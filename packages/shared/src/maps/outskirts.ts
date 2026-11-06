import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";

/**
 * Kessler Road: the industrial road and outskirts of Outbreak's third mission (The Convoy).
 * Authored as a winding route for a vehicle: the depot (south-west) → north through the
 * warehouse district → the police roadblock → south through the outskirts → the pump station →
 * east over the river bridge → the bridgehead where the helicopter lands.
 */

const W = 6000;
const H = 2400;
const T = 24;

type Side = "n" | "s" | "e" | "w";

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
const tree = (x: number, y: number, s = 60): SolidDef => ({ kind: "rock", x, y, w: s, h: s });

const solids: SolidDef[] = [
  // Perimeter.
  { kind: "wall", x: 0, y: 0, w: W, h: T },
  { kind: "wall", x: 0, y: H - T, w: W, h: T },
  { kind: "wall", x: 0, y: 0, w: T, h: H },
  { kind: "wall", x: W - T, y: 0, w: T, h: H },

  // ---------------------------------------------------------------- the depot (south-west)
  // Chain-link fence with the gate opening onto the road east.
  { kind: "fence", x: T, y: 1460, w: 1076, h: T },
  { kind: "fence", x: 1076, y: 1460, w: T, h: 320 },
  { kind: "fence", x: 1076, y: 2020, w: T, h: H - T - 2020 },
  // Depot office (the truck keys), door to the yard on its east side.
  ...room(120, 1520, 360, 240, { e: [[80, 200]] }),
  { kind: "crate", x: 150, y: 1550, w: 56, h: 56 },
  { kind: "vending", x: 420, y: 1550, w: 36, h: 60 },
  { kind: "container", x: 140, y: 1840, w: 160, h: 60 },
  { kind: "container", x: 140, y: 1960, w: 160, h: 60 },
  { kind: "container", x: 980, y: 2140, w: 60, h: 160 },
  { kind: "crate", x: 560, y: 1560, w: 64, h: 64 },
  { kind: "crate", x: 880, y: 1620, w: 64, h: 64 },
  { kind: "machine", x: 640, y: 2200, w: 120, h: 80 },

  // ---------------------------------------------------------------- north-west lots
  { kind: "building", x: 200, y: 160, w: 560, h: 420 },
  { kind: "building", x: 980, y: 120, w: 640, h: 380 },
  { kind: "container", x: 300, y: 760, w: 160, h: 60 },
  { kind: "container", x: 520, y: 900, w: 60, h: 160 },
  { kind: "container", x: 900, y: 820, w: 160, h: 60 },
  { kind: "container", x: 1200, y: 1000, w: 160, h: 60 },
  { kind: "container", x: 1500, y: 700, w: 60, h: 160 },
  { kind: "container", x: 700, y: 1220, w: 160, h: 60 },
  { kind: "container", x: 1400, y: 1250, w: 160, h: 60 },
  car(1700, 1600),
  car(1750, 1100, true),

  // ---------------------------------------------------------------- the warehouse district
  // North of the east-west road: three warehouses split by two alleys.
  { kind: "building", x: 2200, y: 80, w: 520, h: 340 },
  { kind: "building", x: 2800, y: 80, w: 520, h: 340 },
  { kind: "building", x: 3400, y: 80, w: 560, h: 340 },
  // South of it: two warehouses split by an alley.
  { kind: "building", x: 2200, y: 800, w: 680, h: 640 },
  { kind: "building", x: 3000, y: 800, w: 700, h: 640 },
  // Road litter on the climb north and along the district.
  car(1900, 1250, true),
  car(2080, 900, true),
  car(2500, 500),
  car(3150, 660),
  { kind: "sandbag", x: 2700, y: 690, w: 120, h: 30 },
  // Police roadblock at the end of the district: the truck threads the gap.
  { kind: "sandbag", x: 3640, y: 484, w: 40, h: 56 },
  { kind: "sandbag", x: 3640, y: 660, w: 40, h: 60 },
  car(3720, 500),

  // ---------------------------------------------------------------- the outskirts
  // Houses, fences and trees west of the southbound road.
  { kind: "building", x: 2250, y: 1700, w: 300, h: 240 },
  { kind: "building", x: 2700, y: 1650, w: 280, h: 260 },
  { kind: "building", x: 3150, y: 1800, w: 300, h: 260 },
  { kind: "building", x: 3500, y: 1650, w: 240, h: 240 },
  { kind: "fence", x: 2250, y: 2000, w: 300, h: T },
  { kind: "fence", x: 3150, y: 2120, w: 300, h: T },
  tree(2620, 2060),
  tree(3000, 2200, 70),
  tree(2400, 2250),
  tree(3600, 2000),
  // East of the southbound road: fields and houses.
  { kind: "building", x: 4150, y: 160, w: 300, h: 260 },
  { kind: "building", x: 4600, y: 120, w: 380, h: 300 },
  { kind: "building", x: 4200, y: 700, w: 280, h: 240 },
  { kind: "building", x: 4650, y: 760, w: 300, h: 260 },
  { kind: "fence", x: 4100, y: 1000, w: 300, h: T },
  tree(4100, 1100),
  tree(4520, 1180, 64),
  tree(4900, 1150),
  tree(4320, 1320, 56),
  car(3790, 1150, true),
  { kind: "ruin", x: 3790, y: 1400, w: 60, h: 60 },

  // ---------------------------------------------------------------- the pump station
  { kind: "building", x: 4460, y: 1300, w: 300, h: 120 },
  { kind: "pillar", x: 4480, y: 1480, w: 32, h: 32 },
  { kind: "pillar", x: 4780, y: 1480, w: 32, h: 32 },
  { kind: "pillar", x: 4480, y: 1900, w: 32, h: 32 },
  { kind: "pillar", x: 4780, y: 1900, w: 32, h: 32 },
  { kind: "tank", x: 4950, y: 1460, w: 60, h: 60 },
  { kind: "building", x: 5000, y: 2000, w: 140, h: 300 },
  { kind: "container", x: 4200, y: 2100, w: 160, h: 60 },
  { kind: "container", x: 4500, y: 2200, w: 60, h: 140 },

  // ---------------------------------------------------------------- the river and the bridge
  { kind: "water", x: 5150, y: T, w: 550, h: 1580 - T },
  { kind: "water", x: 5150, y: 1820, w: 550, h: H - T - 1820 },
  car(5400, 1600),

  // ---------------------------------------------------------------- the bridgehead
  { kind: "sandbag", x: 5720, y: 1500, w: 36, h: 76 },
  { kind: "sandbag", x: 5720, y: 1824, w: 36, h: 90 },
  { kind: "container", x: 5880, y: 1300, w: 90, h: 60 },
  tree(5800, 600, 70),
  tree(5880, 2100),
];

