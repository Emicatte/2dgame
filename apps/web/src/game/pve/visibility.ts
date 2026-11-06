/**
 * Line of sight for the co-op darkness: which part of the floor the local player can see.
 *
 * Pure geometry (no Phaser), so it is unit tested and cheap to profile. The classic 2D
 * visibility polygon: cast rays at every wall corner (and just beside it) plus a ring of rays
 * for open space, keep the nearest hit of each, sort by angle. The result is star-shaped around
 * the origin, so "is this point visible" is a lookup by angle.
 */

import type { Rect, SolidDef, SolidKind } from "@scrapline/shared";

/** Solids that block sight. Low cover (crates, sandbags, cars), fences and water do not. */
export const SIGHT_BLOCKERS: ReadonlySet<SolidKind> = new Set<SolidKind>([
  "wall",
  "building",
  "container",
  "pillar",
  "machine",
  "tank",
  "vending",
  "ruin",
  "rock",
]);

/** Wall edges as flat [ax, ay, bx, by, ...] plus the boxes they came from (for culling). */
export interface SightWorld {
  boxes: readonly Rect[];
}

export function sightWorld(solids: readonly SolidDef[], closedDoors: readonly Rect[] = []): SightWorld {
  const boxes: Rect[] = [];
  for (const s of solids) if (SIGHT_BLOCKERS.has(s.kind)) boxes.push({ x: s.x, y: s.y, w: s.w, h: s.h });
  for (const d of closedDoors) boxes.push({ x: d.x, y: d.y, w: d.w, h: d.h });
  return { boxes };
}

export interface VisibilityPolygon {
  ox: number;
  oy: number;
  radius: number;
  /** Vertices sorted by angle: x, y pairs. */
  points: Float64Array;
  /** Angle of each vertex (ascending, in [-π, π)). */
  angles: Float64Array;
  /** Distance of each vertex from the origin. */
  dists: Float64Array;
  count: number;
}

const EPS_ANGLE = 0.0004;
const RING_RAYS = 48;

/**
 * Visibility polygon from (ox, oy) up to `radius`. `penetration` extends every wall hit a few
 * pixels into the wall, so the face of a lit wall is lit too (walls are at least 24 px thick,
 * so this never shows what is behind them).
 */
export function visibilityPolygon(
  world: SightWorld,
  ox: number,
  oy: number,
  radius: number,
  penetration = 0,
): VisibilityPolygon {
  // Edges facing the origin, of boxes that reach the circle (back faces never block first).
  const segs: number[] = [];
  const corners: number[] = [];
  for (const b of world.boxes) {
    const nx = Math.max(b.x, Math.min(ox, b.x + b.w));
    const ny = Math.max(b.y, Math.min(oy, b.y + b.h));
    if ((nx - ox) ** 2 + (ny - oy) ** 2 > radius * radius) continue;
    // Origin inside a box (standing in a doorway being closed): ignore that box.
    if (ox > b.x && ox < b.x + b.w && oy > b.y && oy < b.y + b.h) continue;
    const x0 = b.x;
    const y0 = b.y;
    const x1 = b.x + b.w;
    const y1 = b.y + b.h;
    if (oy < y0) segs.push(x0, y0, x1, y0);
    if (oy > y1) segs.push(x0, y1, x1, y1);
    if (ox < x0) segs.push(x0, y0, x0, y1);
    if (ox > x1) segs.push(x1, y0, x1, y1);
    corners.push(x0, y0, x1, y0, x1, y1, x0, y1);
  }
  const rays: number[] = [];
  for (let i = 0; i < RING_RAYS; i++) rays.push(-Math.PI + (i / RING_RAYS) * Math.PI * 2);
  for (let i = 0; i < corners.length; i += 2) {
    const cx = corners[i]!;
    const cy = corners[i + 1]!;
    if ((cx - ox) ** 2 + (cy - oy) ** 2 > radius * radius * 1.05) continue;
    const a = Math.atan2(cy - oy, cx - ox);
    rays.push(a - EPS_ANGLE, a, a + EPS_ANGLE);
  }
  for (let i = 0; i < rays.length; i++) {
    let a = rays[i]!;
    if (a < -Math.PI) a += Math.PI * 2;
    if (a >= Math.PI) a -= Math.PI * 2;
    rays[i] = a;
  }
  rays.sort((p, q) => p - q);
  const n = rays.length;
  const points = new Float64Array(n * 2);
  const angles = new Float64Array(n);
  const dists = new Float64Array(n);
  let count = 0;
  let lastA = Number.NEGATIVE_INFINITY;
  for (const a of rays) {
    if (a - lastA < 1e-7) continue;
    lastA = a;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = radius;
    for (let s = 0; s < segs.length; s += 4) {
      const t = raySegment(ox, oy, dx, dy, segs[s]!, segs[s + 1]!, segs[s + 2]!, segs[s + 3]!);
      if (t >= 0 && t < best) best = t;
    }
    const d = best < radius ? Math.min(radius, best + penetration) : radius;
    points[count * 2] = ox + dx * d;
    points[count * 2 + 1] = oy + dy * d;
    angles[count] = a;
    dists[count] = d;
    count++;
  }
  return { ox, oy, radius, points, angles, dists, count };
}

