import { describe, expect, it } from "vitest";
import {
  buildMaze,
  type CollisionWorld,
  isFreeSpot,
  isMapId,
  MAP_IDS,
  MAPS,
  MAZE_DEFAULT_IDS,
  type MapDef,
  mapsForMode,
  mazeId,
  PLAYER,
  parseMazeId,
  pveWorlds,
  type Vec2,
  validateMap,
} from "../src/index.ts";

/** Places a player can walk to from `from` (16 px grid). */
function reach(map: MapDef, world: CollisionWorld, from: Vec2): (p: Vec2) => boolean {
  const step = 16;
  const cols = Math.floor(map.width / step);
  const rows = Math.floor(map.height / step);
  const seen = new Uint8Array(cols * rows);
  const free = (c: number, r: number) =>
    isFreeSpot(world, { x: c * step + step / 2, y: r * step + step / 2 }, PLAYER.radius);
  const s0 = Math.floor(from.y / step) * cols + Math.floor(from.x / step);
  const q = [s0];
  seen[s0] = 1;
  for (let i = 0; i < q.length; i++) {
    const u = q[i]!;
    const c = u % cols;
    const r = Math.floor(u / cols);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const v = nr * cols + nc;
      if (seen[v] || !free(nc, nr)) continue;
      seen[v] = 1;
      q.push(v);
    }
  }
  return (p) => !!seen[Math.floor(p.y / step) * cols + Math.floor(p.x / step)];
}

/** Gates closed until their opener is reachable, in order: the exit must end up reachable. */
function solvable(map: MapDef): boolean {
  const maze = map.maze!;
  const open = new Set<string>();
  for (const g of maze.gates) {
    const can = reach(map, pveWorlds(map, maze.gates, open).world, map.spawns[0]!);
    if (!can(g.opener)) return false;
    // The opener must not sit behind its own gate (or any later one).
    open.add(g.id);
  }
  return reach(map, pveWorlds(map, maze.gates, open).world, map.spawns[0]!)(maze.exit);
}

describe("seeded mazes", () => {
  it("the same id always builds the same maze, another seed a different one", () => {
    const a = buildMaze("m", 42);
    const b = buildMaze("m", 42);
    const c = buildMaze("m", 43);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.solids)).not.toBe(JSON.stringify(c.solids));
  });

  it("listed mazes pass map validation and are offered to the maze mode only", () => {
    for (const id of MAZE_DEFAULT_IDS) {
      expect(MAP_IDS).toContain(id);
      expect(validateMap(MAPS[id])).toEqual([]);
    }
    expect(mapsForMode("maze")).toEqual([...MAZE_DEFAULT_IDS]);
    expect(mapsForMode("deathmatch").some((m) => m.startsWith("maze"))).toBe(false);
  });

  it("any seed is a valid map id, generated on demand", () => {
    const id = mazeId("s", 123456);
    expect(isMapId(id)).toBe(true);
    expect(MAPS[id].maze?.seed).toBe(123456);
    expect(isMapId("maze-x-1")).toBe(false);
    expect(parseMazeId("maze-l-9")).toEqual({ size: "l", seed: 9 });
  });

  it("every maze is solvable with its gates: key before the amber gate, switch before the cyan one", () => {
    for (const size of ["s", "m", "l"] as const) {
      for (let seed = 1; seed <= (size === "l" ? 6 : 12); seed++) {
        const map = buildMaze(size, seed * 7919);
        expect(map.maze!.gates.length).toBe(2);
        expect(solvable(map), `${size}-${seed * 7919}`).toBe(true);
      }
    }
  });

  it("the exit is not reachable while the gates are shut", () => {
    const map = buildMaze("m", 4721);
    const can = reach(map, pveWorlds(map, map.maze!.gates, new Set()).world, map.spawns[0]!);
    expect(can(map.maze!.exit)).toBe(false);
  });

  it("traps lie on the route and fill the corridor", () => {
    const map = buildMaze("l", 9306);
    expect(map.maze!.traps.length).toBe(6);
    for (const t of map.maze!.traps) expect(t.w).toBeGreaterThan(PLAYER.radius * 6);
  });
});
