import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Tactical Facility: a fenced industrial compound around a four-block facility with cross
 * corridors. Fences stop movement but not bullets; vehicles get in through the gates. Authored as
 * the west half and point-mirrored.
 */
const W = 3072;
const H = 2048;

const halfSolids: SolidDef[] = [
  // Perimeter fence with a vehicle gate (y 800-1100)
  { kind: "fence", x: 400, y: 120, w: 12, h: 680 },
  { kind: "fence", x: 400, y: 1100, w: 12, h: 760 },
  // Plant
  { kind: "machine", x: 600, y: 300, w: 160, h: 120 },
  { kind: "machine", x: 900, y: 250, w: 120, h: 96 },
  { kind: "tank", x: 650, y: 1500, w: 128, h: 128 },
  { kind: "tank", x: 850, y: 1650, w: 112, h: 112 },
  { kind: "container", x: 1000, y: 600, w: 240, h: 72, tone: 0 },
  { kind: "container", x: 1000, y: 760, w: 240, h: 72, tone: 1 },
  { kind: "container", x: 1300, y: 380, w: 72, h: 240, tone: 2 },
  // Facility blocks (with their mirrors: four blocks around a cross corridor)
  { kind: "building", x: 1240, y: 880, w: 220, h: 100, tone: 3 },
  { kind: "building", x: 1240, y: 1068, w: 220, h: 100, tone: 0 },
  // Cover
  { kind: "wall", x: 700, y: 900, w: 200, h: 24 },
  { kind: "wall", x: 1100, y: 1300, w: 24, h: 200 },
  { kind: "crate", x: 560, y: 700, w: 56, h: 56 },
  { kind: "crate", x: 1150, y: 1500, w: 56, h: 56 },
  { kind: "fence", x: 1000, y: 1880, w: 400, h: 12 },
];

const halfDecor: DecorDef[] = [
  { kind: "road", x: 180, y: 860, w: 1060, h: 180 },
  { kind: "lane", x: 180, y: 942, w: 1060, h: 16 },
  { kind: "hazard", x: 412, y: 800, w: 16, h: 300 },
  { kind: "grate", x: 860, y: 450, w: 160, h: 90 },
  { kind: "cables", x: 760, y: 360, w: 140, h: 12 },
  { kind: "paint", x: 600, y: 1460, w: 400, h: 340, tone: 3 },
  { kind: "verge", x: 0, y: 0, w: 180, h: H },
];

const halfLights: LightDef[] = [
  { x: 680, y: 360, radius: 240, color: 0xffd9a0, intensity: 0.45 },
  { x: 410, y: 950, radius: 220, color: 0xff7a3d, intensity: 0.4, flicker: 0.15 },
  { x: 760, y: 1600, radius: 240, color: 0x9fd8ff, intensity: 0.4 },
  { x: 1200, y: 700, radius: 220, color: 0xffb36b, intensity: 0.35 },
];

const halfSpawns = [
  { x: 96, y: 150 },
  { x: 96, y: 450 },
  { x: 200, y: 720 },
  { x: 96, y: 1000 },
  { x: 200, y: 1250 },
  { x: 96, y: 1500 },
  { x: 200, y: 1750 },
  { x: 96, y: 1950 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 800, y: 1000, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 1150, y: 1120, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 500, y: 1000, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1350, y: 1700, respawnSec: 25 },
];

const halfVehicles: VehicleSpawnDef[] = [
  { id: "car-a", kind: "car", x: 300, y: 950, angle: 0 },
  { id: "apc-a", kind: "armored", x: 250, y: 400, angle: Math.PI / 2 },
];

export const TACTICAL_FACILITY: MapDef = {
  id: "facility",
  name: "Tactical Facility",
  tagline: "A fenced compound around a four-block facility. Fences stop boots, not bullets.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x2f3337,
    floorAlt: 0x363b40,
    grid: 0x40464c,
    wall: 0x535a61,
    wallTop: 0x737b84,
    shadow: 0x0a0b0d,
    ambient: 0x14171a,
    accents: [0xe0a33a, 0x2f6e8a, 0x8a8f3a, 0xc8622f],
    fog: 0x0e1012,
  },
  solids: withMirror(halfSolids, W, H),
  decor: withMirror(halfDecor, W, H),
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: W / 2, y: H / 2, radius: 260, color: 0xfff1d0, intensity: 0.5 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 324, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 324, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
