import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Military Airbase: a runway between two hangar rows. Each team has a helipad with a Kestrel
 * helicopter, a car and a rover. Hangars, the control tower and the fuel tanks are tall (they stop
 * helicopters and air-to-ground fire); everything else can be overflown. Doubles as the
 * helicopter test map. Authored as the west half and point-mirrored.
 */
const W = 3072;
const H = 2048;

const halfSolids: SolidDef[] = [
  { kind: "building", x: 320, y: 96, w: 384, h: 288, tone: 0 },
  { kind: "building", x: 896, y: 128, w: 320, h: 256, tone: 1 },
  { kind: "building", x: 1344, y: 448, w: 128, h: 128, tone: 2 },
  { kind: "container", x: 760, y: 420, w: 80, h: 200, tone: 2 },
  { kind: "sandbag", x: 400, y: 840, w: 160, h: 32 },
  { kind: "sandbag", x: 1100, y: 840, w: 160, h: 32 },
  { kind: "crate", x: 1024, y: 560, w: 56, h: 56 },
  { kind: "crate", x: 1080, y: 560, w: 56, h: 56 },
  { kind: "crate", x: 1024, y: 616, w: 56, h: 56 },
  { kind: "wall", x: 1216, y: 1360, w: 24, h: 220 },
  { kind: "building", x: 896, y: 1440, w: 352, h: 192, tone: 3 },
  { kind: "ruin", x: 320, y: 1300, w: 160, h: 96 },
  { kind: "tank", x: 640, y: 1720, w: 120, h: 120 },
  { kind: "sandbag", x: 1340, y: 1180, w: 32, h: 140 },
];

const halfDecor: DecorDef[] = [
  { kind: "road", x: 640, y: 384, w: 128, h: 528 },
  { kind: "helipad", x: 400, y: 1600, w: 192, h: 192 },
  { kind: "hazard", x: 320, y: 384, w: 384, h: 16 },
  { kind: "hazard", x: 896, y: 384, w: 320, h: 16 },
  { kind: "stain", x: 520, y: 600, w: 140, h: 70 },
  { kind: "stain", x: 1180, y: 1720, w: 120, h: 60 },
  { kind: "tracks", x: 700, y: 1240, w: 300, h: 40 },
  { kind: "verge", x: 0, y: 0, w: 256, h: H },
  { kind: "paint", x: 100, y: 1024, w: 120, h: 6, tone: 0 },
];

const halfLights: LightDef[] = [
  { x: 512, y: 420, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 1056, y: 420, radius: 240, color: 0xffd9a0, intensity: 0.4 },
  { x: 496, y: 1696, radius: 240, color: 0x9fe7ff, intensity: 0.45 },
  { x: 1408, y: 620, radius: 200, color: 0xff7a3d, intensity: 0.4, flicker: 0.1 },
  { x: 1060, y: 1400, radius: 220, color: 0xffb36b, intensity: 0.35 },
];

const halfSpawns = [
  { x: 96, y: 160 },
  { x: 96, y: 480 },
  { x: 96, y: 800 },
  { x: 160, y: 1180 },
  { x: 96, y: 1420 },
  { x: 96, y: 1700 },
  { x: 96, y: 1940 },
  { x: 260, y: 1960 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1100, y: 720, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 700, y: 1320, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 1060, y: 1350, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1420, y: 1720, respawnSec: 25 },
];

const halfVehicles: VehicleSpawnDef[] = [
  { id: "heli-a", kind: "heli", x: 496, y: 1696, angle: 0 },
  { id: "car-a", kind: "car", x: 800, y: 760, angle: 0 },
  { id: "rover-a", kind: "offroad", x: 1300, y: 1250, angle: 0 },
];

export const MILITARY_AIRBASE: MapDef = {
  id: "airbase",
  name: "Military Airbase",
  tagline: "Hangars, a runway and a helicopter on each pad. Take the air or shoot it down.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x34372f,
    floorAlt: 0x3b3e35,
    grid: 0x43473c,
    wall: 0x555a4c,
    wallTop: 0x737a66,
    shadow: 0x0b0c0a,
    ambient: 0x151712,
    accents: [0xc8622f, 0x4f7a8a, 0x8a8f3a, 0xd9a441],
    fog: 0x0f100d,
  },
  solids: withMirror(halfSolids, W, H),
  decor: [
    // Runway across the middle (point-symmetric on its own)
    { kind: "road", x: 256, y: H / 2 - 112, w: W - 512, h: 224 },
    { kind: "lane", x: 256, y: H / 2 - 8, w: W - 512, h: 16 },
    ...withMirror(halfDecor, W, H),
  ],
  lights: withMirrorPoints(halfLights, W, H),
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 300, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 300, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
