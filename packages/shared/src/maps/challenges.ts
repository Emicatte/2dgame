import type { Rect, Vec2 } from "../sim/math.ts";
import { mulberry32 } from "../sim/rng.ts";
import type { MazeDef, MazeGate, MazeSweeper, MazeTrap } from "./maze.ts";
import type { DecorDef, LightDef, MapDef, MapId, SolidDef } from "./types.ts";

/**
 * Seeded challenge maps that run on the maze controller: a Parkour course (`parkour-<seed>`) and
 * an Escape Room (`escape-<seed>`). Like mazes, the id is enough for every machine to build the
 * same map.
 */

const T = 32;
const THEME = {
  floor: 0x2c2f33,
  floorAlt: 0x32363b,
  grid: 0x3a3f45,
  wall: 0x50565e,
  wallTop: 0x737a84,
  shadow: 0x08090a,
  ambient: 0x131518,
  accents: [0xff7a2e, 0x4fd8ff, 0xffb347, 0x7dffb0],
  fog: 0x0e0f11,
};

export function parseChallengeId(id: string): { kind: "parkour" | "escape"; seed: number } | null {
  const m = /^(parkour|escape)-(\d{1,9})$/.exec(id);
  return m ? { kind: m[1] as "parkour" | "escape", seed: Number(m[2]) } : null;
}

export const CHALLENGE_DEFAULT_IDS: readonly MapId[] = ["parkour-101", "escape-202"];

export function randomChallengeId(kind: "parkour" | "escape"): MapId {
  return `${kind}-${1 + Math.floor(Math.random() * 999_999)}` as MapId;
}

export function buildChallenge(kind: "parkour" | "escape", seed: number): MapDef {
  return kind === "parkour" ? buildCourse(seed) : buildEscape(seed);
}

function grid9(box: Rect): Vec2[] {
  const out: Vec2[] = [];
  for (let a = 1; a <= 3; a++)
    for (let b = 1; b <= 3; b++) out.push({ x: box.x + (box.w * a) / 4, y: box.y + (box.h * b) / 4 });
  return out;
}

function baseDef(
  id: MapId,
  name: string,
  tagline: string,
  w: number,
  h: number,
): Omit<MapDef, "solids" | "decor" | "lights" | "spawns" | "maze"> {
  return { id, name, tagline, width: w, height: h, theme: THEME, pickups: [], players: { min: 1, max: 8 } };
}

/** Three corridors in a snake; timed floor traps, gaps to dash over and moving bars. */
function buildCourse(seed: number): MapDef {
  const rng = mulberry32(seed * 7 + 3);
  const W = 2800;
  const LANE = 260;
  const H = 3 * (LANE + T) + T;
  const laneY = (j: number) => T + j * (LANE + T);
  const solids: SolidDef[] = [
    { kind: "wall", x: 0, y: 0, w: W, h: T },
    { kind: "wall", x: 0, y: H - T, w: W, h: T },
    { kind: "wall", x: 0, y: 0, w: T, h: H },
    { kind: "wall", x: W - T, y: 0, w: T, h: H },
    { kind: "wall", x: 0, y: laneY(1) - T, w: W - LANE - T, h: T },
    { kind: "wall", x: LANE + T, y: laneY(2) - T, w: W - LANE - T, h: T },
  ];
  const traps: MazeTrap[] = [];
  const pits: (Rect & { id: string })[] = [];
  const sweepers: MazeSweeper[] = [];
  const decor: DecorDef[] = [];
  for (let j = 0; j < 3; j++) {
    const y = laneY(j);
    for (let k = 0; k < 6; k++) {
      const x = 420 + k * 360;
      const kind = Math.floor(rng() * 3);
      const id = `h-${j}-${k}`;
      if (kind === 0) {
        traps.push({ id, x: x - 70, y: y + 14, w: 140, h: LANE - 28, phase: Math.round(rng() * 30) / 10 });
        decor.push({ kind: "hazard", x: x - 70, y: y + 14, w: 140, h: LANE - 28 });
      } else if (kind === 1) {
        pits.push({ id, x: x - 45, y, w: 90, h: LANE });
      } else {
        sweepers.push({
          id,
          x0: x,
          y0: y + 50,
          x1: x,
          y1: y + LANE - 50,
          w: 34,
          h: 110,
          periodSec: 1.8 + rng() * 1.2,
          phase: Math.round(rng() * 20) / 10,
        });
      }
    }
  }
  const start: Rect = { x: T, y: laneY(0), w: 260, h: LANE };
  const checkpoints: Vec2[] = [
    { x: 150, y: laneY(0) + LANE / 2 },
    { x: W - 150, y: laneY(1) + LANE / 2 },
    { x: 150, y: laneY(2) + LANE / 2 },
  ];
  const exit = { x: W - 140, y: laneY(2) + LANE / 2, r: 90 };
  const maze: MazeDef = {
    size: "m",
    seed,
    cols: 0,
    rows: 0,
    start,
    exit,
    gates: [],
    checkpoints,
    traps,
    route: 3,
    lair: { x: W / 2, y: laneY(1) + LANE / 2 },
    pits,
    sweepers,
  };
  const lights: LightDef[] = checkpoints.map((c) => ({ ...c, radius: 260, color: 0x9fd8ff, intensity: 0.4 }));
  lights.push({ x: exit.x, y: exit.y, radius: 300, color: 0x7dffb0, intensity: 0.5 });
  return {
    ...baseDef(
      `parkour-${seed}` as MapId,
      "Parkour Course",
      `Three lanes, seed ${seed}: traps, gaps, moving bars.`,
      W,
      H,
    ),
    solids,
    decor: [{ kind: "paint", ...start, tone: 1 }, ...decor],
    lights,
    spawns: grid9(start),
    modes: ["parkour"],
    maze,
  };
}

