import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Mountain Outpost: boulder fields and dirt tracks around a fortified outpost in the middle.
 * Boulders are low (a helicopter flies over them); the outpost is tall. Each team has a rover, an
 * APC and a helicopter. Authored as the west half and point-mirrored.
 */
const W = 3328;
const H = 2304;

const halfSolids: SolidDef[] = [
  { kind: "rock", x: 400, y: 200, w: 220, h: 160 },
  { kind: "rock", x: 700, y: 420, w: 160, h: 140 },
  { kind: "rock", x: 300, y: 700, w: 180, h: 220 },
  { kind: "rock", x: 900, y: 800, w: 240, h: 160 },
  { kind: "rock", x: 520, y: 1100, w: 160, h: 120 },
  { kind: "rock", x: 1200, y: 300, w: 200, h: 160 },
  { kind: "rock", x: 1300, y: 620, w: 140, h: 120 },
  { kind: "rock", x: 420, y: 1500, w: 220, h: 180 },
  { kind: "rock", x: 800, y: 1700, w: 260, h: 160 },
  { kind: "rock", x: 1150, y: 1500, w: 180, h: 150 },
  { kind: "rock", x: 1400, y: 1900, w: 200, h: 160 },
  { kind: "rock", x: 350, y: 2000, w: 180, h: 140 },
  { kind: "sandbag", x: 1100, y: 1100, w: 32, h: 120 },
  { kind: "sandbag", x: 1350, y: 850, w: 140, h: 32 },
  { kind: "pillar", x: 900, y: 1300, w: 48, h: 48 },
  { kind: "ruin", x: 1500, y: 1250, w: 120, h: 90 },
];

const halfDecor: DecorDef[] = [
  { kind: "tracks", x: 260, y: 1100, w: 1200, h: 60 },
  { kind: "tracks", x: 200, y: 560, w: 60, h: 1200 },
  { kind: "sand", x: 600, y: 600, w: 400, h: 300 },
  { kind: "sand", x: 1000, y: 1700, w: 360, h: 260 },
  { kind: "helipad", x: 124, y: 1654, w: 192, h: 192 },
  { kind: "verge", x: 0, y: 0, w: 260, h: H },
  { kind: "stain", x: 1250, y: 1150, w: 120, h: 60 },
];

const halfLights: LightDef[] = [
  { x: 220, y: 1750, radius: 240, color: 0x9fe7ff, intensity: 0.4 },
  { x: 230, y: 1152, radius: 240, color: 0xffd9a0, intensity: 0.4 },
  { x: 1000, y: 1120, radius: 220, color: 0xffb36b, intensity: 0.35, flicker: 0.1 },
];

const halfSpawns = [
  { x: 96, y: 150 },
  { x: 96, y: 450 },
  { x: 96, y: 760 },
  { x: 96, y: 1000 },
  { x: 96, y: 1300 },
  { x: 96, y: 1550 },
  { x: 96, y: 1950 },
  { x: 96, y: 2200 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 800, y: 650, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 1000, y: 1300, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 650, y: 1350, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1300, y: 520, respawnSec: 25 },
];

const halfVehicles: VehicleSpawnDef[] = [
  { id: "rover-a", kind: "offroad", x: 220, y: 600, angle: 0 },
  { id: "apc-a", kind: "armored", x: 230, y: 1152, angle: 0 },
  { id: "heli-a", kind: "heli", x: 220, y: 1750, angle: 0 },
];

export const MOUNTAIN_OUTPOST: MapDef = {
  id: "mountain",
  name: "Mountain Outpost",
  tagline: "Boulder fields, dirt tracks and a fortified outpost to fight over.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x3a3a2e,
    floorAlt: 0x424234,
    grid: 0x4a4a3b,
    wall: 0x5d5a48,
    wallTop: 0x7b7760,
    shadow: 0x0c0c08,
    ambient: 0x171711,
    accents: [0xc8622f, 0x4f7a8a, 0x8a8f3a, 0xd9a441],
    fog: 0x10100c,
  },
  solids: [
    ...withMirror(halfSolids, W, H),
    // The outpost: point-symmetric on its own
    { kind: "building", x: W / 2 - 110, y: H / 2 - 80, w: 220, h: 160, tone: 1 },
  ],
  decor: withMirror(halfDecor, W, H),
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: W / 2, y: H / 2, radius: 320, color: 0xfff1d0, intensity: 0.45 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 252, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 252, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
