import { type MapDef, SHOOT_THROUGH, type SolidKind } from "@scrapline/shared";

/**
 * What a bullet hit, for impact effects: metal rings with bright sparks, masonry and earth puff
 * dust and chips, the map edge raises dust. Visual only.
 */
export type Surface = "metal" | "masonry" | "edge";

export const SURFACE_OF: Readonly<Record<SolidKind, Surface | null>> = {
  container: "metal",
  machine: "metal",
  car: "metal",
  tank: "metal",
  vending: "metal",
  wall: "masonry",
  building: "masonry",
  ruin: "masonry",
  rock: "masonry",
  sandbag: "masonry",
  crate: "masonry",
  pillar: "masonry",
  // Shoot-through solids never stop a bullet, so they are never an impact surface.
  water: null,
  fence: null,
};

/** Dust / chip colour per solid (light enough to read on every map palette). */
export const SURFACE_TINT: Readonly<Record<SolidKind, number>> = {
  container: 0x5a5f68,
  machine: 0x5a5f68,
  car: 0x5a5f68,
  tank: 0x5a5f68,
  vending: 0x5a5f68,
  wall: 0xb6b0a4,
  building: 0xaaa59b,
  ruin: 0x9e978c,
  rock: 0xa39277,
  sandbag: 0xb8a274,
  crate: 0xa07a52,
  pillar: 0xbab4a8,
  water: 0x9fb8c8,
  fence: 0x8a8a8a,
};

export const EDGE_TINT = 0x9a958c;

export interface SurfaceHit {
  surface: Surface;
  /** Solid hit, or null for the map edge. */
  kind: SolidKind | null;
  /** Outward normal of the face that was hit (radians). */
  normal: number;
  tint: number;
}

type SurfaceMap = Pick<MapDef, "width" | "height" | "solids">;

/**
 * Classifies the surface at an impact point (the end of a hitscan pellet). The point lies on the
 * face of the solid the ray entered, up to rounding (remote shots arrive with whole-pixel
 * distances and 1/1000 rad angles), so solids within `eps` px count. The nearest candidate wins;
 * a solid beats the map edge on a tie. Returns null when nothing is there: the pellet stopped on
 * a player or a vehicle.
 */
export function classifyImpact(map: SurfaceMap, x: number, y: number, eps = 2): SurfaceHit | null {
  let best = eps;
  let bestKind: SolidKind | null = null;
  let bestNormal = 0;
  for (const s of map.solids) {
    if (SHOOT_THROUGH.has(s.kind)) continue;
    // Cheap reject first: the expanded box.
    if (x < s.x - best || x > s.x + s.w + best || y < s.y - best || y > s.y + s.h + best) continue;
    const dx = Math.max(s.x - x, 0, x - (s.x + s.w));
    const dy = Math.max(s.y - y, 0, y - (s.y + s.h));
    const d = Math.hypot(dx, dy);
    if (d > best || (d === best && bestKind !== null)) continue;
    best = d;
    bestKind = s.kind;
    bestNormal = faceNormal(s.x, s.y, s.w, s.h, x, y);
  }
  const edge = Math.min(x, y, map.width - x, map.height - y);
  if (bestKind !== null && best <= Math.max(0, edge)) {
    const surface = SURFACE_OF[bestKind] ?? "masonry";
    return { surface, kind: bestKind, normal: bestNormal, tint: SURFACE_TINT[bestKind] };
  }
  if (edge <= eps) {
    const normal =
      edge === x ? 0 : edge === map.width - x ? Math.PI : edge === y ? Math.PI / 2 : -Math.PI / 2;
    return { surface: "edge", kind: null, normal, tint: EDGE_TINT };
  }
  return null;
}

/** Outward normal of the rectangle face nearest to the point. */
function faceNormal(rx: number, ry: number, rw: number, rh: number, x: number, y: number): number {
  const left = Math.abs(x - rx);
  const right = Math.abs(rx + rw - x);
  const top = Math.abs(y - ry);
  const bottom = Math.abs(ry + rh - y);
  const m = Math.min(left, right, top, bottom);
  if (m === left) return Math.PI;
  if (m === right) return 0;
  if (m === top) return -Math.PI / 2;
  return Math.PI / 2;
}
