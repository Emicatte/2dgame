import { describe, expect, it } from "vitest";
import { collisionWorldFor, isFreeSpot, MAP_IDS, MAPS, validateMap } from "../src/maps/index.ts";

describe("maps", () => {
  it("ships the three arena maps unchanged, plus the vehicle maps", () => {
    expect(MAP_IDS).toEqual([
      "industrial",
      "neon",
      "desert",
      "urban",
      "airbase",
      "harbor",
      "downtown",
      "mountain",
      "facility",
    ]);
    for (const id of ["industrial", "neon", "desert"] as const)
      expect(MAPS[id].vehicleSpawns).toBeUndefined();
    for (const id of ["urban", "airbase", "harbor", "downtown", "mountain", "facility"] as const) {
      expect(MAPS[id].vehicleSpawns?.length).toBeGreaterThanOrEqual(4);
    }
  });

  for (const id of MAP_IDS) {
    const map = MAPS[id];
    describe(map.name, () => {
      it("has valid, reachable spawns and pickups", () => {
        expect(validateMap(map)).toEqual([]);
      });

      it("has at least 12 spawns for 8 players", () => {
        expect(map.spawns.length).toBeGreaterThanOrEqual(12);
      });

      it("keeps every solid inside the map bounds", () => {
        for (const s of map.solids) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(map.width);
          expect(s.y + s.h).toBeLessThanOrEqual(map.height);
        }
      });

      it("is point-symmetric (fair for both halves)", () => {
        const key = (x: number, y: number, w: number, h: number) => `${x},${y},${w},${h}`;
        const set = new Set(map.solids.map((s) => key(s.x, s.y, s.w, s.h)));
        for (const s of map.solids) {
          expect(set.has(key(map.width - s.x - s.w, map.height - s.y - s.h, s.w, s.h))).toBe(true);
        }
      });
    });
  }

  it("rejects spots inside walls", () => {
    const map = MAPS.industrial;
    const world = collisionWorldFor(map);
    const wall = map.solids[0]!;
    expect(isFreeSpot(world, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 })).toBe(false);
    expect(isFreeSpot(world, map.spawns[0]!)).toBe(true);
  });
});
