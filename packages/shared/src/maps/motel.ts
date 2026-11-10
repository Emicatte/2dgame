import type { DecorDef, HideSpotDef, LightDef, MapDef, PickupDef, PropSpotDef, SolidDef } from "./types.ts";

/**
 * Motel Strip: a party map (Prop Hunt, Hide & Seek, Infection). A row of six motel rooms on a
 * covered walkway, a parking lot, a drained pool and a laundry shed; the hunters wait in the
 * reception office during the hiding time.
 */
const W = 2080;
const H = 1400;
const X0 = 160;
const ROOM_W = 280;
const ROOM_H = 400;
const DOOR = 110;

const solids: SolidDef[] = [];
const props: PropSpotDef[] = [];

// Rooms: partition walls, the walkway wall with one door per room, a bed and a dresser each.
for (let k = 0; k <= 6; k++) solids.push({ kind: "wall", x: X0 + k * ROOM_W - 12, y: 0, w: 24, h: ROOM_H });
let wallFrom = X0 - 12;
const ROOM_PROPS: PropSpotDef["kind"][][] = [
  ["chair", "plant", "bin", "box"],
  ["chair", "cooler", "bin", "plant"],
  ["box", "plant", "chair", "bin"],
  ["chair", "bin", "cooler", "box"],
  ["plant", "chair", "box", "bin"],
  ["cooler", "plant", "bin", "chair"],
];
for (let i = 0; i < 6; i++) {
  const rx = X0 + i * ROOM_W;
  const cx = rx + ROOM_W / 2;
  solids.push({ kind: "wall", x: wallFrom, y: ROOM_H, w: cx - DOOR / 2 - wallFrom, h: 24 });
  wallFrom = cx + DOOR / 2;
  solids.push({ kind: "desk", x: rx + 30, y: 30, w: 110, h: 150, tone: i % 3 });
  solids.push({ kind: "desk", x: rx + 190, y: 30, w: 60, h: 40 });
  const [a, b, c, d] = ROOM_PROPS[i]!;
  props.push(
    { kind: a!, x: rx + 210, y: 140, rot: i * 17 },
    { kind: b!, x: rx + 240, y: 360 },
    { kind: c!, x: rx + 44, y: 360 },
    { kind: d!, x: rx + 120, y: 290, rot: -i * 11 },
  );
}
solids.push({ kind: "wall", x: wallFrom, y: ROOM_H, w: X0 + 6 * ROOM_W + 12 - wallFrom, h: 24 });

solids.push(
  // Ice machine in the west courtyard, vending machine at the east end of the walkway
  { kind: "machine", x: 20, y: 40, w: 80, h: 60 },
  { kind: "vending", x: 1880, y: 440, w: 52, h: 40, tone: 1 },
  // Parking lot: two rows of parked cars
  { kind: "car", x: 220, y: 600, w: 56, h: 104, tone: 0 },
  { kind: "car", x: 560, y: 600, w: 56, h: 104, tone: 1 },
  { kind: "car", x: 940, y: 600, w: 56, h: 104, tone: 2 },
  { kind: "car", x: 1320, y: 600, w: 56, h: 104, tone: 0 },
  { kind: "car", x: 1660, y: 600, w: 56, h: 104, tone: 1 },
  { kind: "car", x: 380, y: 900, w: 56, h: 104, tone: 2 },
  { kind: "car", x: 760, y: 900, w: 56, h: 104, tone: 0 },
  { kind: "car", x: 1120, y: 900, w: 56, h: 104, tone: 1 },
  { kind: "car", x: 1480, y: 900, w: 56, h: 104, tone: 2 },
  // Drained pool (stops walking, not bullets)
  { kind: "water", x: 260, y: 1150, w: 480, h: 170 },
  // Laundry shed (door at x 1340–1460)
  { kind: "wall", x: 1100, y: 1080, w: 240, h: 24 },
  { kind: "wall", x: 1460, y: 1080, w: 240, h: 24 },
  { kind: "wall", x: 1100, y: 1104, w: 24, h: 296 },
  { kind: "wall", x: 1676, y: 1104, w: 24, h: 296 },
  { kind: "machine", x: 1500, y: 1130, w: 150, h: 50 },
  { kind: "shelf", x: 1150, y: 1340, w: 300, h: 40, tone: 1 },
  // Reception office (the hunters' pen), door at x 1880–1990
  { kind: "wall", x: 1760, y: 1100, w: 120, h: 24 },
  { kind: "wall", x: 1990, y: 1100, w: 90, h: 24 },
  { kind: "wall", x: 1760, y: 1124, w: 24, h: 276 },
  { kind: "desk", x: 1820, y: 1170, w: 120, h: 50 },
);

