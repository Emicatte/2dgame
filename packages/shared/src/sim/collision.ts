import type { Rect } from "./math.ts";

/**
 * Collision primitives. The world is made of axis-aligned solid rectangles plus the map bounds,
 * which keeps movement resolution and hitscan raycasts cheap and exactly reproducible.
 */

export interface CollisionWorld {
  width: number;
  height: number;
  solids: readonly Rect[];
  /** Uniform grid of solid indices for broad-phase queries. */
  grid: SolidGrid;
}

export interface SolidGrid {
  cell: number;
  cols: number;
  rows: number;
  cells: number[][];
}

const GRID_CELL = 128;

export function buildCollisionWorld(width: number, height: number, solids: readonly Rect[]): CollisionWorld {
  const cols = Math.ceil(width / GRID_CELL);
  const rows = Math.ceil(height / GRID_CELL);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  solids.forEach((r, i) => {
    const c0 = Math.max(0, Math.floor(r.x / GRID_CELL));
    const c1 = Math.min(cols - 1, Math.floor((r.x + r.w) / GRID_CELL));
    const r0 = Math.max(0, Math.floor(r.y / GRID_CELL));
    const r1 = Math.min(rows - 1, Math.floor((r.y + r.h) / GRID_CELL));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) cells[row * cols + col]!.push(i);
    }
  });
  return { width, height, solids, grid: { cell: GRID_CELL, cols, rows, cells } };
}

/** Indices of solids whose grid cells overlap the given box (may contain duplicates' removal). */
export function querySolids(world: CollisionWorld, x0: number, y0: number, x1: number, y1: number): number[] {
  const g = world.grid;
  const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / g.cell));
  const c1 = Math.min(g.cols - 1, Math.floor(Math.max(x0, x1) / g.cell));
  const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / g.cell));
  const r1 = Math.min(g.rows - 1, Math.floor(Math.max(y0, y1) / g.cell));
  const out: number[] = [];
  const seen = new Set<number>();
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      for (const idx of g.cells[row * g.cols + col]!) {
        if (!seen.has(idx)) {
          seen.add(idx);
          out.push(idx);
        }
      }
    }
  }
  return out;
}

export function circleIntersectsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Pushes a circle out of every overlapping solid and keeps it inside the map.
 * Returns the corrected position and which axes were blocked (used to cancel velocity).
 */
export function resolveCircle(
  world: CollisionWorld,
  x: number,
  y: number,
  r: number,
): { x: number; y: number; hitX: boolean; hitY: boolean } {
  let px = x;
  let py = y;
  let hitX = false;
  let hitY = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const idx of querySolids(world, px - r, py - r, px + r, py + r)) {
      const s = world.solids[idx]!;
      const nx = Math.max(s.x, Math.min(px, s.x + s.w));
      const ny = Math.max(s.y, Math.min(py, s.y + s.h));
      let dx = px - nx;
      let dy = py - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = r - d;
        dx /= d;
        dy /= d;
        px += dx * push;
        py += dy * push;
        if (Math.abs(dx) > 0.01) hitX = true;
        if (Math.abs(dy) > 0.01) hitY = true;
      } else {
        // Center is inside the rectangle: exit through the nearest edge.
        const left = px - s.x;
        const right = s.x + s.w - px;
        const top = py - s.y;
        const bottom = s.y + s.h - py;
        const m = Math.min(left, right, top, bottom);
        if (m === left) {
          px = s.x - r;
          hitX = true;
        } else if (m === right) {
          px = s.x + s.w + r;
          hitX = true;
        } else if (m === top) {
          py = s.y - r;
          hitY = true;
        } else {
          py = s.y + s.h + r;
          hitY = true;
        }
      }
      moved = true;
    }
    if (!moved) break;
  }
  if (px < r) {
    px = r;
    hitX = true;
  } else if (px > world.width - r) {
    px = world.width - r;
    hitX = true;
  }
  if (py < r) {
    py = r;
    hitY = true;
  } else if (py > world.height - r) {
    py = world.height - r;
    hitY = true;
  }
  return { x: px, y: py, hitX, hitY };
}

/**
 * Distance along the ray (dirX, dirY normalised) to the first solid or map edge, capped at maxDist.
 * Uses the slab method per rectangle.
 */
export function raycastSolids(
  world: CollisionWorld,
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
  maxDist: number,
): number {
  let best = maxDist;
  // Map bounds
  if (dirX > 0) best = Math.min(best, (world.width - ox) / dirX);
  else if (dirX < 0) best = Math.min(best, -ox / dirX);
  if (dirY > 0) best = Math.min(best, (world.height - oy) / dirY);
  else if (dirY < 0) best = Math.min(best, -oy / dirY);
  best = Math.max(0, best);

  const ex = ox + dirX * best;
  const ey = oy + dirY * best;
  const invX = dirX !== 0 ? 1 / dirX : Number.POSITIVE_INFINITY;
  const invY = dirY !== 0 ? 1 / dirY : Number.POSITIVE_INFINITY;
  for (const idx of querySolids(world, ox, oy, ex, ey)) {
    const s = world.solids[idx]!;
    let tmin: number;
    let tmax: number;
    if (dirX !== 0) {
      const t1 = (s.x - ox) * invX;
      const t2 = (s.x + s.w - ox) * invX;
      tmin = Math.min(t1, t2);
      tmax = Math.max(t1, t2);
    } else {
      if (ox < s.x || ox > s.x + s.w) continue;
      tmin = Number.NEGATIVE_INFINITY;
      tmax = Number.POSITIVE_INFINITY;
    }
    if (dirY !== 0) {
      const t1 = (s.y - oy) * invY;
      const t2 = (s.y + s.h - oy) * invY;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    } else if (oy < s.y || oy > s.y + s.h) {
      continue;
    }
    if (tmax < 0 || tmin > tmax) continue;
    const t = tmin < 0 ? 0 : tmin;
    if (t < best) best = t;
  }
  return best;
}

/** Distance along a normalised ray to a circle, or -1 if missed. */
export function raycastCircle(
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
  cx: number,
  cy: number,
  r: number,
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dirX + fy * dirY;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // origin inside circle
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** True when the straight segment between two points crosses no solid. */
export function hasLineOfSight(
  world: CollisionWorld,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  return raycastSolids(world, ax, ay, dx / d, dy / d, d) >= d - 0.5;
}