const decor: DecorDef[] = [
  { kind: "road", x: 1100, y: 1780, w: 1020, h: 240 },
  { kind: "road", x: 1880, y: 480, w: 240, h: 1540 },
  { kind: "road", x: 1880, y: 480, w: 2140, h: 240 },
  { kind: "road", x: 3780, y: 480, w: 240, h: 1340 },
  { kind: "road", x: 3780, y: 1580, w: W - T - 3780, h: 240 },
  { kind: "road", x: 4380, y: 1440, w: 500, h: 540 },
  { kind: "lane", x: 1100, y: 1896, w: 1020, h: 8 },
  { kind: "lane", x: 1996, y: 480, w: 8, h: 1540 },
  { kind: "lane", x: 1880, y: 596, w: 2140, h: 8 },
  { kind: "lane", x: 3896, y: 480, w: 8, h: 1340 },
  { kind: "lane", x: 3780, y: 1696, w: W - T - 3780, h: 8 },
  { kind: "verge", x: 4020, y: 1000, w: 1130, h: 580 },
  { kind: "verge", x: 2120, y: 1940, w: 1660, h: 436 },
  { kind: "hazard", x: 3640, y: 540, w: 40, h: 120 },
  { kind: "hazard", x: 1076, y: 1780, w: T, h: 240 },
  { kind: "helipad", x: 5760, y: 1600, w: 200, h: 200 },
  { kind: "stain", x: 2000, y: 1500, w: 120, h: 80 },
  { kind: "stain", x: 2900, y: 600, w: 140, h: 90 },
  { kind: "stain", x: 4620, y: 1740, w: 160, h: 90 },
  { kind: "bones", x: 3880, y: 1300, w: 60, h: 40 },
  { kind: "bones", x: 5500, y: 1700, w: 60, h: 40 },
  { kind: "puddle", x: 4560, y: 1600, w: 180, h: 80 },
  { kind: "tracks", x: 1880, y: 1100, w: 240, h: 400 },
  { kind: "grate", x: 3300, y: 560, w: 60, h: 40 },
];