/** Distance along the ray (dx, dy unit) to the segment, or -1. */
function raySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const sx = bx - ax;
  const sy = by - ay;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return -1;
  const qx = ax - ox;
  const qy = ay - oy;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * dy - qy * dx) / den;
  if (t < 0 || u < 0 || u > 1) return -1;
  return t;
}

/**
 * Is (x, y) visible from the polygon's origin? The polygon is star-shaped, so find the two
 * vertices around the point's angle and compare against the edge between them.
 */
export function isVisible(poly: VisibilityPolygon, x: number, y: number, margin = 0): boolean {
  const dx = x - poly.ox;
  const dy = y - poly.oy;
  const d = Math.hypot(dx, dy);
  if (d <= 1) return true;
  if (d > poly.radius + margin || poly.count < 2) return false;
  const a = Math.atan2(dy, dx);
  // Binary search for the first vertex angle ≥ a (wrapping).
  const ang = poly.angles;
  let lo = 0;
  let hi = poly.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ang[mid]! < a) lo = mid + 1;
    else hi = mid;
  }
  const j = lo % poly.count;
  const i = (lo - 1 + poly.count) % poly.count;
  const ax = poly.points[i * 2]! - poly.ox;
  const ay = poly.points[i * 2 + 1]! - poly.oy;
  const bx = poly.points[j * 2]! - poly.ox;
  const by = poly.points[j * 2 + 1]! - poly.oy;
  // Distance from the origin to edge (a, b) along the point's direction.
  const ux = dx / d;
  const uy = dy / d;
  const ex = bx - ax;
  const ey = by - ay;
  const den = ux * ey - uy * ex;
  const edge =
    Math.abs(den) < 1e-9 ? Math.min(Math.hypot(ax, ay), Math.hypot(bx, by)) : (ax * ey - ay * ex) / den;
  return d <= edge + margin;
}

/**
 * Shadow quads: for every pair of consecutive vertices, the region between the polygon edge and
 * `far` px from the origin. Drawn dark over the lights, they hide everything out of sight.
 * Returns flat [x0, y0, x1, y1, x2, y2, x3, y3] per quad.
 */
export function shadowQuads(poly: VisibilityPolygon, far: number, overlap = 1.5): Float64Array {
  const out = new Float64Array(poly.count * 8);
  // Neighbouring quads overlap a little (along the polygon edge and angularly at the far end):
  // shared edges rasterized twice leave no pinholes of light; the fill is opaque, so the
  // overlap does not darken anything further.
  const angOv = overlap / Math.max(1, far) + 0.0015;
  for (let i = 0; i < poly.count; i++) {
    const j = (i + 1) % poly.count;
    const ai = poly.angles[i]!;
    let aj = poly.angles[j]!;
    if (j === 0) aj += Math.PI * 2;
    const pix = poly.points[i * 2]!;
    const piy = poly.points[i * 2 + 1]!;
    const pjx = poly.points[j * 2]!;
    const pjy = poly.points[j * 2 + 1]!;
    const ex = pjx - pix;
    const ey = pjy - piy;
    const el = Math.hypot(ex, ey);
    const ux = el > 1e-6 ? (ex / el) * overlap : 0;
    const uy = el > 1e-6 ? (ey / el) * overlap : 0;
    out[i * 8] = pix - ux;
    out[i * 8 + 1] = piy - uy;
    out[i * 8 + 2] = pjx + ux;
    out[i * 8 + 3] = pjy + uy;
    out[i * 8 + 4] = poly.ox + Math.cos(aj + angOv) * far;
    out[i * 8 + 5] = poly.oy + Math.sin(aj + angOv) * far;
    out[i * 8 + 6] = poly.ox + Math.cos(ai - angOv) * far;
    out[i * 8 + 7] = poly.oy + Math.sin(ai - angOv) * far;
  }
  return out;
}
