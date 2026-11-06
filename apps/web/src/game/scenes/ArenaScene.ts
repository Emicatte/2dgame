import type { Room } from "@colyseus/sdk";
import {
  AIRBORNE_ALT,
  activeWeapon,
  airWorldFor,
  BTN,
  bodyFits,
  C2S,
  type Circle,
  type CollisionWorld,
  canDamage,
  clamp,
  closestOnBody,
  collisionWorldFor,
  currentSpreadDeg,
  DEFAULT_MAP,
  DIFFICULTY,
  DOWNED,
  ENTER_REACH,
  encodeInput,
  fireIntervalSteps,
  type HitTarget,
  hashString,
  type InputFrame,
  inSector,
  isDifficulty,
  isMapId,
  isTeamMode,
  isVehicleKind,
  lerpAngle,
  MAPS,
  type MapDef,
  type MapId,
  type MatchPhase,
  type MatchState,
  missionById,
  NET,
  type NetEvent,
  NO_WEAPON,
  objectivesFor,
  PLAYER as P,
  PLAYER,
  type PlayerState,
  parseIdList,
  pveWorlds,
  quantizeInput,
  raycastSolids,
  STEP_DT,
  seatOccupant,
  seatWorld,
  secToSteps,
  shotWorldFor,
  tracePellet,
  VEHICLE_STATUS,
  VEHICLES,
  type VehicleDef,
  type VehicleState,
  vehicleCircles,
  WEAPONS,
  type WeaponDef,
  weaponByIndex,
} from "@scrapline/shared";
import Phaser from "phaser";
import { keyLabel, settingsStore } from "../../lib/settings.ts";
import { gameEvents, session, sessionStore } from "../../net/session.ts";
import { currentLoadout } from "../../state/profile.ts";
import { renderMap } from "../art/mapRenderer.ts";
import { TEX, TEX_SCALE } from "../art/textures.ts";
import { sfx } from "../audio/sfx.ts";
import { autopilot } from "../bench/autopilot.ts";
import { Effects } from "../effects/Effects.ts";
import { FlagView, PointView } from "../entities/ObjectiveView.ts";
import { PlayerView } from "../entities/PlayerView.ts";
import { VehicleView } from "../entities/VehicleView.ts";
import { type HudObjective, type HudVehicle, hudStore, uiStore } from "../hudStore.ts";
import { InputManager } from "../input/InputManager.ts";
import { ServerClock } from "../net/clock.ts";
import {
  type RemoteSample,
  SnapshotBuffer,
  VehicleBuffer,
  type VehicleSample,
} from "../net/interpolation.ts";
import { NetMetrics } from "../net/metrics.ts";
import { type PredictEnv, Predictor } from "../net/Predictor.ts";
import { PerfRecorder } from "../perf/PerfRecorder.ts";
import { enemyHitFx, PveLayer } from "../pve/PveLayer.ts";
import { pveHud } from "../pve/pveHud.ts";

interface PickupView {
  id: string;
  base: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  active: boolean;
}

interface QueuedEvent {
  tick: number;
  ev: NetEvent;
}

const STEP_MS = STEP_DT * 1000;
/** px/s → km/h shown on the speedometer (a car body is ~4.5 m long). */
const KMH_PER_PX = 0.18;

interface VehiclePose {
  x: number;
  y: number;
  angle: number;
  alt: number;
  rotor: number;
  speed: number;
}

interface EnterTarget {
  id: string;
  def: VehicleDef;
  seat: number;
}
/** Visible world area stays the same on every screen size (fairness across resolutions). */
const VIEW_W = 1600;
const VIEW_H = 900;

/**
 * The game scene: renders the map, predicts the local player, interpolates everybody else,
 * and turns server events into effects and sound.
 */
export class ArenaScene extends Phaser.Scene {
  private room: Room<unknown, MatchState> | null = null;
  private map: MapDef = MAPS[DEFAULT_MAP];
  private mapImage?: Phaser.GameObjects.Image;
  private lightImages: {
    img: Phaser.GameObjects.Image;
    base: number;
    flicker: number;
    seed: number;
    group?: "power" | "alarm";
  }[] = [];
  /** Outbreak / Survival rendering (enemies, telegraphs, props, doors, hazards). */
  private pve!: PveLayer;
  /** Collision worlds with the current mission doors (null outside PvE maps with doors). */
  private doorWorlds: { world: CollisionWorld; shotWorld: CollisionWorld } | null = null;
  private pickupViews = new Map<string, PickupView>();
  private views = new Map<string, PlayerView>();
  private vehicleViews = new Map<string, VehicleView>();
  private vbuffer = new VehicleBuffer();
  /** Pose of every vehicle as rendered this frame (players on seats follow it). */
  private vehiclePoses = new Map<string, VehiclePose>();
  private prevVehicle = { x: 0, y: 0, angle: 0 };
  private env: PredictEnv = { obstacles: [], vehicleObstacles: [], ridePose: null };
  private enterTarget: EnterTarget | null = null;
  private enterBlocked: string | null = null;
  private seatPending = false;
  private baseZoom = 1;
  private zoomFactor = 1;
  private engineTimer = 0;
  private mapTiles: Phaser.GameObjects.Image[] = [];
  private pendingMap: MapId | null = null;
  private pointViews = new Map<string, PointView>();
  private flagViews = new Map<string, FlagView>();
  private controls!: InputManager;
  private predictor!: Predictor;
  private netMetrics = new NetMetrics();
  private perf: PerfRecorder | null = null;
  private benchStep = 0;
  private clock = new ServerClock();
  private buffer = new SnapshotBuffer();
  private effects!: Effects;
  private crosshair!: Phaser.GameObjects.Graphics;
  private hitMarker!: Phaser.GameObjects.Graphics;
  private hitMarkerLife = 0;
  private hitMarkerLethal = false;
  private accumulator = 0;
  private outbox: InputFrame[] = [];
  private eventQueue: QueuedEvent[] = [];
  private pendingSlot = -1;
  private prevRender = { x: 0, y: 0 };
  private hudTimer = 0;
  private fpsSamples: number[] = [];
  private killedBy: string | null = null;
  private lastPhase: MatchPhase = "lobby";
  private lastCountdownSec = -1;
  private menuCamAngle = 0;
  private ping = 0;
  private pingTimer = 0;
  private stats = { bytesIn: 0, bytesOut: 0, msgsOut: 0, windowStart: 0, kbIn: 0, kbOut: 0, msgsRate: 0 };
  private unsubs: (() => void)[] = [];
  private localAliveSince = 0;
  private cleanupRoom: (() => void) | null = null;

  constructor() {
    super("arena");
  }

  create(): void {
    this.controls = new InputManager();
    this.effects = new Effects(this);
    this.pve = new PveLayer(this, this.effects);
    this.perf = new PerfRecorder(this.game, () => this.children.length);
    this.crosshair = this.add.graphics().setDepth(1000).setScrollFactor(0);
    this.hitMarker = this.add.graphics().setDepth(1001).setScrollFactor(0);
    this.predictor = new Predictor(collisionWorldFor(this.map), 0, airWorldFor(this.map));
    this.loadMap(this.map);
    this.applyQuality();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());
    this.fitCamera();

    this.unsubs.push(
      gameEvents.on("roomChanged", (room) => this.attachRoom(room)),
      gameEvents.on("net", ({ events, tick }) => this.onNetEvents(events, tick)),
      settingsStore.subscribe(() => this.applyQuality()),
      uiStore.subscribe(() => {
        const ui = uiStore.get();
        this.controls.enabled = !ui.menuOpen;
        if (ui.menuOpen) this.controls.reset();
      }),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

    // The session may have joined before this scene existed (page-reload resume and invite links
    // start connecting as soon as the profile loads, while Phaser is still booting): pick up the
    // current room instead of relying on a roomChanged event that was emitted too early.
    const existing = session.room ?? (this.registry.get("room") as Room<unknown, MatchState> | undefined);
    if (existing) this.attachRoom(existing);
    if (import.meta.env.DEV || import.meta.env.VITE_E2E === "true") this.exposeTestHooks();
  }

