import type { MapDef, WeaponDef } from "@scrapline/shared";
import Phaser from "phaser";
import { type GraphicsQuality, settingsStore } from "../../lib/settings.ts";
import { TEX } from "../art/textures.ts";
import {
  budgetFor,
  choosePoolSlot,
  clampToCap,
  type FxBudget,
  type FxCounts,
  formatFxCounts,
  ImpactLimiter,
  mergeTarget,
} from "../combat/fxBudget.ts";
import { classifyImpact, EDGE_TINT } from "../combat/surfaces.ts";
import { type MuzzleVariant, profileFor } from "../combat/weaponFx.ts";

interface Tracer {
  img: Phaser.GameObjects.Image;
  /** Glow under the streak, or the sniper's full-length beam. */
  glow: Phaser.GameObjects.Image;
  life: number;
  max: number;
  // Animated streak travelling from (x0,y0) to (x1,y1)
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dist: number;
  speed: number;
  width: number;
  streak: number;
  fade: number;
  beam: boolean;
  glowAlpha: number;
}

interface Flash {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  baseScale: number;
  peak: number;
}

interface FloatText {
  text: Phaser.GameObjects.Text;
  life: number;
  max: number;
  vy: number;
  /** Anchor (the hit position) for merging rapid hits on the same target. */
  x: number;
  y: number;
  born: number;
  amount: number;
  /** Lethal and critical numbers stand alone (never merged). */
  lethal: boolean;
  baseScale: number;
  pop: number;
}

/** Options of a hit on a (PvE) enemy or a player. All visual; nothing graphic (sparks, scrap). */
export interface EnemyHitOpts {
  lethal: boolean;
  /** Colour of the scrap chips (the enemy's palette). */
  color?: number;
  /** Plated target: white-blue ricochet sparks. */
  armored?: boolean;
  /** Weak spot / critical: hot yellow burst and a small ring. */
  weakSpot?: boolean;
  /** Larger burst for bosses. */
  boss?: boolean;
}

export interface EnemyDeathOpts {
  /** Colour of the scrap debris. */
  color?: number;
  /** Size multiplier of the burst (1 = a player). */
  size?: number;
  boss?: boolean;
}

export interface DamageNumberOpts {
  crit?: boolean;
  /** Damage absorbed by plating / a vehicle hull: steel-coloured, smaller. */
  armored?: boolean;
}

type SurfaceMap = Pick<MapDef, "width" | "height" | "solids">;

const MUZZLE_TEX: Readonly<Record<MuzzleVariant, string>> = {
  cone: TEX.muzzle,
  star: TEX.muzzleStar,
  wide: TEX.muzzleWide,
  brake: TEX.muzzleBrake,
};

const NUMBER_LABELS = Array.from({ length: 1000 }, (_, i) => String(i));
const label = (n: number) => (n >= 0 && n < 1000 ? NUMBER_LABELS[n]! : String(n));

const SPARK_HOT = 0xffe2a8;
const SPARK_WHITE = 0xfff8ec;
const METAL_CHIP = 0x4a4e56;

const registry = new WeakMap<Phaser.Scene, Effects>();

/**
 * Pooled transient effects. Nothing here allocates per shot once the pools are warm (pools are
 * reused, particle parameters are read through callbacks from one mutable object), which keeps
 * frame times flat during heavy firefights. Every pool and emitter is capped by the quality
 * budget (combat/fxBudget.ts).
 */
