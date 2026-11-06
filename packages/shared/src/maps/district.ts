import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";

/**
 * Dead District: the abandoned city of Outbreak's second mission. Authored as a route, not
 * mirrored: insertion at the west end of the avenue → Marlow apartments (survivors holed up) →
 * St. Anne clinic across the avenue → the intersection to defend → the garage with the
 * survivors' truck → east along the avenue, south down the side street (the overpass has
 * collapsed), east on the river road → the military checkpoint.
 *
 * Mission doors (clinic, garage, checkpoint gate) are NOT solids here: the mission adds them to
 * the collision world while closed.
 */

const W = 4800;
const H = 2560;
const T = 24;

type Side = "n" | "s" | "e" | "w";

/** Four walls of a room, each side split around its doorway gaps ([from, to] along the side). */
function room(
  x: number,
  y: number,
  w: number,
  h: number,
  gaps: Partial<Record<Side, [number, number][]>> = {},
  kind: SolidDef["kind"] = "wall",
): SolidDef[] {
  const out: SolidDef[] = [];
  const run = (side: Side, len: number, place: (a: number, b: number) => SolidDef) => {
    const cuts = [...(gaps[side] ?? [])].sort((p, q) => p[0] - q[0]);
    let at = 0;
    for (const [a, b] of cuts) {
      if (a > at) out.push(place(at, a));
      at = b;
    }
    if (at < len) out.push(place(at, len));
  };
  run("n", w, (a, b) => ({ kind, x: x + a, y, w: b - a, h: T }));
  run("s", w, (a, b) => ({ kind, x: x + a, y: y + h - T, w: b - a, h: T }));
  run("w", h, (a, b) => ({ kind, x, y: y + a, w: T, h: b - a }));
  run("e", h, (a, b) => ({ kind, x: x + w - T, y: y + a, w: T, h: b - a }));
  return out;
}

const car = (x: number, y: number, vertical = false): SolidDef =>
  vertical ? { kind: "car", x, y, w: 36, h: 72 } : { kind: "car", x, y, w: 72, h: 36 };

