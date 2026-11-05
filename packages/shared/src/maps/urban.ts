import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, VehicleSpawnDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints, withMirrorVehicles } from "./types.ts";

/**
 * Urban Warfare: a city grid built for vehicles and infantry together. 192 px avenues carry the
 * vehicles between the two spawn courtyards; building blocks, alleys too narrow for a car and
 * sandbagged plazas keep infantry in the fight. Authored as the west half and point-mirrored.
 */
const W = 3584;
const H = 2560;

const ROAD = 192;

/** Avenues and streets (visual; driving space is whatever the solids leave free). */
const halfRoads: DecorDef[] = [
  // West spawn street (vertical, full height)
  { kind: "road", x: 256, y: 0, w: ROAD, h: H },
  // Inner vertical street
  { kind: "road", x: 1088, y: 0, w: ROAD, h: H },
  // North avenue (west half)
  { kind: "road", x: 256, y: 384, w: 1440, h: ROAD },
];

const halfSolids: SolidDef[] = [
  // --- North strip (y 0-384): two buildings split by a walking alley, a third block east
  { kind: "building", x: 448, y: 64, w: 288, h: 256, tone: 0 },
  { kind: "building", x: 800, y: 64, w: 288, h: 256, tone: 1 },
  { kind: "building", x: 1280, y: 64, w: 416, h: 224, tone: 2 },
  // --- Block row 1 (y 576-1184)
  { kind: "building", x: 512, y: 640, w: 320, h: 256, tone: 3 },
  { kind: "building", x: 896, y: 640, w: 128, h: 480, tone: 0 },
  { kind: "building", x: 1344, y: 640, w: 288, h: 288, tone: 1 },
  // Plaza in front of the west block: sandbag line and crates
  { kind: "sandbag", x: 544, y: 992, w: 160, h: 32 },
  { kind: "crate", x: 752, y: 1040, w: 56, h: 56 },
  // Low wall across the east block's yard (cover from the boulevard)
  { kind: "wall", x: 1344, y: 1008, w: 224, h: 24 },
  { kind: "crate", x: 1592, y: 992, w: 56, h: 56 },
  // --- Block row 2 (y 1376-1984)
  { kind: "building", x: 512, y: 1440, w: 448, h: 256, tone: 2 },
  { kind: "building", x: 512, y: 1760, w: 192, h: 160, tone: 3 },
  { kind: "ruin", x: 768, y: 1792, w: 192, h: 128 },
  { kind: "building", x: 1344, y: 1600, w: 288, h: 320, tone: 0 },
  // Parked cars along the east block (static cover)
  { kind: "car", x: 1360, y: 1448, w: 112, h: 52, tone: 1 },
  { kind: "car", x: 1504, y: 1448, w: 112, h: 52, tone: 3 },
  // --- South strip (y 2176-2560): mirrored north strip of the other half
  { kind: "building", x: 448, y: 2240, w: 256, h: 256, tone: 1 },
  { kind: "building", x: 768, y: 2240, w: 320, h: 256, tone: 2 },
  { kind: "building", x: 1280, y: 2272, w: 416, h: 224, tone: 3 },
  // --- West spawn courtyard (x 0-256): low cover only, so the spawn is never boxed in
  { kind: "sandbag", x: 176, y: 300, w: 32, h: 128 },
  { kind: "sandbag", x: 176, y: 1220, w: 32, h: 120 },
  { kind: "sandbag", x: 176, y: 2120, w: 32, h: 128 },
  { kind: "wall", x: 0, y: 700, w: 140, h: 24 },
  { kind: "wall", x: 0, y: 1840, w: 140, h: 24 },
  // --- Street cover the vehicles can drive around
  { kind: "sandbag", x: 1120, y: 880, w: 128, h: 32 },
  { kind: "crate", x: 600, y: 520, w: 56, h: 56 },
  { kind: "wall", x: 1120, y: 1600, w: 24, h: 160 },
  { kind: "crate", x: 1216, y: 2080, w: 56, h: 56 },
];

