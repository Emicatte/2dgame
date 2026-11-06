import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";

/**
 * Halvorsen Works: the industrial complex of Outbreak's first mission (First Contact). Authored as
 * a route, not mirrored: insertion yard (south-west) → main hall → generator room (north-west) →
 * courtyard → offices (east) → security compound with the extraction pad (north-east).
 *
 * Doors that missions open or close (generator shutter, office door, security gate) are NOT solids
 * here: they live in the mission definition and are added to the collision world while closed.
 */

const W = 3200;
const H = 2240;
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

const solids: SolidDef[] = [
  // Perimeter wall.
  { kind: "wall", x: 0, y: 0, w: W, h: T },
  { kind: "wall", x: 0, y: H - T, w: W, h: T },
  { kind: "wall", x: 0, y: 0, w: T, h: H },
  { kind: "wall", x: W - T, y: 0, w: T, h: H },

  // Generator room (north-west). South doorway to the hall corridor; east doorway = the
  // generator shutter (mission door, closed until the power is back).
  ...room(140, 120, 760, 500, { s: [[160, 280]], e: [[180, 320]] }),
  { kind: "machine", x: 360, y: 190, w: 150, h: 96 },
  { kind: "tank", x: 196, y: 440, w: 72, h: 72 },
  { kind: "crate", x: 690, y: 170, w: 64, h: 64 },
  { kind: "crate", x: 754, y: 170, w: 64, h: 64 },
  { kind: "machine", x: 640, y: 470, w: 120, h: 64 },

  // Main hall (warehouse). North doorway lines up with the generator room, south doorway to the
  // insertion yard, east doorway to the courtyard.
  ...room(140, 760, 960, 660, { n: [[160, 280]], s: [[380, 540]], e: [[240, 400]] }),
  { kind: "crate", x: 230, y: 900, w: 200, h: 44 },
  { kind: "crate", x: 230, y: 1060, w: 200, h: 44 },
  { kind: "container", x: 560, y: 880, w: 64, h: 220, tone: 1 },
  { kind: "crate", x: 740, y: 900, w: 200, h: 44 },
  { kind: "crate", x: 740, y: 1200, w: 200, h: 44 },
  { kind: "machine", x: 260, y: 1230, w: 160, h: 64 },

  // North yard behind the generator room: a container row hides the north spawn lane.
  { kind: "container", x: 1180, y: 210, w: 300, h: 64, tone: 2 },
  { kind: "container", x: 1560, y: 210, w: 300, h: 64, tone: 0 },
  { kind: "container", x: 1940, y: 120, w: 64, h: 240, tone: 3 },
  { kind: "crate", x: 1000, y: 380, w: 64, h: 64 },

  // Courtyard cover.
  { kind: "sandbag", x: 1290, y: 760, w: 150, h: 30 },
  { kind: "sandbag", x: 1480, y: 1140, w: 30, h: 150 },
  { kind: "crate", x: 1720, y: 680, w: 72, h: 72 },
  { kind: "tank", x: 1580, y: 880, w: 92, h: 92 },
  { kind: "crate", x: 1820, y: 1290, w: 96, h: 64 },
  { kind: "car", x: 1300, y: 1340, w: 112, h: 56 },
  { kind: "container", x: 1940, y: 920, w: 64, h: 190, tone: 1 },

  // Offices (east). West door = office door (mission door, opens after the courtyard is held).
  ...room(2200, 1180, 760, 600, { w: [[200, 340]] }),
  { kind: "wall", x: 2520, y: 1180, w: T, h: 250 },
  { kind: "crate", x: 2320, y: 1280, w: 120, h: 50 },
  { kind: "crate", x: 2320, y: 1600, w: 120, h: 50 },
  { kind: "crate", x: 2620, y: 1260, w: 130, h: 50 },
  { kind: "crate", x: 2640, y: 1500, w: 50, h: 120 },
  { kind: "vending", x: 2880, y: 1220, w: 40, h: 60 },

  // Security compound (north-east): the south wall holds the security gate (mission door).
  { kind: "wall", x: 2200, y: 24, w: T, h: 976 },
  { kind: "wall", x: 2200, y: 976, w: 360, h: T },
  { kind: "wall", x: 2720, y: 976, w: W - T - 2720, h: T },
  { kind: "container", x: 2340, y: 140, w: 170, h: 64, tone: 0 },
  { kind: "container", x: 2340, y: 480, w: 64, h: 170, tone: 2 },
  { kind: "container", x: 2980, y: 700, w: 140, h: 64, tone: 3 },
  { kind: "pillar", x: 2620, y: 640, w: 48, h: 48 },

  // Insertion yard (south-west).
  { kind: "container", x: 560, y: 1590, w: 190, h: 64, tone: 3 },
  { kind: "container", x: 900, y: 1680, w: 64, h: 190, tone: 0 },
  { kind: "sandbag", x: 140, y: 1840, w: 130, h: 30 },
  { kind: "car", x: 700, y: 1990, w: 112, h: 56 },
  { kind: "crate", x: 1120, y: 1560, w: 64, h: 64 },

  // South-east storage yard.
  { kind: "container", x: 1400, y: 1700, w: 220, h: 64, tone: 2 },
  { kind: "container", x: 1760, y: 1880, w: 64, h: 220, tone: 1 },
  { kind: "container", x: 2120, y: 1880, w: 240, h: 64, tone: 0 },
  { kind: "container", x: 2560, y: 1900, w: 64, h: 200, tone: 3 },
  { kind: "crate", x: 2860, y: 1880, w: 64, h: 64 },
  { kind: "crate", x: 3010, y: 1420, w: 64, h: 64 },
];