const solids: SolidDef[] = [
  // Perimeter.
  { kind: "wall", x: 0, y: 0, w: W, h: T },
  { kind: "wall", x: 0, y: H - T, w: W, h: T },
  { kind: "wall", x: 0, y: 0, w: T, h: H },
  { kind: "wall", x: W - T, y: 0, w: T, h: H },
  // The river along the south edge: stops anything on foot or wheels, shots and sight pass.
  { kind: "water", x: T, y: 2440, w: W - 2 * T, h: H - T - 2440 },

  // ---------------------------------------------------------------- north of the avenue
  // Parking lot (west): wrecked cars.
  car(90, 420),
  car(250, 380, true),
  car(120, 640),
  car(330, 700),
  car(150, 900, true),
  car(380, 960),
  // Marlow apartments: one entrance from the avenue (south), the survivors' barricade inside.
  ...room(520, 360, 740, 700, { s: [[300, 460]] }),
  { kind: "sandbag", x: 560, y: 580, w: 230, h: 36 },
  { kind: "sandbag", x: 990, y: 580, w: 230, h: 36 },
  { kind: "crate", x: 600, y: 420, w: 56, h: 56 },
  { kind: "crate", x: 1140, y: 420, w: 56, h: 56 },
  { kind: "vending", x: 560, y: 900, w: 40, h: 70 },
  { kind: "crate", x: 1120, y: 860, w: 64, h: 64 },
  { kind: "pillar", x: 760, y: 760, w: 40, h: 40 },
  { kind: "pillar", x: 1000, y: 760, w: 40, h: 40 },
  // Blocks east of the north street, split by footpaths and the north alley.
  { kind: "building", x: 1700, y: 340, w: 290, h: 700 },
  { kind: "building", x: 2054, y: 340, w: 286, h: 700 },
  { kind: "building", x: 2480, y: 340, w: 380, h: 700 },
  { kind: "building", x: 2924, y: 340, w: 376, h: 700 },
  // North-east: the dead factory block (the avenue's north side beyond the overpass).
  { kind: "building", x: 3340, y: T, w: W - T - 3340, h: 1032 },
  // Litter in the back street and the north street.
  car(1820, 150),
  car(2700, 120),
  { kind: "container", x: 3060, y: 120, w: 140, h: 60 },
  car(1330, 560, true),
  { kind: "crate", x: 1540, y: 820, w: 48, h: 48 },

  // ---------------------------------------------------------------- the avenue
  // Abandoned cars and a burnt bus: cover, not walls (shots pass over the low ones).
  car(640, 1110),
  car(1080, 1370),
  car(2440, 1110),
  { kind: "ruin", x: 1700, y: 1180, w: 160, h: 56 },
  car(2960, 1320),
  { kind: "sandbag", x: 1350, y: 1110, w: 120, h: 32 },
  { kind: "sandbag", x: 1500, y: 1385, w: 120, h: 32 },
  // The collapsed overpass east of the side street: impassable for vehicles, the infected
  // squeeze through two gaps in the rubble.
  { kind: "ruin", x: 3500, y: 1080, w: 120, h: 56 },
  { kind: "ruin", x: 3500, y: 1192, w: 120, h: 104 },
  { kind: "ruin", x: 3500, y: 1352, w: 120, h: 68 },
  { kind: "rock", x: 3440, y: 1120, w: 56, h: 56 },
  { kind: "rock", x: 3624, y: 1300, w: 64, h: 56 },

  // ---------------------------------------------------------------- south of the avenue
  // Bus depot (west).
  { kind: "building", x: 200, y: 1500, w: 420, h: 380 },
  { kind: "ruin", x: 760, y: 1560, w: 200, h: 60 },
  { kind: "ruin", x: 980, y: 1700, w: 60, h: 200 },
  car(720, 1980),
  car(1100, 2060, true),
  car(400, 2200),
  { kind: "container", x: 840, y: 2260, w: 160, h: 60 },
  // St. Anne clinic: front door on the avenue (mission door), back door to the lot (open).
  ...room(1700, 1460, 600, 580, { n: [[220, 380]], s: [[420, 520]] }),
  { kind: "vending", x: 1740, y: 1500, w: 40, h: 64 },
  { kind: "crate", x: 1760, y: 1600, w: 120, h: 40 },
  { kind: "crate", x: 2100, y: 1700, w: 40, h: 120 },
  { kind: "crate", x: 1880, y: 1860, w: 120, h: 40 },
  { kind: "machine", x: 2180, y: 1500, w: 80, h: 56 },
  // Garage: wide door on the avenue (mission door), the survivors' truck inside.
  ...room(2400, 1460, 560, 520, { n: [[150, 410]] }),
  { kind: "machine", x: 2440, y: 1840, w: 110, h: 90 },
  { kind: "crate", x: 2860, y: 1840, w: 64, h: 64 },
  { kind: "tank", x: 2880, y: 1520, w: 50, h: 50 },
  // Block between the garage and the side street.
  { kind: "building", x: 2984, y: 1444, w: 232, h: 632 },
  // Side street barricade (a gap the truck fits through).
  { kind: "sandbag", x: 3240, y: 1700, w: 70, h: 36 },
  { kind: "sandbag", x: 3410, y: 1700, w: 70, h: 36 },
  // Blocks between the east avenue and the river road, split by the east alley.
  { kind: "building", x: 3500, y: 1444, w: 460, h: 632 },
  { kind: "building", x: 4080, y: 1444, w: W - T - 4080, h: 616 },
  // River road wrecks (the truck weaves between them).
  car(3640, 2140),
  car(3820, 2340),
  car(4060, 2140, true),
  { kind: "ruin", x: 2200, y: 2300, w: 160, h: 50 },
  car(2620, 2140),
  car(1900, 2340),

  // ---------------------------------------------------------------- the checkpoint
  // West wall with the gate (mission door between y 2100 and 2380).
  { kind: "wall", x: 4400, y: 2060, w: T, h: 40 },
  { kind: "wall", x: 4400, y: 2380, w: T, h: 60 },
  { kind: "sandbag", x: 4500, y: 2140, w: 36, h: 90 },
  { kind: "sandbag", x: 4500, y: 2300, w: 36, h: 90 },
  { kind: "container", x: 4660, y: 2100, w: 90, h: 60 },
];

const decor: DecorDef[] = [
  // Roads under everything.
  { kind: "road", x: T, y: 1080, w: 3476, h: 340 },
  { kind: "road", x: 3620, y: 1080, w: W - T - 3620, h: 340 },
  { kind: "road", x: 1300, y: T, w: 320, h: 1056 },
  { kind: "road", x: 1300, y: 1420, w: 320, h: 656 },
  { kind: "road", x: 3240, y: 1420, w: 240, h: 656 },
  { kind: "road", x: 1300, y: 2076, w: 3100, h: 364 },
  { kind: "road", x: T, y: T, w: 3316, h: 300 },
  { kind: "lane", x: T, y: 1246, w: 3476, h: 8 },
  { kind: "lane", x: 1456, y: T, w: 8, h: 1056 },
  { kind: "lane", x: 1300, y: 2256, w: 3100, h: 8 },
  { kind: "crosswalk", x: 1300, y: 1040, w: 320, h: 40 },
  { kind: "crosswalk", x: 1300, y: 1420, w: 320, h: 40 },
  { kind: "crosswalk", x: 1260, y: 1080, w: 40, h: 340 },
  { kind: "crosswalk", x: 1620, y: 1080, w: 40, h: 340 },
  // Signs of what happened.
  { kind: "stain", x: 880, y: 1150, w: 120, h: 80 },
  { kind: "stain", x: 1480, y: 1240, w: 140, h: 90 },
  { kind: "stain", x: 2000, y: 1300, w: 100, h: 70 },
  { kind: "bones", x: 2260, y: 1180, w: 60, h: 40 },
  { kind: "bones", x: 3360, y: 1880, w: 60, h: 40 },
  { kind: "puddle", x: 2700, y: 1250, w: 160, h: 90 },
  { kind: "puddle", x: 3900, y: 2200, w: 140, h: 80 },
  { kind: "paint", x: 520, y: 1064, w: 740, h: 6, tone: 0 },
  { kind: "paint", x: 1700, y: 1444, w: 600, h: 6, tone: 2 },
  { kind: "hazard", x: 2550, y: 1430, w: 260, h: 24 },
  { kind: "hazard", x: 4400, y: 2080, w: 24, h: 340 },
  { kind: "helipad", x: 4520, y: 2160, w: 200, h: 200 },
  { kind: "grate", x: 700, y: 1180, w: 60, h: 40 },
  { kind: "grate", x: 3100, y: 1180, w: 60, h: 40 },
  { kind: "tracks", x: 3240, y: 1500, w: 240, h: 300 },
];

