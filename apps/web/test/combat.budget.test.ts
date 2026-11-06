import { describe, expect, it } from "vitest";
import {
  budgetFor,
  choosePoolSlot,
  clampToCap,
  FX_BUDGETS,
  type FxBudget,
  formatFxCounts,
  ImpactLimiter,
  mergeTarget,
} from "../src/game/combat/fxBudget.ts";
import { GRAPHICS_QUALITIES } from "../src/lib/settings.ts";

describe("fx budget table", () => {
  it("has one budget per quality, growing from low to high", () => {
    expect(Object.keys(FX_BUDGETS).sort()).toEqual([...GRAPHICS_QUALITIES].sort());
    const numeric = Object.keys(FX_BUDGETS.high).filter(
      (k) =>
        typeof FX_BUDGETS.high[k as keyof FxBudget] === "number" &&
        k !== "coalescePx" &&
        k !== "lightMinIntensity",
    ) as (keyof FxBudget)[];
    for (const k of numeric) {
      expect(FX_BUDGETS.low[k] as number).toBeLessThanOrEqual(FX_BUDGETS.medium[k] as number);
      expect(FX_BUDGETS.medium[k] as number).toBeLessThanOrEqual(FX_BUDGETS.high[k] as number);
    }
    // Coarser merging and fewer map lights on lower settings.
    expect(FX_BUDGETS.low.coalescePx).toBeGreaterThanOrEqual(FX_BUDGETS.high.coalescePx);
    expect(FX_BUDGETS.low.lightMinIntensity).toBeGreaterThan(FX_BUDGETS.medium.lightMinIntensity);
    expect(FX_BUDGETS.medium.lightMinIntensity).toBeGreaterThan(FX_BUDGETS.high.lightMinIntensity);
  });

  it("vignette only on High; Low drops shells, muzzle smoke and impact dust", () => {
    expect(FX_BUDGETS.high.vignette).toBe(true);
    expect(FX_BUDGETS.medium.vignette).toBe(false);
    expect(FX_BUDGETS.low.vignette).toBe(false);
    expect(FX_BUDGETS.low.shells).toBe(0);
    expect(FX_BUDGETS.low.muzzleSmoke).toBe(false);
    expect(FX_BUDGETS.low.smokePerImpact).toBe(0);
    // Damaged-vehicle smoke is gameplay information: Low keeps a smoke pool for it.
    expect(FX_BUDGETS.low.smoke).toBeGreaterThan(0);
  });

  it("falls back to High for an unknown quality", () => {
    expect(budgetFor("medium")).toBe(FX_BUDGETS.medium);
    expect(budgetFor("bogus" as never)).toBe(FX_BUDGETS.high);
  });
});

describe("caps", () => {
  it("clampToCap never exceeds the room under the cap", () => {
    expect(clampToCap(10, 0, 50)).toBe(10);
    expect(clampToCap(10, 45, 50)).toBe(5);
    expect(clampToCap(10, 50, 50)).toBe(0);
    expect(clampToCap(10, 80, 50)).toBe(0);
    expect(clampToCap(2.6, 0, 50)).toBe(3);
  });

  it("choosePoolSlot: free slot, then grow, then recycle the item closest to its end", () => {
    const items = [{ life: 50 }, { life: 0 }, { life: 10 }];
    expect(choosePoolSlot(items, 5)).toBe(1);
    items[1]!.life = 80;
    expect(choosePoolSlot(items, 5)).toBe(3);
    expect(choosePoolSlot(items, 3)).toBe(2);
    // Lowered cap: items past it are never reused.
    const big = [{ life: 30 }, { life: 20 }, { life: 0 }, { life: 0 }];
    expect(choosePoolSlot(big, 2)).toBe(1);
  });

  it("a pool driven through choosePoolSlot never grows past its cap", () => {
    const pool: { life: number }[] = [];
    const cap = FX_BUDGETS.high.tracers;
    for (let shot = 0; shot < 5000; shot++) {
      const i = choosePoolSlot(pool, cap);
      if (i === pool.length) pool.push({ life: 0 });
      pool[i]!.life = 100 + (shot % 7);
      for (const p of pool) p.life -= 1;
    }
    expect(pool.length).toBe(cap);
  });
});

describe("impact limiter", () => {
  const budget = { impactsPerFrame: 4, coalescePx: 10 };

  it("full detail up to the per-frame budget, a token share up to twice it, then nothing", () => {
    const l = new ImpactLimiter(budget);
    l.beginFrame();
    const shares = Array.from({ length: 12 }, (_, i) => l.allow(i * 100, 0));
    expect(shares).toEqual([1, 1, 1, 1, 0.34, 0.34, 0.34, 0.34, 0, 0, 0, 0]);
    l.beginFrame();
    expect(l.allow(5000, 5000)).toBe(1);
  });

  it("coalesces impacts landing on top of one already drawn this frame", () => {
    const l = new ImpactLimiter(budget);
    l.beginFrame();
    expect(l.allow(100, 100)).toBe(1);
    expect(l.allow(105, 104)).toBe(0);
    expect(l.allow(112, 100)).toBe(1);
    expect(l.coalesced).toBe(1);
    expect(l.count).toBe(2);
  });

  it("dozens of simultaneous hits stay bounded", () => {
    for (const b of Object.values(FX_BUDGETS)) {
      const l = new ImpactLimiter(b);
      l.beginFrame();
      let sparks = 0;
      for (let i = 0; i < 300; i++) {
        // Clustered (shotgun on a wall) and scattered impacts in one frame.
        const share = l.allow((i % 30) * 40 + (i % 3), Math.floor(i / 30) * 40);
        sparks += clampToCap(b.sparksPerImpact * share, sparks, b.sparks);
      }
      expect(sparks).toBeLessThanOrEqual(b.sparks);
      expect(sparks).toBeLessThanOrEqual(b.sparksPerImpact * b.impactsPerFrame * 1.34 + b.impactsPerFrame);
    }
  });
});

describe("damage numbers", () => {
  const items = [
    { life: 300, x: 100, y: 100, born: 1000, lethal: false },
    { life: 300, x: 100, y: 100, born: 1100, lethal: false },
    { life: 300, x: 400, y: 100, born: 1100, lethal: false },
    { life: 300, x: 200, y: 200, born: 1100, lethal: true },
  ];

  it("merges rapid hits on the same spot into the newest number", () => {
    expect(mergeTarget(items, 104, 98, 1150, false)).toBe(1);
    expect(mergeTarget(items, 104, 98, 1400, false)).toBe(-1);
    expect(mergeTarget(items, 104, 98, 1150, true)).toBe(-1);
    expect(mergeTarget(items, 200, 200, 1150, false)).toBe(-1);
    expect(mergeTarget(items, 300, 300, 1150, false)).toBe(-1);
  });

  it("formats live counts for the debug overlay", () => {
    const line = formatFxCounts(
      { tracers: 3, flashes: 1, lights: 2, rings: 0, sparks: 40, debris: 5, smoke: 7, shells: 2, numbers: 1 },
      FX_BUDGETS.medium,
      4,
    );
    expect(line).toBe("tr 3/40 sp 40/160 ch 5/90 sm 7/40 sh 2/24 dn 1/12 li 2/10 merged 4");
  });
});