const decor: DecorDef[] = [
  { kind: "road", x: 2224, y: 1000, w: 952, h: 180 },
  { kind: "lane", x: 2240, y: 1084, w: 920, h: 8 },
  { kind: "road", x: 1100, y: 1430, w: 180, h: 786 },
  { kind: "helipad", x: 2760, y: 230, w: 300, h: 300 },
  { kind: "hazard", x: 2560, y: 1000, w: 160, h: 14 },
  { kind: "hazard", x: 876, y: 300, w: 14, h: 140 },
  { kind: "hazard", x: 2210, y: 1380, w: 14, h: 140 },
  { kind: "grate", x: 330, y: 300, w: 220, h: 110 },
  { kind: "cables", x: 510, y: 236, w: 360, h: 10 },
  { kind: "cables", x: 900, y: 360, w: 240, h: 10 },
  { kind: "stain", x: 600, y: 1150, w: 140, h: 90 },
  { kind: "stain", x: 1650, y: 1050, w: 160, h: 100 },
  { kind: "stain", x: 2450, y: 1650, w: 120, h: 80 },
  { kind: "stain", x: 420, y: 1750, w: 150, h: 90 },
  { kind: "paint", x: 160, y: 1440, w: 920, h: 6, tone: 0 },
  { kind: "paint", x: 1120, y: 580, w: 1040, h: 6, tone: 1 },
  { kind: "grate", x: 1700, y: 1500, w: 200, h: 100 },
  { kind: "tracks", x: 1200, y: 1500, w: 900, h: 40 },
  { kind: "paint", x: 2240, y: 40, w: 6, h: 920, tone: 3 },
];

const lights: LightDef[] = [
  // Generator room, main hall and offices stay dark until the power is restored.
  { x: 430, y: 370, radius: 300, color: 0xffd9a0, intensity: 0.55, flicker: 0.2, group: "power" },
  { x: 380, y: 1000, radius: 320, color: 0xffd9a0, intensity: 0.5, group: "power" },
  { x: 860, y: 1150, radius: 300, color: 0xffd9a0, intensity: 0.5, flicker: 0.1, group: "power" },
  { x: 2580, y: 1460, radius: 340, color: 0xffd9a0, intensity: 0.5, group: "power" },
  // Emergency lights (always on, dim).
  { x: 300, y: 2000, radius: 300, color: 0xffb36b, intensity: 0.45 },
  { x: 1600, y: 1000, radius: 360, color: 0x9fd8ff, intensity: 0.3 },
  { x: 2620, y: 1080, radius: 240, color: 0xffb36b, intensity: 0.35, flicker: 0.3 },
  { x: 2910, y: 380, radius: 320, color: 0x7dffb0, intensity: 0.4 },
  { x: 1500, y: 1950, radius: 260, color: 0xffb36b, intensity: 0.3 },
  // Alarm beacons (pulse red while the alarm sounds).
  { x: 1300, y: 640, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 2050, y: 1350, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 2620, y: 940, radius: 220, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
];

const spawns = [
  { x: 220, y: 2000 },
  { x: 300, y: 2070 },
  { x: 380, y: 2000 },
  { x: 460, y: 2070 },
  { x: 220, y: 2130 },
  { x: 320, y: 2150 },
  { x: 420, y: 2140 },
  { x: 520, y: 2000 },
];

const pickups: PickupDef[] = [
  { id: "hp-yard", kind: "health", x: 1020, y: 2100, respawnSec: 45 },
  { id: "am-hall", kind: "ammo", x: 680, y: 1320, respawnSec: 35 },
  { id: "hp-gen", kind: "health", x: 800, y: 350, respawnSec: 45 },
  { id: "am-court", kind: "ammo", x: 1760, y: 1100, respawnSec: 30 },
  { id: "hp-court", kind: "health", x: 1250, y: 1000, respawnSec: 40 },
  { id: "wp-shotgun-hall", kind: "weapon", weapon: "shotgun", x: 940, y: 1320, respawnSec: 40 },
  { id: "wp-smg-court", kind: "weapon", weapon: "smg", x: 2080, y: 700, respawnSec: 40 },
  { id: "am-office", kind: "ammo", x: 2440, y: 1450, respawnSec: 30 },
  { id: "hp-sec", kind: "health", x: 2500, y: 820, respawnSec: 40 },
];

export const HALVORSEN_WORKS: MapDef = {
  id: "works",
  name: "Halvorsen Works",
  tagline: "An abandoned chemical plant. The night shift never clocked out.",
  width: W,
  height: H,
  theme: {
    floor: 0x2a2d30,
    floorAlt: 0x303337,
    grid: 0x3a3e43,
    wall: 0x4c5056,
    wallTop: 0x6a7078,
    shadow: 0x08090a,
    ambient: 0x0e1012,
    accents: [0x9a4a26, 0x2a5a6e, 0x6e7a2e, 0xb8862e],
    fog: 0x0a0b0d,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  large: true,
  pve: true,
};
