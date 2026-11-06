import {
  currentSpreadDeg,
  fireIntervalSteps,
  PLAYER,
  type PlayerSim,
  secToSteps,
  type WeaponDef,
} from "@scrapline/shared";
import type { CrosshairStyle, Settings } from "../../lib/settings.ts";

/**
 * Crosshair logic without Phaser: what to draw (geometry), the cosmetic kick and the hit-marker
 * timeline. The game draws it with a Phaser Graphics (Crosshair.ts), the settings preview with SVG,
 * the tests with a recording sink; all three see exactly the same shapes.
 *
 * Truth contract: with dynamic spread on, the inner gap is never smaller than the weapon's true
 * spread cone at the cursor distance (`trueGapPx`); the per-shot kick only adds to it.
 */

export type HitKind = "hit" | "crit" | "kill" | "armor";
export type CrosshairMode = "active" | "blocked" | "disabled";

export interface CrosshairLook {
  style: CrosshairStyle;
  size: number;
  color: number;
  opacity: number;
  thickness: number;
  outline: boolean;
  dynamicSpread: boolean;
}

export interface CrosshairFrame {
  /** Screen position of the centre (the cursor). */
  x: number;
  y: number;
  /**
   * active: firing works; blocked: seated gunner / passenger aiming outside the seat's fire arc;
   * disabled: drivers and pilots (never fire), or no weapon.
   */
  mode: CrosshairMode;
  /** True spread radius at the cursor distance, in screen px. */
  trueGapPx: number;
  /** Reload progress 0..1, or null. */
  reload: number | null;
  /** Cooldown progress 0..1 of slow weapons (sniper, shotgun), or null. */
  cooldown: number | null;
}

export interface CrosshairSink {
  line(x1: number, y1: number, x2: number, y2: number, width: number, color: number, alpha: number): void;
  /** Stroked circle. */
  ring(x: number, y: number, r: number, width: number, color: number, alpha: number): void;
  /** Stroked arc, angles in radians (clockwise on screen, 0 = right). */
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    width: number,
    color: number,
    alpha: number,
  ): void;
  /** Filled circle. */
  dot(x: number, y: number, r: number, color: number, alpha: number): void;
}

const OUTLINE = 0x0b0c0e;
const NEUTRAL = 0x8c877d;
const RELOAD = 0xffd27a;
export const MARKER_COLORS: Readonly<Record<HitKind, number>> = {
  hit: 0xffffff,
  armor: 0xa9c7e8,
  crit: 0xffd27a,
  kill: 0xff4d3d,
};

/** Fixed gap with dynamic spread off (screen px at size 1). */
export const STATIC_GAP = 6;
/** Smallest gap with dynamic spread on (screen px at size 1): a point-blank cone stays visible. */
export const MIN_GAP = 4;
/** A single hit dealing at least this much reads as critical (no weak spots exist in PvP). */
export const CRIT_DAMAGE = PLAYER.maxHealth * 0.5;
/** Weapons slower than this (steps between shots) show a cooldown ring. */
export const SLOW_WEAPON_STEPS = 20;

export const HIT_MS: Readonly<Record<HitKind, number>> = { hit: 140, armor: 170, crit: 240, kill: 420 };
const HIT_PRIORITY: Readonly<Record<HitKind, number>> = { hit: 0, armor: 1, crit: 2, kill: 3 };
export const KILL_RING_MS = 520;
export const KICK_MAX = 24;
/** Time constant of the kick recovery (exponential), ms. */
export const KICK_TAU_MS = 90;

export function classifyHit(h: {
  dmg: number;
  lethal: boolean;
  armored?: boolean;
  weakSpot?: boolean;
}): HitKind {
  if (h.lethal) return "kill";
  if (h.armored) return "armor";
  if (h.weakSpot || h.dmg >= CRIT_DAMAGE) return "crit";
  return "hit";
}

export function parseHexColor(hex: string, fallback = 0x7dffb0): number {
  return /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : fallback;
}

type LookSettings = Pick<
  Settings,
  | "crosshairStyle"
  | "crosshairSize"
  | "crosshairColor"
  | "crosshairOpacity"
  | "crosshairThickness"
  | "crosshairOutline"
  | "crosshairDynamic"
>;

