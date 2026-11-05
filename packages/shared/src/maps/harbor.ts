import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Harbor Conflict: a quay with piers into the water, warehouses and a container yard. Water stops
 * people and ground vehicles but not bullets: the piers are exposed firing lanes. Authored as the
 * west half and point-mirrored.
 */
const W = 3584;
const H = 2304;

const halfSolids: SolidDef[] = [
  // Water along the north quay, broken by two piers
  { kind: "water", x: 0, y: 0, w: 560, h: 288 },
  { kind: "water", x: 720, y: 0, w: 520, h: 288 },
  { kind: "water", x: 1400, y: 0, w: 392, h: 288 },
  { kind: "crate", x: 612, y: 72, w: 56, h: 56 },
  { kind: "crate", x: 1292, y: 140, w: 56, h: 56 },
  // Warehouses between the quay road and the central avenue
  { kind: "building", x: 480, y: 520, w: 384, h: 256, tone: 0 },
  { kind: "building", x: 960, y: 520, w: 320, h: 224, tone: 1 },
  { kind: "building", x: 1440, y: 600, w: 192, h: 160, tone: 2 },
  { kind: "crate", x: 1150, y: 860, w: 56, h: 56 },
  { kind: "crate", x: 1206, y: 860, w: 56, h: 56 },
  // Crane legs at the quay
  { kind: "pillar", x: 1320, y: 330, w: 40, h: 40 },
  { kind: "pillar", x: 1560, y: 330, w: 40, h: 40 },
  // Container yard (alleys too narrow for vehicles)
  { kind: "container", x: 480, y: 1320, w: 240, h: 72, tone: 0 },
  { kind: "container", x: 480, y: 1488, w: 240, h: 72, tone: 1 },
  { kind: "container", x: 800, y: 1320, w: 72, h: 240, tone: 2 },
  { kind: "container", x: 960, y: 1380, w: 240, h: 72, tone: 3 },
  { kind: "container", x: 960, y: 1548, w: 240, h: 72, tone: 0 },
  { kind: "container", x: 480, y: 1680, w: 240, h: 72, tone: 2 },
  { kind: "container", x: 800, y: 1680, w: 240, h: 72, tone: 1 },
  // Customs house and fuel tank in the south-west
  { kind: "building", x: 480, y: 1960, w: 320, h: 240, tone: 3 },
  { kind: "tank", x: 1480, y: 1720, w: 120, h: 120 },
  { kind: "sandbag", x: 1100, y: 1900, w: 160, h: 32 },
  // Spawn yard cover
  { kind: "sandbag", x: 170, y: 760, w: 32, h: 120 },
  { kind: "sandbag", x: 170, y: 1600, w: 32, h: 120 },
  { kind: "fence", x: 0, y: 1280, w: 150, h: 12 },
];

const halfDecor: DecorDef[] = [
  { kind: "road", x: 240, y: 288, w: 176, h: H - 288 },
  { kind: "road", x: 416, y: 288, w: 1376, h: 160 },
  { kind: "lane", x: 320, y: 288, w: 16, h: H - 288 },
  { kind: "hazard", x: 0, y: 288, w: 1792, h: 12 },
  { kind: "paint", x: 1400, y: 1640, w: 280, h: 280, tone: 3 },
  { kind: "stain", x: 700, y: 900, w: 140, h: 80 },
  { kind: "stain", x: 1100, y: 1760, w: 120, h: 70 },
  { kind: "verge", x: 0, y: 288, w: 240, h: H - 288 },
];

const halfLights: LightDef[] = [
  { x: 640, y: 300, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 1320, y: 300, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 880, y: 1500, radius: 240, color: 0x9fd8ff, intensity: 0.35 },
  { x: 1540, y: 1780, radius: 220, color: 0xff7a3d, intensity: 0.4, flicker: 0.1 },
  { x: 330, y: 1150, radius: 240, color: 0xffb36b, intensity: 0.35 },
];

const halfSpawns = [
  { x: 96, y: 360 },
  { x: 96, y: 640 },
  { x: 110, y: 950 },
  { x: 96, y: 1150 },
  { x: 110, y: 1420 },
  { x: 96, y: 1840 },
  { x: 110, y: 2000 },
  { x: 96, y: 2220 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1120, y: 980, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 600, y: 1830, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 916, y: 1460, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1500, y: 980, respawnSec: 25 },
];

const halfVehicles: VehicleSpawnDef[] = [
  { id: "car-a", kind: "car", x: 328, y: 760, angle: Math.PI / 2 },
  { id: "rover-a", kind: "offroad", x: 328, y: 1560, angle: -Math.PI / 2 },
  { id: "apc-a", kind: "armored", x: 640, y: 1152, angle: 0 },
];

export const HARBOR_CONFLICT: MapDef = {
  id: "harbor",
  name: "Harbor Conflict",
  tagline: "Piers, warehouses and a container yard. Water stops trucks, not bullets.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x2d3236,
    floorAlt: 0x343a3f,
    grid: 0x3d444a,
    wall: 0x4f585f,
    wallTop: 0x6d7880,
    shadow: 0x090b0d,
    ambient: 0x12161a,
    accents: [0xc8622f, 0x2f6e8a, 0x8a8f3a, 0xd9a441],
    fog: 0x0b0e11,
  },
  solids: withMirror(halfSolids, W, H),
  decor: [
    { kind: "road", x: 240, y: H / 2 - 96, w: W - 480, h: 192 },
    { kind: "lane", x: 240, y: H / 2 - 8, w: W - 480, h: 16 },
    ...withMirror(halfDecor, W, H),
  ],
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: W / 2, y: H / 2, radius: 300, color: 0xfff1d0, intensity: 0.45 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 260, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 260, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
