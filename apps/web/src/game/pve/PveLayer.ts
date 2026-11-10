import {
  ACT,
  AI,
  ATTACK_KINDS,
  type HitTarget,
  lerp,
  lerpAngle,
  type MapDef,
  type MatchState,
  type MissionDef,
  missionById,
  type NetEvent,
  parseIdList,
  VENT_PHASE,
  type VentPhase,
  ventOnline,
  ventPhase,
  type ZombieDef,
  zombieByIndex,
} from "@scrapline/shared";
import Phaser from "phaser";
import { TEX, TEX_SCALE } from "../art/textures.ts";
import { generateZombieTextures, ZTEX } from "../art/zombieArt.ts";
import type { Effects } from "../effects/Effects.ts";
import type { Lightmap } from "./lightmap.ts";
import { isVisible } from "./visibility.ts";

const TEX_EYES = "dread-eyes";

function makeEyesTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(TEX_EYES)) return;
  const c = scene.textures.createCanvas(TEX_EYES, 24, 12)!;
  const ctx = c.getContext();
  for (const x of [6, 18]) {
    const g = ctx.createRadialGradient(x, 6, 0, x, 6, 6);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, 0, 12, 12);
  }
  c.refresh();
}

/**
 * Client side of Outbreak: renders what the authoritative room simulates. Enemies are interpolated
 * 110 ms in the past like remote players; attack telegraphs, props, doors, hazards and acid
 * projectiles are drawn from the synchronized state and events. Nothing here decides anything.
 */

export function enemyHitFx(
  effects: Effects,
  x: number,
  y: number,
  angle: number,
  opts: { lethal: boolean; color?: number; armored?: boolean; weakSpot?: boolean; boss?: boolean },
): void {
  effects.enemyHit(x, y, angle, opts);
}

export function enemyDeathFx(
  effects: Effects,
  x: number,
  y: number,
  opts: { color?: number; size?: number; boss?: boolean },
): void {
  effects.enemyDeath(x, y, opts);
}

/** Half-angle of a boss sweep drawn with radius `ar` (the matching attack of its definition). */
function sweepArc(def: ZombieDef, ar: number): number {
  let best = 1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const ph of def.boss?.phases ?? []) {
    for (const a of ph.attacks) {
      if (a.kind !== "sweep") continue;
      const d = Math.abs((a.radius ?? 180) - ar);
      if (d < bestD) {
        bestD = d;
        best = a.arc ?? 1;
      }
    }
  }
  return best;
}

interface ZSample {
  x: number;
  y: number;
  a: number;
}

interface ZSnap {
  tick: number;
  z: Map<string, ZSample>;
}

/** Same interpolation as remote players: always a blend of two real server states. */
class ZombieBuffer {
  private readonly snaps: ZSnap[] = [];
  push(tick: number, z: Map<string, ZSample>): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && tick <= last.tick) {
      if (tick === last.tick) last.z = z;
      return;
    }
    this.snaps.push({ tick, z });
    if (this.snaps.length > 30) this.snaps.shift();
  }
  clear(): void {
    this.snaps.length = 0;
  }
  sample(id: string, t: number): ZSample | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    let i = n - 1;
    while (i >= 0 && this.snaps[i]!.tick > t) i--;
    if (i < 0) return this.snaps[0]!.z.get(id) ?? null;
    const a = this.snaps[i]!.z.get(id);
    const nb = this.snaps[i + 1];
    if (!a) return nb?.z.get(id) ?? null;
    const b = nb?.z.get(id);
    if (!nb || !b) return a;
    const k = (t - this.snaps[i]!.tick) / (nb.tick - this.snaps[i]!.tick);
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), a: lerpAngle(a.a, b.a, k) };
  }
}

class ZombieView {
  readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly bar: Phaser.GameObjects.Graphics;
  private flashMs = 0;
  private bob = Math.random() * 10;
  /** Glinting eyes in the dark (above the light map): seen, not lit. */
  readonly eyes: Phaser.GameObjects.Image;
  private blink = Math.random() * 4;
  /** Plated enemies: the glowing weak point on the back (brighter while it vents). */
  readonly weak: Phaser.GameObjects.Image | null;
  private lastX = 0;
  private lastY = 0;
  x = 0;
  y = 0;

  constructor(
    scene: Phaser.Scene,
    readonly id: string,
    readonly def: ZombieDef,
  ) {
    this.shadow = scene.add
      .image(0, 4, TEX.shadow)
      .setDisplaySize(def.radius * 3, def.radius * 2.3)
      .setAlpha(0.8);
    this.body = scene.add.image(0, 0, ZTEX.body(def.kind)).setScale(1 / TEX_SCALE);
    this.bar = scene.add.graphics();
    this.root = scene.add.container(0, 0, [this.shadow, this.body, this.bar]).setDepth(18);
    const big = def.boss ? 2.4 : def.kind === "brute" ? 1.5 : 1;
    this.eyes = scene.add
      .image(0, 0, TEX_EYES)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(
        def.boss ? 0xff3b2f : def.kind === "runner" ? 0xffe68a : def.kind === "stalker" ? 0x9fffd0 : 0xffc35a,
      )
      .setDisplaySize(10 * big, 5 * big)
      .setDepth(34)
      .setVisible(false);
    // Above the darkness, like the eyes: the place to shoot is always findable.
    this.weak = def.plating
      ? scene.add
          .image(0, 0, TEX.glow)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(def.accent)
          .setDisplaySize(def.radius * 1.4, def.radius * 1.4)
          .setDepth(34)
      : null;
  }

