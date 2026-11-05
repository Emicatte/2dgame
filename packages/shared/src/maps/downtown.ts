import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Downtown: tight city blocks, long sight lines down the streets and alleys only infantry fits
 * through. One car and one rover per team for quick flanks. Authored as the west half and
 * point-mirrored.
 */
const W = 3328;
const H = 2560;

const halfSolids: SolidDef[] = [
  // Top row of blocks (y 0-512)
  { kind: "building", x: 424, y: 40, w: 240, h: 200, tone: 0 },
  { kind: "building", x: 424, y: 280, w: 240, h: 192, tone: 1 },
  { kind: "building", x: 728, y: 40, w: 256, h: 432, tone: 2 },
  { kind: "building", x: 1224, y: 40, w: 200, h: 220, tone: 3 },
  { kind: "building", x: 1224, y: 300, w: 200, h: 172, tone: 0 },
  { kind: "building", x: 1464, y: 40, w: 160, h: 432, tone: 1 },
  // Middle row (y 672-1200)
  { kind: "building", x: 424, y: 712, w: 560, h: 200, tone: 2 },
  { kind: "ruin", x: 424, y: 960, w: 200, h: 180 },
  { kind: "sandbag", x: 680, y: 1000, w: 160, h: 32 },
  { kind: "building", x: 1224, y: 712, w: 400, h: 180, tone: 3 },
  { kind: "crate", x: 1260, y: 960, w: 56, h: 56 },
  { kind: "crate", x: 1316, y: 960, w: 56, h: 56 },
  { kind: "wall", x: 1400, y: 1000, w: 24, h: 160 },
  // Bottom rows (y 1360-2560)
  { kind: "building", x: 424, y: 1400, w: 300, h: 260, tone: 0 },
  { kind: "building", x: 764, y: 1400, w: 220, h: 260, tone: 1 },
  { kind: "building", x: 424, y: 1724, w: 560, h: 196, tone: 2 },
  { kind: "building", x: 1224, y: 1400, w: 400, h: 220, tone: 3 },
  { kind: "vending", x: 1240, y: 1660, w: 48, h: 64, tone: 1 },
  { kind: "car", x: 1340, y: 1700, w: 112, h: 52, tone: 0 },
  { kind: "building", x: 424, y: 1984, w: 280, h: 200, tone: 0 },
  { kind: "building", x: 768, y: 1984, w: 216, h: 200, tone: 1 },
  { kind: "building", x: 1224, y: 1984, w: 400, h: 220, tone: 2 },
  { kind: "building", x: 424, y: 2280, w: 560, h: 240, tone: 3 },
  { kind: "building", x: 1224, y: 2300, w: 400, h: 200, tone: 0 },
  // West spawn street cover
  { kind: "sandbag", x: 150, y: 640, w: 32, h: 120 },
  { kind: "sandbag", x: 150, y: 1900, w: 32, h: 120 },
];

const halfDecor: DecorDef[] = [
  { kind: "road", x: 224, y: 0, w: 160, h: H },
  { kind: "road", x: 1024, y: 0, w: 160, h: H },
  { kind: "road", x: 224, y: 512, w: 1440, h: 160 },
  { kind: "lane", x: 296, y: 0, w: 16, h: H },
  { kind: "lane", x: 1096, y: 0, w: 16, h: H },
  { kind: "crosswalk", x: 224, y: 680, w: 160, h: 40 },
  { kind: "crosswalk", x: 1024, y: 470, w: 160, h: 40 },
  { kind: "neonSign", x: 740, y: 470, w: 120, h: 14, tone: 1, label: "OPEN" },
  { kind: "puddle", x: 1060, y: 900, w: 90, h: 50 },
  { kind: "stain", x: 620, y: 1280, w: 140, h: 70 },
];

const halfLights: LightDef[] = [
  { x: 304, y: 590, radius: 240, color: 0xffd9a0, intensity: 0.45 },
  { x: 1104, y: 590, radius: 240, color: 0xffd9a0, intensity: 0.45 },
  { x: 800, y: 480, radius: 200, color: 0xff4fd8, intensity: 0.35, flicker: 0.2 },
  { x: 1104, y: 1600, radius: 240, color: 0xffb36b, intensity: 0.4 },
  { x: 304, y: 1280, radius: 240, color: 0x9fd8ff, intensity: 0.35 },
];

const halfSpawns = [
  { x: 100, y: 200 },
  { x: 100, y: 520 },
  { x: 100, y: 820 },
  { x: 100, y: 1100 },
  { x: 100, y: 1450 },
  { x: 100, y: 1760 },
  { x: 100, y: 2080 },
  { x: 100, y: 2400 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1104, y: 950, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 700, y: 1280, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 696, y: 400, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1500, y: 1150, respawnSec: 25 },
];

const halfVehicles: VehicleSpawnDef[] = [
  { id: "car-a", kind: "car", x: 304, y: 900, angle: Math.PI / 2 },
  { id: "rover-a", kind: "offroad", x: 304, y: 1700, angle: -Math.PI / 2 },
];

export const DOWNTOWN: MapDef = {
  id: "downtown",
  name: "Downtown",
  tagline: "Tight blocks, long streets, alleys only boots fit through.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x24222b,
    floorAlt: 0x2a2833,
    grid: 0x33303d,
    wall: 0x3c3848,
    wallTop: 0x575169,
    shadow: 0x060509,
    ambient: 0x100e16,
    accents: [0xff7a3d, 0x3ff2ff, 0xb36bff, 0xffd23f],
    fog: 0x09080d,
  },
  solids: withMirror(halfSolids, W, H),
  decor: [
    { kind: "road", x: 224, y: H / 2 - 80, w: W - 448, h: 160 },
    { kind: "lane", x: 224, y: H / 2 - 8, w: W - 448, h: 16 },
    ...withMirror(halfDecor, W, H),
  ],
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: W / 2, y: H / 2, radius: 280, color: 0xfff1d0, intensity: 0.45 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 200, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 200, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