export class Effects {
  /** The Effects of a scene (views that emit effects, e.g. shell casings, look it up here). */
  static of(scene: Phaser.Scene): Effects | undefined {
    return registry.get(scene);
  }

  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly lights: Flash[] = [];
  private readonly texts: FloatText[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly shells: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rings: Flash[] = [];
  private budget: FxBudget;
  private quality: GraphicsQuality;
  private readonly limiter: ImpactLimiter;
  /** Parameters of the next burst, read by the emitters' onEmit callbacks. */
  private readonly p = {
    angle: 0,
    spread: 360,
    speedMin: 0,
    speedMax: 0,
    tint: 0xffffff,
    life: 1,
    scale: 1,
    alpha: 0.2,
  };
  private nextAngle = 0;
  private clock = 0;
  private mergeWindowStart = 0;
  private mergedPerSec = 0;
  private readonly countsOut: FxCounts = {
    tracers: 0,
    flashes: 0,
    lights: 0,
    rings: 0,
    sparks: 0,
    debris: 0,
    smoke: 0,
    shells: 0,
    numbers: 0,
  };
  /** Number of live pooled objects and particles, for the debug overlay. */
  active = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Map of the arena, to tell metal from masonry at impact points. */
    private readonly mapOf: () => SurfaceMap | null = () => null,
  ) {
    registry.set(scene, this);
    this.quality = settingsStore.get().quality;
    this.budget = budgetFor(this.quality);
    this.limiter = new ImpactLimiter(this.budget);
    const p = this.p;
    const speed = { onEmit: () => p.speedMin + Math.random() * (p.speedMax - p.speedMin) };
    const angle = { onEmit: () => p.angle + (Math.random() - 0.5) * p.spread };
    const tint = { onEmit: () => p.tint };
    // Per-particle start values for the grow / shrink / fade curves (set at emit).
    type Born = { s0?: number; a0?: number };
    const born = (particle: unknown) => particle as Born;
    this.sparks = scene.add
      .particles(0, 0, TEX.spark, {
        emitting: false,
        lifespan: { onEmit: () => (120 + Math.random() * 200) * p.life },
        speed,
        // `rotate` is evaluated before the velocity: pick the direction here, reuse it below.
        rotate: {
          onEmit: () => {
            this.nextAngle = p.angle + (Math.random() - 0.5) * p.spread;
            return this.nextAngle;
          },
        },
        angle: { onEmit: () => this.nextAngle },
        scale: {
          onEmit: (particle) => {
            if (particle) born(particle).s0 = p.scale;
            return p.scale;
          },
          onUpdate: (particle, _key, t) => (born(particle).s0 ?? 1) * (1 - 0.8 * t),
        },
        // Bright for most of the life, then a quick fade.
        alpha: { onEmit: () => 1, onUpdate: (_particle, _key, t) => 1 - t * t },
        tint,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(40);
    this.debris = scene.add
      .particles(0, 0, TEX.debris, {
        emitting: false,
        lifespan: { onEmit: () => (400 + Math.random() * 500) * p.life },
        speed,
        angle,
        scale: { onEmit: () => p.scale * (0.7 + Math.random() * 0.6) },
        alpha: { start: 1, end: 0 },
        rotate: { min: 0, max: 360 },
        tint,
        drag: 300,
      } as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig)
      .setDepth(15);
    this.smoke = scene.add
      .particles(0, 0, TEX.smoke, {
        emitting: false,
        lifespan: { onEmit: () => (400 + Math.random() * 400) * p.life },
        speed,
        angle,
        scale: {
          onEmit: (particle) => {
            const s = 0.4 * p.scale;
            if (particle) born(particle).s0 = s;
            return s;
          },
          onUpdate: (particle, _key, t) => (born(particle).s0 ?? 0.4) * (1 + 2.5 * t),
        },
        alpha: {
          onEmit: (particle) => {
            if (particle) born(particle).a0 = p.alpha;
            return p.alpha;
          },
          onUpdate: (particle, _key, t) => (born(particle).a0 ?? 0.2) * (1 - t),
        },
        tint,
      })
      .setDepth(39);
    this.shells = scene.add
      .particles(0, 0, TEX.shell, {
        emitting: false,
        lifespan: 500,
        speed,
        angle,
        rotate: { min: 0, max: 360 },
        alpha: { start: 1, end: 0 },
        scale: 0.9,
      })
      .setDepth(14);
    this.applyCaps();
  }

  /** Graphics quality changed: new caps for every pool and emitter. */
  setQuality(quality: GraphicsQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.budget = budgetFor(quality);
    this.limiter.setBudget(this.budget);
    this.applyCaps();
  }

  private applyCaps() {
    const b = this.budget;
    // 0 would mean "unlimited" to Phaser; bursts are clamped to the cap before emitting anyway.
    this.sparks.maxAliveParticles = Math.max(1, b.sparks);
    this.debris.maxAliveParticles = Math.max(1, b.debris);
    this.smoke.maxAliveParticles = Math.max(1, b.smoke);
    this.shells.maxAliveParticles = Math.max(1, b.shells);
  }

  // ---------------------------------------------------------------- pools

  private takeTracer(): Tracer {
    const i = choosePoolSlot(this.tracers, this.budget.tracers);
    const existing = this.tracers[i];
    if (existing) return existing;
    const img = this.scene.add
      .image(0, 0, TEX.tracer)
      .setOrigin(1, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(38);
    const glow = this.scene.add
      .image(0, 0, TEX.beam)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(37)
      .setVisible(false);
    const t: Tracer = {
      img,
      glow,
      life: 0,
      max: 0,
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      dist: 0,
      speed: 0,
      width: 2,
      streak: 140,
      fade: 60,
      beam: false,
      glowAlpha: 0,
    };
    this.tracers.push(t);
    return t;
  }

  private takeFlash(pool: Flash[], cap: number, texture: string, depth: number): Flash {
    const i = choosePoolSlot(pool, cap);
    let f = pool[i];
    if (!f) {
      const img = this.scene.add.image(0, 0, texture).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
      f = { img, life: 0, max: 0, baseScale: 1, peak: 1 };
      pool.push(f);
    }
    f.img.setTexture(texture).setVisible(true);
    return f;
  }

  /**
   * Co-op darkness: every transient light (muzzle flash, explosion) is also handed to the light
   * map, so gunfire really lights the dark. Null outside PvE.
   */
  lightSink:
    | ((x: number, y: number, radius: number, color: number, ms: number, alpha: number) => void)
    | null = null;

  private light(x: number, y: number, color: number, radius: number, ms: number, alpha: number) {
    this.lightSink?.(x, y, radius, color, ms, alpha);
    const l = this.takeFlash(this.lights, this.budget.lights, TEX.glow, 5);
    l.img
      .setPosition(x, y)
      .setOrigin(0.5)
      .setTint(color)
      .setAlpha(alpha)
      .setDisplaySize(radius * 2, radius * 2);
    l.life = l.max = ms;
    l.peak = alpha;
  }

  private ringBurst(x: number, y: number, color: number, size: number, ms: number) {
    const r = this.takeFlash(this.rings, this.budget.rings, TEX.ring, 36);
    r.img.setPosition(x, y).setOrigin(0.5).setTint(color).setAlpha(0.9).setDisplaySize(10, 10);
    r.baseScale = size;
    r.life = r.max = ms;
  }

  /** Sets the next burst's parameters (angles in radians, spread in degrees of arc). */
  private setBurst(
    angle: number,
    spreadDeg: number,
    speedMin: number,
    speedMax: number,
    tint: number,
    life = 1,
  ) {
    const p = this.p;
    p.angle = Phaser.Math.RadToDeg(angle);
    p.spread = spreadDeg;
    p.speedMin = speedMin;
    p.speedMax = speedMax;
    p.tint = tint;
    p.life = life;
    p.scale = 1;
    // Smoke texture peaks at 0.85: 0.2 keeps muzzle / vehicle smoke as light as before.
    p.alpha = 0.2;
  }

  /** Emits up to `n` particles, clamped to what the emitter's cap still allows. */
  private burst(
    e: Phaser.GameObjects.Particles.ParticleEmitter,
    cap: number,
    n: number,
    x: number,
    y: number,
  ) {
    const k = clampToCap(n, e.getAliveParticleCount(), cap);
    if (k > 0) e.emitParticleAt(x, y, k);
  }

  // ---------------------------------------------------------------- shots

  /** A shot: muzzle flash, light, tracers and impacts. `ends` are per pellet. */
  shot(
    def: WeaponDef,
    muzzleX: number,
    muzzleY: number,
    aim: number,
    ends: readonly { x: number; y: number; wall: boolean; player: boolean }[],
  ): void {
    const prof = profileFor(def);
    const b = this.budget;
    const variant = prof.muzzle.variant;
    const m = this.takeFlash(this.flashes, b.flashes, MUZZLE_TEX[variant], 37);
    const sc = def.fx.muzzleScale * prof.muzzle.scaleMul;
    m.img
      .setPosition(muzzleX, muzzleY)
      .setRotation(aim + (variant === "star" ? (Math.random() - 0.5) * 0.5 : 0))
      .setOrigin(0.06, 0.5)
      .setScale(sc * (0.85 + Math.random() * 0.3), sc * (0.9 + Math.random() * 0.2))
      .setAlpha(1)
      .setTint(0xffffff);
    m.life = m.max = prof.muzzle.lifeMs;
    m.baseScale = sc;
    m.peak = 1;
    const mz = prof.muzzle;
    this.light(
      muzzleX,
      muzzleY,
      mz.lightColor,
      mz.lightRadius * def.fx.muzzleScale,
      mz.lightMs,
      mz.lightAlpha,
    );

    const tr = prof.tracer;
    const glow = b.tracerGlow ? tr.glow : 0;
    for (let i = 0; i < ends.length; i++) {
      const end = ends[i]!;
      const t = this.takeTracer();
      const dist = Math.hypot(end.x - muzzleX, end.y - muzzleY);
      const travel = (dist / def.fx.tracerSpeed) * 1000;
      t.x0 = muzzleX;
      t.y0 = muzzleY;
      t.x1 = end.x;
      t.y1 = end.y;
      t.dist = dist;
      t.speed = def.fx.tracerSpeed;
      t.width = def.fx.tracerWidth * tr.widthMul;
      t.streak = tr.beam ? 220 : tr.streakPx;
      t.fade = tr.fadeMs;
      t.beam = tr.beam && b.tracerGlow;
      t.glowAlpha = tr.beam ? (b.tracerGlow ? 0.55 : 0) : glow;
      t.life = t.max = travel + tr.fadeMs;
      const rot = Math.atan2(end.y - muzzleY, end.x - muzzleX);
      t.img.setVisible(true).setTint(def.fx.tracerColor).setRotation(rot).setAlpha(0.95);
      t.glow
        .setVisible(t.glowAlpha > 0)
        .setTint(def.fx.tracerColor)
        .setRotation(rot)
        .setOrigin(t.beam ? 0 : 1, 0.5)
        .setAlpha(t.glowAlpha);
      this.placeTracer(t);
      if (end.wall) this.surfaceImpact(end.x, end.y, rot, def);
    }

    const dx = Math.cos(aim);
    const dy = Math.sin(aim);
    if (b.muzzleSmoke && prof.smokePuffs > 0) {
      this.setBurst(aim, 60, 10, 60, 0xffffff);
      this.burst(this.smoke, b.smoke, prof.smokePuffs, muzzleX + dx * 10, muzzleY + dy * 10);
    }
    if (prof.shell === "shot") this.shellEject(muzzleX - dx * 14, muzzleY - dy * 14, aim);
  }

  /** A spent casing flying out to the right of the weapon (budgeted; none on Low). */
  shellEject(x: number, y: number, aim: number): void {
    if (this.budget.shells <= 0) return;
    const side = aim + Math.PI / 2;
    this.setBurst(side, 50, 60, 140, 0xffffff);
    this.burst(this.shells, this.budget.shells, 1, x + Math.cos(side) * 6, y + Math.sin(side) * 6);
  }

  /**
   * Bullet impact on the world. The surface at the point decides the look: metal throws bright
   * sparks, masonry and earth puff dust and chips, the map edge raises dust.
   */
  surfaceImpact(x: number, y: number, travelAngle: number, def?: WeaponDef): void {
    const map = this.mapOf();
    const hit = map ? classifyImpact(map, x, y) : null;
    const share = this.limiter.allow(x, y);
    if (share <= 0) return;
    const pelletMul = def && def.pellets > 1 ? 1 / Math.sqrt(def.pellets) : 1;
    const heavy = def && profileFor(def).tracer.beam ? 1.6 : 1;
    const k = share * pelletMul * heavy;
    const normal = hit ? hit.normal : travelAngle + Math.PI;
    // Mirror of the incoming direction about the face: where a ricochet would go.
    const reflect = 2 * normal - travelAngle + Math.PI;
    if (hit?.surface === "metal") this.metalSparks(x, y, reflect, k, share >= 1);
    else
      this.dustImpact(
        x,
        y,
        normal,
        reflect,
        hit?.tint ?? EDGE_TINT,
        k,
        share >= 1 && hit?.surface !== "edge",
      );
  }

  /** Back-compat: generic impact (treated as a world hit). */
  impact(x: number, y: number, normalAngle: number, def?: WeaponDef): void {
    this.surfaceImpact(x, y, normalAngle + Math.PI, def);
  }

  private metalSparks(x: number, y: number, dir: number, k: number, full: boolean) {
    const b = this.budget;
    const n = Math.max(1, Math.round(b.sparksPerImpact * k));
    this.setBurst(dir, 80, 160, 600, SPARK_HOT);
    this.p.scale = 1.3;
    this.burst(this.sparks, b.sparks, n, x, y);
    this.setBurst(dir, 50, 300, 760, SPARK_WHITE, 0.7);
    this.p.scale = 1.1;
    this.burst(this.sparks, b.sparks, Math.ceil(n / 3), x, y);
    if (full) {
      this.setBurst(dir, 120, 60, 200, METAL_CHIP);
      this.p.scale = 0.5;
      this.burst(this.debris, b.debris, 1, x, y);
      // Hot point at the contact (every quality), plus a light on the floor on High.
      this.light(x, y, 0xffe2a8, 16, 70, 0.9);
      if (b.impactLights) this.light(x, y, 0xffd08a, 52, 80, 0.55);
    }
  }

  private dustImpact(
    x: number,
    y: number,
    normal: number,
    reflect: number,
    tint: number,
    k: number,
    spark: boolean,
  ) {
    const b = this.budget;
    if (b.smokePerImpact > 0) {
      // Dust puffs blown off the face, opaque enough to read on light and dark floors.
      this.setBurst(normal, 100, 25, 90, tint, 0.9);
      this.p.scale = 1.15;
      this.p.alpha = 0.85;
      this.burst(this.smoke, b.smoke, Math.max(k >= 1 ? 1 : 0, Math.round(b.smokePerImpact * k)), x, y);
    }
    this.setBurst(reflect, 120, 90, 320, tint);
    this.p.scale = 0.8;
    this.burst(this.debris, b.debris, Math.max(1, Math.round(b.chipsPerImpact * k)), x, y);
    if (spark) {
      // A brief pale flash and one dim spark mark the exact point on dark maps.
      this.light(x, y, 0xfff0d8, 16, 60, 0.6);
      this.setBurst(reflect, 60, 90, 260, 0xffb070, 0.8);
      this.burst(this.sparks, b.sparks, 1, x, y);
    }
  }

  /** Bullet on a vehicle hull: metal sparks bouncing back towards the shooter. */
  hullHit(x: number, y: number, fromAngle: number): void {
    const share = this.limiter.allow(x, y);
    if (share <= 0) return;
    this.metalSparks(x, y, fromAngle + Math.PI, share * 1.2, share >= 1);
  }

  // ---------------------------------------------------------------- hits and eliminations

  /**
   * Generic hit feedback on a target (players now, PvE enemies later). `fromAngle` is the
   * direction the bullet travelled. Non-graphic: sparks and scrap chips only.
   */
  enemyHit(
    x: number,
    y: number,
    fromAngle: number,
    opts: { lethal: boolean; color?: number; armored?: boolean; weakSpot?: boolean; boss?: boolean },
  ): void {
    const b = this.budget;
    const share = this.limiter.allow(x, y);
    if (share <= 0 && !opts.lethal) return;
    const size = opts.boss ? 1.6 : 1;
    const k = Math.max(share, opts.lethal ? 1 : 0) * size * (opts.lethal ? 1.8 : 1);
    const q = b.sparksPerImpact / 7;
    const n = Math.max(2, Math.round(7 * k * q));
    // Sparks carry the impact (steel-white on plating, hot yellow on a weak spot); chips carry the
    // target's own colour.
    const tint = opts.armored ? 0xd8ecff : opts.weakSpot ? 0xffe07a : 0xff9a5a;
    const ox = x + Math.cos(fromAngle) * 4;
    const oy = y + Math.sin(fromAngle) * 4;
    this.setBurst(fromAngle, 110, 120, 520, tint);
    this.burst(this.sparks, b.sparks, n, ox, oy);
    if (opts.color !== undefined && !opts.armored) {
      this.setBurst(fromAngle, 140, 70, 260, opts.color);
      this.p.scale = 0.55;
      this.burst(this.debris, b.debris, Math.max(1, Math.round(2 * k)), ox, oy);
    }
    if (opts.armored) {
      this.setBurst(fromAngle + Math.PI, 90, 220, 640, SPARK_WHITE, 0.8);
      this.burst(this.sparks, b.sparks, Math.ceil(n / 2), x, y);
      if (b.impactLights) this.light(x, y, 0xcfe6ff, 40 * size, 60, 0.55);
    }
    if (opts.weakSpot) {
      this.ringBurst(x, y, 0xffe07a, 60 * size, 180);
      this.light(x, y, 0xffe07a, 60 * size, 80, 0.6);
    }
    if (opts.lethal) this.ringBurst(x, y, opts.color ?? 0xff7a2e, 90 * size, 260);
  }

  /** Elimination burst: shock ring, light pulse, scrap debris, sparks and smoke. */
  enemyDeath(x: number, y: number, opts: { color?: number; size?: number; boss?: boolean }): void {
    const b = this.budget;
    const color = opts.color ?? 0xc8622f;
    const big = Math.max(0.3, opts.size ?? 1) * (opts.boss ? 1.8 : 1);
    this.ringBurst(x, y, 0xff7a2e, 160 * big, 380);
    if (opts.boss) this.ringBurst(x, y, color, 280 * big, 640);
    this.light(x, y, 0xff9a5a, 150 * big, opts.boss ? 420 : 240, 0.7);
    this.setBurst(0, 360, 80, 340, color);
    this.p.scale = 0.9;
    this.burst(this.debris, b.debris, b.debrisPerBurst * big, x, y);
    this.setBurst(0, 360, 120, 520, 0xffc46b);
    this.burst(this.sparks, b.sparks, 14 * big * (b.sparksPerImpact / 7), x, y);
    if (b.smokePerImpact > 0) {
      this.setBurst(0, 360, 10, 60, 0xffffff);
      this.burst(this.smoke, b.smoke, 5 * big, x, y);
    }
  }

  /** Back-compat wrapper (players): non-graphic hit sparks. */
  playerHit(x: number, y: number, fromAngle: number, lethal: boolean): void {
    this.enemyHit(x, y, fromAngle, { lethal });
  }

  /** Back-compat wrapper (players): elimination burst. */
  death(x: number, y: number, color: number): void {
    this.enemyDeath(x, y, { color });
  }

  spawn(x: number, y: number): void {
    this.ringBurst(x, y, 0x9fe7ff, 120, 420);
    this.light(x, y, 0x9fe7ff, 130, 450, 0.7);
  }

  pickup(x: number, y: number): void {
    this.ringBurst(x, y, 0x7dffb0, 80, 300);
  }

  /** A vehicle blowing up: fireball light, shock ring, debris and smoke. */
  explosion(x: number, y: number): void {
    const b = this.budget;
    const high = this.quality === "high";
    this.ringBurst(x, y, 0xffb36b, 300, 520);
    this.light(x, y, 0xff8a3d, 210, 600, 0.9);
    this.setBurst(0, 360, 80, 340, 0x2a2c31);
    this.p.scale = 0.9;
    this.burst(this.debris, b.debris, high ? 26 : 12, x, y);
    this.setBurst(0, 360, 120, 520, 0xffc46b);
    this.burst(this.sparks, b.sparks, high ? 30 : 14, x, y);
    this.setBurst(0, 360, 10, 60, 0xffffff);
    this.burst(this.smoke, b.smoke, high ? 12 : 5, x, y);
  }

  /** Damaged vehicles trail smoke (darker and denser when burning). */
  vehicleSmoke(x: number, y: number, burning: boolean): void {
    const b = this.budget;
    this.setBurst(0, 360, 10, 60, burning ? 0x2a2522 : 0x8a8a8a);
    this.burst(this.smoke, b.smoke, 1, x, y);
    if (burning && this.quality === "high") {
      this.setBurst(0, 360, 120, 520, 0xff7a2e);
      this.burst(this.sparks, b.sparks, 1, x, y);
    }
  }

  /** Dust kicked up by drifting tyres or rotor wash. */
  dust(x: number, y: number): void {
    if (this.quality === "low") return;
    this.setBurst(0, 360, 10, 60, 0xb8a98a);
    this.burst(this.smoke, this.budget.smoke, 1, x, y);
  }

  /** Metal-on-metal or metal-on-wall contact. */
  crash(x: number, y: number, force: number): void {
    this.setBurst(0, 360, 120, 520, 0xffd89a);
    this.burst(this.sparks, this.budget.sparks, Math.min(24, 4 + Math.round(force / 40)), x, y);
    if (force > 300) this.ringBurst(x, y, 0xffd89a, 90, 240);
  }

  /**
   * Floating damage number. Rapid non-lethal hits on the same spot merge into one rising total;
   * criticals pop larger in amber, lethal hits in red-orange, armour hits smaller in steel.
   */
  damageNumber(
    x: number,
    y: number,
    amount: number,
    lethal: boolean,
    opts?: { crit?: boolean; armored?: boolean },
  ): void {
    const amt = Math.max(0, Math.round(amount));
    const crit = !!opts?.crit;
    const armored = !!opts?.armored && !lethal && !crit;
    const solo = lethal || crit;
    const merge = mergeTarget(this.texts, x, y, this.clock, solo);
    if (merge >= 0) {
      const t = this.texts[merge]!;
      t.amount += amt;
      t.text.setText(label(t.amount));
      t.life = t.max;
      t.pop = 1;
      return;
    }
    const i = choosePoolSlot(this.texts, this.budget.damageNumbers);
    let ft = this.texts[i];
    if (!ft) {
      const text = this.scene.add
        .text(0, 0, "", {
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#ffffff",
          stroke: "#0b0c0e",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(50);
      ft = {
        text,
        life: 0,
        max: 650,
        vy: 0,
        x: 0,
        y: 0,
        born: 0,
        amount: 0,
        lethal: false,
        baseScale: 1,
        pop: 0,
      };
      this.texts.push(ft);
    }
    const color = lethal ? "#ff5a3d" : crit ? "#ffd27a" : armored ? "#a9c7e8" : "#ffffff";
    ft.baseScale = lethal ? 1.4 : crit ? 1.3 : armored ? 0.9 : 1;
    ft.text
      .setText(label(amt))
      .setPosition(x + (Math.random() - 0.5) * 16, y - 20)
      .setColor(color)
      .setScale(ft.baseScale * 1.4)
      .setAlpha(1)
      .setVisible(true);
    ft.x = x;
    ft.y = y;
    ft.born = this.clock;
    ft.amount = amt;
    ft.lethal = solo;
    ft.pop = 1;
    ft.life = ft.max = solo ? 800 : 650;
    ft.vy = solo ? -75 : -60;
  }

  // ---------------------------------------------------------------- frame

  private placeTracer(t: Tracer) {
    const elapsed = t.max - t.life;
    const head = Math.min(t.dist, (elapsed / 1000) * t.speed + 40);
    const streak = Math.min(head, t.streak, t.dist);
    const ux = (t.x1 - t.x0) / Math.max(1, t.dist);
    const uy = (t.y1 - t.y0) / Math.max(1, t.dist);
    const hx = t.x0 + ux * head;
    const hy = t.y0 + uy * head;
    t.img.setPosition(hx, hy).setDisplaySize(Math.max(2, streak), t.width * 2);
    if (t.glowAlpha > 0) {
      if (t.beam) t.glow.setPosition(t.x0, t.y0).setDisplaySize(Math.max(2, head), t.width * 1.6);
      else t.glow.setPosition(hx, hy).setDisplaySize(Math.max(2, streak * 1.2), t.width * 6);
    }
    if (head >= t.dist) {
      const k = Math.max(0, Math.min(1, t.life / t.fade));
      t.img.setAlpha(k * 0.95);
      if (t.glowAlpha > 0) t.glow.setAlpha(k * t.glowAlpha);
    }
  }

  update(dtMs: number): void {
    this.clock += dtMs;
    this.limiter.beginFrame();
    if (this.clock - this.mergeWindowStart >= 1000) {
      this.mergedPerSec = this.limiter.coalesced;
      this.limiter.coalesced = 0;
      this.mergeWindowStart = this.clock;
    }
    const c = this.countsOut;
    c.tracers = 0;
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      c.tracers++;
      t.life -= dtMs;
      this.placeTracer(t);
      if (t.life <= 0) {
        t.img.setVisible(false);
        t.glow.setVisible(false);
      }
    }
    c.flashes = this.tickFlashes(this.flashes, dtMs);
    c.lights = this.tickFlashes(this.lights, dtMs);
    c.rings = 0;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      c.rings++;
      r.life -= dtMs;
      const k = 1 - Math.max(0, r.life / r.max);
      const size = 10 + r.baseScale * Phaser.Math.Easing.Cubic.Out(k);
      r.img.setDisplaySize(size, size).setAlpha((1 - k) * 0.9);
      if (r.life <= 0) r.img.setVisible(false);
    }
    c.numbers = 0;
    for (const ft of this.texts) {
      if (ft.life <= 0) continue;
      c.numbers++;
      ft.life -= dtMs;
      ft.text.y += (ft.vy * dtMs) / 1000;
      ft.vy *= 0.92;
      ft.pop = Math.max(0, ft.pop - dtMs / 120);
      ft.text.setScale(ft.baseScale * (1 + 0.4 * ft.pop)).setAlpha(Math.min(1, ft.life / 250));
      if (ft.life <= 0) ft.text.setVisible(false);
    }
    c.sparks = this.sparks.getAliveParticleCount();
    c.debris = this.debris.getAliveParticleCount();
    c.smoke = this.smoke.getAliveParticleCount();
    c.shells = this.shells.getAliveParticleCount();
    this.active =
      c.tracers + c.flashes + c.lights + c.rings + c.numbers + c.sparks + c.debris + c.smoke + c.shells;
  }

  private tickFlashes(pool: Flash[], dtMs: number): number {
    let n = 0;
    for (const f of pool) {
      if (f.life <= 0) continue;
      n++;
      f.life -= dtMs;
      const k = Math.max(0, f.life / f.max);
      f.img.setAlpha(k * f.peak);
      if (f.life <= 0) f.img.setVisible(false);
    }
    return n;
  }

  /** Live counts per pool / emitter (updated every frame; the object is reused). */
  get counts(): Readonly<FxCounts> {
    return this.countsOut;
  }

  /** Live counts against the current caps, one line for the debug overlay. */
  detail(): string {
    return `${this.quality} ${formatFxCounts(this.countsOut, this.budget, this.mergedPerSec)}/s`;
  }
}
