import type { DoorDef } from "../pve/missions.ts";
import type { Rect, Vec2 } from "../sim/math.ts";
import { mulberry32 } from "../sim/rng.ts";
import type { DecorDef, LightDef, MapDef, MapId, SolidDef } from "./types.ts";

/**
 * Seeded labyrinths. A maze is a map generated from (size, seed): the same id gives the same map
 * on every machine, so the room and every client build identical walls, doors and traps from the
 * id alone (`maze-m-48213`). The lobby picks a size; "New maze" draws a new seed.
 *
 * Layout: a perfect maze (one path between any two cells) carved by a seeded backtracker. The exit
 * is the cell farthest from the start. On the route to it: an amber gate opened by a key lying in
 * a side branch before the gate, then a cyan gate opened by a switch in a branch between the two
 * gates, a checkpoint after each gate, and timed floor traps that send you back to your
 * checkpoint. Every opener is reachable without crossing its own gate, so a maze is always
 * solvable (checked by tests for many seeds).
 */

export type MazeSize = "s" | "m" | "l";

export const MAZE_SIZES: Record<MazeSize, { name: string; cells: number; traps: number }> = {
  s: { name: "Small", cells: 8, traps: 2 },
  m: { name: "Medium", cells: 12, traps: 4 },
  l: { name: "Large", cells: 16, traps: 6 },
};

/** Cell pitch and wall thickness (px). The corridor is CELL - WALL wide. */
export const MAZE_CELL = 192;
export const MAZE_WALL = 28;

/** Floor trap cycle: safe, then live (s). */
export const MAZE_TRAP = { offSec: 2, onSec: 1.2 } as const;

export interface MazeGate extends DoorDef {
  color: number;
  /**
   * What opens it: a key to carry to the gate, a switch to press (interact), pressure plates that
   * must all be held at once (co-op), or switches pressed in the order of a code (`order`).
   */
  opener: {
    kind: "key" | "switch" | "plates" | "sequence";
    x: number;
    y: number;
    points?: Vec2[];
    order?: number[];
  };
}

/** A moving bar (Parkour): it slides between two centres; touching it sends you back. */
export interface MazeSweeper {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  periodSec: number;
  phase: number;
}

/** Where a sweeper is at `sec` seconds since the start. */
export function sweeperAt(s: MazeSweeper, sec: number): Rect {
  const k = 0.5 - 0.5 * Math.cos(((sec + s.phase) / s.periodSec) * Math.PI * 2);
  const cx = s.x0 + (s.x1 - s.x0) * k;
  const cy = s.y0 + (s.y1 - s.y0) * k;
  return { x: cx - s.w / 2, y: cy - s.h / 2, w: s.w, h: s.h };
}

export interface MazeTrap extends Rect {
  id: string;
  /** Offset of this trap's cycle (s), so traps do not all fire together. */
  phase: number;
}

export interface MazeDef {
  size: MazeSize;
  seed: number;
  cols: number;
  rows: number;
  start: Rect;
  exit: Vec2 & { r: number };
  gates: MazeGate[];
  /** In route order; index 0 is the start. */
  checkpoints: Vec2[];
  traps: MazeTrap[];
  /** Cells of the route start → exit (tests, bots later). */
  route: number;
  /** Horror Maze: where the creature starts (a far dead end on the start side of the first gate). */
  lair: Vec2;
  /** Parkour: gaps to dash over (walking in = a fall) and moving bars. */
  pits?: (Rect & { id: string })[];
  sweepers?: MazeSweeper[];
  /** Escape Room: the code clue shown on a terminal. */
  clue?: Vec2 & { text: string };
}

export function mazeId(size: MazeSize, seed: number): MapId {
  return `maze-${size}-${seed}` as MapId;
}

export function parseMazeId(id: string): { size: MazeSize; seed: number } | null {
  const m = /^maze-([sml])-(\d{1,9})$/.exec(id);
  return m ? { size: m[1] as MazeSize, seed: Number(m[2]) } : null;
}

