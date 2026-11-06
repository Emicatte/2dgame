import Phaser from "phaser";
import type { GraphicsQuality } from "../../lib/settings.ts";
import { type SightWorld, shadowQuads, type VisibilityPolygon, visibilityPolygon } from "./visibility.ts";

/**
 * Co-op darkness as a light map: a texture the size of the view, filled with a dim ambient
 * colour, lights added on top (flashlights, headlights, lamps, muzzle flashes), then shadow
 * quads from the local player's line of sight drawn back in ambient colour. Rendered with a
 * MULTIPLY blend over the world: lit floor keeps its colour, everything else sinks into the dark.
 *
 * One texture, a handful of stamps and one graphics draw per frame; resolution is reduced by
 * quality (1/2, 1/3, 1/4 of the view). Only exists in PvE.
 */

export interface LightSource {
  x: number;
  y: number;
  r: number;
  color: number;
  a: number;
}

export interface Carrier {
  x: number;
  y: number;
  aim: number;
  downed: boolean;
}

export interface Headlight {
  x: number;
  y: number;
  angle: number;
}

export interface LightmapFrame {
  cam: Phaser.Cameras.Scene2D.Camera;
  /** Vision origin: the local player, or the teammate being followed. */
  eye: { x: number; y: number };
  /** The local player's own flashlight (null while dead or driving). */
  me: Carrier | null;
  allies: readonly Carrier[];
  headlights: readonly Headlight[];
  lamps: readonly LightSource[];
  /** 0 = darkest allowed … 1 = brightest allowed (difficulty and accessibility setting). */
  brightness: number;
  /** Flashlight intensity multiplier (stalker flicker). */
  flicker: number;
  /** Low-health pulse 0..1 (red vignette). */
  danger: number;
  dtSec: number;
}

const TEX_RADIAL = "dread-radial";
const TEX_CONE = "dread-cone";
const TEX_VIGNETTE = "dread-vignette";
const CONE_W = 256;
const CONE_H = 160;
/** Flashlight: reach and half-angle of the beam (soft edge beyond). */
export const FLASHLIGHT = { range: 600, halfAngle: 0.5 } as const;
const PERSONAL_R = 150;
const HEADLIGHT = { range: 520, spread: 0.42 } as const;

const RES: Record<GraphicsQuality, number> = { low: 4, medium: 3, high: 2 };

interface Flash extends LightSource {
  ttl: number;
  life: number;
}

