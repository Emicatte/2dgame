import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints } from "./types.ts";

const W = 2560;
const H = 1664;

const halfSolids: SolidDef[] = [
  // North-west rock outcrop
  { kind: "rock", x: 128, y: 128, w: 192, h: 128 },
  { kind: "rock", x: 224, y: 256, w: 96, h: 96 },
  // Ruined guard house: walls with breaches on the east and south sides
  { kind: "ruin", x: 640, y: 160, w: 320, h: 32 },
  { kind: "ruin", x: 640, y: 192, w: 32, h: 192 },
  { kind: "ruin", x: 928, y: 192, w: 32, h: 64 },
  { kind: "ruin", x: 672, y: 352, w: 128, h: 32 },
  // Sandbag line in front of the tower
  { kind: "sandbag", x: 1120, y: 480, w: 128, h: 32 },
  // North-east rocks and ruined wall
  { kind: "rock", x: 2240, y: 160, w: 160, h: 224 },
  { kind: "rock", x: 2016, y: 96, w: 96, h: 96 },
  { kind: "ruin", x: 1600, y: 320, w: 256, h: 32 },
  { kind: "ruin", x: 1824, y: 352, w: 32, h: 160 },
  // Flanks
  { kind: "sandbag", x: 448, y: 720, w: 32, h: 224 },
  { kind: "rock", x: 800, y: 600, w: 96, h: 96 },
  { kind: "tank", x: 1600, y: 640, w: 160, h: 96 },
  { kind: "sandbag", x: 1376, y: 160, w: 32, h: 128 },
  { kind: "rock", x: 1024, y: 640, w: 96, h: 64 },
  { kind: "sandbag", x: 560, y: 480, w: 160, h: 32 },
  { kind: "rock", x: 1400, y: 420, w: 64, h: 64 },
  { kind: "ruin", x: 1920, y: 640, w: 32, h: 160 },
  { kind: "rock", x: 2300, y: 720, w: 128, h: 96 },
  { kind: "rock", x: 1180, y: 250, w: 64, h: 64 },
];

const halfDecor: DecorDef[] = [
  { kind: "sand", x: 1000, y: 260, w: 260, h: 140 },
  { kind: "sand", x: 120, y: 520, w: 300, h: 160 },
  { kind: "sand", x: 2000, y: 560, w: 260, h: 120 },
  { kind: "tracks", x: 0, y: 470, w: 1200, h: 40 },
  { kind: "tracks", x: 1500, y: 560, w: 40, h: 300 },
  { kind: "bones", x: 1500, y: 140, w: 60, h: 30 },
  { kind: "stain", x: 700, y: 230, w: 160, h: 90 },
  { kind: "cables", x: 960, y: 300, w: 120, h: 10 },
];

const halfLights: LightDef[] = [
  { x: 800, y: 270, radius: 260, color: 0xffd08a, intensity: 0.35 },
  { x: 1760, y: 430, radius: 240, color: 0xffc070, intensity: 0.35, flicker: 0.1 },
  { x: 300, y: 600, radius: 300, color: 0xfff0c8, intensity: 0.25 },
];

const halfSpawns = [
  { x: 64, y: 64 },
  { x: 520, y: 96 },
  { x: 1280, y: 120 },
  { x: 1940, y: 240 },
  { x: 2480, y: 80 },
  { x: 2480, y: 520 },
];

const halfPickups: PickupDef[] = [
  { id: "wp-sniper", kind: "weapon", weapon: "sniper", x: 780, y: 270, respawnSec: 30 },
  { id: "hp", kind: "health", x: 1280, y: 380, respawnSec: 20 },
  { id: "am", kind: "ammo", x: 2140, y: 560, respawnSec: 15 },
  { id: "wp-shotgun", kind: "weapon", weapon: "shotgun", x: 1710, y: 420, respawnSec: 25 },
];

export const DESERT_OUTPOST: MapDef = {
  id: "desert",
  name: "Desert Outpost",
  tagline: "Long sightlines, broken ruins and a water tower in the dust.",
  width: W,
  height: H,
  theme: {
    floor: 0xb08a5a,
    floorAlt: 0xbd9765,
    grid: 0xa47f52,
    wall: 0x8a6a48,
    wallTop: 0xc9a27a,
    shadow: 0x3a2614,
    ambient: 0x6b4c2c,
    accents: [0x6a7d5a, 0xb85c38, 0x5a6a7a, 0xd9b37a],
    fog: 0x4a3420,
  },
  solids: [...withMirror(halfSolids, W, H), { kind: "tank", x: 1216, y: 768, w: 128, h: 128, tone: 1 }],
  decor: withMirror(halfDecor, W, H),
  lights: [...withMirrorPoints(halfLights, W, H), { x: 1280, y: 832, radius: 240, color: 0xffe2b0, intensity: 0.3 }],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: withMirrorPickups(halfPickups, W, H),
};
