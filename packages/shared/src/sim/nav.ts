import { type CollisionWorld, circleIntersectsRect, querySolids, raycastSolids } from "./collision.ts";
import type { Rect, Vec2 } from "./math.ts";

/**
 * Navigation for PvE enemies on the same axis-aligned collision world players use.
 *
 * - A grid of cells; each cell stores the largest clearance class whose circle fits at its centre
 *   (0 = blocked, 1 = small bodies, 2 = large bodies). Bodies of a class only walk cells of that
 *   class or better, so a brute never plans through a gap only a walker fits.
 * - Flow fields (multi-source Dijkstra with Dial's bucket queue, 8-connected, no corner cutting):
 *   one field per chased target gives every enemy its path at the cost of one lookup, which is what
 *   keeps large hordes cheap. Fields are rebuilt only when their target changes cell.
 * - A* for individual goals (investigating a noise, wandering, flanking), with line-of-sight path
 *   smoothing.
 *
 * Movement itself is resolved against the collision world (resolveCircle), so whatever the
 * navigation says, an enemy can never pass through a wall.
 */

export const NAV_CELL = 24;
/** Body radius each clearance class must fit (index = class). Class 3: bosses. */
export const NAV_CLASS_RADIUS = [0, 16, 26, 40] as const;
export type NavClass = 1 | 2 | 3;
export const NAV_SMALL: NavClass = 1;
export const NAV_LARGE: NavClass = 2;
export const NAV_HUGE: NavClass = 3;
export const NAV_INF = 0x3fffffff;

const ORTHO = 10;
const DIAG = 14;
const BUCKETS = DIAG + 1;

export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Clearance class per cell. */
  clear: Uint8Array;
}

export function navClassFor(radius: number): NavClass {
  return radius > NAV_CLASS_RADIUS[2] ? NAV_HUGE : radius > NAV_CLASS_RADIUS[1] ? NAV_LARGE : NAV_SMALL;
}

function fits(world: CollisionWorld, x: number, y: number, r: number): boolean {
  if (x < r || y < r || x > world.width - r || y > world.height - r) return false;
  for (const i of querySolids(world, x - r, y - r, x + r, y + r)) {
    if (circleIntersectsRect(x, y, r, world.solids[i]!)) return false;
  }
  return true;
}

function classAt(world: CollisionWorld, x: number, y: number): number {
  if (!fits(world, x, y, NAV_CLASS_RADIUS[1])) return 0;
  if (!fits(world, x, y, NAV_CLASS_RADIUS[2])) return 1;
  return fits(world, x, y, NAV_CLASS_RADIUS[3]) ? 3 : 2;
}

export function buildNavGrid(world: CollisionWorld, cell: number = NAV_CELL): NavGrid {
  const cols = Math.ceil(world.width / cell);
  const rows = Math.ceil(world.height / cell);
  const grid: NavGrid = {
    cell,
    cols,
    rows,
    width: world.width,
    height: world.height,
    clear: new Uint8Array(cols * rows),
  };
  updateNavRegion(grid, world, { x: 0, y: 0, w: world.width, h: world.height });
  return grid;
}

/** Recomputes the cells a changed rectangle (a door opening or closing) can affect. */
export function updateNavRegion(grid: NavGrid, world: CollisionWorld, rect: Rect): void {
  const m = NAV_CLASS_RADIUS[3] + grid.cell;
  const c0 = Math.max(0, Math.floor((rect.x - m) / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.floor((rect.x + rect.w + m) / grid.cell));
  const r0 = Math.max(0, Math.floor((rect.y - m) / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.floor((rect.y + rect.h + m) / grid.cell));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      grid.clear[r * grid.cols + c] = classAt(world, (c + 0.5) * grid.cell, (r + 0.5) * grid.cell);
    }
  }
}

export function cellIndex(grid: NavGrid, x: number, y: number): number {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cell)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / grid.cell)));
  return r * grid.cols + c;
}

export function cellCenter(grid: NavGrid, idx: number): Vec2 {
  const c = idx % grid.cols;
  const r = (idx - c) / grid.cols;
  return { x: (c + 0.5) * grid.cell, y: (r + 0.5) * grid.cell };
}

export function walkable(grid: NavGrid, idx: number, cls: NavClass): boolean {
  return idx >= 0 && idx < grid.clear.length && grid.clear[idx]! >= cls;
}

