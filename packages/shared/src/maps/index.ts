import { PLAYER } from "../config/game.ts";
import { VEHICLES } from "../config/vehicles.ts";
import { buildCollisionWorld, type CollisionWorld, circleIntersectsRect } from "../sim/collision.ts";
import type { Vec2 } from "../sim/math.ts";
import { bodyFits } from "../sim/vehicle.ts";
import { MILITARY_AIRBASE } from "./airbase.ts";
import { BLACK_SITE } from "./blacksite.ts";
import { FINAL_BREACH } from "./breach.ts";
import { DESERT_OUTPOST } from "./desert.ts";
import { DEAD_DISTRICT } from "./district.ts";
import { DOWNTOWN } from "./downtown.ts";
import { TACTICAL_FACILITY } from "./facility.ts";
import { HARBOR_CONFLICT } from "./harbor.ts";
import { INDUSTRIAL_ARENA } from "./industrial.ts";
import { MOUNTAIN_OUTPOST } from "./mountain.ts";
import { NEON_DISTRICT } from "./neon.ts";
import { KESSLER_ROAD } from "./outskirts.ts";
import { type MapDef, type MapId, SHOOT_THROUGH, TALL_SOLIDS } from "./types.ts";
import { URBAN_WARFARE } from "./urban.ts";
import { HALVORSEN_WORKS } from "./works.ts";

export * from "./types.ts";

export const MAPS: Record<MapId, MapDef> = {
  industrial: INDUSTRIAL_ARENA,
  neon: NEON_DISTRICT,
  desert: DESERT_OUTPOST,
  urban: URBAN_WARFARE,
  airbase: MILITARY_AIRBASE,
  harbor: HARBOR_CONFLICT,
  downtown: DOWNTOWN,
  mountain: MOUNTAIN_OUTPOST,
  facility: TACTICAL_FACILITY,
  works: HALVORSEN_WORKS,
  district: DEAD_DISTRICT,
  outskirts: KESSLER_ROAD,
  blacksite: BLACK_SITE,
  breach: FINAL_BREACH,
};

export const MAP_IDS = Object.keys(MAPS) as MapId[];
/** Maps offered to competitive modes (PvE maps excluded). */
export const PVP_MAP_IDS = MAP_IDS.filter((id) => !MAPS[id].pve);
export const DEFAULT_MAP: MapId = "industrial";

export function isMapId(v: unknown): v is MapId {
  return typeof v === "string" && v in MAPS;
}

const worldCache = new Map<MapId, CollisionWorld>();
const airWorldCache = new Map<MapId, CollisionWorld>();

const shotWorldCache = new Map<MapId, CollisionWorld>();

/**
 * What bullets and sight lines meet at ground level: every solid except the ones that only stop
 * movement (water, fences). Identical to the collision world on maps without such solids.
 */
export function shotWorldFor(map: MapDef): CollisionWorld {
  if (!map.solids.some((s) => SHOOT_THROUGH.has(s.kind))) return collisionWorldFor(map);
  let w = shotWorldCache.get(map.id);
  if (!w) {
    w = buildCollisionWorld(
      map.width,
      map.height,
      map.solids.filter((s) => !SHOOT_THROUGH.has(s.kind)),
    );
    shotWorldCache.set(map.id, w);
  }
  return w;
}

/** Collision world of the tall solids only: what flying helicopters and air shots meet. */
export function airWorldFor(map: MapDef): CollisionWorld {
  let w = airWorldCache.get(map.id);
  if (!w) {
    w = buildCollisionWorld(
      map.width,
      map.height,
      map.solids.filter((s) => TALL_SOLIDS.has(s.kind)),
    );
    airWorldCache.set(map.id, w);
  }
  return w;
}

export function collisionWorldFor(map: MapDef): CollisionWorld {
  let w = worldCache.get(map.id);
  if (!w) {
    w = buildCollisionWorld(map.width, map.height, map.solids);
    worldCache.set(map.id, w);
  }
  return w;
}

/** A point where a player circle fits without touching any solid or the map edge. */
export function isFreeSpot(world: CollisionWorld, p: Vec2, radius: number = PLAYER.radius): boolean {
  if (p.x < radius || p.y < radius || p.x > world.width - radius || p.y > world.height - radius) return false;
  return !world.solids.some((s) => circleIntersectsRect(p.x, p.y, radius, s));
}

export interface MapIssue {
  map: MapId;
  problem: string;
}

/**
 * Static validation run by tests (and usable by a future map editor): every spawn and pickup must
 * fit a player, and all of them must be reachable from each other by walking.
 */
export function validateMap(map: MapDef): MapIssue[] {
  const issues: MapIssue[] = [];
  const world = collisionWorldFor(map);
  const clearance = PLAYER.radius + 2;
  map.spawns.forEach((s, i) => {
    if (!isFreeSpot(world, s, clearance))
      issues.push({ map: map.id, problem: `spawn ${i} at ${s.x},${s.y} is blocked` });
  });
  map.pickups.forEach((p) => {
    if (!isFreeSpot(world, p, clearance)) issues.push({ map: map.id, problem: `pickup ${p.id} is blocked` });
  });
  const ids = new Set<string>();
  for (const p of map.pickups) {
    if (ids.has(p.id)) issues.push({ map: map.id, problem: `duplicate pickup id ${p.id}` });
    ids.add(p.id);
  }
  if (map.spawns.length < 8) issues.push({ map: map.id, problem: "fewer than 8 spawns" });
  for (const v of map.vehicleSpawns ?? []) {
    if (ids.has(v.id)) issues.push({ map: map.id, problem: `duplicate id ${v.id}` });
    ids.add(v.id);
    if (!bodyFits(world, v, VEHICLES[v.kind]))
      issues.push({ map: map.id, problem: `vehicle ${v.id} at ${v.x},${v.y} is blocked` });
  }

  // Flood fill on a coarse grid of positions where a player fits.
  const step = 16;
  const cols = Math.floor(map.width / step);
  const rows = Math.floor(map.height / step);
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isFreeSpot(world, { x: c * step + step / 2, y: r * step + step / 2 }, PLAYER.radius))
        free[r * cols + c] = 1;
    }
  }
  const cellOf = (p: Vec2) => {
    const c = Math.floor(p.x / step);
    const r = Math.floor(p.y / step);
    return r * cols + c;
  };
  const start = cellOf(map.spawns[0]!);
  const seen = new Uint8Array(cols * rows);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const cur = queue.pop()!;
    const c = cur % cols;
    const r = (cur - c) / cols;
    const neighbours = [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ] as const;
    for (const [nc, nr] of neighbours) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const n = nr * cols + nc;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const reachable = (p: Vec2) => {
    // A point is reachable if any free cell within the player's radius was visited.
    const c0 = Math.floor((p.x - PLAYER.radius) / step);
    const c1 = Math.floor((p.x + PLAYER.radius) / step);
    const r0 = Math.floor((p.y - PLAYER.radius) / step);
    const r1 = Math.floor((p.y + PLAYER.radius) / step);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (seen[r * cols + c]) return true;
    return false;
  };
  map.spawns.forEach((s, i) => {
    if (!reachable(s)) issues.push({ map: map.id, problem: `spawn ${i} unreachable` });
  });
  map.pickups.forEach((p) => {
    if (!reachable(p)) issues.push({ map: map.id, problem: `pickup ${p.id} unreachable` });
  });
  for (const v of map.vehicleSpawns ?? []) {
    if (!reachable(v)) issues.push({ map: map.id, problem: `vehicle ${v.id} unreachable on foot` });
  }
  return issues;
}