  /** Read-only hooks for automated browser tests (dev and E2E builds only). */
  private exposeTestHooks() {
    (window as unknown as { __scrapline?: unknown }).__scrapline = {
      selfId: () => this.room?.sessionId ?? null,
      phase: () => this.room?.state?.phase ?? null,
      players: () => {
        const out: {
          id: string;
          x: number;
          y: number;
          alive: boolean;
          hp: number;
          kills: number;
          deaths: number;
        }[] = [];
        this.room?.state?.players.forEach((p, id) => {
          out.push({ id, x: p.x, y: p.y, alive: p.alive, hp: p.hp, kills: p.kills, deaths: p.deaths });
        });
        return out;
      },
      rendered: (id: string) => {
        const v = this.views.get(id);
        return v ? { x: v.root.x, y: v.root.y, visible: v.root.visible } : null;
      },
      toScreen: (x: number, y: number) => {
        const cam = this.cameras.main;
        return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
      },
      predictor: () => ({ corrections: this.predictor.corrections, pending: this.predictor.pendingCount }),
      vehicles: () => {
        const out: {
          id: string;
          kind: string;
          x: number;
          y: number;
          angle: number;
          alt: number;
          hp: number;
          status: number;
          seats: string[];
        }[] = [];
        this.room?.state?.vehicles.forEach((v, id) => {
          out.push({
            id,
            kind: v.kind,
            x: v.x,
            y: v.y,
            angle: v.angle,
            alt: v.alt,
            hp: v.hp,
            status: v.status,
            seats: [v.s0, v.s1, v.s2, v.s3],
          });
        });
        return out;
      },
      mount: () => {
        const me = this.room?.state?.players.get(this.room.sessionId);
        return me ? { vehicle: me.vehicle, seat: me.seat } : null;
      },
      enterTarget: () => this.enterTarget?.id ?? null,
      objectives: () => {
        const out: {
          id: string;
          kind: string;
          team: number;
          x: number;
          y: number;
          carrier: string;
          home: boolean;
        }[] = [];
        this.room?.state?.objectives.forEach((o, id) => {
          out.push({ id, kind: o.kind, team: o.team, x: o.x, y: o.y, carrier: o.carrier, home: o.home });
        });
        return out;
      },
      flagStand: (team: 1 | 2) => objectivesFor(this.map).flags[team],
      renderedVehicle: (id: string) => {
        const p = this.vehiclePoses.get(id);
        return p ? { x: p.x, y: p.y, angle: p.angle, alt: p.alt } : null;
      },
      net: () => ({
        ...this.netMetrics.snapshot(performance.now(), this.predictor),
        seq: this.predictor.lastSeq,
        fps: this.fpsSamples.length
          ? Math.round(1000 / (this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length))
          : 0,
        frameP95Ms: Math.round(
          [...this.fpsSamples].sort((a, b) => a - b)[Math.floor(this.fpsSamples.length * 0.95)] ?? 0,
        ),
        frameMaxMs: Math.round(Math.max(0, ...this.fpsSamples)),
        stalled: this.netMetrics.isStalled,
        local: { x: this.predictor.sim.x, y: this.predictor.sim.y },
        ammo: this.predictor.sim.slots.map((sl) => ({ mag: sl.mag, reserve: sl.reserve })),
      }),
      perf: () => this.perf?.snapshot() ?? null,
      pve: () => {
        const st = this.room?.state;
        const me = st?.players.get(this.room?.sessionId ?? "");
        if (!st) return null;
        return {
          mode: st.mode,
          mission: st.pve.mission,
          step: st.pve.step,
          doors: st.pve.doors,
          flags: st.pve.flags,
          power: st.pve.power,
          alarm: st.pve.alarm,
          status: st.pve.status,
          wave: st.pve.wave,
          left: st.pve.left,
          zombies: st.zombies.size,
          rendered: this.pve.enemyCount,
          downed: !!me?.downed,
          hp: me?.hp ?? 0,
        };
      },
      /**
       * Test-only co-op bot (dev and E2E builds): walks the waypoints, shoots the nearest infected
       * within range, holds E at the last waypoint when asked. Uses the benchmark autopilot path, so
       * inputs go through the normal prediction and network pipeline.
       */
      walkTo: (points: { x: number; y: number }[], opts: { fire?: boolean; interact?: boolean } = {}) => {
        const path = points.map((p) => ({ ...p }));
        this.autoDone = false;
        autopilot.set((_step, me) => {
          let mx = 0;
          let my = 0;
          while (path.length > 0 && Math.hypot(path[0]!.x - me.x, path[0]!.y - me.y) < 22) path.shift();
          const wp = path[0];
          if (wp) {
            const dx = wp.x - me.x;
            const dy = wp.y - me.y;
            mx = Math.abs(dx) > 8 ? Math.sign(dx) : 0;
            my = Math.abs(dy) > 8 ? Math.sign(dy) : 0;
          } else {
            this.autoDone = true;
          }
          let aim = wp ? Math.atan2(wp.y - me.y, wp.x - me.x) : 0;
          let buttons = 0;
          if (opts.fire) {
            let best: { x: number; y: number; d: number } | null = null;
            for (const t of this.pve.targets()) {
              const d = Math.hypot(t.x - me.x, t.y - me.y);
              if (d < 520 && (!best || d < best.d)) best = { x: t.x, y: t.y, d };
            }
            if (best) {
              aim = Math.atan2(best.y - me.y, best.x - me.x);
              buttons |= BTN.FIRE;
            }
          }
          if (opts.interact && !wp) buttons |= BTN.INTERACT;
          return { mx, my, aim, buttons };
        });
      },
      autoDone: () => this.autoDone,
      stopAuto: () => autopilot.set(null),
      perfReset: () => this.perf?.reset(),
      createDebugRoom: (
        spawns: { x: number; y: number }[],
        map: MapId = "industrial",
        vehicles?: { kind: string; x: number; y: number; angle: number }[],
      ) =>
        session.createPrivate(currentLoadout(), map, {
          debugSpawns: spawns,
          ...(vehicles ? { debugVehicles: vehicles } : {}),
        }),
    };
  }