export function lookFromSettings(s: LookSettings, out?: CrosshairLook): CrosshairLook {
  const look = out ?? ({} as CrosshairLook);
  look.style = s.crosshairStyle;
  look.size = s.crosshairSize;
  look.color = parseHexColor(s.crosshairColor);
  look.opacity = s.crosshairOpacity;
  look.thickness = s.crosshairThickness;
  look.outline = s.crosshairOutline;
  look.dynamicSpread = s.crosshairDynamic;
  return look;
}

/** Radius of the true spread cone at `distWorld` from the shooter, in screen px. */
export function trueSpreadGapPx(spreadDeg: number, distWorld: number, zoom: number): number {
  const deg = Math.min(Math.max(0, spreadDeg), 80);
  return Math.tan((deg * Math.PI) / 180) * Math.max(0, distWorld) * zoom;
}

export interface CrosshairInput {
  screenX: number;
  screenY: number;
  /** Cursor in world coordinates (the point the aim is taken towards). */
  worldX: number;
  worldY: number;
  zoom: number;
  /** Predicted local player: the shot origin and the spread state. */
  sim: PlayerSim;
  def: WeaponDef | undefined;
  /** Seated in a vehicle: can this seat fire at all, and is the cursor inside its arc. */
  seat: { canFire: boolean; inSector: boolean } | null;
}

/**
 * Frame state from the local player's predicted simulation. Spread is the same function firing
 * uses (`currentSpreadDeg`: base + bloom + movement). A seated player's sim never moves on its
 * own (the seat carries it), so a passenger's spread is base + bloom, exactly as the shot.
 */
export function crosshairFrame(i: CrosshairInput, out?: CrosshairFrame): CrosshairFrame {
  const f = out ?? ({} as CrosshairFrame);
  const def = i.def;
  f.x = i.screenX;
  f.y = i.screenY;
  f.mode =
    !def || (i.seat && !i.seat.canFire) ? "disabled" : i.seat && !i.seat.inSector ? "blocked" : "active";
  const dist = Math.hypot(i.worldX - i.sim.x, i.worldY - i.sim.y);
  f.trueGapPx =
    def && f.mode !== "disabled" ? trueSpreadGapPx(currentSpreadDeg(i.sim, def), dist, i.zoom) : 0;
  f.reload = def && i.sim.reload > 0 ? clamp01(1 - i.sim.reload / secToSteps(def.reloadSec)) : null;
  const interval = def ? fireIntervalSteps(def) : 0;
  f.cooldown =
    def && f.reload === null && i.sim.cooldown > 0 && interval > SLOW_WEAPON_STEPS
      ? clamp01(1 - i.sim.cooldown / interval)
      : null;
  return f;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Animated part of the crosshair: shot kick and hit markers. */
export class CrosshairModel {
  /** Cosmetic expansion (screen px) added on top of the true spread. */
  kick = 0;
  hit: HitKind | null = null;
  hitLife = 0;
  killLife = 0;

  onShot(kickPx: number): void {
    this.kick = Math.min(KICK_MAX, this.kick + Math.max(0, kickPx));
  }

  /** A higher-priority marker replaces a lower one; a lower one never hides a higher one. */
  registerHit(kind: HitKind): void {
    if (this.hit === null || this.hitLife <= 0 || HIT_PRIORITY[kind] >= HIT_PRIORITY[this.hit]) {
      this.hit = kind;
      this.hitLife = HIT_MS[kind];
    } else {
      this.hitLife = Math.max(this.hitLife, HIT_MS[kind]);
    }
    if (kind === "kill") this.killLife = KILL_RING_MS;
  }

  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    this.kick *= Math.exp(-dt / KICK_TAU_MS);
    if (this.kick < 0.05) this.kick = 0;
    if (this.hitLife > 0) {
      this.hitLife -= dt;
      if (this.hitLife <= 0) {
        this.hitLife = 0;
        this.hit = null;
      }
    }
    this.killLife = Math.max(0, this.killLife - dt);
  }
}

/** Inner gap actually drawn (screen px). */
export function crosshairGap(
  look: CrosshairLook,
  frame: CrosshairFrame,
  model: Pick<CrosshairModel, "kick">,
) {
  if (frame.mode === "disabled") return STATIC_GAP * look.size;
  if (!look.dynamicSpread) return STATIC_GAP * look.size;
  return Math.max(frame.trueGapPx, MIN_GAP * look.size) + model.kick;
}

