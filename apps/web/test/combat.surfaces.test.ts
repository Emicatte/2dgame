import {
  MAPS,
  type MapDef,
  raycastSolids,
  SHOOT_THROUGH,
  type SolidDef,
  type SolidKind,
  shotWorldFor,
  tracePellet,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { classifyImpact, SURFACE_OF, SURFACE_TINT } from "../src/game/combat/surfaces.ts";

const solid = (kind: SolidKind, x: number, y: number, w: number, h: number): SolidDef => ({
  kind,
  x,
  y,
  w,
  h,
});

const map = (solids: SolidDef[]): Pick<MapDef, "width" | "height" | "solids"> => ({
  width: 1000,
  height: 800,
  solids,
});

describe("impact surface classification", () => {
  it("maps every solid kind (shoot-through kinds are never surfaces)", () => {
    const kinds = Object.keys(SURFACE_OF) as SolidKind[];
    expect(kinds.sort()).toEqual(Object.keys(SURFACE_TINT).sort());
    for (const k of kinds) {
      if (SHOOT_THROUGH.has(k)) expect(SURFACE_OF[k]).toBeNull();
      else expect(SURFACE_OF[k]).not.toBeNull();
    }
    for (const k of ["container", "machine", "car", "tank", "vending"] as const)
      expect(SURFACE_OF[k]).toBe("metal");
    for (const k of ["wall", "building", "ruin", "rock", "sandbag", "crate", "pillar"] as const) {
      expect(SURFACE_OF[k]).toBe("masonry");
    }
  });

  it("metal vs masonry vs edge vs nothing, with the face normal", () => {
    const m = map([solid("container", 100, 100, 80, 40), solid("wall", 400, 300, 20, 200)]);
    expect(classifyImpact(m, 100, 120)).toMatchObject({
      surface: "metal",
      kind: "container",
      normal: Math.PI,
    });
    expect(classifyImpact(m, 140, 140)).toMatchObject({ surface: "metal", normal: Math.PI / 2 });
    expect(classifyImpact(m, 420, 400)).toMatchObject({ surface: "masonry", kind: "wall", normal: 0 });
    expect(classifyImpact(m, 410, 300)).toMatchObject({ surface: "masonry", normal: -Math.PI / 2 });
    expect(classifyImpact(m, 1000, 500)).toMatchObject({ surface: "edge", kind: null, normal: Math.PI });
    expect(classifyImpact(m, 500, 0)).toMatchObject({ surface: "edge", normal: Math.PI / 2 });
    // Open floor (a pellet that stopped on a player or a vehicle): no surface.
    expect(classifyImpact(m, 600, 600)).toBeNull();
  });

  it("tolerates rounded remote impact points, and the nearest solid wins", () => {
    const m = map([solid("container", 100, 100, 80, 40), solid("crate", 181.5, 100, 30, 40)]);
    expect(classifyImpact(m, 98.6, 120)?.kind).toBe("container");
    expect(classifyImpact(m, 95, 120)).toBeNull();
    expect(classifyImpact(m, 180.4, 120)?.kind).toBe("container");
    expect(classifyImpact(m, 181.2, 120)?.kind).toBe("crate");
  });

  it("ignores shoot-through solids (water, fences)", () => {
    const m = map([solid("water", 0, 0, 500, 500), solid("fence", 600, 0, 10, 300)]);
    expect(classifyImpact(m, 250, 250)).toBeNull();
    expect(classifyImpact(m, 605, 100)).toBeNull();
    expect(classifyImpact(m, 250, 0)?.surface).toBe("edge");
  });

  it("a solid flush with the map border beats the edge", () => {
    const m = map([solid("rock", 0, 200, 60, 60)]);
    expect(classifyImpact(m, 0, 230)?.kind).toBe("rock");
  });

  it("real maps: hitscan impacts land on the solid they hit", () => {
    let checked = 0;
    for (const def of Object.values(MAPS)) {
      const world = shotWorldFor(def);
      for (const s of def.solids) {
        if (SHOOT_THROUGH.has(s.kind)) continue;
        // Probe each solid from 30 px left of its left face, mid-height, if that spot is open.
        const ox = s.x - 30;
        const oy = s.y + s.h / 2;
        if (ox < 1) continue;
        const inside = def.solids.some(
          (o) => !SHOOT_THROUGH.has(o.kind) && ox >= o.x && ox <= o.x + o.w && oy >= o.y && oy <= o.y + o.h,
        );
        if (inside) continue;
        const d = raycastSolids(world, ox, oy, 1, 0, 100);
        if (Math.abs(d - 30) > 1e-6) continue; // something else is in the way
        const r = tracePellet(world, ox, oy, 0, 100, [], "me");
        expect(r.hitWall).toBe(true);
        const hit = classifyImpact(def, ox + r.dist, oy);
        expect(hit).not.toBeNull();
        const touching = def.solids.filter(
          (o) =>
            !SHOOT_THROUGH.has(o.kind) &&
            ox + r.dist >= o.x - 2 &&
            ox + r.dist <= o.x + o.w + 2 &&
            oy >= o.y - 2 &&
            oy <= o.y + o.h + 2,
        );
        expect(touching.map((o) => o.kind)).toContain(hit!.kind);
        if (touching.length === 1) {
          expect(hit!.kind).toBe(s.kind);
          expect(hit!.surface).toBe(SURFACE_OF[s.kind]);
          expect(hit!.normal).toBe(Math.PI);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
