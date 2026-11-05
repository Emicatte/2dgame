import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";
import { withMirror, withMirrorPickups, withMirrorPoints } from "./types.ts";

const W = 2560;
const H = 1664;

/** Authored half; the other half is its point-symmetric mirror. */
const halfSolids: SolidDef[] = [
  // North-west container yard: two stacked containers with a 96px alley between them
  { kind: "container", x: 160, y: 160, w: 256, h: 80, tone: 0 },
  { kind: "container", x: 160, y: 336, w: 256, h: 80, tone: 1 },
  { kind: "container", x: 512, y: 64, w: 80, h: 224, tone: 2 },
  // Concrete wall dropping from the north edge: splits the yard from the press hall
  { kind: "wall", x: 736, y: 0, w: 32, h: 288 },
  // Hydraulic press block
  { kind: "machine", x: 896, y: 160, w: 160, h: 128 },
  // Crates on the north axis
  { kind: "crate", x: 1152, y: 96, w: 64, h: 64 },
  { kind: "crate", x: 1216, y: 96, w: 64, h: 64 },
  // Catwalk railing in front of the center
  { kind: "wall", x: 1120, y: 384, w: 320, h: 32 },
  // North-east container pair
  { kind: "container", x: 1664, y: 128, w: 80, h: 256, tone: 1 },
  { kind: "container", x: 1840, y: 128, w: 80, h: 256, tone: 0 },
  { kind: "machine", x: 1600, y: 448, w: 128, h: 96 },
  // Crate L-stack
  { kind: "crate", x: 2048, y: 288, w: 64, h: 64 },
  { kind: "crate", x: 2112, y: 288, w: 64, h: 64 },
  { kind: "crate", x: 2048, y: 352, w: 64, h: 64 },
  { kind: "wall", x: 2304, y: 160, w: 32, h: 320 },
  // East mid container
  { kind: "container", x: 2176, y: 640, w: 256, h: 80, tone: 2 },
  // West lane wall
  { kind: "wall", x: 608, y: 448, w: 32, h: 256 },
  // Pillars flanking the center
  { kind: "pillar", x: 960, y: 576, w: 48, h: 48 },
  { kind: "pillar", x: 1552, y: 576, w: 48, h: 48 },
  // Center: railing bar + crate (mirrored to form four diagonal entrances)
  { kind: "wall", x: 1184, y: 704, w: 192, h: 32 },
  { kind: "crate", x: 1088, y: 800, w: 64, h: 64 },
  // Mid-band cover so long lanes always have something to break line of sight
  { kind: "crate", x: 832, y: 448, w: 64, h: 64 },
  { kind: "crate", x: 832, y: 512, w: 64, h: 64 },
  { kind: "container", x: 416, y: 560, w: 80, h: 192, tone: 3 },
  { kind: "crate", x: 1856, y: 704, w: 64, h: 64 },
  { kind: "machine", x: 1472, y: 224, w: 96, h: 64 },
  { kind: "wall", x: 96, y: 448, w: 160, h: 32 },
];

const halfDecor: DecorDef[] = [
  { kind: "hazard", x: 1152, y: 736, w: 256, h: 16 },
  { kind: "paint", x: 96, y: 520, w: 420, h: 6, tone: 0 },
  { kind: "paint", x: 1700, y: 600, w: 6, h: 260, tone: 0 },
  { kind: "grate", x: 864, y: 352, w: 192, h: 96 },
  { kind: "grate", x: 1984, y: 480, w: 160, h: 96 },
  { kind: "stain", x: 300, y: 600, w: 120, h: 70 },
  { kind: "stain", x: 1420, y: 220, w: 90, h: 60 },
  { kind: "stain", x: 2200, y: 820, w: 110, h: 80 },
  { kind: "cables", x: 768, y: 120, w: 128, h: 12 },
  { kind: "cables", x: 1920, y: 240, w: 128, h: 12 },
  { kind: "hazard", x: 2336, y: 160, w: 16, h: 320 },
  { kind: "paint", x: 1240, y: 40, w: 80, h: 6, tone: 1 },
];

const halfLights: LightDef[] = [
  { x: 288, y: 288, radius: 260, color: 0xffb36b, intensity: 0.55 },
  { x: 976, y: 330, radius: 300, color: 0xffd9a0, intensity: 0.5, flicker: 0.15 },
  { x: 1880, y: 460, radius: 280, color: 0xffb36b, intensity: 0.5 },
  { x: 2420, y: 120, radius: 220, color: 0xff7a3d, intensity: 0.45 },
  { x: 720, y: 640, radius: 240, color: 0x9fd8ff, intensity: 0.35 },
];

const halfSpawns = [
  { x: 96, y: 96 },
  { x: 660, y: 120 },
  { x: 1280, y: 240 },
  { x: 1990, y: 96 },
  { x: 2460, y: 96 },
  { x: 2480, y: 540 },
];

const halfPickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 288, y: 288, respawnSec: 20 },
  { id: "hp-b", kind: "health", x: 2000, y: 540, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 1000, y: 480, respawnSec: 15 },
  { id: "wp-shotgun-a", kind: "weapon", weapon: "shotgun", x: 660, y: 380, respawnSec: 25 },
  { id: "wp-smg-a", kind: "weapon", weapon: "smg", x: 2240, y: 820, respawnSec: 25 },
];

export const INDUSTRIAL_ARENA: MapDef = {
  id: "industrial",
  name: "Industrial Arena",
  tagline: "Container yards, a hydraulic press hall and a crossfire center.",
  width: W,
  height: H,
  theme: {
    floor: 0x2a2d31,
    floorAlt: 0x31353a,
    grid: 0x3a3f45,
    wall: 0x5a5f66,
    wallTop: 0x7b818a,
    shadow: 0x0b0c0e,
    ambient: 0x15171a,
    accents: [0xc8622f, 0x2f6e8a, 0x8a8f3a, 0xe0a33a],
    fog: 0x101114,
  },
  solids: withMirror(halfSolids, W, H),
  decor: [...withMirror(halfDecor, W, H), { kind: "paint", x: 1216, y: 768, w: 128, h: 128, tone: 3 }],
  lights: [...withMirrorPoints(halfLights, W, H), { x: 1280, y: 832, radius: 220, color: 0xfff1d0, intensity: 0.5 }],
  spawns: withMirrorPoints(halfSpawns, W, H),
  pickups: [
    ...withMirrorPickups(halfPickups, W, H),
    { id: "wp-sniper-c", kind: "weapon", weapon: "sniper", x: 1280, y: 832, respawnSec: 35 },
  ],
};