props.push(
  // West courtyard and the walkway
  { kind: "barrel", x: 70, y: 200 },
  { kind: "box", x: 60, y: 300, rot: 15 },
  { kind: "bin", x: 120, y: 370 },
  { kind: "plant", x: 300, y: 470 },
  { kind: "bin", x: 580, y: 480 },
  { kind: "chair", x: 860, y: 470, rot: 20 },
  { kind: "cooler", x: 1140, y: 480 },
  { kind: "plant", x: 1420, y: 470 },
  { kind: "bin", x: 1700, y: 480 },
  { kind: "chair", x: 1800, y: 500, rot: -30 },
  // East yard (beside the last room)
  { kind: "tires", x: 1900, y: 80 },
  { kind: "barrel", x: 2020, y: 160 },
  { kind: "box", x: 1880, y: 300 },
  { kind: "cone", x: 2030, y: 340 },
  // Parking lot
  { kind: "cone", x: 160, y: 800 },
  { kind: "cone", x: 640, y: 820 },
  { kind: "tires", x: 1000, y: 790 },
  { kind: "barrel", x: 1240, y: 800 },
  { kind: "cone", x: 1560, y: 820 },
  { kind: "tires", x: 1900, y: 720 },
  { kind: "box", x: 90, y: 960, rot: 30 },
  { kind: "bin", x: 1980, y: 980 },
  { kind: "crate", x: 1840, y: 930 },
  { kind: "cone", x: 1300, y: 1040 },
  // Pool deck
  { kind: "chair", x: 300, y: 1105 },
  { kind: "chair", x: 420, y: 1105 },
  { kind: "chair", x: 560, y: 1105 },
  { kind: "chair", x: 700, y: 1105 },
  { kind: "plant", x: 200, y: 1360 },
  { kind: "plant", x: 800, y: 1360 },
  { kind: "cooler", x: 800, y: 1170 },
  { kind: "bin", x: 200, y: 1170 },
  { kind: "chair", x: 960, y: 1250, rot: 45 },
  // Laundry shed
  { kind: "box", x: 1170, y: 1160 },
  { kind: "box", x: 1210, y: 1210, rot: 25 },
  { kind: "barrel", x: 1300, y: 1170 },
  { kind: "crate", x: 1420, y: 1250 },
  { kind: "bin", x: 1610, y: 1250 },
  { kind: "box", x: 1520, y: 1300 },
  { kind: "cooler", x: 1240, y: 1295 },
  // Reception
  { kind: "plant", x: 2040, y: 1150 },
);

const decor: DecorDef[] = [
  { kind: "road", x: 0, y: 560, w: W, h: 480 },
  { kind: "lane", x: 120, y: 790, w: 1820, h: 6 },
  { kind: "paint", x: 200, y: 590, w: 6, h: 130, tone: 3 },
  { kind: "paint", x: 1700, y: 590, w: 6, h: 130, tone: 3 },
  { kind: "stain", x: 1050, y: 700, w: 120, h: 60 },
  { kind: "neonSign", x: 1840, y: 1050, w: 200, h: 30, label: "MOTEL" },
  { kind: "grate", x: 900, y: 1300, w: 120, h: 60 },
  { kind: "puddle", x: 600, y: 980, w: 140, h: 50 },
];

