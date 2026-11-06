import { describe, expect, it } from "vitest";
import {
  buildCollisionWorld,
  buildFlowField,
  buildNavGrid,
  MAP_IDS,
  MAPS,
  NAV_INF,
  type NavClass,
  type NavGrid,
  nearestWalkable,
} from "../src/index.ts";

/** Plain Dijkstra over the same 8-neighbour rules (no corner cutting): the reference. */
function referenceField(grid: NavGrid, cls: NavClass, sources: number[]): Int32Array {
  const n = grid.clear.length;
  const dist = new Int32Array(n).fill(NAV_INF);
  const open: number[] = [];
  for (const s of sources) {
    if (s < 0 || grid.clear[s]! < cls) continue;
    dist[s] = 0;
    open.push(s);
  }
  const done = new Uint8Array(n);
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]!]! < dist[open[bi]!]!) bi = i;
    const u = open[bi]!;
    open[bi] = open[open.length - 1]!;
    open.pop();
    if (done[u]) continue;
    done[u] = 1;
    const c = u % grid.cols;
    const r = (u - c) / grid.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        const v = nr * grid.cols + nc;
        if (grid.clear[v]! < cls) continue;
        if (dc !== 0 && dr !== 0) {
          if (grid.clear[r * grid.cols + nc]! < cls || grid.clear[nr * grid.cols + c]! < cls) continue;
        }
        const nd = dist[u]! + (dc !== 0 && dr !== 0 ? 14 : 10);
        if (nd < dist[v]!) {
          dist[v] = nd;
          open.push(v);
        }
      }
    }
  }
  return dist;
}

describe("flow fields", () => {
  it("match a reference Dijkstra on every map, class and several source sets", () => {
    for (const id of MAP_IDS) {
      const map = MAPS[id];
      const grid = buildNavGrid(buildCollisionWorld(map.width, map.height, map.solids));
      const points = [
        [map.width * 0.5, map.height * 0.5],
        [map.width * 0.15, map.height * 0.2],
        [map.width * 0.85, map.height * 0.75],
      ] as const;
      for (const cls of [1, 2, 3] as NavClass[]) {
        const cells = points.map(([x, y]) => nearestWalkable(grid, x, y, cls, 6)).filter((c) => c >= 0);
        for (const sources of [cells.slice(0, 1), cells]) {
          if (sources.length === 0) continue;
          const got = buildFlowField(grid, cls, sources);
          const want = referenceField(grid, cls, sources);
          expect(Array.from(got.dist), `${id} class ${cls}`).toEqual(Array.from(want));
        }
      }
    }
  });

  it("reuses the target array and honours maxCost", () => {
    const map = MAPS.works;
    const grid = buildNavGrid(buildCollisionWorld(map.width, map.height, map.solids));
    const src = nearestWalkable(grid, 1500, 1100, 1, 4);
    const first = buildFlowField(grid, 1, [src]);
    const again = buildFlowField(grid, 1, [src], 200, first);
    expect(again).toBe(first);
    for (const d of again.dist) expect(d === NAV_INF || d <= 200).toBe(true);
    const full = buildFlowField(grid, 1, [src], NAV_INF, first);
    expect(Array.from(full.dist)).toEqual(Array.from(referenceField(grid, 1, [src])));
  });
});
