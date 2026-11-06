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
  type ZombieDef,
  zombieByIndex,
} from "@scrapline/shared";
import Phaser from "phaser";
import { TEX, TEX_SCALE } from "../art/textures.ts";
import { generateZombieTextures, ZTEX } from "../art/zombieArt.ts";
import type { Effects } from "../effects/Effects.ts";

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
  private readonly dark: Phaser.GameObjects.Rectangle;
  private readonly lantern: Phaser.GameObjects.Image;
  private mission: MissionDef | null = null;
  private mapId = "";
  private doorKey = "\u0000";
  /** Mission flags the scene uses for lights. */
  power = false;
  alarm = false;
  active = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly effects: Effects,
  ) {
    generateZombieTextures(scene);
    this.fx = scene.add.graphics().setDepth(13);
    // PvE maps are darker: one camera-space quad (cheap) under the lights, which brighten it back.
    this.dark = scene.add
      .rectangle(0, 0, 10, 10, 0x05060a, 0.4)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(29)
      .setVisible(false);
    this.lantern = scene.add
      .image(0, 0, TEX.glowSoft)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xfff1d0)
      .setAlpha(0.22)
      .setDisplaySize(620, 620)
      .setDepth(31)
      .setVisible(false);
  }

  /** Map / mission changed (or left PvE): rebuild doors and props. */
  setContext(map: MapDef, state: MatchState): void {
    const pve = state.mode === "outbreak" || state.mode === "survival";
    const mission = state.mode === "outbreak" ? (missionById(state.pve.mission) ?? null) : null;
    if (this.active === pve && this.mapId === map.id && this.mission === mission) return;
    this.clear();
    this.active = pve;
    this.mapId = map.id;
    this.mission = mission;
    this.doorKey = "\u0000";
    this.dark.setVisible(pve);
    this.lantern.setVisible(pve);
  }

  /** Doors open in the state (the scene rebuilds the collision world when this changes). */
  doorsChanged(state: MatchState): boolean {
    const key = state.pve.doors;
    if (key === this.doorKey) return false;
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

  /** Survival plays on mission maps with every door open. */
  private get activeMissionDoors(): boolean {
    return !!this.mission;
  }

  onPatch(state: MatchState, inMatch: boolean): void {
    if (!this.active) return;
    this.power = state.pve.power;
    this.alarm = state.pve.alarm;
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
    const cam = this.scene.cameras.main;
    // Camera zoom also scales scroll-factor-0 objects around the screen centre: oversize the
    // quad so it covers the whole view at any zoom.
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    this.dark.setPosition(-w, -h).setSize(w * 3, h * 3);
    this.dark.setAlpha(this.power ? 0.26 : 0.42);
    this.lantern.setPosition(focus.x, focus.y);
    void cam;
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
        const t = performance.now() / 1000;
        for (let i = 0; i < 3; i++) {
          const rr = def.radius + ((t * 160 + i * 60) % 200);
          g.lineStyle(3, 0xffb36b, Math.max(0, 0.8 - rr / 260)).strokeCircle(v.x, v.y, rr);
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
  }

  /** Back to the lobby: enemies and effects go, doors and props stay drawn. */
  resetMatch(): void {
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
    this.buffer.clear();
    for (const p of this.projectiles.values()) p.img.destroy();
    this.projectiles.clear();
  }

  get enemyCount(): number {
    return this.views.size;
  }
}
