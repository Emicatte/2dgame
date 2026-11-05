import type { VehicleKind } from "../config/vehicles.ts";
import type { WeaponId } from "../config/weapons.ts";
import type { Rect, Vec2 } from "../sim/math.ts";

export type MapId = "industrial" | "neon" | "desert" | "urban" | "airbase";

/** Visual style of a solid block; collision is always the rectangle itself. */
export type SolidKind =
  | "container"
  | "wall"
  | "crate"
  | "pillar"
  | "machine"
  | "building"
  | "vending"
  | "car"
  | "rock"
  | "sandbag"
  | "ruin"
  | "tank";

export interface SolidDef extends Rect {
  kind: SolidKind;
  /** Palette index into the theme's accent colors (visual only). */
  tone?: number;
}

export type DecorKind =
  | "hazard"
  | "stain"
  | "paint"
  | "grate"
  | "neonSign"
  | "puddle"
  | "crosswalk"
  | "sand"
  | "tracks"
  | "bones"
  | "cables"
  /** Asphalt road surface (drawn under everything). */
  | "road"
  /** Dashed lane marking along the longer side. */
  | "lane"
  /** Helicopter landing pad. */
  | "helipad"
  /** Grass / dirt verge. */
  | "verge";

export interface DecorDef extends Rect {
  kind: DecorKind;
  tone?: number;
  /** Rotation in degrees (visual only). */
  rot?: number;
  label?: string;
}

export interface LightDef extends Vec2 {
  radius: number;
  color: number;
  intensity: number;
  /** Flicker amount 0..1 (visual only). */
  flicker?: number;
}

export type PickupKind = "health" | "ammo" | "weapon";

export interface PickupDef extends Vec2 {
  id: string;
  kind: PickupKind;
  weapon?: WeaponId;
  respawnSec: number;
}

export interface VehicleSpawnDef extends Vec2 {
  id: string;
  kind: VehicleKind;
  /** Heading in radians. */
  angle: number;
}

/**
 * Solids tall enough to stop a flying helicopter and the bullets between the ground and the air.
 * Everything else (walls, crates, cars, sandbags…) is overflown.
 */
export const TALL_SOLIDS: ReadonlySet<SolidKind> = new Set<SolidKind>(["building", "pillar", "tank"]);

export interface ThemeDef {
  floor: number;
  floorAlt: number;
  grid: number;
  wall: number;
  wallTop: number;
  shadow: number;
  ambient: number;
  accents: readonly number[];
  fog: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  tagline: string;
  width: number;
  height: number;
  theme: ThemeDef;
  solids: readonly SolidDef[];
  decor: readonly DecorDef[];
  lights: readonly LightDef[];
  spawns: readonly Vec2[];
  /**
   * Team modes: spawn points per team. Optional: maps authored as a mirrored half use the authored
   * spawns for Alpha and their mirror images for Bravo (see teamSpawns), balanced by construction.
   */
  teamSpawns?: { 1: readonly Vec2[]; 2: readonly Vec2[] };
  pickups: readonly PickupDef[];
  /** Vehicles parked at match start and respawned in place after destruction. */
  vehicleSpawns?: readonly VehicleSpawnDef[];
  /** Large maps: shown in the map picker as "vehicles" maps, sized for bigger matches. */
  large?: boolean;
}

/**
 * Point-symmetric mirroring around the map center. Competitive maps are authored as one half
 * and mirrored, so every route, cover spot and pickup has a counterpart: balance by construction.
 */
export function mirrorRect<T extends Rect>(r: T, width: number, height: number): T {
  return { ...r, x: width - r.x - r.w, y: height - r.y - r.h };
}

export function mirrorPoint<T extends Vec2>(p: T, width: number, height: number): T {
  return { ...p, x: width - p.x, y: height - p.y };
}

export function withMirror<T extends Rect>(items: readonly T[], width: number, height: number): T[] {
  return [...items, ...items.map((r) => mirrorRect(r, width, height))];
}

export function withMirrorPoints<T extends Vec2>(
  items: readonly T[],
  width: number,
  height: number,
  rename?: (item: T) => T,
): T[] {
  return [
    ...items,
    ...items.map((p) => (rename ? rename(mirrorPoint(p, width, height)) : mirrorPoint(p, width, height))),
  ];
}

/** Mirrored vehicles face the opposite way (point symmetry) and get a "-m" id. */
export function withMirrorVehicles(
  items: readonly VehicleSpawnDef[],
  width: number,
  height: number,
): VehicleSpawnDef[] {
  return withMirrorPoints(items, width, height, (v) => ({
    ...v,
    id: `${v.id}-m`,
    angle: v.angle > 0 ? v.angle - Math.PI : v.angle + Math.PI,
  }));
}

export function withMirrorPickups(items: readonly PickupDef[], width: number, height: number): PickupDef[] {
  return withMirrorPoints(items, width, height, (p) => ({ ...p, id: `${p.id}-m` }));
}

/**
 * Spawn points of a team. Without explicit `teamSpawns`, the first half of `spawns` (the authored
 * half of a mirrored map) belongs to Alpha and the mirrored half to Bravo.
 */
export function teamSpawns(map: Pick<MapDef, "spawns" | "teamSpawns">, team: number): readonly Vec2[] {
  if (team !== 1 && team !== 2) return map.spawns;
  if (map.teamSpawns) return map.teamSpawns[team];
  const half = Math.floor(map.spawns.length / 2);
  return team === 1 ? map.spawns.slice(0, half) : map.spawns.slice(half);
}