  /** Weak point on the back: a steady glow, flaring while the plates are open. */
  weakPoint(angle: number, venting: boolean, t: number): void {
    if (!this.weak) return;
    const back = this.def.radius * 0.62;
    const pulse = 0.5 + 0.5 * Math.sin(t * (venting ? 14 : 3));
    const size = this.def.radius * (venting ? 2.6 + pulse * 0.6 : 1.3 + pulse * 0.2);
    this.weak
      .setVisible(true)
      .setPosition(this.x - Math.cos(angle) * back, this.y - Math.sin(angle) * back)
      .setDisplaySize(size, size)
      .setAlpha(venting ? 0.85 : 0.35 + pulse * 0.15);
  }

  /** Eyes in the dark: shown when the enemy is in sight but unlit; they blink now and then. */
  glint(show: boolean, angle: number, dist: number, dtSec: number): void {
    this.blink -= dtSec;
    if (this.blink < -0.12) this.blink = 1.5 + Math.random() * 4;
    if (!show || this.blink < 0) {
      this.eyes.setVisible(false);
      return;
    }
    const fwd = this.def.radius * 0.55;
    this.eyes
      .setVisible(true)
      .setPosition(this.x + Math.cos(angle) * fwd, this.y + Math.sin(angle) * fwd)
      .setRotation(angle + Math.PI / 2)
      .setAlpha(Math.max(0.18, 0.75 - dist / 1400));
  }

  flash(): void {
    this.flashMs = 90;
  }

  update(x: number, y: number, angle: number, hp: number, mhp: number, st: number, dtSec: number): void {
    const speed = Math.hypot(x - this.lastX, y - this.lastY) / Math.max(1e-3, dtSec);
    this.lastX = x;
    this.lastY = y;
    this.x = x;
    this.y = y;
    this.root.setPosition(x, y);
    this.bob += dtSec * (3 + Math.min(1, speed / 120) * 7);
    const sway = Math.sin(this.bob) * 0.12 * Math.min(1, speed / 60 + 0.25);
    const stunned = st === AI.STUNNED;
    this.body.setRotation(angle + sway + (stunned ? Math.sin(this.bob * 3) * 0.3 : 0));
    // Hit feedback: a short scale pop and a warm tint.
    const pop = this.flashMs > 0 ? 1 + (this.flashMs / 90) * 0.08 : 1;
    const s = ((1 + Math.abs(Math.sin(this.bob)) * 0.03) * pop) / TEX_SCALE;
    this.body.setScale(s);
    if (this.flashMs > 0) {
      this.flashMs -= dtSec * 1000;
      this.body.setTint(0xffc0b0);
      if (this.flashMs <= 0) this.body.clearTint();
    }
    this.bar.clear();
    const showBar = !this.def.boss && hp < mhp && (this.def.kind !== "walker" || hp < mhp * 0.99);
    if (showBar) {
      const w = Math.max(26, this.def.radius * 2);
      const top = -this.def.radius - 12;
      const frac = Math.max(0, hp / Math.max(1, mhp));
      this.bar.fillStyle(0x0b0c0e, 0.8).fillRect(-w / 2 - 1, top, w + 2, 5);
      this.bar
        .fillStyle(this.def.kind === "brute" ? 0xd8a7c8 : 0xc8d26a, 1)
        .fillRect(-w / 2, top + 1, w * frac, 3);
    }
  }

  destroy(): void {
    this.root.destroy(true);
    this.eyes.destroy();
    this.weak?.destroy();
  }
}

interface PropView {
  kind: string;
  base: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text | null;
  x: number;
  y: number;
}

interface Proj {
  /** Lobbed debris: where it lands and how wide (drawn as a warning circle during the flight). */
  land?: { x: number; y: number; r: number; dur: number };
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
}

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "13px",
  color: "#e8e4dc",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