/**
 * Phaser applies the camera zoom to scroll-factor-0 objects too, about the camera's zoom origin
 * (its centre): a point drawn at S shows at O + (S - O) * zoom. Without compensation a crosshair
 * drawn at the cursor sits off the cursor (and off the shot ray) everywhere but the screen centre,
 * by (1 - zoom) of its distance from it (80 px at the right edge of a 1280x720 window). This
 * position + scale for the Graphics cancels the zoom, so shapes are drawn in true screen pixels.
 */
export function screenSpaceTransform(
  zoom: number,
  originX: number,
  originY: number,
  out: { x: number; y: number; scale: number } = { x: 0, y: 0, scale: 1 },
): { x: number; y: number; scale: number } {
  const k = zoom > 0 ? 1 / zoom : 1;
  out.x = originX * (1 - k);
  out.y = originY * (1 - k);
  out.scale = k;
  return out;
}

// ------------------------------------------------------------------ drawing

/** Draws with the outline pass first (dark, wider), then the colour pass. Allocation-free. */
export function drawCrosshair(
  sink: CrosshairSink,
  look: CrosshairLook,
  frame: CrosshairFrame,
  model: Pick<CrosshairModel, "kick" | "hit" | "hitLife" | "killLife">,
): void {
  if (look.outline) drawPass(sink, true, look, frame, model);
  drawPass(sink, false, look, frame, model);
}

function drawPass(
  k: CrosshairSink,
  o: boolean,
  look: CrosshairLook,
  f: CrosshairFrame,
  m: Pick<CrosshairModel, "kick" | "hit" | "hitLife" | "killLife">,
): void {
  const s = look.size;
  const t = look.thickness;
  const x = f.x;
  const y = f.y;
  const gap = crosshairGap(look, f, m);
  let outer: number;
  if (f.mode === "disabled") {
    const r = 6 * s;
    const a = 0.6 * look.opacity;
    ring(k, o, x, y, r, Math.max(1, t * 0.75), NEUTRAL, a);
    dot(k, o, x, y, Math.max(0.9, t * 0.5), NEUTRAL, a);
    outer = r;
  } else {
    const blocked = f.mode === "blocked";
    const c = blocked ? NEUTRAL : look.color;
    const a = look.opacity * (blocked ? 0.45 : 1);
    switch (look.style) {
      case "dot": {
        const r = (1.4 + t * 0.55) * s;
        dot(k, o, x, y, r, c, a);
        outer = r;
        if (look.dynamicSpread && gap > r + 3) {
          ring(k, o, x, y, gap, Math.max(1, t * 0.5), c, a * 0.35);
          outer = gap;
        }
        break;
      }
      case "circle": {
        const r = Math.max(gap, 5 * s);
        ring(k, o, x, y, r, t, c, a);
        dot(k, o, x, y, Math.max(0.8, t * 0.5), c, a);
        outer = r;
        break;
      }
      case "tactical": {
        const r = gap + 1;
        const half = 0.42;
        for (let q = 0; q < 4; q++) {
          const mid = Math.PI / 4 + (q * Math.PI) / 2;
          arc(k, o, x, y, r, mid - half, mid + half, t, c, a);
        }
        const len = 8 * s;
        line(k, o, x - r - 3, y, x - r - 3 - len, y, t, c, a);
        line(k, o, x + r + 3, y, x + r + 3 + len, y, t, c, a);
        line(k, o, x, y + r + 3, x, y + r + 3 + len, t, c, a);
        dot(k, o, x, y, Math.max(0.8, t * 0.6), c, a);
        outer = r + 3 + len;
        break;
      }
      case "minimal": {
        const len = 3.5 * s;
        const w = Math.max(1, t * 0.75);
        line(k, o, x + gap, y, x + gap + len, y, w, c, a);
        line(k, o, x - gap, y, x - gap - len, y, w, c, a);
        line(k, o, x, y + gap, x, y + gap + len, w, c, a);
        line(k, o, x, y - gap, x, y - gap - len, w, c, a);
        outer = gap + len;
        break;
      }
      default: {
        const len = 7 * s;
        line(k, o, x + gap, y, x + gap + len, y, t, c, a);
        line(k, o, x - gap, y, x - gap - len, y, t, c, a);
        line(k, o, x, y + gap, x, y + gap + len, t, c, a);
        line(k, o, x, y - gap, x, y - gap - len, t, c, a);
        dot(k, o, x, y, Math.max(0.9, t * 0.75), c, a);
        outer = gap + len;
        break;
      }
    }
  }

  // Reload ring (amber, from 12 o'clock) and the cooldown ring of slow weapons.
  if (f.reload !== null) {
    const r = outer + 7;
    if (o) k.ring(x, y, r, 5, OUTLINE, 0.55 * look.opacity);
    else {
      k.ring(x, y, r, 3, OUTLINE, 0.55 * look.opacity);
      if (f.reload > 0)
        k.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + f.reload * Math.PI * 2, 3, RELOAD, look.opacity);
    }
  } else if (f.cooldown !== null && f.mode !== "disabled") {
    const r = outer + 6;
    const end = -Math.PI / 2 + f.cooldown * Math.PI * 2;
    arc(k, o, x, y, r, -Math.PI / 2, end, 2, look.color, 0.5 * look.opacity);
  }

  // Hit markers: never scaled by the opacity setting (feedback must stay readable).
  const sm = 0.8 + 0.2 * s;
  if (m.hit !== null && m.hitLife > 0) {
    const max = HIT_MS[m.hit];
    // Full strength for the first ~45 % of the marker's life, then a fade.
    const a = clamp01((m.hitLife / max) * 1.8);
    const c = MARKER_COLORS[m.hit];
    if (m.hit === "armor") {
      const h = 11 * sm;
      const arm = 5 * sm;
      for (let q = 0; q < 4; q++) {
        const sx = q & 1 ? 1 : -1;
        const sy = q & 2 ? 1 : -1;
        line(k, o, x + sx * h, y + sy * h, x + sx * (h - arm), y + sy * h, 2.5, c, a);
        line(k, o, x + sx * h, y + sy * h, x + sx * h, y + sy * (h - arm), 2.5, c, a);
      }
    } else {
      // Crits pop in slightly larger during their first 70 ms.
      const pop = m.hit === "crit" ? 1 + 0.35 * clamp01((m.hitLife - (max - 70)) / 70) : 1;
      const r0 = (m.hit === "kill" ? 7 : m.hit === "crit" ? 5 : 6) * sm * pop;
      const r1 = (m.hit === "kill" ? 19 : m.hit === "crit" ? 16 : 13) * sm * pop;
      const w = m.hit === "kill" ? 3.5 : m.hit === "crit" ? 3 : 2.5;
      const d0 = r0 * Math.SQRT1_2;
      const d1 = r1 * Math.SQRT1_2;
      line(k, o, x + d0, y + d0, x + d1, y + d1, w, c, a);
      line(k, o, x - d0, y + d0, x - d1, y + d1, w, c, a);
      line(k, o, x + d0, y - d0, x + d1, y - d1, w, c, a);
      line(k, o, x - d0, y - d0, x - d1, y - d1, w, c, a);
    }
  }
  if (m.killLife > 0) {
    const q = 1 - m.killLife / KILL_RING_MS;
    const ease = 1 - (1 - q) ** 3;
    ring(k, o, x, y, (12 + 22 * ease) * sm, 2.5, MARKER_COLORS.kill, (1 - q) * 0.9);
  }
}