  private teardown() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.cleanupRoom?.();
    this.controls?.destroy();
    this.perf?.destroy();
    this.perf = null;
  }

  private applyQuality() {
    const high = settingsStore.get().quality === "high";
    for (const l of this.lightImages) l.img.setVisible(high || l.base > 0.45);
    const cam = this.cameras.main;
    if (this.renderer.type === Phaser.WEBGL) {
      cam.filters.external.clear();
      if (high) cam.filters.external.addVignette(0.5, 0.5, 0.95, 0.35);
    }
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const zoom = Math.min(this.scale.width / VIEW_W, this.scale.height / VIEW_H);
    this.baseZoom = clamp(zoom, 0.5, 2);
    cam.setZoom(this.baseZoom * this.zoomFactor);
    cam.setBounds(0, 0, this.map.width, this.map.height);
  }

  // ---------------------------------------------------------------- map

  private loadMap(map: MapDef) {
    this.map = map;
    const key = `map-${map.id}`;
    this.mapImage?.destroy();
    this.mapImage = undefined;
    for (const t of this.mapTiles) t.destroy();
    this.mapTiles = [];
    if (map.large) {
      // Large maps are baked once and sliced into tiles: a single texture would exceed the GPU's
      // maximum texture size on many devices.
      const TILE = 1024;
      if (!this.textures.exists(`${key}-0-0`)) {
        const full = renderMap(map);
        for (let ty = 0; ty < map.height; ty += TILE) {
          for (let tx = 0; tx < map.width; tx += TILE) {
            const w = Math.min(TILE, map.width - tx);
            const h = Math.min(TILE, map.height - ty);
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            c.getContext("2d")!.drawImage(full, tx, ty, w, h, 0, 0, w, h);
            this.addStaticCanvas(`${key}-${tx}-${ty}`, c);
          }
        }
      }
      for (let ty = 0; ty < map.height; ty += TILE) {
        for (let tx = 0; tx < map.width; tx += TILE) {
          this.mapTiles.push(this.add.image(tx, ty, `${key}-${tx}-${ty}`).setOrigin(0).setDepth(0));
        }
      }
    } else {
      if (!this.textures.exists(key)) this.addStaticCanvas(key, renderMap(map));
      this.mapImage = this.add.image(0, 0, key).setOrigin(0).setDepth(0);
    }
    this.cameras.main.setBackgroundColor(map.theme.fog);

    for (const l of this.lightImages) l.img.destroy();
    this.lightImages = map.lights.map((l, i) => ({
      img: this.add
        .image(l.x, l.y, TEX.glowSoft)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(l.color)
        .setAlpha(l.intensity)
        .setDisplaySize(l.radius * 2, l.radius * 2)
        .setDepth(30),
      base: l.intensity,
      flicker: l.flicker ?? 0,
      seed: i * 13.37,
      ...(l.group ? { group: l.group } : {}),
    }));
    this.doorWorlds = null;

    for (const pv of this.pickupViews.values()) {
      pv.base.destroy();
      pv.icon.destroy();
      pv.glow.destroy();
    }
    this.pickupViews.clear();
    for (const p of map.pickups) {
      const color = p.kind === "health" ? 0xff6b6b : p.kind === "ammo" ? 0xffd27a : 0x9fe7ff;
      const glow = this.add
        .image(p.x, p.y, TEX.glow)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(color)
        .setAlpha(0.35)
        .setDisplaySize(90, 90)
        .setDepth(8);
      const base = this.add
        .image(p.x, p.y, TEX.pickupBase)
        .setScale(1 / TEX_SCALE)
        .setTint(color)
        .setDepth(9);
      const iconKey =
        p.kind === "health"
          ? TEX.pickupHealth
          : p.kind === "ammo"
            ? TEX.pickupAmmo
            : TEX.weapon(p.weapon ?? "rifle");
      const icon = this.add
        .image(p.x, p.y, iconKey)
        .setScale((p.kind === "weapon" ? 1.1 : 0.8) / TEX_SCALE)
        .setDepth(10);
      this.pickupViews.set(p.id, { id: p.id, base, icon, glow, x: p.x, y: p.y, active: true });
    }
    this.predictor?.setWorld(collisionWorldFor(map), airWorldFor(map));
    for (const v of this.vehicleViews.values()) v.destroy();
    this.vehicleViews.clear();
    this.vbuffer.clear();
    this.clearObjectiveViews();
    this.fitCamera();
  }

  /**
   * Registers a baked canvas as a plain image texture. `addCanvas` would wrap it in a
   * CanvasTexture, which reads every pixel back (getImageData) for pixel access the map never
   * needs: seconds on large maps with software rendering.
   */
  private addStaticCanvas(key: string, canvas: HTMLCanvasElement) {
    this.textures.addImage(key, canvas as unknown as HTMLImageElement);
  }

  private clearObjectiveViews() {
    for (const v of this.pointViews.values()) v.destroy();
    for (const v of this.flagViews.values()) v.destroy();
    this.pointViews.clear();
    this.flagViews.clear();
  }

  /** Creates / removes the views of Domination points and CTF flags to match the state. */
  private syncObjectiveViews(state: MatchState) {
    if (state.mapId !== this.map.id) return;
    state.objectives.forEach((o, id) => {
      if (o.kind === "point" && !this.pointViews.has(id)) {
        this.pointViews.set(id, new PointView(this, o.x, o.y, id));
      } else if (o.kind === "flag" && !this.flagViews.has(id) && (o.team === 1 || o.team === 2)) {
        const home = objectivesFor(this.map).flags[o.team];
        this.flagViews.set(id, new FlagView(this, o.team, home.x, home.y));
      }
    });
    for (const [id, v] of this.pointViews) {
      if (state.objectives.get(id)?.kind !== "point") {
        v.destroy();
        this.pointViews.delete(id);
      }
    }
    for (const [id, v] of this.flagViews) {
      if (state.objectives.get(id)?.kind !== "flag") {
        v.destroy();
        this.flagViews.delete(id);
      }
    }
  }

  private renderObjectives(state: MatchState, dtSec: number) {
    for (const [id, v] of this.pointViews) {
      const o = state.objectives.get(id);
      if (o) v.update(o.team, o.progress);
    }
    for (const [id, v] of this.flagViews) {
      const o = state.objectives.get(id);
      if (!o) continue;
      const carrier = o.carrier ? this.views.get(o.carrier) : undefined;
      if (carrier?.visibleAlive) v.update(carrier.root.x, carrier.root.y, true, dtSec);
      else v.update(o.x, o.y, false, dtSec);
    }
  }

  // ---------------------------------------------------------------- room

  private attachRoom(room: Room<unknown, MatchState> | null) {
    this.cleanupRoom?.();
    this.cleanupRoom = null;
    this.room = room;
    this.registry.set("room", room ?? undefined);
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    for (const v of this.vehicleViews.values()) v.destroy();
    this.vehicleViews.clear();
    this.vbuffer.clear();
    this.vehiclePoses.clear();
    this.clearObjectiveViews();
    this.pve.clear();
    pveHud.reset();
    this.doorWorlds = null;
    this.buffer.clear();
    this.clock.reset();
    this.eventQueue = [];
    this.outbox = [];
    this.accumulator = 0;
    this.killedBy = null;
    hudStore.patch({ ready: false });
    if (!room) return;

    this.predictor = new Predictor(
      collisionWorldFor(this.map),
      hashString(room.sessionId),
      airWorldFor(this.map),
    );
    this.netMetrics = new NetMetrics();
    const onState = (state: MatchState) => this.onPatch(state);
    const listener = room.onStateChange(onState);
    const onReconnect = () => {
      this.predictor.resetStream();
      this.netMetrics.resetStream();
      this.clock.reset();
    };
    room.onReconnect(onReconnect);
    const rawHandler = (ev: MessageEvent) => {
      const d = ev.data as ArrayBuffer | string;
      this.stats.bytesIn += typeof d === "string" ? d.length : d.byteLength;
    };
    const ws = (room.connection as unknown as { transport?: { ws?: WebSocket } }).transport?.ws;
    ws?.addEventListener("message", rawHandler);
    this.cleanupRoom = () => {
      room.onStateChange.remove(onState);
      room.onReconnect.remove(onReconnect);
      ws?.removeEventListener("message", rawHandler);
      void listener;
    };
    if (room.state) this.onPatch(room.state);
  }

  private onPatch(state: MatchState) {
    if (!this.room) return;
    const mapId = isMapId(state.mapId) ? state.mapId : DEFAULT_MAP;
    if (mapId !== this.map.id && this.pendingMap !== mapId) {
      // Baking a map takes a moment on slow devices: do it on the next frame so joining a room
      // (whose first state carries the map) shows the lobby at once instead of freezing on it.
      this.pendingMap = mapId;
      this.time.delayedCall(0, () => {
        if (this.pendingMap !== mapId) return;
        this.pendingMap = null;
        this.loadMap(MAPS[mapId]);
      });
    }
    if (state.tickRate) this.clock.setTickRate(state.tickRate);

    const phase = state.phase as MatchPhase;
    const inMatch = phase === "countdown" || phase === "playing";
    if (inMatch) this.clock.onSnapshot(state.tick);

    const samples = new Map<string, RemoteSample>();
    state.players.forEach((p, id) => {
      samples.set(id, {
        x: p.x,
        y: p.y,
        aim: p.aim,
        alive: p.alive,
        weapon: p.weapon,
        hp: p.hp,
        protected: p.protected,
        reloading: p.reloading,
      });
      if (!this.views.has(id)) {
        const isLocal = id === this.room!.sessionId;
        this.views.set(id, new PlayerView(this, id, isLocal, p.name, p.skin));
      }
      const v = this.views.get(id)!;
      v.setSkin(p.skin);
      v.setName(p.name);
      v.setTeam(isTeamMode(state.mode) ? p.team : 0);
    });
    for (const [id, v] of this.views) {
      if (!state.players.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
    }
    if (inMatch) this.buffer.push(state.tick, samples);

    const vsamples = new Map<string, VehicleSample>();
    state.vehicles.forEach((v, id) => {
      vsamples.set(id, {
        x: v.x,
        y: v.y,
        angle: v.angle,
        alt: v.alt,
        rotor: v.rotor,
        hp: v.hp,
        status: v.status,
        speed: Math.hypot(v.vx, v.vy),
      });
      const existing = this.vehicleViews.get(id);
      if (existing && existing.kind !== v.kind) {
        existing.destroy();
        this.vehicleViews.delete(id);
      }
      if (!this.vehicleViews.has(id) && isVehicleKind(v.kind)) {
        const view = new VehicleView(this, id, v.kind);
        view.onSmoke = (x, y, burning) => this.effects.vehicleSmoke(x, y, burning);
        view.onDust = (x, y) => this.effects.dust(x, y);
        this.vehicleViews.set(id, view);
      }
    });
    for (const [id, v] of this.vehicleViews) {
      if (!state.vehicles.has(id)) {
        v.destroy();
        this.vehicleViews.delete(id);
      }
    }
    if (inMatch) this.vbuffer.push(state.tick, vsamples);
    this.syncObjectiveViews(state);
    if (state.mapId === this.map.id) {
      this.pve.setContext(this.map, state);
      if (this.pve.active && this.pve.doorsChanged(state)) this.applyDoors(state);
      if (phase === "lobby") this.pve.resetMatch();
      this.pve.onPatch(state, inMatch);
    }

    const me = state.players.get(this.room.sessionId);
    if (me && inMatch) {
      const wasAlive = this.predictorAlive;
      this.predictorAlive = me.alive && phase === "playing";
      if (me.alive && !wasAlive) this.localAliveSince = performance.now();
      this.predictor.downed = me.downed;
      const wasDriving = this.predictor.driving;
      this.predictor.reconcile(
        me,
        this.predictorAlive,
        me.vehicle ? state.vehicles.get(me.vehicle) : undefined,
        this.env,
      );
      if (this.predictor.driving && !wasDriving && this.predictor.vehicle) {
        const v = this.predictor.vehicle;
        this.prevVehicle = { x: v.x, y: v.y, angle: v.angle };
      }
      this.netMetrics.onPatch(me.ack, this.predictor.pendingCount, performance.now());
    }
    state.pickups.forEach((pk, id) => {
      const v = this.pickupViews.get(id);
      if (v) v.active = pk.active;
    });

    if (phase !== this.lastPhase) this.onPhaseChange(this.lastPhase, phase);
    this.lastPhase = phase;
  }

  private predictorAlive = false;
  private lastFrameAt = 0;

  private onPhaseChange(_from: MatchPhase, to: MatchPhase) {
    if (to === "countdown" || to === "lobby") pveHud.reset();
    if (to === "countdown") {
      this.lastCountdownSec = -1;
      this.controls.reset();
    }
    if (to === "playing") sfx.countdown(true);
    if (to === "results") {
      const s = sessionStore.get();
      const me = this.room?.sessionId;
      sfx.stinger(s.winnerId === me || this.room?.state.winnerId === me);
      this.controls.reset();
    }
  }

  // ---------------------------------------------------------------- events

  private onNetEvents(events: NetEvent[], tick: number) {
    const self = this.room?.sessionId;
    for (const ev of events) {
      // Feedback about my own actions is instant; other players' visuals wait for the
      // interpolation timeline so tracers leave their guns where you see them.
      switch (ev.t) {
        case "hit":
          if (ev.p === self) {
            this.hitMarkerLife = 140;
            this.hitMarkerLethal = ev.k;
            sfx.hitMarker(ev.k);
            this.effects.damageNumber(ev.x, ev.y, ev.dmg, ev.k);
            hudStore.patch({ hitConfirm: hudStore.get().hitConfirm + 1 });
          }
          if (ev.v === self) {
            const me = this.views.get(self);
            const shooter = this.views.get(ev.p);
            const angle =
              me && shooter ? Math.atan2(shooter.root.y - me.root.y, shooter.root.x - me.root.x) : 0;
            sfx.hurt();
            this.cameras.main.shake(120, 0.004 * settingsStore.get().screenShake);
            hudStore.patch({ damageFlash: hudStore.get().damageFlash + 1, damageAngle: angle });
          }
          break;
        case "kill":
          if (ev.v === self) {
            this.killedBy = ev.k;
            const me = this.views.get(self);
            if (me) this.effects.death(me.root.x, me.root.y, 0xff7a2e);
            sfx.death(true);
          }
          break;
        case "spawn":
          if (ev.p === self) {
            this.killedBy = null;
            this.effects.spawn(ev.x, ev.y);
            sfx.spawn();
          }
          break;
        case "pickup":
          if (ev.p === self) sfx.pickup();
          break;
        case "seat":
          if (ev.p === self) sfx.door(true);
          break;
        case "vhit":
          if (ev.p === self) {
            this.hitMarkerLife = 140;
            this.hitMarkerLethal = false;
            sfx.armorHit();
            this.effects.damageNumber(ev.x, ev.y, ev.dmg, false);
            hudStore.patch({ hitConfirm: hudStore.get().hitConfirm + 1 });
          }
          break;
        case "wreck":
          if (this.predictor.mount?.vehicleId === ev.v) {
            this.cameras.main.shake(260, 0.012 * settingsStore.get().screenShake);
          }
          break;
        case "obj":
          if (ev.k === "capture" || ev.k === "score") sfx.pickup();
          else if (ev.k === "take" || ev.k === "return") sfx.door(true);
          break;
        case "crash":
          if (this.predictor.mount?.vehicleId === ev.v || ev.o === self) {
            this.cameras.main.shake(140, Math.min(0.01, ev.f / 60000) * settingsStore.get().screenShake);
          }
          break;
        default:
          break;
      }
      if (this.pve.active) this.onPveEvent(ev);
      this.eventQueue.push({ tick, ev });
    }
  }

  /** Immediate PvE feedback (hit markers on enemies, damage direction from enemies, banners). */
  private onPveEvent(ev: NetEvent) {
    const self = this.room?.sessionId;
    switch (ev.t) {
      case "zhit":
        if (ev.p === self) {
          this.hitMarkerLife = 140;
          this.hitMarkerLethal = ev.k;
          sfx.hitMarker(ev.k);
          this.effects.damageNumber(ev.x, ev.y, ev.dmg, ev.k);
          hudStore.patch({ hitConfirm: hudStore.get().hitConfirm + 1 });
        }
        break;
      case "hit":
        if (ev.v === self && ev.p.startsWith("z:")) {
          const me = this.views.get(self);
          const from = this.pve.position(ev.p);
          if (me && from) hudStore.patch({ damageAngle: Math.atan2(from.y - me.root.y, from.x - me.root.x) });
        }
        break;
      case "down":
        if (ev.p === self) {
          sfx.death(true);
          this.cameras.main.shake(200, 0.006 * settingsStore.get().screenShake);
        }
        break;
      case "revive":
        if (ev.p === self || ev.by === self) sfx.spawn();
        break;
      case "boom": {
        const me = this.views.get(self ?? "");
        if (me && Math.hypot(me.root.x - ev.x, me.root.y - ev.y) < 500) {
          this.cameras.main.shake(220, 0.01 * settingsStore.get().screenShake);
        }
        break;
      }
      default:
        break;
    }
    pveHud.onEvent(ev, self ?? "");
  }

  /** Mission doors changed: every machine rebuilds the same collision worlds (exact prediction). */
  private applyDoors(state: MatchState) {
    const mission = state.mode === "outbreak" ? missionById(state.pve.mission) : undefined;
    const doors = mission?.doors ?? [];
    const open = state.mode === "survival" ? new Set(doors.map((d) => d.id)) : parseIdList(state.pve.doors);
    this.doorWorlds = doors.length > 0 ? pveWorlds(this.map, doors, open) : null;
    this.predictor.setWorld(this.doorWorlds?.world ?? collisionWorldFor(this.map), airWorldFor(this.map));
  }

  /** What bullets meet at ground level (mission doors included). */
  private shotWorld(): CollisionWorld {
    return this.doorWorlds?.shotWorld ?? shotWorldFor(this.map);
  }

  private playQueuedEvents(renderTick: number) {
    const self = this.room?.sessionId;
    const listener = this.views.get(self ?? "")?.root;
    const lx = listener?.x ?? this.cameras.main.midPoint.x;
    const ly = listener?.y ?? this.cameras.main.midPoint.y;
    const spatial = (x: number, y: number) => ({
      distance: Math.hypot(x - lx, y - ly),
      pan: clamp((x - lx) / 900, -1, 1),
    });
    while (this.eventQueue.length > 0) {
      const q = this.eventQueue[0]!;
      if (q.tick > renderTick + 0.5 && q.tick - renderTick < 40) break;
      this.eventQueue.shift();
      const ev = q.ev;
      if (this.pve.active) this.playPveEvent(ev, spatial);
      switch (ev.t) {
        case "shot": {
          if (ev.p === self) break;
          const def = weaponByIndex(ev.w);
          const view = this.views.get(ev.p);
          if (!def || !view?.visibleAlive) break;
          const ox = view.root.x;
          const oy = view.root.y;
          const aim = (ev.a[0] ?? 0) / 1000;
          const mx = ox + Math.cos(aim) * 30;
          const my = oy + Math.sin(aim) * 30;
          const ends = ev.a.map((a, i) => {
            const ang = a / 1000;
            const d = ev.d[i] ?? 0;
            return {
              x: ev.x + Math.cos(ang) * d + (ox - ev.x),
              y: ev.y + Math.sin(ang) * d + (oy - ev.y),
              wall: d < def.rangePx - 1,
              player: false,
            };
          });
          this.effects.shot(def, mx, my, aim, ends);
          view.recoil(def);
          const s = spatial(ox, oy);
          sfx.shot(def, s.distance, s.pan);
          break;
        }
        case "hit": {
          const from = this.views.get(ev.p);
          const angle = from ? Math.atan2(ev.y - from.root.y, ev.x - from.root.x) : 0;
          this.effects.playerHit(ev.x, ev.y, angle, ev.k);
          break;
        }
        case "kill": {
          if (ev.v !== self) {
            const v = this.views.get(ev.v);
            if (v) {
              this.effects.death(v.root.x, v.root.y, 0xc8622f);
              const s = spatial(v.root.x, v.root.y);
              sfx.death(false, s.distance, s.pan);
            }
          }
          break;
        }
        case "spawn":
          if (ev.p !== self) this.effects.spawn(ev.x, ev.y);
          break;
        case "pickup": {
          const pv = this.pickupViews.get(ev.id);
          if (pv) this.effects.pickup(pv.x, pv.y);
          break;
        }
        case "reload":
          if (ev.p !== self) {
            const v = this.views.get(ev.p);
            if (v) {
              const s = spatial(v.root.x, v.root.y);
              sfx.reload(false, s.distance, s.pan);
            }
          }
          break;
        case "dash":
          if (ev.p !== self) {
            const v = this.views.get(ev.p);
            if (v) {
              const s = spatial(v.root.x, v.root.y);
              sfx.dash(false, s.distance, s.pan);
            }
          }
          break;
        case "seat":
          if (ev.p !== self) {
            const pose = this.vehiclePoses.get(ev.v);
            if (pose) {
              const s = spatial(pose.x, pose.y);
              sfx.door(false, s.distance, s.pan);
            }
          }
          break;
        case "vhit":
          if (ev.p !== self) this.effects.impact(ev.x, ev.y, Math.random() * Math.PI * 2);
          break;
        case "wreck": {
          this.effects.explosion(ev.x, ev.y);
          const s = spatial(ev.x, ev.y);
          sfx.explosion(s.distance, s.pan);
          break;
        }
        case "crash": {
          this.effects.crash(ev.x, ev.y, ev.f);
          const s = spatial(ev.x, ev.y);
          sfx.crash(ev.f, s.distance, s.pan);
          break;
        }
        case "vspawn": {
          const pose = this.vehiclePoses.get(ev.v);
          if (pose) this.effects.spawn(pose.x, pose.y);
          break;
        }
      }
    }
  }

  private playPveEvent(ev: NetEvent, spatial: (x: number, y: number) => { distance: number; pan: number }) {
    this.pve.playEvent(ev);
    switch (ev.t) {
      case "zhit": {
        const from = this.views.get(ev.p);
        const angle = from ? Math.atan2(ev.y - from.root.y, ev.x - from.root.x) : 0;
        enemyHitFx(this.effects, ev.x, ev.y, angle, { lethal: ev.k, armored: !!ev.a, weakSpot: !!ev.c });
        break;
      }
      case "zatk": {
        const s = spatial(ev.x, ev.y);
        sfx.zombieAttack(ev.k, s.distance, s.pan);
        break;
      }
      case "zdie": {
        const s = spatial(ev.x, ev.y);
        sfx.zombieDeath(s.distance, s.pan);
        break;
      }
      case "boom": {
        const s = spatial(ev.x, ev.y);
        sfx.explosion(s.distance, s.pan);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- loop

  override update(): void {
    // Real elapsed time: Phaser's smoothed delta would slow the fixed-step simulation down on
    // low frame rates, making the player move slower than the server's real-time budget.
    const now = performance.now();
    const deltaMs = this.lastFrameAt ? now - this.lastFrameAt : 16.7;
    this.lastFrameAt = now;
    const dt = Math.min(deltaMs, 250);
    this.fpsSamples.push(deltaMs);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();

    const state = this.room?.state;
    const phase = (state?.phase as MatchPhase | undefined) ?? "lobby";
    const inMatch = !!state && (phase === "countdown" || phase === "playing");

    this.animateLights();
    this.animatePickups();
    this.effects.update(dt);
    if (state) this.renderObjectives(state, dt / 1000);

    if (!inMatch || !this.room) {
      this.updateMenuCamera(dt);
      this.crosshair.clear();
      for (const v of this.views.values()) v.root.setVisible(false);
      this.controls.enabled = false;
      this.updateHud(dt, false);
      return;
    }
    this.controls.enabled = !uiStore.get().menuOpen;
    if (!this.clock.ready) return;

    this.sampleEdgeInputs();
    const stalled = this.netMetrics.updateStall(now, this.predictor.pendingCount, NET.inputStallMs, dt);
    if (stalled || sessionStore.get().status === "reconnecting") {
      // Connection interrupted: hold the local player instead of predicting ever further ahead of
      // a server that is not receiving the inputs. Resumes as soon as the ack moves again. While
      // the SDK reconnects nothing is produced either: inputs it buffers would be re-sent after
      // newer ones and rejected as out of order.
      this.accumulator = 0;
      this.prevRender = { x: this.predictor.sim.x, y: this.predictor.sim.y };
      const v = this.predictor.vehicle;
      if (v) this.prevVehicle = { x: v.x, y: v.y, angle: v.angle };
    } else {
      this.accumulator += dt;
      let steps = 0;
      this.env = this.computeEnv(state, this.clock.renderTick());
      while (this.accumulator >= STEP_MS && steps < 15) {
        this.accumulator -= STEP_MS;
        steps++;
        this.prevRender = { x: this.predictor.sim.x, y: this.predictor.sim.y };
        const v = this.predictor.vehicle;
        if (v) this.prevVehicle = { x: v.x, y: v.y, angle: v.angle };
        this.fixedStep(phase);
      }
      if (steps >= 15) {
        this.netMetrics.lostStepMs += this.accumulator;
        this.accumulator = 0;
      }
    }
    this.flushInputs();
    this.netMetrics.onFrame(now);
    if (this.buffer.newestTick < this.clock.renderTick(now)) this.netMetrics.starvedFrames++;

    this.predictor.decay(dt / 1000);
    const renderTick = this.clock.renderTick();
    this.playQueuedEvents(renderTick);
    this.updateEnterTarget(state, renderTick);
    this.renderVehicles(renderTick, dt / 1000, state);
    this.renderPlayers(renderTick, dt / 1000, state);
    if (this.pve.active) {
      const me = this.views.get(this.room.sessionId);
      this.pve.update(renderTick, dt / 1000, state, state.tickRate || NET.serverTickRate, {
        x: me?.root.x ?? this.cameras.main.midPoint.x,
        y: me?.root.y ?? this.cameras.main.midPoint.y,
      });
      this.drawDowned(state);
      this.updateAmbience(dt, state);
    }
    this.updateEngine(dt, state);
    this.updateCamera(dt);
    this.drawCrosshair();
    this.updatePing(dt);
    this.updateHud(dt, true);
  }

  private sampleEdgeInputs() {
    if (this.controls.consume("slot1")) this.pendingSlot = 0;
    if (this.controls.consume("slot2")) this.pendingSlot = 1;
    if (this.controls.consume("slot3")) this.pendingSlot = 2;
    if (this.controls.consume("seat")) this.seatPending = true;
    const sb = this.controls.isDown("scoreboard");
    if (sb !== uiStore.get().scoreboard) uiStore.patch({ scoreboard: sb });
  }

  private aimAngle(): number {
    const pointer = this.input_pointer();
    const sim = this.predictor.sim;
    return Math.atan2(pointer.worldY - sim.y, pointer.worldX - sim.x);
  }

  private input_pointer() {
    const p = this.game.input.activePointer;
    p.updateWorldPoint(this.cameras.main);
    return p;
  }

  private fixedStep(phase: MatchPhase) {
    const i = this.controls;
    let buttons = 0;
    if (i.mouseDown) buttons |= BTN.FIRE;
    if (i.isDown("reload")) buttons |= BTN.RELOAD;
    if (i.isDown("dash")) buttons |= BTN.DASH;
    if (i.isDown("interact")) buttons |= BTN.INTERACT;
    if (this.seatPending) {
      buttons |= BTN.SEAT;
      this.seatPending = false;
    }
    const mount = this.predictor.mount;
    if (mount) {
      // Seated: fire only through the seat's arc, as the vehicle is rendered (the server checks
      // the same pose through lag compensation). Drivers and pilots never fire.
      const pose = this.env.ridePose;
      const aimNow = this.aimAngle();
      if (mount.seat === 0 || !pose || !inSector(mount.seatDef, pose.angle, aimNow)) buttons &= ~BTN.FIRE;
    }
    const ap = autopilot.get()?.(this.benchStep++, this.predictor.sim);
    const frame = quantizeInput({
      seq: this.predictor.nextSeq(),
      mx: ap ? ap.mx : (i.isDown("right") ? 1 : 0) - (i.isDown("left") ? 1 : 0),
      my: ap ? ap.my : (i.isDown("down") ? 1 : 0) - (i.isDown("up") ? 1 : 0),
      aim: ap ? ap.aim : this.aimAngle(),
      buttons: ap ? ap.buttons : buttons,
      slot: this.pendingSlot,
      viewTick: Math.max(0, this.clock.renderTick()),
    });
    this.pendingSlot = -1;
    const alive = this.predictorAlive && phase === "playing";
    this.predictor.predict(
      frame,
      alive,
      (e) => {
        switch (e.kind) {
          case "shot":
            this.localShot(e.shot.weapon, e.shot.angles);
            break;
          case "dry":
            sfx.dry();
            break;
          case "reloadStart":
            sfx.reload(true);
            break;
          case "reloadDone":
            sfx.reloadDone();
            break;
          case "swap":
            sfx.swap();
            break;
          case "dash":
            if (!this.predictor.mount) sfx.dash(true);
            break;
        }
      },
      this.env,
    );
    this.outbox.push(frame);
    this.netMetrics.generated++;
  }

  private flushInputs() {
    if (this.outbox.length === 0 || !this.room) return;
    while (this.outbox.length > 0) {
      const batch = this.outbox.splice(0, NET.maxInputsPerMessage).map(encodeInput);
      this.room.send(C2S.INPUT, { i: batch });
      this.netMetrics.sent += batch.length;
      this.netMetrics.messages += 1;
      this.stats.msgsOut += 1;
      this.stats.bytesOut += 4 + batch.length * 24;
    }
  }

  private localShot(weaponIndex: number, angles: number[]) {
    const def = weaponByIndex(weaponIndex);
    if (!def) return;
    const me = this.views.get(this.room?.sessionId ?? "");
    const sim = this.predictor.sim;
    const ox = sim.x;
    const oy = sim.y;
    const world = this.shotWorld();
    const renderTick = this.clock.renderTick();
    const targets: HitTarget[] = [];
    const state = this.room?.state;
    const teams = !!state && isTeamMode(state.mode);
    const rules = { teams, friendlyFire: teams && !!state?.friendlyFire };
    const selfId = this.room?.sessionId ?? "";
    const myTeam = state?.players.get(selfId)?.team ?? 0;
    const myVehicle = this.predictor.mount?.vehicleId ?? "";
    for (const [id, v] of this.views) {
      if (id === this.room?.sessionId || !v.visibleAlive) continue;
      const ps = state?.players.get(id);
      // Same rule as the server: without friendly fire, tracers pass through teammates.
      const team = ps?.team ?? 0;
      if (!canDamage({ id: selfId, team: myTeam }, { id, team }, rules)) continue;
      if (ps?.vehicle) {
        const vs = state?.vehicles.get(ps.vehicle);
        const pose = this.vehiclePoses.get(ps.vehicle);
        const seat = vs && isVehicleKind(vs.kind) ? VEHICLES[vs.kind].seats[ps.seat] : undefined;
        if (!pose || !seat || seat.exposure <= 0 || ps.vehicle === myVehicle) continue;
        const at = seatWorld(pose, seat);
        targets.push({
          id,
          x: at.x,
          y: at.y,
          r: 13,
          air: pose.alt >= AIRBORNE_ALT,
          group: ps.vehicle,
          occupant: true,
        });
        continue;
      }
      const s = this.buffer.sample(id, renderTick);
      if (s?.alive) targets.push({ id, x: s.x, y: s.y, r: PLAYER.radius });
    }
    state?.vehicles.forEach((vs, id) => {
      const pose = this.vehiclePoses.get(id);
      if (!pose || vs.status !== VEHICLE_STATUS.READY || id === myVehicle || !isVehicleKind(vs.kind)) return;
      const team = this.vehicleTeam(vs, state);
      if (!canDamage({ id: selfId, team: myTeam }, { id: `veh:${id}`, team }, rules)) return;
      targets.push({
        id: `veh:${id}`,
        x: pose.x,
        y: pose.y,
        r: 0,
        air: pose.alt >= AIRBORNE_ALT,
        body: { angle: pose.angle, def: VEHICLES[vs.kind] },
        group: id,
      });
    });
    if (this.pve.active) targets.push(...this.pve.targets());
    const ride = myVehicle ? this.vehiclePoses.get(myVehicle) : undefined;
    const opts = { airWorld: airWorldFor(this.map), shooterAir: (ride?.alt ?? 0) >= AIRBORNE_ALT };
    const ends = angles.map((a) => {
      const r = tracePellet(world, ox, oy, a, def.rangePx, targets, this.room?.sessionId ?? "", opts);
      return {
        x: ox + Math.cos(a) * r.dist,
        y: oy + Math.sin(a) * r.dist,
        wall: r.hitWall,
        player: !!r.targetId,
      };
    });
    const aim = sim.aim;
    const rx = (me?.root.x ?? ox) + Math.cos(aim) * 30;
    const ry = (me?.root.y ?? oy) + Math.sin(aim) * 30;
    this.effects.shot(def, rx, ry, aim, ends);
    me?.recoil(def);
    sfx.shot(def, 0, 0, true);
    const shake = def.fx.shake * settingsStore.get().screenShake;
    if (shake > 0) this.cameras.main.shake(70, 0.0012 * shake);
  }

  /** Team of a vehicle for damage rules: its first occupant's (0 when empty). */
  private vehicleTeam(vs: VehicleState, state: MatchState): number {
    for (let i = 0; i < 4; i++) {
      const id = seatOccupant(vs, i);
      const p = id ? state.players.get(id) : undefined;
      if (p) return p.team;
    }
    return 0;
  }

  /**
   * Prediction environment for this frame: ground vehicles as obstacles (where they are rendered)
   * and, for a passenger, the pose of the vehicle they ride.
   */
  private computeEnv(state: MatchState, renderTick: number): PredictEnv {
    const obstacles: Circle[] = [];
    const vehicleObstacles: Circle[] = [];
    let ridePose: PredictEnv["ridePose"] = null;
    const mount = this.predictor.mount;
    state.vehicles.forEach((vs, id) => {
      if (!isVehicleKind(vs.kind)) return;
      const sample = this.vbuffer.sample(id, renderTick);
      if (!sample) return;
      if (mount && id === mount.vehicleId) ridePose = { x: sample.x, y: sample.y, angle: sample.angle };
      if (sample.status === VEHICLE_STATUS.GONE || sample.alt >= AIRBORNE_ALT) return;
      const circles = vehicleCircles(sample, VEHICLES[vs.kind]);
      obstacles.push(...circles);
      if (!mount || id !== mount.vehicleId) vehicleObstacles.push(...circles);
    });
    return { obstacles, vehicleObstacles, ridePose };
  }

  /** Mirrors the server's entry rule to show the prompt (the server decides). */
  private updateEnterTarget(state: MatchState, renderTick: number) {
    this.enterTarget = null;
    this.enterBlocked = null;
    const selfId = this.room?.sessionId ?? "";
    const me = state.players.get(selfId);
    if (!me || !this.predictorAlive || me.vehicle) return;
    const sim = this.predictor.sim;
    const teams = isTeamMode(state.mode);
    let best: { t: EnterTarget; d: number } | null = null;
    state.vehicles.forEach((vs, id) => {
      if (!isVehicleKind(vs.kind) || vs.status !== VEHICLE_STATUS.READY) return;
      const sample = this.vbuffer.sample(id, renderTick);
      if (!sample) return;
      const def = VEHICLES[vs.kind];
      const d = closestOnBody(sample, def, sim.x, sim.y).dist;
      if (d > ENTER_REACH) return;
      if (best && d >= best.d) return;
      if (teams) {
        const team = this.vehicleTeam(vs, state);
        if (team !== 0 && team !== me.team) {
          this.enterBlocked = `${def.name}: held by the enemy`;
          return;
        }
      }
      if (sample.speed > def.enterMaxSpeed || sample.alt > 0.05) {
        this.enterBlocked = `${def.name}: wait until it stops`;
        return;
      }
      const seat =
        vs.s0 === "" ? 0 : ([1, 2, 3].find((i) => i < def.seats.length && seatOccupant(vs, i) === "") ?? -1);
      if (seat < 0) {
        this.enterBlocked = `${def.name} is full`;
        return;
      }
      best = { t: { id, def, seat }, d };
    });
    this.enterTarget = (best as { t: EnterTarget; d: number } | null)?.t ?? null;
  }

  private renderVehicles(renderTick: number, dtSec: number, state: MatchState) {
    this.vehiclePoses.clear();
    const mount = this.predictor.mount;
    const quality = settingsStore.get().quality;
    const alpha = this.accumulator / STEP_MS;
    const selfId = this.room?.sessionId ?? "";
    const teams = isTeamMode(state.mode);
    for (const [id, view] of this.vehicleViews) {
      const vs = state.vehicles.get(id);
      if (!vs) continue;
      let pose: VehiclePose;
      const predicted = this.predictor.driving && mount?.vehicleId === id ? this.predictor.vehicle : null;
      if (predicted) {
        pose = {
          x: Phaser.Math.Linear(this.prevVehicle.x, predicted.x, alpha) + this.predictor.offsetX,
          y: Phaser.Math.Linear(this.prevVehicle.y, predicted.y, alpha) + this.predictor.offsetY,
          angle: lerpAngle(this.prevVehicle.angle, predicted.angle, alpha),
          alt: predicted.alt,
          rotor: predicted.rotor,
          speed: Math.hypot(predicted.vx, predicted.vy),
        };
      } else {
        const sample = this.buffer.newestTick ? this.vbuffer.sample(id, renderTick) : null;
        if (!sample) {
          view.root.setVisible(false);
          continue;
        }
        pose = sample;
      }
      this.vehiclePoses.set(id, pose);
      const sample = this.vbuffer.sample(id, renderTick);
      const def = view.def;
      const gunSeat = def.seats.findIndex((x) => !!x.mounted);
      let gunAim: number | null = null;
      if (gunSeat >= 0) {
        const gunner = seatOccupant(vs, gunSeat);
        if (gunner === selfId) gunAim = this.aimAngle();
        else if (gunner) gunAim = this.buffer.sample(gunner, renderTick)?.aim ?? null;
      }
      const driver = vs.s0 ? state.players.get(vs.s0) : undefined;
      const occupied = !!(vs.s0 || vs.s1 || vs.s2 || vs.s3);
      view.update(
        {
          x: pose.x,
          y: pose.y,
          angle: pose.angle,
          alt: pose.alt,
          rotor: pose.rotor,
          hp: sample?.hp ?? vs.hp,
          status: sample?.status ?? vs.status,
          team: teams ? this.vehicleTeam(vs, state) : 0,
          occupied,
          gunAim,
          label: driver && vs.s0 !== selfId ? driver.name : "",
          enterable: this.enterTarget?.id === id,
        },
        dtSec,
        quality,
      );
    }
  }

  private renderPlayers(renderTick: number, dtSec: number, state: MatchState) {
    const self = this.room?.sessionId;
    const alpha = this.accumulator / STEP_MS;
    for (const [id, view] of this.views) {
      const ps = state.players.get(id);
      if (!ps) continue;
      // Seated players follow their vehicle as it is rendered (never a separate interpolation).
      const vs = ps.vehicle ? state.vehicles.get(ps.vehicle) : undefined;
      const pose = ps.vehicle ? this.vehiclePoses.get(ps.vehicle) : undefined;
      const seat = vs && isVehicleKind(vs.kind) ? VEHICLES[vs.kind].seats[ps.seat] : undefined;
      if (pose && seat) {
        const at = seatWorld(pose, seat);
        const hidden = seat.exposure <= 0;
        view.setSeated(true, hidden, pose.alt >= AIRBORNE_ALT);
        if (id === self) {
          const s = this.predictor.sim;
          const sl = s.slots[s.slot];
          view.update(
            at.x,
            at.y,
            this.aimAngle(),
            ps.alive,
            sl?.id ?? NO_WEAPON,
            ps.hp,
            ps.protected,
            dtSec,
            0,
          );
        } else {
          const sample = this.buffer.sample(id, renderTick);
          view.update(
            at.x,
            at.y,
            sample?.aim ?? pose.angle,
            ps.alive,
            sample?.weapon ?? ps.weapon,
            sample?.hp ?? ps.hp,
            false,
            dtSec,
            0,
          );
        }
        continue;
      }
      view.setSeated(false, false, false);
      if (id === self) {
        const s = this.predictor.sim;
        const x = Phaser.Math.Linear(this.prevRender.x, s.x, alpha) + this.predictor.offsetX;
        const y = Phaser.Math.Linear(this.prevRender.y, s.y, alpha) + this.predictor.offsetY;
        const slot = s.slots[s.slot];
        const aim = this.aimAngle();
        const laser = this.laserLength(x, y, aim, slot?.id ?? NO_WEAPON);
        view.update(x, y, aim, ps.alive, slot?.id ?? NO_WEAPON, ps.hp, ps.protected, dtSec, laser);
      } else {
        const sample = this.buffer.sample(id, renderTick);
        if (!sample) {
          view.root.setVisible(false);
          continue;
        }
        const laser = this.laserLength(sample.x, sample.y, sample.aim, sample.weapon);
        view.update(
          sample.x,
          sample.y,
          sample.aim,
          sample.alive,
          sample.weapon,
          sample.hp,
          sample.protected,
          dtSec,
          laser,
        );
      }
    }
  }

  /** Engine / rotor sound of the vehicle the local player sits in. */
  private updateEngine(dt: number, state: MatchState) {
    this.engineTimer -= dt;
    if (this.engineTimer > 0) return;
    this.engineTimer = 90;
    const mount = this.predictor.mount;
    const pose = mount ? this.vehiclePoses.get(mount.vehicleId) : undefined;
    const vs = mount ? state.vehicles.get(mount.vehicleId) : undefined;
    if (!mount || !pose || !vs || vs.status !== VEHICLE_STATUS.READY) {
      sfx.engineSound(0, 0, false);
      return;
    }
    const heli = !!mount.def.flight;
    const pitch = heli ? pose.rotor : Math.min(1, pose.speed / mount.def.maxSpeed);
    sfx.engineSound(mount.seat === 0 ? 1 : 0.6, pitch, heli);
  }

  private laserLength(x: number, y: number, aim: number, weaponIndex: number): number {
    const def = weaponIndex === NO_WEAPON ? undefined : weaponByIndex(weaponIndex);
    if (!def?.fx.laserSight) return 0;
    return raycastSolids(this.shotWorld(), x, y, Math.cos(aim), Math.sin(aim), def.rangePx);
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const me = this.views.get(this.room?.sessionId ?? "");
    if (!me) return;
    const pointer = this.input_pointer();
    // In a vehicle the view leads along the direction of travel and widens a little with speed and
    // altitude (gently, so it never pumps); on foot it leads towards the cursor.
    const mount = this.predictor.mount;
    const pose = mount ? this.vehiclePoses.get(mount.vehicleId) : undefined;
    let cursorLead = 1;
    let leadX = 0;
    let leadY = 0;
    let targetZoom = 1;
    if (mount && pose) {
      const v = this.predictor.vehicle;
      const vx = v ? v.vx : Math.cos(pose.angle) * pose.speed;
      const vy = v ? v.vy : Math.sin(pose.angle) * pose.speed;
      const lead = Math.min(1, pose.speed / mount.def.maxSpeed);
      leadX = clamp(vx * 0.35, -240, 240);
      leadY = clamp(vy * 0.35, -170, 170);
      cursorLead = 0.6;
      targetZoom = 1 - 0.1 * lead - 0.12 * pose.alt;
    }
    const zk = 1 - Math.exp(-dt / 500);
    this.zoomFactor += (targetZoom - this.zoomFactor) * zk;
    cam.setZoom(this.baseZoom * this.zoomFactor);
    const lookX =
      clamp((pointer.x - this.scale.width / 2) / (this.scale.width / 2), -1, 1) * 140 * cursorLead;
    const lookY =
      clamp((pointer.y - this.scale.height / 2) / (this.scale.height / 2), -1, 1) * 100 * cursorLead;
    const tx = me.root.x + lookX + leadX;
    const ty = me.root.y + lookY + leadY;
    const k = 1 - Math.exp(-dt / (mount ? 140 : 90));
    const mid = cam.midPoint;
    cam.centerOn(Phaser.Math.Linear(mid.x, tx, k), Phaser.Math.Linear(mid.y, ty, k));
  }

  private updateMenuCamera(dt: number) {
    this.menuCamAngle += dt / 16000;
    const cx = this.map.width / 2 + Math.cos(this.menuCamAngle) * this.map.width * 0.28;
    const cy = this.map.height / 2 + Math.sin(this.menuCamAngle * 1.3) * this.map.height * 0.22;
    this.cameras.main.centerOn(cx, cy);
  }

  private drawCrosshair() {
    const g = this.crosshair;
    g.clear();
    // Benchmark autopilot aims by itself: a mouse crosshair would contradict the shown aim.
    if (autopilot.get()) return;
    const pointer = this.game.input.activePointer;
    const color = Phaser.Display.Color.HexStringToColor(settingsStore.get().crosshairColor).color;
    const sim = this.predictor.sim;
    const def = activeWeapon(sim);
    const me = this.views.get(this.room?.sessionId ?? "");
    if (!me?.visibleAlive || uiStore.get().menuOpen) {
      this.game.canvas.style.cursor = "default";
      return;
    }
    this.game.canvas.style.cursor = "none";
    const cam = this.cameras.main;
    const dist = Math.hypot(pointer.worldX - sim.x, pointer.worldY - sim.y);
    const spreadDeg = def ? currentSpreadDeg(sim, def) : 2;
    const gap = clamp(Math.tan((spreadDeg * Math.PI) / 180) * dist * cam.zoom, 4, 120);
    const x = pointer.x;
    const y = pointer.y;
    const len = 7;
    g.lineStyle(4, 0x0b0c0e, 0.7);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.lineBetween(x + dx * gap, y + dy * gap, x + dx * (gap + len), y + dy * (gap + len));
    }
    g.lineStyle(2, color, 1);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      g.lineBetween(x + dx * gap, y + dy * gap, x + dx * (gap + len), y + dy * (gap + len));
    }
    g.fillStyle(color, 1).fillCircle(x, y, 1.5);
    // Reload ring
    if (sim.reload > 0 && def) {
      const total = secToSteps(def.reloadSec);
      const prog = 1 - sim.reload / total;
      g.lineStyle(3, 0x0b0c0e, 0.6)
        .beginPath()
        .arc(x, y, gap + len + 8, 0, Math.PI * 2)
        .strokePath();
      g.lineStyle(3, 0xffd27a, 1)
        .beginPath()
        .arc(x, y, gap + len + 8, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2)
        .strokePath();
    } else if (def && sim.cooldown > 0 && fireIntervalSteps(def) > 20) {
      const prog = 1 - sim.cooldown / fireIntervalSteps(def);
      g.lineStyle(2, color, 0.5)
        .beginPath()
        .arc(x, y, gap + len + 6, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2)
        .strokePath();
    }
    // Hit marker
    const hm = this.hitMarker;
    hm.clear();
    if (this.hitMarkerLife > 0) {
      this.hitMarkerLife -= this.game.loop.delta;
      const a = Math.max(0, this.hitMarkerLife / 140);
      const c = this.hitMarkerLethal ? 0xff5a3d : 0xffffff;
      hm.lineStyle(2.5, c, a);
      const r0 = 6;
      const r1 = 13;
      for (const s of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as const) {
        hm.lineBetween(x + s[0] * r0, y + s[1] * r0, x + s[0] * r1, y + s[1] * r1);
      }
    }
  }

  private animateLights() {
    const t = performance.now() / 1000;
    for (const l of this.lightImages) {
      if (l.group) {
        // PvE: power lights follow the generator, alarm beacons pulse while the alarm sounds.
        const on =
          l.group === "power" ? this.pve.power || !this.pve.active : this.pve.alarm && this.pve.active;
        l.img.setVisible(on);
        if (!on) continue;
        if (l.group === "alarm") {
          l.img.setAlpha(l.base * (0.35 + 0.65 * Math.max(0, Math.sin(t * 6 + l.seed))));
          continue;
        }
      }
      if (l.flicker <= 0) continue;
      const n = Math.sin(t * 13 + l.seed) * 0.5 + Math.sin(t * 31 + l.seed * 2) * 0.3;
      l.img.setAlpha(Math.max(0, l.base * (1 - l.flicker * 0.5 + n * l.flicker * 0.5)));
    }
  }

  private animatePickups() {
    const t = performance.now() / 1000;
    for (const pv of this.pickupViews.values()) {
      pv.icon.setVisible(pv.active);
      pv.glow.setVisible(pv.active);
      pv.base.setAlpha(pv.active ? 0.9 : 0.25);
      if (pv.active) {
        pv.icon.y = pv.y + Math.sin(t * 2.6 + pv.x) * 3;
        pv.base.rotation = t * 0.6;
        pv.glow.setAlpha(0.25 + Math.sin(t * 3 + pv.y) * 0.1);
      }
    }
  }

  private updatePing(dt: number) {
    this.pingTimer -= dt;
    if (this.pingTimer > 0 || !this.room) return;
    this.pingTimer = 2000;
    const room = this.room;
    room.ping((ms) => {
      this.ping = ms;
      room.send("ping", { ms: Math.min(5000, Math.round(ms)) });
    });
  }

  private updateHud(dt: number, inMatch: boolean) {
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    this.hudTimer = 66;
    const now = performance.now();
    if (now - this.stats.windowStart > 1000) {
      const secs = (now - this.stats.windowStart) / 1000 || 1;
      this.stats.kbIn = this.stats.bytesIn / 1024 / secs;
      this.stats.kbOut = this.stats.bytesOut / 1024 / secs;
      this.stats.msgsRate = this.stats.msgsOut / secs;
      this.stats.bytesIn = 0;
      this.stats.bytesOut = 0;
      this.stats.msgsOut = 0;
      this.stats.windowStart = now;
    }
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);
    const fps = avg > 0 ? Math.round(1000 / avg) : 0;
    const state = this.room?.state;
    if (!inMatch || !state || !this.room) {
      hudStore.patch({ ready: false, fps });
      return;
    }
    const me = state.players.get(this.room.sessionId);
    const sim = this.predictor.sim;
    const def = activeWeapon(sim);
    const slot = sim.slots[sim.slot];
    const serverTick = this.clock.serverTick();
    const tickRate = state.tickRate || NET.serverTickRate;
    const phase = state.phase as MatchPhase;
    const net = this.netMetrics.snapshot(now, this.predictor);
    const secsLeft = Math.max(0, (state.phaseEndTick - serverTick) / tickRate);
    if (phase === "countdown") {
      const s = Math.ceil(secsLeft);
      if (s !== this.lastCountdownSec && s > 0 && s <= 3) sfx.countdown(false);
      this.lastCountdownSec = s;
    }
    const weapon = this.predictor.mount ? null : this.nearbyWeaponPickup();
    const interact = this.enterTarget
      ? `Enter ${this.enterTarget.def.name} as ${this.enterTarget.def.seats[this.enterTarget.seat]!.role}`
      : (this.enterBlocked ?? (weapon ? `Take ${weapon}` : null));
    if (this.pve.active) this.updatePveHud(state, serverTick);
    const killerName = this.killedBy ? (state.players.get(this.killedBy)?.name ?? "someone") : null;
    const keySlots = ["1", "2", "3"];
    hudStore.patch({
      ready: true,
      alive: !!me?.alive,
      hp: me?.hp ?? 0,
      weaponId: def?.id ?? null,
      weaponName: def?.name ?? "",
      mag: slot?.mag ?? 0,
      magSize: def?.magSize ?? 0,
      reserve: slot?.reserve ?? 0,
      slots: sim.slots.map((sl, i) => {
        const w = sl.id === NO_WEAPON ? undefined : weaponByIndex(sl.id);
        return {
          key: keySlots[i]!,
          weaponId: w?.id ?? null,
          name: w?.name ?? "",
          mag: sl.mag,
          reserve: sl.reserve,
          active: i === sim.slot,
        };
      }),
      reloading: sim.reload > 0,
      reloadProgress: def && sim.reload > 0 ? 1 - sim.reload / secToSteps(def.reloadSec) : 0,
      dashProgress: 1 - sim.dashCd / secToSteps(P.dashCooldown),
      timeLeftSec: phase === "playing" ? secsLeft : state.durationSec,
      countdownSec: phase === "countdown" ? secsLeft : 0,
      kills: me?.kills ?? 0,
      deaths: me?.deaths ?? 0,
      streak: me?.streak ?? 0,
      respawnInSec:
        me && !me.alive && me.respawnTick > 0 ? Math.max(0, (me.respawnTick - serverTick) / tickRate) : null,
      killedBy: killerName,
      interactPrompt: interact,
      vehicle: this.vehicleHud(state),
      objectives: this.objectiveHud(state),
      protected: !!me?.protected,
      ping: Math.round(this.ping),
      fps,
      stalled: this.netMetrics.isStalled,
      debug: {
        tick: state.tick,
        renderLag: Math.round((serverTick - this.clock.renderTick()) * (1000 / tickRate)),
        interpBuffer: Math.round((this.buffer.newestTick - this.clock.renderTick()) * (1000 / tickRate)),
        jitter: Math.round(this.clock.jitterMs()),
        pending: this.predictor.pendingCount,
        pendingP95: net.pendingP95,
        pendingMax: net.pendingMax,
        ackAge: net.ackAgeMs,
        snaps: net.snaps,
        correction: Math.round(this.predictor.lastCorrection * 100) / 100,
        corrections: this.predictor.corrections,
        kbIn: Math.round(this.stats.kbIn * 10) / 10,
        kbOut: Math.round(this.stats.kbOut * 10) / 10,
        msgsOut: Math.round(this.stats.msgsRate),
        entities: this.children.length,
        fx: this.effects.active,
      },
    });
    void this.localAliveSince;
  }

  /** Downed players: rings for bleed-out and revive progress. */
  private drawDowned(state: MatchState) {
    const bleedMax =
      DIFFICULTY[isDifficulty(state.pve.difficulty) ? state.pve.difficulty : "veteran"].bleedoutSec;
    state.players.forEach((p, id) => {
      if (!p.alive || !p.downed) return;
      const v = this.views.get(id);
      if (!v) return;
      this.pve.markDowned(v.root.x, v.root.y, p.bleed / 10 / bleedMax, p.revive);
    });
  }

  private groanTimer = 0;
  private autoDone = false;
  /** Occasional groans from the nearest infected (positional). */
  private updateAmbience(dt: number, state: MatchState) {
    this.groanTimer -= dt;
    if (this.groanTimer > 0) return;
    this.groanTimer = 1400 + Math.random() * 2200;
    const me = this.views.get(this.room?.sessionId ?? "");
    if (!me) return;
    let best: { x: number; y: number; d: number } | null = null;
    state.zombies.forEach((z) => {
      const d = Math.hypot(z.x - me.root.x, z.y - me.root.y);
      if (d < 900 && (!best || d < best.d)) best = { x: z.x, y: z.y, d };
    });
    const b = best as { x: number; y: number; d: number } | null;
    if (b) sfx.zombieGroan(b.d, clamp((b.x - me.root.x) / 900, -1, 1));
  }

  /** PvE HUD: prompts, objective marker, off-screen allies, squad. */
  private updatePveHud(state: MatchState, serverTick: number) {
    const self = this.room?.sessionId ?? "";
    const me = state.players.get(self);
    const sim = this.predictor.sim;
    let prompt: { text: string; progress: number; blocked?: boolean } | null = null;
    const key = keyLabel(settingsStore.get().bindings.interact);
    if (me?.alive && !me.downed && !me.vehicle) {
      // Revive first (the server gives revives priority over props).
      state.players.forEach((p, id) => {
        if (prompt || id === self || !p.alive || !p.downed) return;
        if (Math.hypot(p.x - sim.x, p.y - sim.y) <= DOWNED.reviveReach) {
          prompt = { text: `Hold ${key}: revive ${p.name}`, progress: p.revive };
        }
      });
      const mission = state.mode === "outbreak" ? missionById(state.pve.mission) : undefined;
      const flags = parseIdList(state.pve.flags);
      state.props.forEach((pr, id) => {
        if (prompt || Math.hypot(pr.x - sim.x, pr.y - sim.y) > 74) return;
        if (pr.kind === "supply") {
          prompt = { text: `Hold ${key}: take supplies`, progress: 0 };
          return;
        }
        const def = mission?.props.find((x) => x.id === id);
        if (!def || pr.used) return;
        if (def.requires && !flags.has(def.requires)) {
          prompt = { text: `${def.label}: needs the ${def.requires}`, progress: 0, blocked: true };
          return;
        }
        if (pr.active) prompt = { text: `Hold ${key}: ${def.label}`, progress: pr.prog };
      });
    }
    // Objective marker (off-screen arrow) and teammates.
    const cam = this.cameras.main;
    const project = (x: number, y: number, label: string, downed?: boolean) => {
      const sx = (x - cam.worldView.x) * cam.zoom;
      const sy = (y - cam.worldView.y) * cam.zoom;
      const w = this.scale.width;
      const h = this.scale.height;
      const onScreen = sx >= 0 && sy >= 0 && sx <= w && sy <= h;
      const angle = Math.atan2(sy - h / 2, sx - w / 2);
      const m = 44;
      return {
        x: onScreen ? sx : clamp(sx, m, w - m),
        y: onScreen ? sy : clamp(sy, m, h - m),
        angle,
        onScreen,
        distM: Math.round(Math.hypot(x - sim.x, y - sim.y) / 16),
        label,
        ...(downed ? { downed } : {}),
      };
    };
    const mission = state.mode === "outbreak" ? missionById(state.pve.mission) : undefined;
    const step = mission?.steps[state.pve.step];
    const marker =
      step?.marker && state.pve.status === 0 ? project(step.marker.x, step.marker.y, step.text) : null;
    const allies: ReturnType<typeof project>[] = [];
    state.players.forEach((p, id) => {
      if (id === self || !p.alive) return;
      const v = this.views.get(id);
      allies.push(project(v?.root.x ?? p.x, v?.root.y ?? p.y, p.name, p.downed));
    });
    pveHud.update(state, self, serverTick, { prompt, marker, allies });
  }

  private objectiveHud(state: MatchState): HudObjective[] {
    const out: HudObjective[] = [];
    const selfId = this.room?.sessionId ?? "";
    state.objectives.forEach((o, id) => {
      out.push({
        id,
        kind: o.kind === "flag" ? "flag" : "point",
        team: o.team,
        progress: o.progress,
        home: o.home,
        carrier: o.carrier ? (state.players.get(o.carrier)?.name ?? "?") : "",
        carriedByYou: o.carrier !== "" && o.carrier === selfId,
      });
    });
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  private vehicleHud(state: MatchState): HudVehicle | null {
    const mount = this.predictor.mount;
    const vs = mount ? state.vehicles.get(mount.vehicleId) : undefined;
    const pose = mount ? this.vehiclePoses.get(mount.vehicleId) : undefined;
    if (!mount || !vs || !pose) return null;
    const def = mount.def;
    const selfId = this.room?.sessionId ?? "";
    const occupants: HudVehicle["occupants"] = [];
    for (let i = 0; i < def.seats.length; i++) {
      const id = seatOccupant(vs, i);
      if (!id) continue;
      occupants.push({
        seat: i,
        role: def.seats[i]!.role,
        name: state.players.get(id)?.name ?? "?",
        you: id === selfId,
      });
    }
    const v = this.predictor.vehicle;
    const landBlocked =
      !!def.flight &&
      !!v &&
      !v.lift &&
      v.alt >= AIRBORNE_ALT &&
      !bodyFits(collisionWorldFor(this.map), v, def);
    const ride = this.env.ridePose;
    return {
      name: def.name,
      kind: def.kind,
      role: mount.seatDef.role,
      seat: mount.seat,
      hp: vs.hp,
      maxHp: def.maxHp,
      speedKmh: Math.round(pose.speed * KMH_PER_PX),
      altitude: def.flight ? Math.round(pose.alt * 100) : null,
      lift: v ? v.lift : vs.lift,
      landBlocked,
      occupants,
      seatRoles: def.seats.map((x) => x.role),
      freeSeats: def.seats.length - occupants.length,
      seats: def.seats.length,
      canFire: mount.seatDef.arc > 0,
      inSector: !!ride && inSector(mount.seatDef, ride.angle, this.aimAngle()),
      mounted: !!mount.seatDef.mounted,
      canExit: pose.speed <= def.exitMaxSpeed && pose.alt <= 0.2,
    };
  }

  private nearbyWeaponPickup(): string | null {
    const sim = this.predictor.sim;
    if (!this.predictorAlive) return null;
    for (const p of this.map.pickups) {
      if (p.kind !== "weapon" || !p.weapon) continue;
      const pv = this.pickupViews.get(p.id);
      if (!pv?.active) continue;
      if (Math.hypot(p.x - sim.x, p.y - sim.y) <= PLAYER.interactRadius) {
        const def: WeaponDef = WEAPONS[p.weapon];
        return def.name;
      }
    }
    return null;
  }
}

export type { PlayerState };