/** Nearest cell of the class around a position (bodies pushed against walls stand on blocked cells). */
export function nearestWalkable(grid: NavGrid, x: number, y: number, cls: NavClass, maxRing = 6): number {
  const start = cellIndex(grid, x, y);
  if (walkable(grid, start, cls)) return start;
  const c0 = start % grid.cols;
  const r0 = (start - c0) / grid.cols;
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        const idx = r * grid.cols + c;
        if (!walkable(grid, idx, cls)) continue;
        const p = cellCenter(grid, idx);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, ORTHO],
  [-1, 0, ORTHO],
  [0, 1, ORTHO],
  [0, -1, ORTHO],
  [1, 1, DIAG],
  [1, -1, DIAG],
  [-1, 1, DIAG],
  [-1, -1, DIAG],
];

/**
 * Calls `visit(neighbour, cost)` for every walkable neighbour. Diagonals need both orthogonal
 * cells free, so paths never cut a wall corner the body would scrape.
 */
function forNeighbours(grid: NavGrid, idx: number, cls: NavClass, visit: (n: number, cost: number) => void) {
  const c = idx % grid.cols;
  const r = (idx - c) / grid.cols;
  for (const [dc, dr, cost] of NEIGHBOURS) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
    const n = nr * grid.cols + nc;
    if (grid.clear[n]! < cls) continue;
    if (dc !== 0 && dr !== 0) {
      if (grid.clear[r * grid.cols + nc]! < cls || grid.clear[nr * grid.cols + c]! < cls) continue;
    }
    visit(n, cost);
  }
}

export interface FlowField {
  cls: NavClass;
  /** Path cost to the nearest source per cell (10 per straight cell), NAV_INF = unreachable. */
  dist: Int32Array;
  /** Source cells (for diagnostics and rebuild decisions). */
  sources: number[];
}

/**
 * Multi-source Dijkstra with Dial's bucket queue (integer costs ≤ 14): linear in the number of
 * cells. `maxCost` bounds the search (cells beyond it stay unreachable).
 */
export function buildFlowField(
  grid: NavGrid,
  cls: NavClass,
  sources: readonly number[],
  maxCost = NAV_INF,
  into?: FlowField,
): FlowField {
  const n = grid.clear.length;
  const dist = into && into.dist.length === n ? into.dist : new Int32Array(n);
  dist.fill(NAV_INF);
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  let pending = 0;
  const srcs: number[] = [];
  for (const s of sources) {
    if (s < 0 || s >= n || grid.clear[s]! < cls || dist[s] === 0) continue;
    dist[s] = 0;
    buckets[0]!.push(s);
    srcs.push(s);
    pending++;
  }
  let d = 0;
  while (pending > 0 && d <= maxCost) {
    const bucket = buckets[d % BUCKETS]!;
    while (bucket.length > 0) {
      const u = bucket.pop()!;
      pending--;
      if (dist[u] !== d) continue;
      forNeighbours(grid, u, cls, (v, cost) => {
        const nd = d + cost;
        if (nd < dist[v]! && nd <= maxCost) {
          dist[v] = nd;
          buckets[nd % BUCKETS]!.push(v);
          pending++;
        }
      });
    }
    d++;
  }
  const field = into ?? { cls, dist, sources: srcs };
  field.cls = cls;
  field.dist = dist;
  field.sources = srcs;
  return field;
}

/** Next cell downhill from `idx` (the neighbour with the lowest cost), or -1 at a source / dead end. */
export function descend(grid: NavGrid, field: FlowField, idx: number): number {
  let best = -1;
  let bestD = field.dist[idx] ?? NAV_INF;
  forNeighbours(grid, idx, field.cls, (n) => {
    const d = field.dist[n]!;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  });
  return best;
}

/** Path cost (in px) from a position to the field's nearest source, Infinity when unreachable. */
export function fieldDistancePx(grid: NavGrid, field: FlowField, x: number, y: number): number {
  const idx = nearestWalkable(grid, x, y, field.cls, 3);
  if (idx < 0) return Number.POSITIVE_INFINITY;
  const d = field.dist[idx]!;
  return d >= NAV_INF ? Number.POSITIVE_INFINITY : (d / ORTHO) * grid.cell;
}

/**
 * "Fat" line of sight for a body of `radius`: three parallel rays (centre and both flanks at the
 * full radius) must reach the goal. Solids are at least 24 px thick, wider than the gap between
 * the rays, so none can slip between them. Used to cut path corners only where the body fits.
 */
export function clearPath(
  world: CollisionWorld,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return true;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * radius;
  const py = ux * radius;
  for (const k of [0, 1, -1]) {
    const ox = ax + px * k;
    const oy = ay + py * k;
    if (raycastSolids(world, ox, oy, ux, uy, len) < len - 0.5) return false;
  }
  return true;
}

