import type { DecorDef, HideSpotDef, LightDef, MapDef, PickupDef, PropSpotDef, SolidDef } from "./types.ts";

/**
 * Night Market: a party map (Prop Hunt, Hide & Seek, Infection). Three rows of market stalls under
 * one roof, a food court, a storeroom of racks and a loading dock; the hunters wait in the dock's
 * security booth during the hiding time.
 */
const W = 2160;
const H = 1440;

const solids: SolidDef[] = [];
const props: PropSpotDef[] = [];

// Stall rows: five counters per row with a walkway between each.
const ROWS = [300, 640, 980];
const STALLS = [520, 760, 1000, 1240, 1480];
const STALL_PROPS: PropSpotDef["kind"][] = [
  "crate",
  "box",
  "cooler",
  "barrel",
  "box",
  "crate",
  "bin",
  "cooler",
];
let n = 0;
for (const [r, y] of ROWS.entries()) {
  for (const [c, x] of STALLS.entries()) {
    solids.push({ kind: "desk", x, y, w: 160, h: 50, tone: (r + c) % 3 });
    // Goods in front of and behind every other counter, staggered so the aisles stay open.
    if ((r + c) % 2 === 0) {
      props.push({ kind: STALL_PROPS[n++ % STALL_PROPS.length]!, x: x + 40, y: y - 34, rot: n * 13 });
      props.push({ kind: STALL_PROPS[n++ % STALL_PROPS.length]!, x: x + 120, y: y + 86 });
    } else {
      props.push({ kind: STALL_PROPS[n++ % STALL_PROPS.length]!, x: x + 120, y: y - 34 });
      props.push({ kind: STALL_PROPS[n++ % STALL_PROPS.length]!, x: x + 40, y: y + 86, rot: -n * 9 });
    }
  }
}

// Food court tables (west), with chairs around.
const TABLES = [
  { x: 80, y: 300 },
  { x: 280, y: 300 },
  { x: 80, y: 640 },
  { x: 280, y: 640 },
  { x: 80, y: 980 },
  { x: 280, y: 980 },
];
for (const [i, t] of TABLES.entries()) {
  solids.push({ kind: "desk", x: t.x, y: t.y, w: 90, h: 60, tone: 2 });
  props.push({ kind: "chair", x: t.x + 20, y: t.y - 30, rot: 180 + i * 7 });
  props.push({ kind: "chair", x: t.x + 70, y: t.y + 92, rot: i * 11 });
}

solids.push(
  // Roof pillars of the hall
  { kind: "pillar", x: 460, y: 160, w: 32, h: 32 },
  { kind: "pillar", x: 1700, y: 160, w: 32, h: 32 },
  { kind: "pillar", x: 460, y: 1200, w: 32, h: 32 },
  { kind: "pillar", x: 1700, y: 1200, w: 32, h: 32 },
  // Storeroom (north-east): door in the west wall at y 220–330, in the south wall at x 1900–2010
  { kind: "wall", x: 1784, y: 0, w: 24, h: 220 },
  { kind: "wall", x: 1784, y: 330, w: 24, h: 190 },
  { kind: "wall", x: 1808, y: 496, w: 92, h: 24 },
  { kind: "wall", x: 2010, y: 496, w: 150, h: 24 },
  { kind: "shelf", x: 1860, y: 60, w: 260, h: 40, tone: 0 },
  { kind: "shelf", x: 1860, y: 220, w: 260, h: 40, tone: 2 },
  // Loading dock: containers and the security booth (door at x 2040–2140)
  { kind: "container", x: 1820, y: 1040, w: 220, h: 80, tone: 1 },
  { kind: "machine", x: 1840, y: 700, w: 100, h: 60 },
  { kind: "wall", x: 1960, y: 1200, w: 80, h: 24 },
  { kind: "wall", x: 2140, y: 1200, w: 20, h: 24 },
  { kind: "wall", x: 1960, y: 1224, w: 24, h: 216 },
  // Fountain in the south plaza
  { kind: "water", x: 900, y: 1240, w: 200, h: 120 },
  { kind: "vending", x: 40, y: 1200, w: 52, h: 40, tone: 0 },
  { kind: "vending", x: 40, y: 80, w: 52, h: 40, tone: 1 },
);

props.push(
  // Food court
  { kind: "plant", x: 420, y: 80 },
  { kind: "bin", x: 200, y: 500 },
  { kind: "plant", x: 420, y: 820 },
  { kind: "bin", x: 200, y: 1150 },
  { kind: "cooler", x: 380, y: 1120 },
  // Hall edges
  { kind: "plant", x: 520, y: 120 },
  { kind: "bin", x: 1000, y: 110 },
  { kind: "box", x: 1300, y: 120, rot: 20 },
  { kind: "plant", x: 1640, y: 110 },
  { kind: "cone", x: 1720, y: 470 },
  { kind: "box", x: 1720, y: 830 },
  // Storeroom
  { kind: "box", x: 1880, y: 140 },
  { kind: "box", x: 1960, y: 150, rot: 30 },
  { kind: "barrel", x: 2090, y: 150 },
  { kind: "crate", x: 1900, y: 320 },
  { kind: "box", x: 2010, y: 300 },
  { kind: "barrel", x: 2100, y: 420 },
  { kind: "crate", x: 1850, y: 440 },
  // Loading dock
  { kind: "tires", x: 1880, y: 600 },
  { kind: "barrel", x: 2050, y: 620 },
  { kind: "barrel", x: 2090, y: 660 },
  { kind: "cone", x: 2000, y: 880 },
  { kind: "crate", x: 2100, y: 960 },
  { kind: "tires", x: 1800, y: 1180 },
  { kind: "box", x: 1880, y: 1300 },
  // South plaza
  { kind: "bin", x: 820, y: 1300 },
  { kind: "plant", x: 1160, y: 1300 },
  { kind: "cone", x: 600, y: 1360 },
  { kind: "cone", x: 1400, y: 1360 },
  { kind: "cooler", x: 1300, y: 1180 },
  { kind: "tires", x: 600, y: 1200 },
  { kind: "box", x: 1600, y: 1300 },
  { kind: "plant", x: 2100, y: 1160 },
);

