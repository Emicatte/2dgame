import type { Room } from "@colyseus/sdk";
import {
  activeWeapon,
  BTN,
  C2S,
  canDamage,
  clamp,
  collisionWorldFor,
  currentSpreadDeg,
  DEFAULT_MAP,
  encodeInput,
  fireIntervalSteps,
  type HitTarget,
  hashString,
  type InputFrame,
  isMapId,
  isTeamMode,
  MAPS,
  type MapDef,
  type MatchPhase,
  type MatchState,
  NET,
  type NetEvent,
  NO_WEAPON,
  PLAYER as P,
  PLAYER,
  type PlayerState,
  quantizeInput,
  raycastSolids,
  STEP_DT,
  secToSteps,
  tracePellet,
  WEAPONS,
  type WeaponDef,
  weaponByIndex,
} from "@scrapline/shared";
import Phaser from "phaser";
import { settingsStore } from "../../lib/settings.ts";
import { gameEvents, session, sessionStore } from "../../net/session.ts";
import { currentLoadout } from "../../state/profile.ts";
import { renderMap } from "../art/mapRenderer.ts";
import { TEX, TEX_SCALE } from "../art/textures.ts";
import { sfx } from "../audio/sfx.ts";
import { autopilot } from "../bench/autopilot.ts";
import { Effects } from "../effects/Effects.ts";
import { PlayerView } from "../entities/PlayerView.ts";
import { hudStore, uiStore } from "../hudStore.ts";
import { InputManager } from "../input/InputManager.ts";
import { ServerClock } from "../net/clock.ts";
import { type RemoteSample, SnapshotBuffer } from "../net/interpolation.ts";
import { NetMetrics } from "../net/metrics.ts";
import { Predictor } from "../net/Predictor.ts";
import { PerfRecorder } from "../perf/PerfRecorder.ts";

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
  private lightImages: { img: Phaser.GameObjects.Image; base: number; flicker: number; seed: number }[] = [];
  private pickupViews = new Map<string, PickupView>();
  private views = new Map<string, PlayerView>();
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
    this.perf = new PerfRecorder(this.game, () => this.children.length);
    this.crosshair = this.add.graphics().setDepth(1000).setScrollFactor(0);
    this.hitMarker = this.add.graphics().setDepth(1001).setScrollFactor(0);
    this.predictor = new Predictor(collisionWorldFor(this.map), 0);
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
      perfReset: () => this.perf?.reset(),
      createDebugRoom: (spawns: { x: number; y: number }[]) =>
        session.createPrivate(currentLoadout(), "industrial", { debugSpawns: spawns }),
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
    cam.setZoom(clamp(zoom, 0.5, 2));
    cam.setBounds(0, 0, this.map.width, this.map.height);
  }

  // ---------------------------------------------------------------- map

  private loadMap(map: MapDef) {
    this.map = map;
    const key = `map-${map.id}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, renderMap(map));
    this.mapImage?.destroy();
    this.mapImage = this.add.image(0, 0, key).setOrigin(0).setDepth(0);
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
    }));

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
    this.predictor?.setWorld(collisionWorldFor(map));
    this.fitCamera();
  }

  // ---------------------------------------------------------------- room

  private attachRoom(room: Room<unknown, MatchState> | null) {
    this.cleanupRoom?.();
    this.cleanupRoom = null;
    this.room = room;
    this.registry.set("room", room ?? undefined);
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.buffer.clear();
    this.clock.reset();
    this.eventQueue = [];
    this.outbox = [];
    this.accumulator = 0;
    this.killedBy = null;
    hudStore.patch({ ready: false });
    if (!room) return;

    this.predictor = new Predictor(collisionWorldFor(this.map), hashString(room.sessionId));
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
    if (mapId !== this.map.id) this.loadMap(MAPS[mapId]);
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

    const me = state.players.get(this.room.sessionId);
    if (me && inMatch) {
      const wasAlive = this.predictorAlive;
      this.predictorAlive = me.alive && phase === "playing";
      if (me.alive && !wasAlive) this.localAliveSince = performance.now();
      this.predictor.reconcile(me, this.predictorAlive);
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
        default:
          break;
      }
      this.eventQueue.push({ tick, ev });
    }
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
      }
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
    } else {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= STEP_MS && steps < 15) {
        this.accumulator -= STEP_MS;
        steps++;
        this.prevRender = { x: this.predictor.sim.x, y: this.predictor.sim.y };
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
    this.renderPlayers(renderTick, dt / 1000, state);
    this.updateCamera(dt);
    this.drawCrosshair();
    this.updatePing(dt);
    this.updateHud(dt, true);
  }

  private sampleEdgeInputs() {
    if (this.controls.consume("slot1")) this.pendingSlot = 0;
    if (this.controls.consume("slot2")) this.pendingSlot = 1;
    if (this.controls.consume("slot3")) this.pendingSlot = 2;
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
    this.predictor.predict(frame, alive, (e) => {
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
          sfx.dash(true);
          break;
      }
    });
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
    const world = collisionWorldFor(this.map);
    const renderTick = this.clock.renderTick();
    const targets: HitTarget[] = [];
    const state = this.room?.state;
    const teams = !!state && isTeamMode(state.mode);
    const rules = { teams, friendlyFire: teams && !!state?.friendlyFire };
    const selfId = this.room?.sessionId ?? "";
    const myTeam = state?.players.get(selfId)?.team ?? 0;
    for (const [id, v] of this.views) {
      if (id === this.room?.sessionId || !v.visibleAlive) continue;
      // Same rule as the server: without friendly fire, tracers pass through teammates.
      const team = state?.players.get(id)?.team ?? 0;
      if (!canDamage({ id: selfId, team: myTeam }, { id, team }, rules)) continue;
      const s = this.buffer.sample(id, renderTick);
      if (s?.alive) targets.push({ id, x: s.x, y: s.y, r: PLAYER.radius });
    }
    const ends = angles.map((a) => {
      const r = tracePellet(world, ox, oy, a, def.rangePx, targets, this.room?.sessionId ?? "");
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

  private renderPlayers(renderTick: number, dtSec: number, state: MatchState) {
    const self = this.room?.sessionId;
    const alpha = this.accumulator / STEP_MS;
    for (const [id, view] of this.views) {
      const ps = state.players.get(id);
      if (!ps) continue;
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

  private laserLength(x: number, y: number, aim: number, weaponIndex: number): number {
    const def = weaponIndex === NO_WEAPON ? undefined : weaponByIndex(weaponIndex);
    if (!def?.fx.laserSight) return 0;
    return raycastSolids(collisionWorldFor(this.map), x, y, Math.cos(aim), Math.sin(aim), def.rangePx);
  }

  private updateCamera(dt: number) {
    const cam = this.cameras.main;
    const me = this.views.get(this.room?.sessionId ?? "");
    if (!me) return;
    const pointer = this.input_pointer();
    // Look-ahead towards the cursor so aiming at range is comfortable.
    const lookX = clamp((pointer.x - this.scale.width / 2) / (this.scale.width / 2), -1, 1) * 140;
    const lookY = clamp((pointer.y - this.scale.height / 2) / (this.scale.height / 2), -1, 1) * 100;
    const tx = me.root.x + lookX;
    const ty = me.root.y + lookY;
    const k = 1 - Math.exp(-dt / 90);
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
    const interact = this.nearbyWeaponPickup();
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