/** Canonical maze of each size (map lists, thumbnails); rooms play any seed. */
export const MAZE_DEFAULT_IDS: readonly MapId[] = [mazeId("s", 1207), mazeId("m", 4721), mazeId("l", 9306)];

/** A fresh seed for "New maze". */
export function randomMazeId(size: MazeSize): MapId {
  return mazeId(size, 1 + Math.floor(Math.random() * 999_999));
}

/** Same generated family (maze size, parkour, escape): the lobby shows one card per family. */
export function sameMapFamily(a: string, b: string): boolean {
  const fam = (id: string) => {
    const m = parseMazeId(id);
    if (m) return `maze-${m.size}`;
    const c = /^(parkour|escape)-\d+$/.exec(id);
    return c ? c[1]! : id;
  };
  return fam(a) === fam(b);
}

// ------------------------------------------------------------------ generation

const E = 1;
const S = 2;

export function buildMaze(size: MazeSize, seed: number): MapDef {
  const { cells, traps: trapCount, name } = MAZE_SIZES[size];
  const cols = cells;
  const rows = cells;
  const rng = mulberry32(seed * 2654435761 + cols);
  const n = cols * rows;
  const open = new Uint8Array(n); // E / S passages of each cell
  const idx = (c: number, r: number) => r * cols + c;

  // Carve: iterative backtracker.
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1]!;
    const c = cur % cols;
    const r = Math.floor(cur / cols);
    const opts: number[] = [];
    if (c > 0 && !seen[cur - 1]) opts.push(cur - 1);
    if (c < cols - 1 && !seen[cur + 1]) opts.push(cur + 1);
    if (r > 0 && !seen[cur - cols]) opts.push(cur - cols);
    if (r < rows - 1 && !seen[cur + cols]) opts.push(cur + cols);
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const next = opts[Math.floor(rng() * opts.length)]!;
    if (next === cur + 1) open[cur]! |= E;
    else if (next === cur - 1) open[next]! |= E;
    else if (next === cur + cols) open[cur]! |= S;
    else open[next]! |= S;
    seen[next] = 1;
    stack.push(next);
  }

  const neighbors = (a: number): number[] => {
    const c = a % cols;
    const out: number[] = [];
    if (open[a]! & E) out.push(a + 1);
    if (open[a]! & S) out.push(a + cols);
    if (c > 0 && open[a - 1]! & E) out.push(a - 1);
    if (a >= cols && open[a - cols]! & S) out.push(a - cols);
    return out;
  };
  /** Cells reachable from `from` without crossing the passage a–b. */
  const side = (from: number, a = -1, b = -1): Int32Array => {
    const dist = new Int32Array(n).fill(-1);
    dist[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const u = q[i]!;
      for (const v of neighbors(u)) {
        if ((u === a && v === b) || (u === b && v === a) || dist[v]! >= 0) continue;
        dist[v] = dist[u]! + 1;
        q.push(v);
      }
    }
    return dist;
  };

  const dist = side(0);
  let exitCell = 0;
  for (let i = 0; i < n; i++) if (dist[i]! > dist[exitCell]!) exitCell = i;
  // Route: walk back from the exit along decreasing distance.
  const route = [exitCell];
  while (route[route.length - 1] !== 0) {
    const u = route[route.length - 1]!;
    route.push(neighbors(u).find((v) => dist[v] === dist[u]! - 1)!);
  }
  route.reverse();
  const onRoute = new Set(route);

  const center = (i: number): Vec2 => ({
    x: (i % cols) * MAZE_CELL + MAZE_WALL + (MAZE_CELL - MAZE_WALL) / 2,
    y: Math.floor(i / cols) * MAZE_CELL + MAZE_WALL + (MAZE_CELL - MAZE_WALL) / 2,
  });
  const interior = (i: number): Rect => ({
    x: (i % cols) * MAZE_CELL + MAZE_WALL,
    y: Math.floor(i / cols) * MAZE_CELL + MAZE_WALL,
    w: MAZE_CELL - MAZE_WALL,
    h: MAZE_CELL - MAZE_WALL,
  });
  /** The doorway between two neighbouring cells. */
  const doorway = (a: number, b: number): Rect => {
    const lo = Math.min(a, b);
    const c = lo % cols;
    const r = Math.floor(lo / cols);
    return Math.abs(a - b) === 1
      ? { x: (c + 1) * MAZE_CELL, y: r * MAZE_CELL + MAZE_WALL, w: MAZE_WALL, h: MAZE_CELL - MAZE_WALL }
      : { x: c * MAZE_CELL + MAZE_WALL, y: (r + 1) * MAZE_CELL, w: MAZE_CELL - MAZE_WALL, h: MAZE_WALL };
  };
  /** A spot for an opener: the farthest dead end among `cells`, else any of them. */
  const pick = (cells: number[]): number => {
    const ends = cells.filter((i) => neighbors(i).length === 1);
    const pool = (ends.length ? ends : cells).sort((a, b) => dist[b]! - dist[a]!);
    return pool[Math.floor(rng() * Math.min(3, pool.length))]!;
  };

  const gates: MazeGate[] = [];
  const checkpoints: Vec2[] = [center(0)];
  let lairCell = route[Math.floor(route.length / 2)]!;
  const k1 = Math.floor(route.length * 0.35);
  const k2 = Math.floor(route.length * 0.7);
  const gated = route.length >= 10 && k2 > k1 + 2;
  if (gated) {
    const before1 = side(0, route[k1]!, route[k1 + 1]!);
    const before2 = side(0, route[k2]!, route[k2 + 1]!);
    const keyCells: number[] = [];
    const switchCells: number[] = [];
    for (let i = 0; i < n; i++) {
      if (onRoute.has(i)) continue;
      if (before1[i]! >= 0) keyCells.push(i);
      else if (before2[i]! >= 0) switchCells.push(i);
    }
    const keyAt = keyCells.length ? pick(keyCells) : route[Math.max(1, Math.floor(k1 / 2))]!;
    const lairs = keyCells.filter((i) => i !== keyAt && dist[i]! >= 5).sort((a, b) => dist[b]! - dist[a]!);
    lairCell = lairs[0] ?? route[k1]!;
    const switchAt = switchCells.length ? pick(switchCells) : route[k1 + 1 + Math.floor((k2 - k1) / 2)]!;
    gates.push({
      id: "gate-amber",
      label: "Amber gate",
      color: 0xffb347,
      ...doorway(route[k1]!, route[k1 + 1]!),
      opener: { kind: "key", ...center(keyAt) },
    });
    gates.push({
      id: "gate-cyan",
      label: "Cyan gate",
      color: 0x4fd8ff,
      ...doorway(route[k2]!, route[k2 + 1]!),
      opener: { kind: "switch", ...center(switchAt) },
    });
    checkpoints.push(center(route[k1 + 1]!), center(route[k2 + 1]!));
  }

  // Traps: on the route, spread out, away from the start, the exit, gates and checkpoints.
  const busy = new Set([0, 1, route.length - 1, route.length - 2]);
  if (gated) for (const k of [k1, k1 + 1, k2, k2 + 1]) busy.add(k);
  const slots = route.map((_, k) => k).filter((k) => !busy.has(k));
  const traps: MazeTrap[] = [];
  for (let t = 0; t < trapCount && slots.length; t++) {
    const k = slots[Math.floor(((t + 0.5) / trapCount) * slots.length)]!;
    if (traps.some((x) => x.id === `trap-${k}`)) continue;
    const box = interior(route[k]!);
    const inset = 18;
    traps.push({
      id: `trap-${k}`,
      x: box.x + inset,
      y: box.y + inset,
      w: box.w - inset * 2,
      h: box.h - inset * 2,
      phase: Math.round(rng() * (MAZE_TRAP.offSec + MAZE_TRAP.onSec) * 10) / 10,
    });
  }

  // Walls: maximal runs of closed edges on every grid line.
  const width = cols * MAZE_CELL + MAZE_WALL;
  const height = rows * MAZE_CELL + MAZE_WALL;
  const solids: SolidDef[] = [];
  for (let k = 0; k <= cols; k++) {
    let runStart = -1;
    for (let r = 0; r <= rows; r++) {
      const closed = r < rows && (k === 0 || k === cols || !(open[idx(k - 1, r)]! & E));
      if (closed && runStart < 0) runStart = r;
      if (!closed && runStart >= 0) {
        solids.push({
          kind: "wall",
          x: k * MAZE_CELL,
          y: runStart * MAZE_CELL,
          w: MAZE_WALL,
          h: (r - runStart) * MAZE_CELL + MAZE_WALL,
        });
        runStart = -1;
      }
    }
  }
  for (let r = 0; r <= rows; r++) {
    let runStart = -1;
    for (let c = 0; c <= cols; c++) {
      const closed = c < cols && (r === 0 || r === rows || !(open[idx(c, r - 1)]! & S));
      if (closed && runStart < 0) runStart = c;
      if (!closed && runStart >= 0) {
        solids.push({
          kind: "wall",
          x: runStart * MAZE_CELL,
          y: r * MAZE_CELL,
          w: (c - runStart) * MAZE_CELL + MAZE_WALL,
          h: MAZE_WALL,
        });
        runStart = -1;
      }
    }
  }

  const startBox = interior(0);
  const exit = center(exitCell);
  const spawns: Vec2[] = [];
  for (let a = 1; a <= 3; a++)
    for (let b = 1; b <= 3; b++)
      spawns.push({ x: startBox.x + (startBox.w * a) / 4, y: startBox.y + (startBox.h * b) / 4 });

  const decor: DecorDef[] = [
    { kind: "paint", ...startBox, tone: 1 },
    { kind: "paint", ...interior(exitCell), tone: 3 },
    ...traps.map((t): DecorDef => ({ kind: "hazard", x: t.x, y: t.y, w: t.w, h: t.h })),
  ];
  const lights: LightDef[] = [
    { ...center(0), radius: 260, color: 0xffe2b0, intensity: 0.45 },
    { ...exit, radius: 300, color: 0x7dffb0, intensity: 0.55, flicker: 0.1 },
    ...checkpoints.slice(1).map((p): LightDef => ({ ...p, radius: 220, color: 0x9fd8ff, intensity: 0.4 })),
    ...gates.map(
      (g): LightDef => ({ x: g.opener.x, y: g.opener.y, radius: 200, color: g.color, intensity: 0.4 }),
    ),
  ];

  const maze: MazeDef = {
    size,
    seed,
    cols,
    rows,
    start: startBox,
    exit: { ...exit, r: (MAZE_CELL - MAZE_WALL) / 2 - 12 },
    gates,
    checkpoints,
    traps,
    route: route.length,
    lair: center(lairCell),
  };

  return {
    id: mazeId(size, seed),
    name: `Maze · ${name}`,
    tagline: `${cols}×${rows} cells, seed ${seed}. Keys, switches and floor traps.`,
    width,
    height,
    theme: {
      floor: 0x2c2f33,
      floorAlt: 0x32363b,
      grid: 0x3a3f45,
      wall: 0x50565e,
      wallTop: 0x737a84,
      shadow: 0x08090a,
      ambient: 0x131518,
      accents: [0xff7a2e, 0x4fd8ff, 0xffb347, 0x7dffb0],
      fog: 0x0e0f11,
    },
    solids,
    decor,
    lights,
    spawns,
    pickups: [],
    modes: ["maze", "nighthunt"],
    players: { min: 1, max: 8 },
    maze,
  };
}
