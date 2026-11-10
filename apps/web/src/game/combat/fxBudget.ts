import type { GraphicsQuality } from "../../lib/settings.ts";

/**
 * Particle and effect budget per graphics quality: one table, enforced by the pools and emitters
 * in Effects, so dozens of simultaneous hits can never spawn an unbounded number of objects.
 *  - pools (tracers, flashes, lights, rings, damage numbers) never grow past their cap: when full,
 *    the item closest to its end is recycled;
 *  - particle emitters get `maxAliveParticles` = their cap, and each burst is clamped to the room
 *    left under it;
 *  - impacts coalesce: within one frame, an impact landing on top of one already drawn adds
 *    nothing, and past `impactsPerFrame` the remaining ones get a token amount, then none.
 */
export interface FxBudget {
  /** Live tracer streaks (each may carry a glow / beam image). */
  tracers: number;
  /** Live muzzle flashes. */
  flashes: number;
  /** Live light glows (muzzle lights, metal impact flashes, eliminations). */
  lights: number;
  /** Live expanding rings. */
  rings: number;
  /** Live spark particles. */
  sparks: number;
  /** Sparks for one metal impact at full detail. */
  sparksPerImpact: number;
  /** Live chip / debris particles. */
  debris: number;
  /** Chips for one masonry impact at full detail. */
  chipsPerImpact: number;
  /** Debris for one elimination. */
  debrisPerBurst: number;
  /** Live smoke and dust particles. */
  smoke: number;
  /** Dust puffs per masonry impact (0 = none). */
  smokePerImpact: number;
  /** Muzzle smoke puffs on/off. */
  muzzleSmoke: boolean;
  /** Live shell casings (0 = none). */
  shells: number;
  /** Live floating damage numbers. */
  damageNumbers: number;
  /** Impacts per frame drawn at full detail; the rest coalesce. */
  impactsPerFrame: number;
  /** Impacts closer than this (px) to one already drawn this frame merge into it. */
  coalescePx: number;
  /** Glow under mounted-gun / sniper tracers and the sniper beam. */
  tracerGlow: boolean;
  /** Small light flash on metal impacts. */
  impactLights: boolean;
  /** Map lights dimmer than this are hidden. */
  lightMinIntensity: number;
  /** Camera vignette filter. */
  vignette: boolean;
  /** Camera colour grade (saturation and contrast). */
  grade: boolean;
}

export const FX_BUDGETS: Readonly<Record<GraphicsQuality, FxBudget>> = {
  low: {
    tracers: 24,
    flashes: 8,
    lights: 6,
    rings: 6,
    sparks: 90,
    sparksPerImpact: 3,
    debris: 50,
    chipsPerImpact: 2,
    debrisPerBurst: 8,
    // Kept for damaged-vehicle smoke (gameplay information) and explosions only.
    smoke: 30,
    smokePerImpact: 0,
    muzzleSmoke: false,
    shells: 0,
    damageNumbers: 8,
    impactsPerFrame: 8,
    coalescePx: 14,
    tracerGlow: false,
    impactLights: false,
    lightMinIntensity: 0.45,
    vignette: false,
    grade: false,
  },
  medium: {
    tracers: 40,
    flashes: 12,
    lights: 10,
    rings: 10,
    sparks: 160,
    sparksPerImpact: 5,
    debris: 90,
    chipsPerImpact: 3,
    debrisPerBurst: 12,
    smoke: 40,
    smokePerImpact: 1,
    muzzleSmoke: false,
    shells: 24,
    damageNumbers: 12,
    impactsPerFrame: 12,
    coalescePx: 10,
    tracerGlow: true,
    impactLights: false,
    lightMinIntensity: 0.25,
    vignette: false,
    grade: true,
  },
  high: {
    tracers: 64,
    flashes: 16,
    lights: 16,
    rings: 14,
    sparks: 260,
    sparksPerImpact: 7,
    debris: 140,
    chipsPerImpact: 4,
    debrisPerBurst: 18,
    smoke: 90,
    smokePerImpact: 2,
    muzzleSmoke: true,
    shells: 48,
    damageNumbers: 16,
    impactsPerFrame: 18,
    coalescePx: 8,
    tracerGlow: true,
    impactLights: true,
    lightMinIntensity: 0,
    vignette: true,
    grade: true,
  },
};