export class Lightmap {
  private rt: Phaser.GameObjects.RenderTexture | null = null;
  private readonly shadows: Phaser.GameObjects.Graphics;
  private readonly flashes: Flash[] = [];
  private res = 2;
  private rtW = 0;
  private rtH = 0;
  private world: SightWorld = { boxes: [] };
  private active = false;
  private time = 0;
  /** Last frame's sources, for "is this point lit" queries (eye glints). */
  private lit: LightSource[] = [];
  private cones: { x: number; y: number; a: number; range: number; half: number }[] = [];
  poly: VisibilityPolygon | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    makeTextures(scene);
    this.shadows = scene.make.graphics({}, false);
  }

  setQuality(q: GraphicsQuality): void {
    if (RES[q] === this.res) return;
    this.res = RES[q];
    this.rt?.destroy();
    this.rt = null;
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) {
      this.rt?.destroy();
      this.rt = null;
      this.poly = null;
      this.flashes.length = 0;
    }
  }

  get enabled(): boolean {
    return this.active;
  }

  setWorld(world: SightWorld): void {
    this.world = world;
  }

  /** Transient light (muzzle flash, explosion). */
  flash(x: number, y: number, r: number, color: number, ms: number, a = 1): void {
    if (!this.active) return;
    if (this.flashes.length > 24) this.flashes.shift();
    this.flashes.push({ x, y, r, color, a, ttl: ms / 1000, life: ms / 1000 });
  }

  /** Approximate light level at a world point (0 dark … 1 lit), from last frame's sources. */
  lightAt(x: number, y: number): number {
    let l = 0;
    for (const s of this.lit) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < s.r) l = Math.max(l, s.a * (1 - d / s.r));
    }
    for (const c of this.cones) {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d > c.range) continue;
      const da = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(y - c.y, x - c.x) - c.a));
      if (da < c.half) l = Math.max(l, 1 - d / c.range);
    }
    return l;
  }

  update(f: LightmapFrame): void {
    if (!this.active) return;
    this.time += f.dtSec;
    const view = f.cam.worldView;
    const margin = 64;
    const w = Math.ceil((view.width + margin * 2) / this.res);
    const h = Math.ceil((view.height + margin * 2) / this.res);
    if (!this.rt || Math.abs(w - this.rtW) > 8 || Math.abs(h - this.rtH) > 8) {
      this.rt?.destroy();
      this.rtW = w + 16;
      this.rtH = h + 16;
      this.rt = this.scene.add
        .renderTexture(0, 0, this.rtW, this.rtH)
        .setOrigin(0)
        .setScale(this.res)
        .setDepth(32)
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    const rt = this.rt;
    const ox = view.x - margin;
    const oy = view.y - margin;
    rt.setPosition(ox, oy);
    const res = this.res;
    const lx = (x: number) => (x - ox) / res;
    const ly = (y: number) => (y - oy) / res;

    const ambient = ambientColor(f.brightness);
    rt.clear();
    rt.fill(ambient, 1);
    this.lit = [];
    this.cones = [];

    const radial = (s: LightSource) => {
      if (s.a <= 0.01 || s.r <= 1) return;
      rt.stamp(TEX_RADIAL, undefined, lx(s.x), ly(s.y), {
        scale: (s.r * 2) / res / 128,
        tint: s.color,
        alpha: Math.min(1, s.a),
        blendMode: Phaser.BlendModes.ADD,
      });
    };
    const cone = (
      x: number,
      y: number,
      a: number,
      range: number,
      half: number,
      color: number,
      alpha: number,
    ) => {
      if (alpha <= 0.01) return;
      rt.stamp(TEX_CONE, undefined, lx(x), ly(y), {
        originX: 0,
        originY: 0.5,
        rotation: a,
        scaleX: range / res / CONE_W,
        scaleY: (Math.tan(half * 1.45) * range * 2) / res / CONE_H,
        tint: color,
        alpha: Math.min(1, alpha),
        blendMode: Phaser.BlendModes.ADD,
      });
      this.cones.push({ x, y, a, range: range * 0.9, half });
    };

    // Map lamps and glowing props.
    for (const l of f.lamps) {
      radial(l);
      this.lit.push({ ...l, r: l.r * 0.7 });
    }
    // Teammates: their own light and flashlight (seen only where the local player has sight).
    for (const c of f.allies) {
      const p = { x: c.x, y: c.y, r: PERSONAL_R, color: 0xb9b2a6, a: 0.75 };
      radial(p);
      this.lit.push(p);
      if (!c.downed) cone(c.x, c.y, c.aim, FLASHLIGHT.range, FLASHLIGHT.halfAngle, 0xfff0d6, 0.85);
    }
    for (const v of f.headlights) {
      for (const side of [-1, 1]) {
        const sx = v.x + Math.cos(v.angle) * 30 - Math.sin(v.angle) * 13 * side;
        const sy = v.y + Math.sin(v.angle) * 30 + Math.cos(v.angle) * 13 * side;
        cone(sx, sy, v.angle, HEADLIGHT.range, HEADLIGHT.spread, 0xfff6e0, 0.9);
      }
    }
    // The local player: a small personal light, then the flashlight beam.
    if (f.me) {
      const p = { x: f.me.x, y: f.me.y, r: f.me.downed ? 110 : PERSONAL_R, color: 0xc9c0b0, a: 0.85 };
      radial(p);
      this.lit.push(p);
      if (!f.me.downed) {
        cone(f.me.x, f.me.y, f.me.aim, FLASHLIGHT.range, FLASHLIGHT.halfAngle, 0xfff1d8, f.flicker);
      }
    } else {
      // Dead / spectating: a faint light at the followed position so the view is not black.
      radial({ x: f.eye.x, y: f.eye.y, r: 260, color: 0x8a8f9a, a: 0.6 });
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i]!;
      fl.ttl -= f.dtSec;
      if (fl.ttl <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      const k = fl.ttl / fl.life;
      const s = { x: fl.x, y: fl.y, r: fl.r, color: fl.color, a: fl.a * k };
      radial(s);
      this.lit.push(s);
    }

    // Line of sight: everything the local player cannot see sinks back to ambient.
    const far = Math.hypot(view.width, view.height) + margin * 2;
    const poly = visibilityPolygon(this.world, f.eye.x, f.eye.y, far, 12);
    this.poly = poly;
    const quads = shadowQuads(poly, far * 1.5);
    const g = this.shadows;
    g.clear();
    g.fillStyle(ambient, 1);
    const pts = [
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
      new Phaser.Math.Vector2(),
    ];
    for (let q = 0; q < quads.length; q += 8) {
      for (let k = 0; k < 4; k++) pts[k]!.set(lx(quads[q + k * 2]!), ly(quads[q + k * 2 + 1]!));
      g.fillPoints(pts, true);
    }
    rt.draw(g);

    // Vignette: always a little, red and pulsing when hurt.
    const pulse = f.danger > 0 ? 0.55 + 0.45 * Math.sin(this.time * (5 + f.danger * 4)) : 0;
    const vig = {
      originX: 0.5,
      originY: 0.5,
      scaleX: (view.width + margin * 2) / res / 256,
      scaleY: (view.height + margin * 2) / res / 256,
    };
    rt.stamp(TEX_VIGNETTE, undefined, this.rtW / 2, this.rtH / 2, { ...vig, alpha: 0.55 });
    if (f.danger > 0) {
      rt.stamp(TEX_VIGNETTE, undefined, this.rtW / 2, this.rtH / 2, {
        ...vig,
        tint: 0x8a1010,
        alpha: Math.min(0.6, f.danger * (0.3 + 0.3 * pulse)),
      });
    }
    rt.render();
  }

  destroy(): void {
    this.rt?.destroy();
    this.shadows.destroy();
  }
}