const halfDecor: DecorDef[] = [
  { kind: "lane", x: 344, y: 0, w: 16, h: H },
  { kind: "lane", x: 1176, y: 0, w: 16, h: H },
  { kind: "lane", x: 256, y: 472, w: 1440, h: 16 },
  { kind: "crosswalk", x: 256, y: 584, w: ROAD, h: 40 },
  { kind: "crosswalk", x: 1088, y: 336, w: ROAD, h: 40 },
  { kind: "crosswalk", x: 1048, y: 384, w: 40, h: ROAD },
  { kind: "verge", x: 0, y: 0, w: 256, h: H },
  { kind: "verge", x: 1344, y: 960, w: 288, h: 160 },
  { kind: "stain", x: 640, y: 1220, w: 140, h: 80 },
  { kind: "stain", x: 1500, y: 470, w: 110, h: 60 },
  { kind: "puddle", x: 1150, y: 1450, w: 90, h: 50 },
  { kind: "paint", x: 280, y: 1270, w: 140, h: 6, tone: 0 },
  { kind: "cables", x: 736, y: 80, w: 64, h: 12 },
];

const halfLights: LightDef[] = [
  { x: 448, y: 384, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 1280, y: 576, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 448, y: 1184, radius: 240, color: 0xffd9a0, intensity: 0.4 },
  { x: 1088, y: 1984, radius: 260, color: 0xffb36b, intensity: 0.45, flicker: 0.12 },
  { x: 128, y: 1280, radius: 240, color: 0x9fd8ff, intensity: 0.35 },
  { x: 740, y: 1000, radius: 200, color: 0xff7a3d, intensity: 0.35 },
];

const halfSpawns = [
  { x: 96, y: 160 },
  { x: 96, y: 520 },
  { x: 128, y: 860 },
  { x: 96, y: 1120 },
  { x: 96, y: 1440 },
  { x: 128, y: 1700 },
  { x: 96, y: 2040 },
  { x: 96, y: 2400 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 770, y: 360, respawnSec: 20 },
  { id: "hp-b", kind: "health", x: 1000, y: 1250, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 620, y: 1100, respawnSec: 15 },
  { id: "am-b", kind: "ammo", x: 1480, y: 1550, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 860, y: 1980, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 1500, y: 1060, respawnSec: 25 },
];

/** Each team parks one of each ground vehicle on its spawn street. */
const halfVehicles: VehicleSpawnDef[] = [
  { id: "car-a", kind: "car", x: 352, y: 820, angle: Math.PI / 2 },
  { id: "apc-a", kind: "armored", x: 352, y: 1280, angle: 0 },
  { id: "rover-a", kind: "offroad", x: 352, y: 1760, angle: -Math.PI / 2 },
];

export const URBAN_WARFARE: MapDef = {
  id: "urban",
  name: "Urban Warfare",
  tagline: "City blocks and wide avenues: drive in, fight on foot through the alleys.",
  width: W,
  height: H,
  large: true,
  theme: {
    floor: 0x2c2f33,
    floorAlt: 0x33363b,
    grid: 0x3b3f45,
    wall: 0x4f535a,
    wallTop: 0x6c717a,
    shadow: 0x0a0b0d,
    ambient: 0x131518,
    accents: [0xc8622f, 0x2f6e8a, 0x8a8f3a, 0xd9a441],
    fog: 0x0e0f12,
  },
  solids: [
    ...withMirror(halfSolids, W, H),
    // Monument in the central roundabout (point-symmetric on its own)
    { kind: "pillar", x: W / 2 - 40, y: H / 2 - 40, w: 80, h: 80 },
  ],
  decor: [
    // Roads first: everything else is drawn on top of them
    ...withMirror(halfRoads, W, H),
    { kind: "road", x: W / 2 - ROAD / 2, y: 0, w: ROAD, h: H },
    { kind: "road", x: 256, y: H / 2 - ROAD / 2, w: W - 512, h: ROAD },
    { kind: "lane", x: W / 2 - 8, y: 0, w: 16, h: H },
    { kind: "lane", x: 256, y: H / 2 - 8, w: W - 512, h: 16 },
    ...withMirror(halfDecor, W, H),
  ],
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: W / 2, y: H / 2, radius: 320, color: 0xfff1d0, intensity: 0.5 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 - 180, respawnSec: 35 },
    { id: "wp-sniper-d", kind: "weapon", weapon: "sniper", x: W / 2, y: H / 2 + 180, respawnSec: 35 },
  ],
  vehicleSpawns: withMirrorVehicles(halfVehicles, W, H),
};
