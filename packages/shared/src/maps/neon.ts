import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints } from "./types.ts";

const W = 2560;
const H = 1664;

const halfSolids: SolidDef[] = [
  // Tower blocks along the north edge, separated by streets (160px) and alleys (~96px)
  { kind: "building", x: 0, y: 0, w: 384, h: 256, tone: 0 },
  { kind: "building", x: 576, y: 0, w: 384, h: 224, tone: 1 },
  { kind: "building", x: 1120, y: 112, w: 320, h: 176, tone: 2 },
  { kind: "building", x: 1600, y: 0, w: 384, h: 224, tone: 3 },
  { kind: "building", x: 2176, y: 0, w: 384, h: 352, tone: 0 },
  // Street furniture
  { kind: "vending", x: 960, y: 64, w: 40, h: 64, tone: 1 },
  { kind: "vending", x: 1560, y: 120, w: 40, h: 64, tone: 3 },
  { kind: "car", x: 704, y: 400, w: 128, h: 64, tone: 2 },
  { kind: "car", x: 1744, y: 384, w: 64, h: 128, tone: 0 },
  // Mid-west shop block and east alley wall
  { kind: "building", x: 224, y: 560, w: 256, h: 192, tone: 3 },
  { kind: "wall", x: 2176, y: 560, w: 32, h: 224 },
  // Plaza planters
  { kind: "crate", x: 992, y: 640, w: 192, h: 32, tone: 1 },
  { kind: "crate", x: 1504, y: 576, w: 32, h: 160, tone: 0 },
  { kind: "vending", x: 560, y: 820, w: 48, h: 64, tone: 2 },
  { kind: "car", x: 1360, y: 420, w: 128, h: 64, tone: 3 },
  { kind: "vending", x: 800, y: 640, w: 48, h: 48, tone: 0 },
  { kind: "crate", x: 1700, y: 760, w: 96, h: 48, tone: 2 },
  { kind: "wall", x: 640, y: 560, w: 32, h: 128 },
  { kind: "wall", x: 1984, y: 800, w: 32, h: 64 },
];

const halfDecor: DecorDef[] = [
  { kind: "neonSign", x: 120, y: 256, w: 160, h: 10, tone: 0, label: "NOODLE" },
  { kind: "neonSign", x: 640, y: 224, w: 200, h: 10, tone: 1, label: "KAIRO" },
  { kind: "neonSign", x: 1180, y: 288, w: 200, h: 10, tone: 2, label: "OPEN 24" },
  { kind: "neonSign", x: 1680, y: 224, w: 180, h: 10, tone: 3, label: "VOLT" },
  { kind: "neonSign", x: 2240, y: 352, w: 220, h: 10, tone: 1, label: "HOTEL" },
  { kind: "neonSign", x: 480, y: 600, w: 10, h: 120, tone: 2 },
  { kind: "crosswalk", x: 976, y: 300, w: 128, h: 96 },
  { kind: "crosswalk", x: 1456, y: 300, w: 128, h: 96 },
  { kind: "puddle", x: 820, y: 560, w: 130, h: 60 },
  { kind: "puddle", x: 1960, y: 470, w: 100, h: 54 },
  { kind: "puddle", x: 380, y: 420, w: 90, h: 46 },
  { kind: "paint", x: 0, y: 480, w: 1100, h: 6, tone: 1 },
  { kind: "grate", x: 1200, y: 560, w: 160, h: 64 },
];

const halfLights: LightDef[] = [
  { x: 200, y: 300, radius: 260, color: 0xff3fae, intensity: 0.6, flicker: 0.3 },
  { x: 740, y: 280, radius: 280, color: 0x3ff2ff, intensity: 0.55 },
  { x: 1280, y: 330, radius: 260, color: 0xb36bff, intensity: 0.55, flicker: 0.1 },
  { x: 1780, y: 280, radius: 260, color: 0xffd23f, intensity: 0.5 },
  { x: 2350, y: 400, radius: 280, color: 0x3fff9c, intensity: 0.5, flicker: 0.2 },
  { x: 520, y: 660, radius: 220, color: 0xff6b3f, intensity: 0.45 },
];

const halfSpawns = [
  { x: 480, y: 96 },
  { x: 1040, y: 170 },
  { x: 1520, y: 60 },
  { x: 2080, y: 96 },
  { x: 2480, y: 480 },
  { x: 96, y: 400 },
];

const halfPickups: PickupDef[] = [
  { id: "hp", kind: "health", x: 680, y: 760, respawnSec: 20 },
  { id: "am", kind: "ammo", x: 1280, y: 380, respawnSec: 15 },
  { id: "wp-shotgun", kind: "weapon", weapon: "shotgun", x: 300, y: 820, respawnSec: 25 },
  { id: "wp-smg", kind: "weapon", weapon: "smg", x: 1900, y: 640, respawnSec: 25 },
];

export const NEON_DISTRICT: MapDef = {
  id: "neon",
  name: "Neon District",
  tagline: "Rain-slick streets, tight alleys and a kiosk plaza under the signs.",
  width: W,
  height: H,
  theme: {
    floor: 0x16141f,
    floorAlt: 0x1c1a28,
    grid: 0x262338,
    wall: 0x2b2740,
    wallTop: 0x3d3858,
    shadow: 0x050409,
    ambient: 0x0c0a14,
    accents: [0xff3fae, 0x3ff2ff, 0xb36bff, 0xffd23f],
    fog: 0x07060c,
  },
  solids: [...withMirror(halfSolids, W, H), { kind: "vending", x: 1216, y: 768, w: 128, h: 128, tone: 2 }],
  decor: withMirror(halfDecor, W, H),
  lights: [
    ...withMirrorPoints(halfLights, W, H),
    { x: 1280, y: 832, radius: 300, color: 0xff3fae, intensity: 0.45 },
  ],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-rifle-c", kind: "weapon", weapon: "rifle", x: 1280, y: 700, respawnSec: 25 },
    { id: "wp-rifle-c2", kind: "weapon", weapon: "rifle", x: 1280, y: 964, respawnSec: 25 },
  ],
};