function line(
  k: CrosshairSink,
  o: boolean,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  c: number,
  a: number,
) {
  if (!o) {
    k.line(x1, y1, x2, y2, w, c, a);
    return;
  }
  // Outline: 1 px longer at both ends so the butt caps are outlined too.
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  k.line(x1 - ux, y1 - uy, x2 + ux, y2 + uy, w + 2, OUTLINE, a * 0.8);
}

function ring(
  k: CrosshairSink,
  o: boolean,
  x: number,
  y: number,
  r: number,
  w: number,
  c: number,
  a: number,
) {
  if (o) k.ring(x, y, r, w + 2, OUTLINE, a * 0.8);
  else k.ring(x, y, r, w, c, a);
}

function arc(
  k: CrosshairSink,
  o: boolean,
  x: number,
  y: number,
  r: number,
  start: number,
  end: number,
  w: number,
  c: number,
  a: number,
) {
  if (o) {
    const pad = 1 / Math.max(1, r);
    k.arc(x, y, r, start - pad, end + pad, w + 2, OUTLINE, a * 0.8);
  } else k.arc(x, y, r, start, end, w, c, a);
}

function dot(k: CrosshairSink, o: boolean, x: number, y: number, r: number, c: number, a: number) {
  if (o) k.dot(x, y, r + 1, OUTLINE, a * 0.8);
  else k.dot(x, y, r, c, a);
}