const lights: LightDef[] = [
  // Streetlights along the avenue; a few still work, some stutter.
  { x: 300, y: 1100, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 900, y: 1400, radius: 240, color: 0xffd9a0, intensity: 0.35, flicker: 0.5 },
  { x: 1460, y: 1100, radius: 280, color: 0xffd9a0, intensity: 0.45 },
  { x: 2700, y: 1400, radius: 240, color: 0xffd9a0, intensity: 0.4, flicker: 0.35 },
  { x: 3300, y: 1100, radius: 240, color: 0xffd9a0, intensity: 0.3, flicker: 0.7 },
  { x: 1460, y: 300, radius: 240, color: 0xffd9a0, intensity: 0.3, flicker: 0.4 },
  // The survivors' lantern in the apartments (the beacon to reach).
  { x: 890, y: 500, radius: 320, color: 0xffc070, intensity: 0.6, flicker: 0.15 },
  // St. Anne: the green cross over the door, a dying fluorescent inside.
  { x: 2000, y: 1430, radius: 220, color: 0x4dff9a, intensity: 0.55 },
  { x: 1980, y: 1760, radius: 300, color: 0x9fd8ff, intensity: 0.3, flicker: 0.5 },
  // Garage work light; red beacons when its door alarm goes off.
  { x: 2680, y: 1720, radius: 260, color: 0xffe2b0, intensity: 0.4 },
  { x: 2520, y: 1440, radius: 220, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 2840, y: 1440, radius: 220, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  // A wreck still burning on the river road.
  { x: 3676, y: 2158, radius: 280, color: 0xff8a3d, intensity: 0.55, flicker: 0.6 },
  // Checkpoint floodlights.
  { x: 4600, y: 2250, radius: 360, color: 0xd8ffe0, intensity: 0.55 },
  { x: 4300, y: 2250, radius: 220, color: 0xffd9a0, intensity: 0.35, flicker: 0.2 },
];

const spawns = [
  { x: 90, y: 1160 },
  { x: 170, y: 1210 },
  { x: 250, y: 1160 },
  { x: 330, y: 1210 },
  { x: 90, y: 1300 },
  { x: 170, y: 1350 },
  { x: 250, y: 1300 },
  { x: 330, y: 1350 },
];

const pickups: PickupDef[] = [
  { id: "am-avenue", kind: "ammo", x: 500, y: 1300, respawnSec: 35 },
  { id: "hp-lobby", kind: "health", x: 1180, y: 520, respawnSec: 45 },
  { id: "am-lobby", kind: "ammo", x: 640, y: 520, respawnSec: 30 },
  { id: "wp-shotgun-lobby", kind: "weapon", weapon: "shotgun", x: 890, y: 420, respawnSec: 40 },
  { id: "hp-clinic", kind: "health", x: 2220, y: 1960, respawnSec: 40 },
  { id: "am-plaza", kind: "ammo", x: 1460, y: 1330, respawnSec: 30 },
  { id: "wp-smg-north", kind: "weapon", weapon: "smg", x: 1460, y: 640, respawnSec: 40 },
  { id: "am-garage", kind: "ammo", x: 2780, y: 1890, respawnSec: 35 },
  { id: "hp-gate", kind: "health", x: 4700, y: 2400, respawnSec: 40 },
  { id: "am-gate", kind: "ammo", x: 4460, y: 2400, respawnSec: 30 },
];

/** The survivors' truck: an armored carrier with a roof gun, parked facing the garage door. */
const vehicleSpawns: VehicleSpawnDef[] = [
  { id: "dd-truck", kind: "armored", x: 2680, y: 1700, angle: -Math.PI / 2 },
];

export const DEAD_DISTRICT: MapDef = {
  id: "district",
  name: "Dead District",
  tagline: "Marlow Street. The lights still change; nobody crosses.",
  width: W,
  height: H,
  theme: {
    floor: 0x24272a,
    floorAlt: 0x2b2e32,
    grid: 0x33373c,
    wall: 0x464a50,
    wallTop: 0x60666e,
    shadow: 0x070809,
    ambient: 0x0c0e10,
    accents: [0x8a3a2a, 0x2a5070, 0x5e6a2a, 0xa8762a],
    fog: 0x090a0c,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  vehicleSpawns,
  large: true,
  pve: true,
};