export function budgetFor(quality: GraphicsQuality): FxBudget {
  return FX_BUDGETS[quality] ?? FX_BUDGETS.high;
}

/** How many particles a burst may still spawn under a live cap. */
export function clampToCap(requested: number, live: number, cap: number): number {
  return Math.max(0, Math.min(Math.round(requested), cap - live));
}

/**
 * Pool slot to use: the first free item (life <= 0) among the first `cap` items, else a new item
 * (returns `items.length`) while under the cap, else the live item closest to its end (recycled).
 * Items past the cap (quality was lowered) are left to expire and never reused.
 */
export function choosePoolSlot(items: readonly { life: number }[], cap: number): number {
  const n = Math.min(items.length, cap);
  let victim = 0;
  let least = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const life = items[i]!.life;
    if (life <= 0) return i;
    if (life < least) {
      least = life;
      victim = i;
    }
  }
  return items.length < cap ? items.length : victim;
}

/**
 * Per-frame impact limiter (allocation-free). `allow` returns the share of the full detail an
 * impact gets: 1 for the first `impactsPerFrame` impacts, 0 for one that lands within
 * `coalescePx` of an impact already drawn this frame, then a token 0.34 up to twice the budget,
 * then 0.
 */
export class ImpactLimiter {
  private n = 0;
  private readonly xs = new Float32Array(64);
  private readonly ys = new Float32Array(64);
  /** Impacts merged or dropped since the counter was last read (debug overlay). */
  coalesced = 0;

  constructor(private budget: Pick<FxBudget, "impactsPerFrame" | "coalescePx">) {}

  setBudget(budget: Pick<FxBudget, "impactsPerFrame" | "coalescePx">): void {
    this.budget = budget;
  }

  beginFrame(): void {
    this.n = 0;
  }

  get count(): number {
    return this.n;
  }

  allow(x: number, y: number): number {
    const r2 = this.budget.coalescePx * this.budget.coalescePx;
    const stored = Math.min(this.n, this.xs.length);
    for (let i = 0; i < stored; i++) {
      const dx = this.xs[i]! - x;
      const dy = this.ys[i]! - y;
      if (dx * dx + dy * dy < r2) {
        this.coalesced++;
        return 0;
      }
    }
    if (this.n < this.xs.length) {
      this.xs[this.n] = x;
      this.ys[this.n] = y;
    }
    this.n++;
    const full = this.budget.impactsPerFrame;
    if (this.n <= full) return 1;
    this.coalesced++;
    return this.n <= full * 2 ? 0.34 : 0;
  }
}

/**
 * Index of a live damage number to merge a new hit into (same target area, spawned within
 * `windowMs`, neither of them lethal), or -1. Rapid hits on one target then read as one rising
 * total instead of a pile of numbers.
 */
export function mergeTarget(
  items: readonly { life: number; x: number; y: number; born: number; lethal: boolean }[],
  x: number,
  y: number,
  now: number,
  lethal: boolean,
  radius = 28,
  windowMs = 180,
): number {
  if (lethal) return -1;
  let best = -1;
  let bestBorn = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < items.length; i++) {
    const t = items[i]!;
    if (t.life <= 0 || t.lethal || now - t.born > windowMs) continue;
    const dx = t.x - x;
    const dy = t.y - y;
    if (dx * dx + dy * dy > radius * radius) continue;
    if (t.born > bestBorn) {
      bestBorn = t.born;
      best = i;
    }
  }
  return best;
}

export interface FxCounts {
  tracers: number;
  flashes: number;
  lights: number;
  rings: number;
  sparks: number;
  debris: number;
  smoke: number;
  shells: number;
  numbers: number;
}

/** One-line live counts against the caps, for the debug overlay. */
export function formatFxCounts(c: FxCounts, b: FxBudget, coalesced: number): string {
  return (
    `tr ${c.tracers}/${b.tracers} sp ${c.sparks}/${b.sparks} ch ${c.debris}/${b.debris} ` +
    `sm ${c.smoke}/${b.smoke} sh ${c.shells}/${b.shells} dn ${c.numbers}/${b.damageNumbers} ` +
    `li ${c.lights}/${b.lights} merged ${coalesced}`
  );
}