const lights: LightDef[] = [
  // Depot floodlight and the office lamp.
  { x: 700, y: 1880, radius: 340, color: 0xffd9a0, intensity: 0.5, flicker: 0.1 },
  { x: 300, y: 1640, radius: 220, color: 0xffe2b0, intensity: 0.45, flicker: 0.3 },
  // Warehouse district: sodium lamps, half of them dead.
  { x: 2000, y: 1300, radius: 260, color: 0xffb36b, intensity: 0.4, flicker: 0.4 },
  { x: 2600, y: 600, radius: 260, color: 0xffb36b, intensity: 0.4 },
  { x: 3300, y: 600, radius: 240, color: 0xffb36b, intensity: 0.3, flicker: 0.6 },
  // The roadblock: police lights.
  { x: 3700, y: 600, radius: 240, color: 0x5d8cff, intensity: 0.5, flicker: 0.5 },
  { x: 3760, y: 520, radius: 200, color: 0xff3d3d, intensity: 0.45, flicker: 0.5 },
  // Outskirts: a porch light, a burning car.
  { x: 4340, y: 960, radius: 220, color: 0xffd9a0, intensity: 0.35 },
  { x: 3900, y: 1180, radius: 260, color: 0xff8a3d, intensity: 0.5, flicker: 0.6 },
  // Pump station canopy (white) and its sign.
  { x: 4630, y: 1700, radius: 380, color: 0xe8f0ff, intensity: 0.45, flicker: 0.15 },
  { x: 4610, y: 1360, radius: 200, color: 0xff5a4a, intensity: 0.45 },
  // Bridge lamps and the helipad beacon.
  { x: 5300, y: 1700, radius: 220, color: 0xffd9a0, intensity: 0.35, flicker: 0.3 },
  { x: 5560, y: 1700, radius: 220, color: 0xffd9a0, intensity: 0.3 },
  { x: 5860, y: 1700, radius: 320, color: 0x7dffb0, intensity: 0.5 },
];

const spawns = [
  { x: 220, y: 2120 },
  { x: 300, y: 2180 },
  { x: 380, y: 2120 },
  { x: 460, y: 2180 },
  { x: 220, y: 2260 },
  { x: 300, y: 2320 },
  { x: 380, y: 2260 },
  { x: 460, y: 2320 },
];

const pickups: PickupDef[] = [
  { id: "am-depot", kind: "ammo", x: 900, y: 1760, respawnSec: 30 },
  { id: "hp-office", kind: "health", x: 380, y: 1700, respawnSec: 45 },
  { id: "wp-smg-depot", kind: "weapon", weapon: "smg", x: 560, y: 1700, respawnSec: 40 },
  { id: "am-roadblock", kind: "ammo", x: 3860, y: 680, respawnSec: 30 },
  { id: "hp-roadblock", kind: "health", x: 3960, y: 520, respawnSec: 40 },
  { id: "am-pump", kind: "ammo", x: 4420, y: 1950, respawnSec: 25 },
  { id: "hp-pump", kind: "health", x: 4840, y: 1950, respawnSec: 35 },
  { id: "wp-shotgun-pump", kind: "weapon", weapon: "shotgun", x: 4840, y: 1470, respawnSec: 40 },
  { id: "am-bank", kind: "ammo", x: 5900, y: 1480, respawnSec: 25 },
  { id: "hp-bank", kind: "health", x: 5900, y: 1940, respawnSec: 35 },
];

/** The convoy truck: an armored carrier (driver, roof gun, two seats). */
const vehicleSpawns: VehicleSpawnDef[] = [{ id: "cv-truck", kind: "armored", x: 760, y: 1900, angle: 0 }];

export const KESSLER_ROAD: MapDef = {
  id: "outskirts",
  name: "Kessler Road",
  tagline: "Twelve kilometres of industrial road and nobody left to drive it.",
  width: W,
  height: H,
  theme: {
    floor: 0x272a27,
    floorAlt: 0x2d302c,
    grid: 0x363a35,
    wall: 0x4a4e48,
    wallTop: 0x646a62,
    shadow: 0x070807,
    ambient: 0x0d0f0c,
    accents: [0x9a5a26, 0x2a5a6e, 0x6e7a2e, 0xb8862e],
    fog: 0x0a0b09,
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