/** Ambient light: bluish grey; brighter on Recruit / with the accessibility slider. */
export function ambientColor(brightness: number): number {
  const b = Math.max(0, Math.min(1, brightness));
  const v = 0.05 + b * 0.13;
  const r = Math.round(255 * v * 0.86);
  const g = Math.round(255 * v * 0.92);
  const bl = Math.round(255 * v * 1.12);
  return (r << 16) | (g << 8) | Math.min(255, bl);
}

function makeTextures(scene: Phaser.Scene): void {
  const tex = scene.textures;
  if (!tex.exists(TEX_RADIAL)) {
    const c = tex.createCanvas(TEX_RADIAL, 128, 128)!;
    const ctx = c.getContext();
    const img = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const d = Math.hypot(x - 63.5, y - 63.5) / 64;
        const v = d >= 1 ? 0 : (1 - d) ** 1.6;
        const i = (y * 128 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    c.refresh();
  }
  if (!tex.exists(TEX_CONE)) {
    // Beam from the left-middle: bright core, soft angular edge, fades with distance.
    const c = tex.createCanvas(TEX_CONE, CONE_W, CONE_H)!;
    const ctx = c.getContext();
    const img = ctx.createImageData(CONE_W, CONE_H);
    const tanHalf = CONE_H / 2 / CONE_W;
    for (let y = 0; y < CONE_H; y++) {
      for (let x = 0; x < CONE_W; x++) {
        const dx = x / CONE_W;
        const dy = (y - CONE_H / 2 + 0.5) / CONE_W;
        const d = Math.hypot(dx, dy);
        const ang = Math.abs(Math.atan2(dy, Math.max(1e-6, dx)));
        const halfTex = Math.atan(tanHalf);
        const edge = 1 - Math.min(1, Math.max(0, (ang / halfTex - 0.62) / 0.38));
        const fall = d >= 1 ? 0 : (1 - d) ** 0.85;
        const nearFade = Math.min(1, d / 0.04);
        const v = edge * edge * fall * nearFade;
        const i = (y * CONE_W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    c.refresh();
  }
  if (!tex.exists(TEX_VIGNETTE)) {
    const c = tex.createCanvas(TEX_VIGNETTE, 256, 256)!;
    const ctx = c.getContext();
    const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const dx = (x - 127.5) / 128;
        const dy = (y - 127.5) / 128;
        const d = Math.max(Math.hypot(dx * 0.92, dy), 0);
        const v = Math.min(1, Math.max(0, (d - 0.55) / 0.55)) ** 1.5;
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
        img.data[i + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    c.refresh();
  }
}