const lights: LightDef[] = [
  ...[0, 1, 2, 3, 4, 5].map((i) => ({
    x: X0 + i * ROOM_W + 140,
    y: 200,
    radius: 200,
    color: i % 2 ? 0xffd9a0 : 0xfff1d0,
    intensity: 0.4,
    ...(i === 3 ? { flicker: 0.15 } : {}),
  })),
  { x: 500, y: 480, radius: 240, color: 0xffb36b, intensity: 0.4 },
  { x: 1400, y: 480, radius: 240, color: 0xffb36b, intensity: 0.4 },
  { x: 600, y: 800, radius: 320, color: 0x9fd8ff, intensity: 0.35 },
  { x: 1500, y: 800, radius: 320, color: 0x9fd8ff, intensity: 0.35 },
  { x: 500, y: 1230, radius: 280, color: 0x6bd0ff, intensity: 0.45 },
  { x: 1400, y: 1240, radius: 220, color: 0xfff1d0, intensity: 0.4 },
  { x: 1930, y: 1060, radius: 160, color: 0xff5ab4, intensity: 0.55, flicker: 0.1 },
];

const spawns = [
  { x: 60, y: 480 },
  { x: 440, y: 500 },
  { x: 1000, y: 500 },
  { x: 1560, y: 500 },
  { x: 100, y: 680 },
  { x: 1000, y: 1000 },
  { x: 1990, y: 600 },
  { x: 940, y: 1150 },
  { x: 60, y: 1300 },
  { x: 1560, y: 1040 },
  { x: 1980, y: 420 },
  { x: 1210, y: 720 },
];

const pickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1020, y: 720, respawnSec: 20 },
  { id: "hp-b", kind: "health", x: 120, y: 1060, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 1820, y: 1000, respawnSec: 15 },
  { id: "wp-shotgun", kind: "weapon", weapon: "shotgun", x: 300, y: 1050, respawnSec: 25 },
];

const hideSpots: HideSpotDef[] = [
  { kind: "curtain", x: X0 + 2 * ROOM_W + 250, y: 220, r: 24 },
  { kind: "curtain", x: X0 + 4 * ROOM_W + 250, y: 220, r: 24 },
  { kind: "bush", x: 90, y: 1360, r: 28 },
  { kind: "bush", x: 900, y: 1150, r: 28 },
  { kind: "tarp", x: 1600, y: 1350, r: 28 },
];

export const MOTEL_STRIP: MapDef = {
  id: "motel",
  name: "Motel Strip",
  tagline: "Six rooms, a parking lot, a drained pool and a laundry shed. Party map.",
  width: W,
  height: H,
  theme: {
    floor: 0x2f3436,
    floorAlt: 0x363c3f,
    grid: 0x434a4d,
    wall: 0x6a5f55,
    wallTop: 0x8c8073,
    shadow: 0x0a0b0c,
    ambient: 0x141618,
    accents: [0xc94f6d, 0x3f8f9a, 0xd9a441, 0x6f7f3a],
    fog: 0x101214,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  modes: ["deathmatch", "gungame", "hideseek", "prophunt", "infection", "chaos", "bounty"],
  players: { min: 2, max: 8 },
  party: {
    seekerPen: [
      { x: 1860, y: 1300 },
      { x: 1960, y: 1340 },
      { x: 2030, y: 1250 },
      { x: 2030, y: 1350 },
    ],
    hiderSpawns: [
      { x: 700, y: 500 },
      { x: 1000, y: 860 },
      { x: 480, y: 1050 },
      { x: 1260, y: 520 },
      { x: 1200, y: 1000 },
      { x: 120, y: 500 },
    ],
    shadows: [
      { x: X0 + 12, y: 0, w: 100, h: 110 },
      { x: X0 + 3 * ROOM_W + 12, y: 0, w: 100, h: 110 },
      { x: X0 + 5 * ROOM_W + 12, y: 280, w: 120, h: 120 },
      { x: 1124, y: 1104, w: 120, h: 120 },
      { x: 0, y: 1240, w: 160, h: 160 },
      { x: 1960, y: 860, w: 120, h: 200 },
    ],
    hideSpots,
    props,
  },
};
