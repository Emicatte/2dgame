import { describe, expect, it } from "vitest";
import {
  collisionWorldFor,
  isFreeSpot,
  MAP_IDS,
  MAPS,
  mapModes,
  mapSupportsMode,
  mapsForMode,
  PVP_MAP_IDS,
  validateMap,
} from "../src/maps/index.ts";

describe("maps", () => {
  it("ships the three arena maps unchanged, plus the vehicle maps (competitive list), and the PvE maps", () => {
    expect(MAP_IDS).toEqual([...PVP_MAP_IDS, "works", "district", "outskirts", "blacksite", "breach"]);
    expect(MAPS.works.pve).toBe(true);
    expect(MAPS.district.pve).toBe(true);
    expect(MAPS.outskirts.pve).toBe(true);
    expect(MAPS.blacksite.pve).toBe(true);
    expect(MAPS.breach.pve).toBe(true);
    expect(PVP_MAP_IDS).toEqual([
      "industrial",
      "neon",
      "desert",
      "urban",
      "airbase",
      "harbor",
      "downtown",
      "mountain",
      "facility",
      "depot",
      "motel",
      "market",
    ]);
    for (const id of ["industrial", "neon", "desert"] as const)
      expect(MAPS[id].vehicleSpawns).toBeUndefined();
    for (const id of ["urban", "airbase", "harbor", "downtown", "mountain", "facility"] as const) {
      expect(MAPS[id].vehicleSpawns?.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("the PvE maps have valid, reachable spawns and pickups", () => {
    expect(validateMap(MAPS.works)).toEqual([]);
    expect(validateMap(MAPS.district)).toEqual([]);
    expect(validateMap(MAPS.outskirts)).toEqual([]);
    expect(validateMap(MAPS.blacksite)).toEqual([]);
    expect(validateMap(MAPS.breach)).toEqual([]);
  });

  for (const id of PVP_MAP_IDS) {
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

      it.skipIf(!!map.party)("is point-symmetric (fair for both halves)", () => {
        const key = (x: number, y: number, w: number, h: number) => `${x},${y},${w},${h}`;
        const set = new Set(map.solids.map((s) => key(s.x, s.y, s.w, s.h)));
        for (const s of map.solids) {
          expect(set.has(key(map.width - s.x - s.w, map.height - s.y - s.h, s.w, s.h))).toBe(true);
        }
      });
    });
  }

  describe("mode compatibility", () => {
    it("derives the classic modes for every PvP map and keeps PvE maps out", () => {
      for (const id of PVP_MAP_IDS) {
        if (MAPS[id].modes) continue;
        expect(mapModes(MAPS[id])).toEqual(expect.arrayContaining(["deathmatch", "tdm", "dom", "ctf"]));
      }
      for (const id of ["works", "district", "outskirts", "blacksite", "breach"] as const) {
        expect(mapModes(MAPS[id])).toEqual([]);
      }
    });

    it("offers Vehicle Mayhem only on vehicle maps and Gun Game / Hide & Seek off the large maps", () => {
      for (const id of PVP_MAP_IDS) {
        const m = MAPS[id];
        expect(mapSupportsMode(m, "mayhem")).toBe(!!m.vehicleSpawns?.length);
        if (m.large) expect(mapSupportsMode(m, "gungame")).toBe(false);
      }
      expect(mapsForMode("gungame")).toEqual(
        expect.arrayContaining(["industrial", "neon", "desert", "depot"]),
      );
    });

    it("offers Prop Hunt only on maps with transformable objects", () => {
      expect(mapsForMode("prophunt")).toEqual(["depot", "motel", "market"]);
      for (const id of ["depot", "motel", "market"] as const) {
        expect(mapsForMode("hideseek")).toContain(id);
        expect(mapsForMode("infection")).toContain(id);
        expect(MAPS[id].party?.props.length).toBeGreaterThanOrEqual(45);
      }
    });

    it("Salvage Depot: party data is valid (pen, spawns, objects, hiding spots)", () => {
      const d = MAPS.depot;
      expect(d.party?.props.length).toBeGreaterThanOrEqual(50);
      expect(d.party?.seekerPen.length).toBeGreaterThanOrEqual(2);
      expect(d.party?.shadows.length).toBeGreaterThanOrEqual(3);
      expect(d.party?.hideSpots.length).toBeGreaterThanOrEqual(3);
      expect(validateMap(d)).toEqual([]);
    });
  });

  it("rejects spots inside walls", () => {
    const map = MAPS.industrial;
    const world = collisionWorldFor(map);
    const wall = map.solids[0]!;
    expect(isFreeSpot(world, { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 })).toBe(false);
    expect(isFreeSpot(world, map.spawns[0]!)).toBe(true);
  });
});