/**
 * Steering target along a flow field: walks downhill up to `lookahead` cells and returns the
 * farthest cell centre the body can reach in a straight line (smooth paths instead of grid
 * zig-zags). Null when the position is unreachable or already at the source.
 */
export function flowSteer(
  grid: NavGrid,
  world: CollisionWorld,
  field: FlowField,
  x: number,
  y: number,
  radius: number,
  lookahead = 5,
): Vec2 | null {
  let idx = nearestWalkable(grid, x, y, field.cls, 3);
  if (idx < 0 || field.dist[idx]! >= NAV_INF) return null;
  let target: Vec2 | null = null;
  const start = idx;
  for (let k = 0; k < lookahead; k++) {
    const next = descend(grid, field, idx);
    if (next < 0) break;
    idx = next;
    const c = cellCenter(grid, idx);
    if (k === 0 || clearPath(world, x, y, c.x, c.y, radius)) target = c;
    else break;
  }
  if (!target && idx === start) {
    // Standing on a source cell, or pushed off the grid: head for the cell centre.
    const c = cellCenter(grid, start);
    return Math.hypot(c.x - x, c.y - y) > 2 ? c : null;
  }
  return target;
}

// ------------------------------------------------------------------ A*

class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(val: number, key: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r]! < k[l]! ? r : l;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

export interface PathResult {
  /** Waypoints after smoothing (excluding the start, including the goal cell centre). */
  points: Vec2[];
  /** Nodes expanded (cost diagnostics). */
  expanded: number;
}

/**
 * A* on the grid (octile heuristic). Returns null when the goal is unreachable within `maxNodes`
 * expansions. Waypoints are smoothed with fat line-of-sight checks.
 */
export function findPath(
  grid: NavGrid,
  world: CollisionWorld,
  cls: NavClass,
  from: Vec2,
  to: Vec2,
  maxNodes = 3000,
): PathResult | null {
  const start = nearestWalkable(grid, from.x, from.y, cls, 3);
  const goal = nearestWalkable(grid, to.x, to.y, cls, 4);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return { points: [cellCenter(grid, goal)], expanded: 0 };
  const gc = goal % grid.cols;
  const gr = (goal - gc) / grid.cols;
  const h = (idx: number) => {
    const c = idx % grid.cols;
    const r = (idx - c) / grid.cols;
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return ORTHO * Math.max(dx, dy) + (DIAG - ORTHO) * Math.min(dx, dy);
  };
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  g.set(start, 0);
  open.push(start, h(start));
  let expanded = 0;
  while (open.size > 0) {
    const u = open.pop();
    if (closed.has(u)) continue;
    if (u === goal) break;
    closed.add(u);
    if (++expanded > maxNodes) return null;
    const gu = g.get(u)!;
    forNeighbours(grid, u, cls, (v, cost) => {
      if (closed.has(v)) return;
      const nv = gu + cost;
      if (nv < (g.get(v) ?? Number.POSITIVE_INFINITY)) {
        g.set(v, nv);
        parent.set(v, u);
        open.push(v, nv + h(v));
      }
    });
  }
  if (!parent.has(goal)) return null;
  const cells: number[] = [];
  for (let c = goal; c !== start; c = parent.get(c)!) cells.push(c);
  cells.reverse();
  // String pulling: keep only the waypoints the body cannot skip in a straight line.
  const radius = NAV_CLASS_RADIUS[cls];
  const points: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i) {
      const c = cellCenter(grid, cells[j]!);
      if (clearPath(world, anchor.x, anchor.y, c.x, c.y, radius)) break;
      j--;
    }
    const p = cellCenter(grid, cells[j]!);
    points.push(p);
    anchor = p;
    i = j + 1;
  }
  return { points, expanded };
}

/** A random walkable point around (x, y) within `radius` that the field says is reachable. */
export function randomWalkableNear(
  grid: NavGrid,
  cls: NavClass,
  x: number,
  y: number,
  radius: number,
  rng: () => number,
  tries = 12,
): Vec2 | null {
  for (let i = 0; i < tries; i++) {
    const a = rng() * Math.PI * 2;
    const d = radius * (0.35 + 0.65 * rng());
    const idx = cellIndex(grid, x + Math.cos(a) * d, y + Math.sin(a) * d);
    if (walkable(grid, idx, cls)) return cellCenter(grid, idx);
  }
  return null;
}