const decor: DecorDef[] = [
  { kind: "paint", x: 500, y: 200, w: 1200, h: 6, tone: 3 },
  { kind: "paint", x: 500, y: 1180, w: 1200, h: 6, tone: 3 },
  { kind: "neonSign", x: 900, y: 20, w: 300, h: 34, label: "NIGHT MARKET" },
  { kind: "neonSign", x: 120, y: 200, w: 200, h: 26, label: "FOOD" },
  { kind: "stain", x: 700, y: 480, w: 120, h: 60 },
  { kind: "stain", x: 1400, y: 820, w: 140, h: 70 },
  { kind: "puddle", x: 1100, y: 1120, w: 140, h: 50 },
  { kind: "hazard", x: 1800, y: 1140, w: 340, h: 10 },
  { kind: "cables", x: 600, y: 860, w: 900, h: 10 },
];

const lights: LightDef[] = [
  ...ROWS.flatMap((y) =>
    [600, 1100, 1560].map((x) => ({ x, y: y + 25, radius: 230, color: 0xffc27a, intensity: 0.45 })),
  ),
  { x: 220, y: 450, radius: 280, color: 0xfff1d0, intensity: 0.45 },
  { x: 220, y: 950, radius: 280, color: 0xfff1d0, intensity: 0.4 },
  { x: 1980, y: 250, radius: 200, color: 0x9fd8ff, intensity: 0.35, flicker: 0.12 },
  { x: 1980, y: 850, radius: 260, color: 0xffb36b, intensity: 0.4 },
  { x: 1000, y: 1300, radius: 260, color: 0x6bd0ff, intensity: 0.45 },
  { x: 2060, y: 1320, radius: 160, color: 0x9fe7ff, intensity: 0.5 },
  { x: 1050, y: 40, radius: 200, color: 0xff5ab4, intensity: 0.5, flicker: 0.08 },
];

const spawns = [
  { x: 60, y: 460 },
  { x: 440, y: 470 },
  { x: 1120, y: 470 },
  { x: 1700, y: 640 },
  { x: 60, y: 800 },
  { x: 440, y: 1300 },
  { x: 1120, y: 810 },
  { x: 1700, y: 1060 },
  { x: 2100, y: 760 },
  { x: 700, y: 1140 },
  { x: 1500, y: 1140 },
  { x: 900, y: 140 },
];

const pickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1120, y: 1150, respawnSec: 20 },
  { id: "hp-b", kind: "health", x: 2000, y: 400, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 440, y: 800, respawnSec: 15 },
  { id: "wp-smg", kind: "weapon", weapon: "smg", x: 1700, y: 300, respawnSec: 25 },
];

const hideSpots: HideSpotDef[] = [
  { kind: "tarp", x: 2060, y: 380, r: 28 },
  { kind: "curtain", x: 700, y: 820, r: 24 },
  { kind: "curtain", x: 1420, y: 470, r: 24 },
  { kind: "bush", x: 160, y: 1360, r: 28 },
  { kind: "bush", x: 1720, y: 1360, r: 28 },
];

export const NIGHT_MARKET: MapDef = {
  id: "market",
  name: "Night Market",
  tagline: "Three rows of stalls, a food court, a storeroom and a loading dock. Party map.",
  width: W,
  height: H,
  theme: {
    floor: 0x322d33,
    floorAlt: 0x39333a,
    grid: 0x47404a,
    wall: 0x5d5560,
    wallTop: 0x81767f,
    shadow: 0x0b0a0c,
    ambient: 0x161317,
    accents: [0xd9534f, 0xe0a33a, 0x4fa37a, 0x5a7fd9],
    fog: 0x121014,
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
      { x: 2040, y: 1320 },
      { x: 2110, y: 1390 },
      { x: 2110, y: 1280 },
      { x: 2040, y: 1400 },
    ],
    hiderSpawns: [
      { x: 640, y: 470 },
      { x: 1360, y: 810 },
      { x: 240, y: 810 },
      { x: 880, y: 1150 },
      { x: 1600, y: 470 },
      { x: 1360, y: 140 },
    ],
    shadows: [
      { x: 1808, y: 0, w: 120, h: 60 },
      { x: 2040, y: 260, w: 120, h: 230 },
      { x: 0, y: 1260, w: 200, h: 180 },
      { x: 1600, y: 1240, w: 160, h: 200 },
      { x: 1700, y: 680, w: 100, h: 200 },
    ],
    hideSpots,
    props,
  },
};