export class PveLayer {
  private readonly views = new Map<string, ZombieView>();
  private readonly buffer = new ZombieBuffer();
  private readonly props = new Map<string, PropView>();
  private readonly hazards = new Map<string, Phaser.GameObjects.Image>();
  private readonly doors = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly projectiles = new Map<number, Proj>();
  private readonly fx: Phaser.GameObjects.Graphics;
  /** Co-op darkness (owned by the scene): line of sight and light levels for the eye glints. */
  lightmap: Lightmap | null = null;
  private mission: MissionDef | null = null;
  private mapId = "";
  private doorKey = "\u0000";
  /** Mission flags the scene uses for lights. */
  power = false;
  alarm = false;
  /** Scripted blackout: the main lights are out even with the power on. */
  blackout = false;
  active = false;
  /** Mission flags (sealed doors, blackout, locked vehicles). */
  private flags = new Set<string>();
  private flagKey = "\u0000";
  /** Vent phases last frame (the scene plays a cue when one changes). */
  private ventPhases = new Map<string, VentPhase>();
  /** Vents whose phase changed this frame: the scene turns these into sound. */
  readonly ventCues: { x: number; y: number; phase: VentPhase }[] = [];
  /** Plated enemies that started venting this frame (a sound cue). */
  readonly ventStarts: { x: number; y: number }[] = [];
  private venting = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly effects: Effects,
  ) {
    generateZombieTextures(scene);
    makeEyesTexture(scene);
    // Telegraphs sit above the darkness: an attack is always readable, even from an unseen enemy.
    this.fx = scene.add.graphics().setDepth(33);
  }

  /** Map / mission changed (or left PvE): rebuild doors and props. */
  setContext(map: MapDef, state: MatchState): void {
    // Horror Maze runs a PvE creature in the dark: same enemies, lights and dread.
    const pve =
      state.mode === "outbreak" ||
      state.mode === "survival" ||
      state.mode === "nighthunt" ||
      ((state.mode === "maze" || state.mode === "escape") && state.round.variant === "horror");
    const mission = state.mode === "outbreak" ? (missionById(state.pve.mission) ?? null) : null;
    if (this.active === pve && this.mapId === map.id && this.mission === mission) return;
    this.clear();
    this.active = pve;
    this.mapId = map.id;
    this.mission = mission;
    this.doorKey = "\u0000";
  }

  /** Doors open in the state (the scene rebuilds the collision world when this changes). */
  doorsChanged(state: MatchState): boolean {
    const key = state.pve.doors;
    const flagKey = state.pve.flags;
    const flagsMoved = flagKey !== this.flagKey;
    if (flagsMoved) {
      this.flagKey = flagKey;
      this.flags = parseIdList(flagKey);
    }
    if (key === this.doorKey) {
      // Sealing or releasing a door changes how it looks, not the world.
      if (flagsMoved) this.drawDoors(parseIdList(key));
      return false;
    }
    this.doorKey = key;
    this.drawDoors(parseIdList(key));
    return true;
  }

  private drawDoors(open: Set<string>): void {
    const doors = this.mission?.doors ?? [];
    for (const d of doors) {
      let g = this.doors.get(d.id);
      if (!g) {
        g = this.scene.add.graphics().setDepth(11);
        this.doors.set(d.id, g);
      }
      g.clear();
      const closed = !open.has(d.id) && this.activeMissionDoors;
      if (d.auto) {
        this.drawAutoDoor(g, d, closed, this.flags.has(`sealed-${d.id}`));
        continue;
      }
      if (closed) {
        g.fillStyle(0x3a3e43, 1).fillRect(d.x, d.y, d.w, d.h);
        g.lineStyle(2, 0x0b0c0e, 1).strokeRect(d.x, d.y, d.w, d.h);
        // Hazard stripes along the door.
        g.fillStyle(0xe0a33a, 0.9);
        const horizontal = d.w > d.h;
        const len = horizontal ? d.w : d.h;
        for (let o = 6; o < len - 6; o += 18) {
          if (horizontal) g.fillRect(d.x + o, d.y + 4, 8, d.h - 8);
          else g.fillRect(d.x + 4, d.y + o, d.w - 8, 8);
        }
      } else {
        // Open: a thin retracted frame.
        g.lineStyle(2, 0x6a7078, 0.6);
        if (d.w > d.h) {
          g.lineBetween(d.x, d.y, d.x, d.y + d.h);
          g.lineBetween(d.x + d.w, d.y, d.x + d.w, d.y + d.h);
        } else {
          g.lineBetween(d.x, d.y, d.x + d.w, d.y);
          g.lineBetween(d.x, d.y + d.h, d.x + d.w, d.y + d.h);
        }
      }
    }
  }

  /**
   * Automatic sliding door: two leaves that part into the walls, a status lamp at each end
   * (green: working, amber: no power, red: sealed by the lockdown).
   */
  private drawAutoDoor(
    g: Phaser.GameObjects.Graphics,
    d: { x: number; y: number; w: number; h: number },
    closed: boolean,
    sealed: boolean,
  ): void {
    const horizontal = d.w > d.h;
    const len = horizontal ? d.w : d.h;
    const leaf = closed ? len / 2 : 10;
    const lamp = sealed ? 0xff3d3d : this.power ? 0x7dffb0 : 0xe0a33a;
    g.fillStyle(sealed ? 0x4a3436 : 0x3a4448, 1);
    if (horizontal) {
      g.fillRect(d.x, d.y + 3, leaf, d.h - 6);
      g.fillRect(d.x + d.w - leaf, d.y + 3, leaf, d.h - 6);
    } else {
      g.fillRect(d.x + 3, d.y, d.w - 6, leaf);
      g.fillRect(d.x + 3, d.y + d.h - leaf, d.w - 6, leaf);
    }
    g.lineStyle(1.5, 0x0b0c0e, 1);
    if (closed) {
      if (horizontal) g.lineBetween(d.x + d.w / 2, d.y + 3, d.x + d.w / 2, d.y + d.h - 3);
      else g.lineBetween(d.x + 3, d.y + d.h / 2, d.x + d.w - 3, d.y + d.h / 2);
      g.strokeRect(d.x, d.y + (horizontal ? 3 : 0), d.w, d.h - (horizontal ? 6 : 0));
    }
    // Status lamps on the frame.
    g.fillStyle(lamp, 0.95);
    if (horizontal) {
      g.fillCircle(d.x - 6, d.y + d.h / 2, 3.5);
      g.fillCircle(d.x + d.w + 6, d.y + d.h / 2, 3.5);
    } else {
      g.fillCircle(d.x + d.w / 2, d.y - 6, 3.5);
      g.fillCircle(d.x + d.w / 2, d.y + d.h + 6, 3.5);
    }
  }

  /** Survival plays on mission maps with every door open. */
  private get activeMissionDoors(): boolean {
    return !!this.mission;
  }

  onPatch(state: MatchState, inMatch: boolean): void {
    if (!this.active) return;
    if (this.power !== state.pve.power) {
      this.power = state.pve.power;
      // Door lamps follow the power.
      this.drawDoors(parseIdList(state.pve.doors));
    }
    this.alarm = state.pve.alarm;
    this.blackout = this.flags.has("blackout");
    const samples = new Map<string, ZSample>();
    state.zombies.forEach((z, id) => {
      samples.set(id, { x: z.x, y: z.y, a: (z.a / 256) * Math.PI * 2 });
      if (!this.views.has(id)) {
        const def = zombieByIndex(z.k);
        if (def) this.views.set(id, new ZombieView(this.scene, id, def));
      }
    });
    for (const [id, v] of this.views) {
      if (!state.zombies.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
    }
    if (inMatch) this.buffer.push(state.tick, samples);
    // Hazards (acid).
    state.hazards.forEach((h, id) => {
      if (this.hazards.has(id)) return;
      const img = this.scene.add
        .image(h.x, h.y, ZTEX.acid)
        .setDisplaySize(h.r * 2.2, h.r * 2.2)
        .setDepth(7)
        .setAlpha(0.85);
      this.hazards.set(id, img);
    });
    for (const [id, img] of this.hazards) {
      if (!state.hazards.has(id)) {
        img.destroy();
        this.hazards.delete(id);
      }
    }
    // Props and loot.
    state.props.forEach((p, id) => {
      let v = this.props.get(id);
      if (!v) {
        const color =
          p.kind === "health"
            ? 0xff6b6b
            : p.kind === "ammo"
              ? 0xffd27a
              : p.kind === "supply"
                ? 0x7dffb0
                : 0x9fe7ff;
        const glow = this.scene.add
          .image(p.x, p.y, TEX.glow)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(color)
          .setDisplaySize(
            p.kind === "ammo" || p.kind === "health" ? 60 : 130,
            p.kind === "ammo" || p.kind === "health" ? 60 : 130,
          )
          .setDepth(8);
        const base = this.scene.add
          .image(p.x, p.y, ZTEX.prop(p.kind))
          .setScale(1 / TEX_SCALE)
          .setDepth(10);
        const def = this.mission?.props.find((x) => x.id === id);
        const label = def
          ? this.scene.add
              .text(p.x, p.y - 34, def.label, LABEL_STYLE)
              .setOrigin(0.5, 1)
              .setDepth(50)
          : p.kind === "supply"
            ? this.scene.add
                .text(p.x, p.y - 30, "Supplies", LABEL_STYLE)
                .setOrigin(0.5, 1)
                .setDepth(50)
            : null;
        v = { kind: p.kind, base, glow, label, x: p.x, y: p.y };
        this.props.set(id, v);
      } else if (v.x !== p.x || v.y !== p.y) {
        // Attached props (the convoy's engine) move with their vehicle.
        v.x = p.x;
        v.y = p.y;
        v.base.setPosition(p.x, p.y);
        v.glow.setPosition(p.x, p.y);
        v.label?.setPosition(p.x, p.y - 34);
      }
    });
    for (const [id, v] of this.props) {
      if (!state.props.has(id)) {
        v.base.destroy();
        v.glow.destroy();
        v.label?.destroy();
        this.props.delete(id);
      }
    }
  }

  /** Interpolated enemy position at `renderTick` (also the shot target positions). */
  sample(id: string, renderTick: number): ZSample | null {
    return this.buffer.sample(id, renderTick);
  }

  position(id: string): { x: number; y: number } | null {
    const v = this.views.get(id.startsWith("z:") ? id.slice(2) : id);
    return v ? { x: v.x, y: v.y } : null;
  }

  /** Enemies as predicted-tracer targets (where they are rendered, like the server's rewind). */
  targets(): HitTarget[] {
    const out: HitTarget[] = [];
    for (const v of this.views.values()) out.push({ id: `z:${v.id}`, x: v.x, y: v.y, r: v.def.radius });
    return out;
  }

  /** Effects of events played on the interpolation timeline. */
  playEvent(ev: NetEvent): void {
    switch (ev.t) {
      case "zdie": {
        const def = zombieByIndex(ev.k);
        enemyDeathFx(this.effects, ev.x, ev.y, {
          color: def?.accent ?? 0xb9c48f,
          size: def?.radius ?? 16,
          boss: !!def?.boss,
        });
        break;
      }
      case "zhit": {
        this.views.get(ev.z)?.flash();
        break;
      }
      case "boom":
        this.effects.explosion(ev.x, ev.y);
        break;
      case "proj": {
        const lob = ev.r && ev.tx !== undefined && ev.ty !== undefined;
        const img = this.scene.add
          .image(ev.x, ev.y, lob ? TEX.debris : ZTEX.spit)
          .setDisplaySize(lob ? 34 : 18, lob ? 34 : 18)
          .setTint(lob ? 0x5b4e58 : 0xffffff)
          .setDepth(lob ? 45 : 39);
        const speed = Math.hypot(ev.vx, ev.vy) || 1;
        const land = lob
          ? { x: ev.tx!, y: ev.ty!, r: ev.r!, dur: Math.hypot(ev.tx! - ev.x, ev.ty! - ev.y) / speed }
          : undefined;
        this.projectiles.set(ev.id, {
          img,
          x: ev.x,
          y: ev.y,
          vx: ev.vx,
          vy: ev.vy,
          t0: performance.now(),
          ...(land ? { land } : {}),
        });
        break;
      }
      case "projx": {
        const p = this.projectiles.get(ev.id);
        p?.img.destroy();
        this.projectiles.delete(ev.id);
        if (p?.land) this.effects.crash(ev.x, ev.y, 600);
        else enemyHitFx(this.effects, ev.x, ev.y, 0, { lethal: false, color: 0xc6ff4a });
        break;
      }
      case "zatk":
        if (ev.k === "slam" || ev.k === "impact")
          this.effects.crash(ev.x, ev.y, ev.k === "impact" ? 500 : 700);
        else if (ev.k === "roar" || ev.k === "summon") this.effects.spawn(ev.x, ev.y);
        break;
      default:
        break;
    }
  }

  /** Per rendered frame. */
  update(
    renderTick: number,
    dtSec: number,
    state: MatchState,
    tickRate: number,
    focus: { x: number; y: number },
  ): void {
    if (!this.active) return;
    const lm = this.lightmap?.enabled ? this.lightmap : null;
    const poly = lm?.poly ?? null;
    const g = this.fx;
    g.clear();
    const now = performance.now();
    for (const [id, v] of this.views) {
      const zs = state.zombies.get(id);
      const s = this.buffer.sample(id, renderTick);
      if (!zs || !s) {
        v.root.setVisible(false);
        continue;
      }
      v.root.setVisible(true);
      v.update(s.x, s.y, s.a, zs.hp, zs.mhp, zs.st, dtSec);
      if (v.weak) {
        const venting = zs.act === ACT.WINDUP && ATTACK_KINDS[zs.ak] === "vent";
        v.weakPoint(s.a, venting, now / 1000);
        if (venting && !this.venting.has(id)) this.ventStarts.push({ x: s.x, y: s.y });
        if (venting) this.venting.add(id);
        else this.venting.delete(id);
      }
      if (lm && poly) {
        const dist = Math.hypot(s.x - focus.x, s.y - focus.y);
        const seen = dist < 1100 && isVisible(poly, s.x, s.y, v.def.radius);
        v.glint(seen && lm.lightAt(s.x, s.y) < 0.3, s.a, dist, dtSec);
      } else v.glint(false, s.a, 0, dtSec);
      this.drawTelegraph(g, v, zs.act, zs.at, zs.tx, zs.ty, zs.st, renderTick, tickRate, zs.ak, zs.aw, zs.ar);
    }
    // Props: pulse when usable, hold progress ring.
    const t = now / 1000;
    state.props.forEach((p, id) => {
      const v = this.props.get(id);
      if (!v) return;
      const loot = p.kind === "ammo" || p.kind === "health";
      const usable = loot || p.kind === "supply" ? !p.used || p.kind === "supply" : p.active;
      v.glow.setVisible(usable && !p.used);
      v.glow.setAlpha(0.25 + Math.sin(t * 3 + v.x) * 0.12);
      v.base.setAlpha(p.used && !loot ? 0.45 : 1);
      if (loot) v.base.y = v.y + Math.sin(t * 2.6 + v.x) * 3;
      if (v.label) v.label.setVisible(p.active || p.kind === "supply");
      if (p.prog > 0 && p.prog < 1 && !p.used) {
        g.lineStyle(4, 0x0b0c0e, 0.7)
          .beginPath()
          .arc(v.x, v.y, 30, 0, Math.PI * 2)
          .strokePath();
        g.lineStyle(3, 0x7dffb0, 1)
          .beginPath()
          .arc(v.x, v.y, 30, -Math.PI / 2, -Math.PI / 2 + p.prog * Math.PI * 2)
          .strokePath();
      }
    });
    this.drawVents(g, state, renderTick, tickRate, t);
    // Hazards fade out at the end.
    state.hazards.forEach((h, id) => {
      const img = this.hazards.get(id);
      if (!img) return;
      const left = (h.until - renderTick) / tickRate;
      img.setAlpha(Math.max(0, Math.min(0.85, left)) * (0.8 + Math.sin(t * 5 + h.x) * 0.08));
    });
    // Acid projectiles fly straight until their landing event.
    for (const [id, p] of this.projectiles) {
      const age = (now - p.t0) / 1000;
      if (age > 3) {
        p.img.destroy();
        this.projectiles.delete(id);
        continue;
      }
      if (p.land) {
        // Lobbed debris: arc over the map, the landing circle fills up until impact.
        const k = Math.min(1, age / Math.max(0.05, p.land.dur));
        const lift = Math.sin(k * Math.PI) * 60;
        p.img.setPosition(
          p.x + p.vx * Math.min(age, p.land.dur),
          p.y + p.vy * Math.min(age, p.land.dur) - lift,
        );
        const size = 30 * (0.8 + 0.6 * Math.sin(k * Math.PI));
        p.img.setDisplaySize(size, size).setRotation(age * 5);
        g.fillStyle(0xff3d3d, 0.1 + 0.25 * k).fillCircle(p.land.x, p.land.y, p.land.r);
        g.lineStyle(2, 0xff3d3d, 0.9).strokeCircle(p.land.x, p.land.y, p.land.r);
        g.lineStyle(3, 0xffd34a, 0.9).strokeCircle(p.land.x, p.land.y, p.land.r * k);
        continue;
      }
      p.img.setPosition(p.x + p.vx * age, p.y + p.vy * age).setRotation(age * 8);
    }
  }

  /** Phase of every security vent at `renderTick` (all offline without power). */
  ventStates(
    state: MatchState,
    renderTick: number,
    tickRate: number,
  ): { id: string; online: boolean; phase: VentPhase }[] {
    const vents = this.mission?.vents ?? [];
    const start = state.pve.vents;
    return vents.map((v) => ({
      id: v.id,
      online: start > 0 && ventOnline(v, state.pve.power, this.flags),
      phase:
        start > 0 && ventOnline(v, state.pve.power, this.flags)
          ? ventPhase(v, (renderTick - start) / tickRate)
          : VENT_PHASE.IDLE,
    }));
  }

  /**
   * Security vents: amber stripes flashing during the warning, then the gas. Drawn above the
   * darkness: a hazard is always readable.
   */
  private drawVents(
    g: Phaser.GameObjects.Graphics,
    state: MatchState,
    renderTick: number,
    tickRate: number,
    t: number,
  ): void {
    const vents = this.mission?.vents ?? [];
    if (vents.length === 0) return;
    const states = this.ventStates(state, renderTick, tickRate);
    for (const [i, v] of vents.entries()) {
      const phase = states[i]!.phase;
      const a = v.area;
      const before = this.ventPhases.get(v.id) ?? VENT_PHASE.IDLE;
      if (before !== phase) {
        this.ventPhases.set(v.id, phase);
        if (phase !== VENT_PHASE.IDLE) this.ventCues.push({ x: a.x + a.w / 2, y: a.y + a.h / 2, phase });
      }
      if (phase === VENT_PHASE.WARN) {
        const on = Math.sin(t * 18) > 0;
        g.lineStyle(3, 0xffb33a, on ? 0.95 : 0.35).strokeRect(a.x, a.y, a.w, a.h);
        g.fillStyle(0xffb33a, on ? 0.12 : 0.04).fillRect(a.x, a.y, a.w, a.h);
      } else if (phase === VENT_PHASE.ACTIVE) {
        g.fillStyle(0xd8ffe8, 0.22).fillRect(a.x, a.y, a.w, a.h);
        // Billowing puffs inside the area.
        const n = Math.max(4, Math.round((a.w * a.h) / 9000));
        for (let k = 0; k < n; k++) {
          const px = a.x + ((((k * 97.3 + t * 40 * ((k % 3) - 1)) % a.w) + a.w) % a.w);
          const py = a.y + ((((k * 61.7 + t * 25 * ((k % 2) * 2 - 1)) % a.h) + a.h) % a.h);
          const r = 26 + 14 * Math.sin(t * 2 + k);
          g.fillStyle(0xeafff2, 0.12 + 0.06 * Math.sin(t * 3 + k)).fillCircle(px, py, r);
        }
        g.lineStyle(2, 0xd8ffe8, 0.6).strokeRect(a.x, a.y, a.w, a.h);
      } else if (states[i]!.online) {
        // Online and idle: a faint frame so the grate reads as a hazard.
        g.lineStyle(1, 0xffb33a, 0.25).strokeRect(a.x, a.y, a.w, a.h);
      }
    }
  }

  /**
   * Readable warnings before every significant attack: a growing arc for melee, a lane for the
   * brute's charge, the blast radius of an exploder, a dotted line for spit and pounces.
   */
  private drawTelegraph(
    g: Phaser.GameObjects.Graphics,
    v: ZombieView,
    act: number,
    at: number,
    tx: number,
    ty: number,
    st: number,
    renderTick: number,
    tickRate: number,
    ak = 0,
    aw = 0,
    ar = 0,
  ): void {
    const def = v.def;
    if (st === AI.ALERT) {
      // "!" above the head: it noticed something.
      g.fillStyle(0xffd34a, 1).fillRect(v.x - 2, v.y - def.radius - 26, 4, 10);
      g.fillCircle(v.x, v.y - def.radius - 12, 2.4);
    }
    if (st === AI.STUNNED) {
      const t = performance.now() / 200;
      g.fillStyle(0xfff1d0, 0.9);
      for (let k = 0; k < 3; k++) {
        const a = t + (k * Math.PI * 2) / 3;
        g.fillCircle(v.x + Math.cos(a) * def.radius, v.y - def.radius - 6 + Math.sin(a) * 4, 2.5);
      }
    }
    if (act !== ACT.WINDUP) return;
    // The synchronized attack kind and windup length drive the telegraph (phase-scaled for bosses).
    const kind = ATTACK_KINDS[ak] ?? def.attack.kind;
    const windupTicks = aw > 0 ? aw : def.attack.windupSec * tickRate;
    const k = Math.max(0, Math.min(1, (renderTick - at) / windupTicks));
    const atk = kind === def.attack.kind ? def.attack : (def.special ?? def.attack);
    const red = 0xff3d3d;
    switch (kind) {
      case "slam": {
        const r = ar || 160;
        g.fillStyle(red, 0.1 + 0.25 * k).fillCircle(v.x, v.y, r);
        g.lineStyle(3, red, 0.9).strokeCircle(v.x, v.y, r);
        g.lineStyle(4, 0xffd34a, 0.95).strokeCircle(v.x, v.y, Math.max(def.radius, r * k));
        return;
      }
      case "roar": {
        // Rings travel out to the real reach of the push, drawn as a steady outer circle.
        const reach = ar || 230;
        const span = Math.max(1, reach - def.radius);
        const t = performance.now() / 1000;
        g.lineStyle(2, 0xffb36b, 0.55).strokeCircle(v.x, v.y, reach);
        for (let i = 0; i < 3; i++) {
          const rr = def.radius + ((t * 160 + (i * span) / 3) % span);
          g.lineStyle(3, 0xffb36b, Math.max(0, 0.85 - (rr - def.radius) / span)).strokeCircle(v.x, v.y, rr);
        }
        return;
      }
      case "summon": {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
        g.lineStyle(3, 0xc6ff4a, 0.4 + 0.5 * pulse).strokeCircle(v.x, v.y, def.radius + 30 + 20 * k);
        return;
      }
      case "throw": {
        g.lineStyle(2, red, 0.5 + 0.5 * k).strokeCircle(tx, ty, (ar || 90) * (1.4 - 0.4 * k));
        g.fillStyle(red, 0.08 + 0.15 * k).fillCircle(tx, ty, ar || 90);
        return;
      }
      case "sweep": {
        // The committed cone (front or tail): filling up until it strikes.
        const r = ar || 180;
        const face = Math.atan2(ty - v.y, tx - v.x);
        const arc = sweepArc(def, ar);
        g.fillStyle(red, 0.1 + 0.25 * k);
        g.slice(v.x, v.y, r, face - arc, face + arc, false).fillPath();
        g.lineStyle(2, red, 0.85)
          .beginPath()
          .arc(v.x, v.y, r, face - arc, face + arc)
          .strokePath();
        g.lineStyle(4, 0xffd34a, 0.9)
          .beginPath()
          .arc(v.x, v.y, Math.max(def.radius, r * k), face - arc, face + arc)
          .strokePath();
        return;
      }
      case "vent": {
        // The window: plates open (the weak point flares on its own), a calm ring that turns red
        // in the last quarter, when the burst that closes it is coming.
        const r = ar || 140;
        const late = k > 0.75;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (late ? 50 : 160));
        g.lineStyle(2, late ? red : def.accent, 0.35 + 0.45 * pulse).strokeCircle(v.x, v.y, r);
        if (late) g.fillStyle(red, 0.08 + 0.16 * ((k - 0.75) / 0.25)).fillCircle(v.x, v.y, r);
        return;
      }
    }
    switch (atk.kind === kind ? atk.kind : kind) {
      case "melee": {
        const r = def.radius + atk.range + 20;
        const face = Math.atan2(ty - v.y, tx - v.x);
        g.fillStyle(red, 0.12 + 0.25 * k);
        g.slice(v.x, v.y, r, face - 0.9, face + 0.9, false).fillPath();
        g.lineStyle(2, red, 0.5 + 0.5 * k)
          .beginPath()
          .arc(v.x, v.y, r * (0.4 + 0.6 * k), face - 0.9, face + 0.9)
          .strokePath();
        break;
      }
      case "charge": {
        const ang = Math.atan2(ty - v.y, tx - v.x);
        const len = Math.hypot(tx - v.x, ty - v.y);
        const w = def.radius * 2 + 12;
        const px = -Math.sin(ang) * (w / 2);
        const py = Math.cos(ang) * (w / 2);
        g.fillStyle(red, 0.1 + 0.22 * k);
        g.fillPoints(
          [
            new Phaser.Math.Vector2(v.x + px, v.y + py),
            new Phaser.Math.Vector2(v.x + px + Math.cos(ang) * len, v.y + py + Math.sin(ang) * len),
            new Phaser.Math.Vector2(v.x - px + Math.cos(ang) * len, v.y - py + Math.sin(ang) * len),
            new Phaser.Math.Vector2(v.x - px, v.y - py),
          ],
          true,
        );
        // Filling bar along the lane shows when it goes.
        g.lineStyle(3, red, 0.9).lineBetween(
          v.x,
          v.y,
          v.x + Math.cos(ang) * len * k,
          v.y + Math.sin(ang) * len * k,
        );
        break;
      }
      case "explode": {
        const r = atk.radius ?? 120;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / (60 - 40 * k));
        g.fillStyle(red, 0.08 + 0.18 * k * pulse);
        g.fillCircle(v.x, v.y, r);
        g.lineStyle(2, red, 0.8).strokeCircle(v.x, v.y, r);
        g.lineStyle(3, 0xffd34a, 0.9).strokeCircle(v.x, v.y, r * k);
        break;
      }
      case "spit":
      case "pounce": {
        const ang = Math.atan2(ty - v.y, tx - v.x);
        const len = Math.hypot(tx - v.x, ty - v.y);
        const color = atk.kind === "spit" ? 0xc6ff4a : red;
        g.fillStyle(color, 0.35 + 0.5 * k);
        for (let d = def.radius + 6; d < len; d += 18)
          g.fillCircle(v.x + Math.cos(ang) * d, v.y + Math.sin(ang) * d, 2.2);
        g.lineStyle(2, color, 0.5 + 0.5 * k).strokeCircle(tx, ty, 14 + 10 * (1 - k));
        break;
      }
    }
  }

  /** Downed teammate: pulsing ring, bleed-out arc and the revive progress. */
  markDowned(x: number, y: number, bleedFrac: number, revive: number): void {
    const g = this.fx;
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    g.lineStyle(3, 0xff3d3d, 0.4 + 0.5 * pulse).strokeCircle(x, y, 30 + pulse * 4);
    g.lineStyle(3, 0xffb36b, 0.9)
      .beginPath()
      .arc(x, y, 38, -Math.PI / 2, -Math.PI / 2 + Math.max(0, Math.min(1, bleedFrac)) * Math.PI * 2)
      .strokePath();
    if (revive > 0) {
      g.lineStyle(5, 0x0b0c0e, 0.7)
        .beginPath()
        .arc(x, y, 46, 0, Math.PI * 2)
        .strokePath();
      g.lineStyle(4, 0x7dffb0, 1)
        .beginPath()
        .arc(x, y, 46, -Math.PI / 2, -Math.PI / 2 + revive * Math.PI * 2)
        .strokePath();
    }
  }

  clear(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.buffer.clear();
    for (const v of this.props.values()) {
      v.base.destroy();
      v.glow.destroy();
      v.label?.destroy();
    }
    this.props.clear();
    for (const h of this.hazards.values()) h.destroy();
    this.hazards.clear();
    for (const d of this.doors.values()) d.destroy();
    this.doors.clear();
    for (const p of this.projectiles.values()) p.img.destroy();
    this.projectiles.clear();
    this.fx.clear();
    this.ventPhases.clear();
    this.venting.clear();
    this.flagKey = "\u0000";
    this.flags.clear();
  }

  /** Back to the lobby: enemies and effects go, doors and props stay drawn. */
  resetMatch(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.buffer.clear();
    for (const p of this.projectiles.values()) p.img.destroy();
    this.projectiles.clear();
  }

  /** Enemies currently shown only by their eyes (in sight, unlit). */
  get glintCount(): number {
    let n = 0;
    for (const v of this.views.values()) if (v.eyes.visible) n++;
    return n;
  }

  get enemyCount(): number {
    return this.views.size;
  }
}
