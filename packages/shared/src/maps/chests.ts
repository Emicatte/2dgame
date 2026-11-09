import { CHEST_RESPAWN_SEC } from "../config/weapons.ts";
import type { Vec2 } from "../sim/math.ts";
import type { MapDef, MapId, PickupDef } from "./types.ts";

/**
 * Loot chests (random weapon, shield, ammo; opened with interact). Free, reachable spots away from
 * spawns and pickups (checked by validateMap). Symmetric maps list their authored half here; the
 * mirror image is added, so both halves get the same chests.
 */
const CHEST_SPOTS: Partial<Record<MapId, Vec2[]>> = {
  industrial: [
    { x: 160, y: 1408 },
    { x: 880, y: 112 },
  ],
  neon: [
    { x: 256, y: 304 },
    { x: 976, y: 1408 },
  ],
  desert: [
    { x: 112, y: 1408 },
    { x: 928, y: 112 },
  ],
  urban: [
    { x: 112, y: 2224 },
    { x: 1168, y: 160 },
    { x: 1168, y: 1456 },
    { x: 304, y: 784 },
  ],
  airbase: [
    { x: 256, y: 256 },
    { x: 976, y: 1936 },
    { x: 1024, y: 928 },
    { x: 256, y: 1360 },
  ],
  harbor: [
    { x: 256, y: 2128 },
    { x: 1168, y: 352 },
    { x: 1312, y: 1552 },
    { x: 304, y: 1024 },
  ],
  downtown: [
    { x: 256, y: 112 },
    { x: 352, y: 2416 },
    { x: 1600, y: 544 },
    { x: 496, y: 1264 },
  ],
  mountain: [
    { x: 256, y: 2128 },
    { x: 928, y: 112 },
    { x: 1360, y: 1696 },
    { x: 304, y: 1024 },
  ],
  facility: [
    { x: 256, y: 208 },
    { x: 928, y: 1936 },
    { x: 1024, y: 880 },
    { x: 304, y: 1408 },
  ],
  depot: [
    { x: 2128, y: 112 },
    { x: 112, y: 1120 },
    { x: 1360, y: 1120 },
    { x: 736, y: 112 },
  ],
};

export function withChests(map: MapDef): MapDef {
  const spots = CHEST_SPOTS[map.id];
  if (!spots) return map;
  const all = map.party
    ? spots
    : [...spots, ...spots.map((p) => ({ x: map.width - p.x, y: map.height - p.y }))];
  const chests: PickupDef[] = all.map((p, i) => ({
    id: `chest-${i}`,
    kind: "chest",
    x: p.x,
    y: p.y,
    respawnSec: CHEST_RESPAWN_SEC,
  }));
  return { ...map, pickups: [...map.pickups, ...chests] };
}
