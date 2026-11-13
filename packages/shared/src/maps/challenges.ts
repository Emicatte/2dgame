import type { Rect, Vec2 } from "../sim/math.ts";
import { mulberry32 } from "../sim/rng.ts";
import type { MazeDef, MazeGate, MazeLaser, MazeSweeper, MazeTrap } from "./maze.ts";
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
/**
 * Parkour course: four lanes in a snake, each a run of patterns that get harder lane by lane:
 * gaps and double gaps (jump), spike strips (jump or time them), low lasers (jump), blinking
 * laser gates and moving bars (time or dodge, a jump does not help), slaloms between blocks and
 * narrow bridges over a gap. Checkpoints at the start and the middle of every lane.
 */
function buildCourse(seed: number): MapDef {
  const rng = mulberry32(seed * 7 + 3);
  const W = 3200;
  const LANE = 240;
  const LANES = 4;
  const H = LANES * (LANE + T) + T;
  const laneY = (j: number) => T + j * (LANE + T);
  const solids: SolidDef[] = [
    { kind: "wall", x: 0, y: 0, w: W, h: T },
    { kind: "wall", x: 0, y: H - T, w: W, h: T },
    { kind: "wall", x: 0, y: 0, w: T, h: H },
    { kind: "wall", x: W - T, y: 0, w: T, h: H },
  ];
  // Lane j runs left→right when even; the wall below it leaves the turn open at its end.
  for (let j = 0; j < LANES - 1; j++)
    solids.push({ kind: "wall", x: j % 2 ? LANE + T : 0, y: laneY(j + 1) - T, w: W - LANE - T, h: T });
  const traps: MazeTrap[] = [];
  const pits: (Rect & { id: string })[] = [];
  const sweepers: MazeSweeper[] = [];
  const lasers: MazeLaser[] = [];
  const decor: DecorDef[] = [];
  const r = (a: number, b: number) => a + rng() * (b - a);
  const phase = () => Math.round(rng() * 30) / 10;
  const SLOT = 230;
  const x0 = LANE + T + 140;
  const x1 = W - LANE - T - 140;
  const mid = W / 2;
  const checkpoints: Vec2[] = [];
  for (let j = 0; j < LANES; j++) {
    const y = laneY(j);
    const ltr = j % 2 === 0;
    checkpoints.push({ x: ltr ? 150 : W - 150, y: y + LANE / 2 }, { x: mid, y: y + LANE / 2 });
    const pool = j === 0 ? 5 : 8;
    let n = 0;
    for (let x = x0; x <= x1; x += SLOT) {
      if (Math.abs(x - mid) < SLOT * 0.75) continue; // the middle checkpoint pad stays clear
      const id = `h-${j}-${n++}`;
      const gap = r(90, 110) + j * 8;
      switch (Math.floor(rng() * pool)) {
        case 0:
          pits.push({ id, x: x - gap / 2, y, w: gap, h: LANE });
          break;
        case 1:
          traps.push({ id, x: x - 60, y, w: 120, h: LANE, phase: phase() });
          decor.push({ kind: "hazard", x: x - 60, y, w: 120, h: LANE });
          break;
        case 2:
          lasers.push({ id, x: x - 4, y, w: 8, h: LANE, low: true, onSec: 1, offSec: 0, phase: 0 });
          break;
        case 3:
          sweepers.push({
            id,
            x0: x,
            y0: y + 48,
            x1: x,
            y1: y + LANE - 48,
            w: 30,
            h: 96,
            periodSec: r(1.4, 2.2),
            phase: phase(),
          });
          break;
        case 4:
          solids.push(
            { kind: "wall", x: x - 70, y, w: 36, h: LANE * 0.62 },
            { kind: "wall", x: x + 34, y: y + LANE * 0.38, w: 36, h: LANE * 0.62 },
          );
          break;
        case 5:
          pits.push(
            { id: `${id}a`, x: x - 100, y, w: 80, h: LANE },
            { id: `${id}b`, x: x + 20, y, w: 80, h: LANE },
          );
          break;
        case 6:
          lasers.push({
            id,
            x: x - 4,
            y,
            w: 8,
            h: LANE,
            low: false,
            onSec: r(0.9, 1.3),
            offSec: r(1, 1.4),
            phase: phase(),
          });
          break;
        default: {
          // A narrow bridge over a wide gap: walk the strip or jump the gap.
          const bridge = 54;
          const top = r(40, LANE - 40 - bridge);
          pits.push(
            { id: `${id}a`, x: x - 80, y, w: 160, h: top },
            { id: `${id}b`, x: x - 80, y: y + top + bridge, w: 160, h: LANE - top - bridge },
          );
        }
      }
    }
  }
  const start: Rect = { x: T, y: laneY(0), w: 240, h: LANE };
  const last = LANES - 1;
  const exit = { x: last % 2 ? 140 : W - 140, y: laneY(last) + LANE / 2, r: 90 };
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
    route: LANES,
    lair: { x: mid, y: laneY(1) + LANE / 2 },
    pits,
    sweepers,
    lasers,
  };
  const lights: LightDef[] = checkpoints.map((c) => ({ ...c, radius: 240, color: 0x9fd8ff, intensity: 0.4 }));
  lights.push({ x: exit.x, y: exit.y, radius: 300, color: 0x7dffb0, intensity: 0.5 });
  return {
    ...baseDef(
      `parkour-${seed}` as MapId,
      "Parkour Course",
      `Four lanes, seed ${seed}: gaps, spikes, lasers, moving bars, slaloms.`,
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
