import { MAPS } from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { flashlightFlicker, smoothTension, tensionTarget } from "../src/game/pve/tension.ts";
import { isVisible, shadowQuads, sightWorld, visibilityPolygon } from "../src/game/pve/visibility.ts";

describe("line of sight", () => {
  // A 100 px wall between x 200-224 from y 0 to 400, origin at (100, 200).
  const world = sightWorld([{ x: 200, y: 0, w: 24, h: 400, kind: "wall" }]);

  it("walls hide what is behind them, open space is visible", () => {
    const p = visibilityPolygon(world, 100, 200, 600);
    expect(isVisible(p, 180, 200)).toBe(true);
    expect(isVisible(p, 400, 200)).toBe(false);
    // Past the end of the wall: the ray crosses x = 200 at y ≈ 533, below the wall (y ≤ 400).
    expect(isVisible(p, 250, 700)).toBe(true);
    expect(isVisible(p, 400, 600)).toBe(false); // this ray crosses the wall at y ≈ 333
    expect(isVisible(p, -300, 200)).toBe(true);
    expect(isVisible(p, 800, 200)).toBe(false); // beyond the radius
  });

  it("low cover, fences and water do not block sight", () => {
    const w = sightWorld([
      { x: 200, y: 150, w: 40, h: 100, kind: "crate" },
      { x: 300, y: 150, w: 20, h: 100, kind: "fence" },
      { x: 400, y: 150, w: 60, h: 100, kind: "sandbag" },
    ]);
    expect(isVisible(visibilityPolygon(w, 100, 200, 800), 600, 200)).toBe(true);
  });

  it("a closed door blocks sight until it opens", () => {
    const door = { x: 200, y: 150, w: 24, h: 100 };
    const walls = [
      { x: 200, y: 0, w: 24, h: 150, kind: "wall" as const },
      { x: 200, y: 250, w: 24, h: 150, kind: "wall" as const },
    ];
    expect(isVisible(visibilityPolygon(sightWorld(walls, [door]), 100, 200, 600), 400, 200)).toBe(false);
    expect(isVisible(visibilityPolygon(sightWorld(walls), 100, 200, 600), 400, 200)).toBe(true);
  });

  it("penetration lights the wall face but never shows the far side", () => {
    const p = visibilityPolygon(world, 100, 200, 600, 12);
    expect(isVisible(p, 208, 200)).toBe(true);
    expect(isVisible(p, 230, 200)).toBe(false);
  });

  it("shadow quads start on the polygon and reach the far distance", () => {
    const p = visibilityPolygon(world, 100, 200, 600);
    const q = shadowQuads(p, 2000);
    expect(q.length).toBe(p.count * 8);
    const far = Math.hypot(q[4]! - 100, q[5]! - 200);
    expect(far).toBeCloseTo(2000, 3);
  });

  it("neighbouring shadow quads overlap (no pinholes of light between them)", () => {
    const p = visibilityPolygon(world, 100, 200, 600);
    const q = shadowQuads(p, 2000);
    const ang = (x: number, y: number) => Math.atan2(y - 200, x - 100);
    for (let i = 0; i + 1 < p.count; i++) {
      // Far end of quad i (its "next" side) reaches past the start of quad i + 1.
      const endI = ang(q[i * 8 + 4]!, q[i * 8 + 5]!);
      const startNext = ang(q[(i + 1) * 8 + 6]!, q[(i + 1) * 8 + 7]!);
      const d = Math.atan2(Math.sin(endI - startNext), Math.cos(endI - startNext));
      expect(d).toBeGreaterThan(0);
    }
  });

  it("is cheap on the First Contact map (many origins)", () => {
    const map = MAPS.works;
    const w = sightWorld(map.solids);
    const origins = [
      [480, 352],
      [1500, 1100],
      [2400, 600],
      [900, 1800],
      [2900, 1900],
    ] as const;
    // Warm up, then measure.
    for (const [x, y] of origins) visibilityPolygon(w, x, y, 900, 12);
    const t0 = performance.now();
    let verts = 0;
    const runs = 200;
    for (let i = 0; i < runs; i++) {
      const [x, y] = origins[i % origins.length]!;
      verts += visibilityPolygon(w, x + (i % 7), y + (i % 5), 900, 12).count;
    }
    const ms = (performance.now() - t0) / runs;
    console.log(
      `[dread] visibility polygon on Halvorsen Works: ${ms.toFixed(3)} ms, ${Math.round(verts / runs)} vertices`,
    );
    expect(ms).toBeLessThan(4);
  });
});

describe("tension", () => {
  const calm = { enemies: [], hpFrac: 1, downed: false, waveActive: false, sinceHurt: 99 };

  it("is calm with nobody around and rises with close hunters", () => {
    expect(tensionTarget(calm)).toBe(0);
    const far = tensionTarget({ ...calm, enemies: [{ d: 800, hunting: true, special: false, boss: false }] });
    const near = tensionTarget({
      ...calm,
      enemies: [{ d: 150, hunting: true, special: false, boss: false }],
    });
    const many = tensionTarget({
      ...calm,
      enemies: Array.from({ length: 8 }, () => ({ d: 200, hunting: true, special: false, boss: false })),
    });
    expect(far).toBeLessThan(near);
    expect(near).toBeLessThan(many);
    expect(many).toBeLessThanOrEqual(1);
  });

  it("low health, a wave, damage and being downed keep it high", () => {
    expect(tensionTarget({ ...calm, waveActive: true })).toBeGreaterThanOrEqual(0.25);
    expect(tensionTarget({ ...calm, hpFrac: 0.2 })).toBeGreaterThan(0.6);
    expect(tensionTarget({ ...calm, sinceHurt: 0.2 })).toBeGreaterThan(0.4);
    expect(tensionTarget({ ...calm, downed: true })).toBeGreaterThanOrEqual(0.85);
  });

  it("rises fast and falls slowly", () => {
    let t = 0;
    for (let i = 0; i < 30; i++) t = smoothTension(t, 1, 1 / 60);
    expect(t).toBeGreaterThan(0.75);
    let u = 1;
    for (let i = 0; i < 30; i++) u = smoothTension(u, 0, 1 / 60);
    expect(u).toBeGreaterThan(0.8);
  });

  it("a hunting stalker nearby makes the flashlight stutter; calm keeps it steady", () => {
    let low = 1;
    for (let i = 0; i < 300; i++) low = Math.min(low, flashlightFlicker(i / 60, true, 0.3));
    expect(low).toBeLessThan(0.6);
    for (let i = 0; i < 300; i++) expect(flashlightFlicker(i / 60, false, 0.1)).toBe(1);
  });
});