/** Three rooms: a hidden key, two pressure plates held together, a coded switch sequence. */
function buildEscape(seed: number): MapDef {
  const rng = mulberry32(seed * 13 + 5);
  const RW = 640;
  const RH = 560;
  const EXIT_W = 300;
  const W = 3 * RW + 4 * T + EXIT_W;
  const H = RH + 2 * T;
  const roomX = (i: number) => T + i * (RW + T);
  const DOOR = 160;
  const dy = T + RH / 2 - DOOR / 2;
  const solids: SolidDef[] = [
    { kind: "wall", x: 0, y: 0, w: W, h: T },
    { kind: "wall", x: 0, y: H - T, w: W, h: T },
    { kind: "wall", x: 0, y: 0, w: T, h: H },
    { kind: "wall", x: W - T, y: 0, w: T, h: H },
  ];
  // Dividers with a doorway in the middle (the gates fill them).
  const gateRect = (i: number): Rect => ({ x: roomX(i) + RW, y: dy, w: T, h: DOOR });
  for (let i = 0; i < 3; i++) {
    const x = roomX(i) + RW;
    solids.push(
      { kind: "wall", x, y: T, w: T, h: dy - T },
      { kind: "wall", x, y: dy + DOOR, w: T, h: H - T - dy - DOOR },
    );
  }
  // Room 1: the key behind crates in a corner.
  const corner = rng() < 0.5;
  const kx = roomX(0) + RW - 70;
  const ky = corner ? T + 70 : H - T - 70;
  solids.push(
    { kind: "crate", x: kx - 150, y: corner ? T + 10 : H - T - 66, w: 56, h: 56 },
    { kind: "crate", x: kx - 150, y: corner ? T + 130 : H - T - 186, w: 56, h: 56 },
    { kind: "desk", x: roomX(0) + 360, y: T + RH / 2 - 30, w: 140, h: 60 },
  );
  // Room 2: two plates far apart, the clue terminal.
  const plates = [
    { x: roomX(1) + 90, y: T + 90 },
    { x: roomX(1) + RW - 90, y: H - T - 90 },
  ];
  // Room 3: three switches A, B, C; the code is a permutation from the seed.
  const switches = [
    { x: roomX(2) + 70, y: T + 60 },
    { x: roomX(2) + RW - 70, y: T + 60 },
    { x: roomX(2) + RW / 2, y: H - T - 60 },
  ];
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const letters = order.map((i) => "ABC"[i]).join(" · ");
  const gates: MazeGate[] = [
    {
      id: "gate-a",
      label: "Storage door",
      color: 0xffb347,
      ...gateRect(0),
      opener: { kind: "key", x: kx, y: ky },
    },
    {
      id: "gate-b",
      label: "Lab door",
      color: 0x7dffb0,
      ...gateRect(1),
      opener: { kind: "plates", x: plates[0]!.x, y: plates[0]!.y, points: plates },
    },
    {
      id: "gate-c",
      label: "Exit door",
      color: 0x4fd8ff,
      ...gateRect(2),
      opener: { kind: "sequence", x: switches[0]!.x, y: switches[0]!.y, points: switches, order },
    },
  ];
  solids.push({ kind: "machine", x: roomX(1) + RW / 2 - 60, y: T + RH / 2 - 40, w: 120, h: 80 });
  const start: Rect = { x: roomX(0) + 20, y: T + 140, w: 260, h: RH - 280 };
  const exit = { x: W - T - EXIT_W / 2, y: H / 2, r: 100 };
  const maze: MazeDef = {
    size: "s",
    seed,
    cols: 0,
    rows: 0,
    start,
    exit,
    gates,
    checkpoints: [
      { x: roomX(0) + 150, y: H / 2 },
      { x: roomX(1) + 80, y: H / 2 },
      { x: roomX(2) + 80, y: H / 2 },
    ],
    traps: [],
    route: 3,
    lair: { x: roomX(1) + RW - 120, y: T + 100 },
    clue: { x: roomX(1) + RW / 2, y: T + RH / 2 + 70, text: `Code: ${letters}` },
  };
  const lights: LightDef[] = [0, 1, 2].map((i) => ({
    x: roomX(i) + RW / 2,
    y: H / 2,
    radius: 380,
    color: 0xffe2b0,
    intensity: 0.4,
  }));
  return {
    ...baseDef(
      `escape-${seed}` as MapId,
      "Escape Room",
      `Three locked rooms, seed ${seed}. Work together.`,
      W,
      H,
    ),
    players: { min: 2, max: 4 },
    solids,
    decor: [{ kind: "paint", ...start, tone: 1 }],
    lights,
    spawns: grid9(start),
    modes: ["escape"],
    maze,
  };
}
