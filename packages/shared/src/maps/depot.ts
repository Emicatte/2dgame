import type { DecorDef, LightDef, MapDef, PickupDef, PropSpotDef, SolidDef } from "./types.ts";

/**
 * Salvage Depot: the first party map (Prop Hunt, Hide & Seek). A racked warehouse, two offices and
 * a yard, full of the small objects props can turn into, with dark corners, tarps to crawl under
 * and a security booth where the seekers wait out the hiding time. Compact on purpose: 2–8
 * players, no empty ground.
 */
const W = 2240;
const H = 1440;

const solids: SolidDef[] = [
  // Divider between the warehouse and the east wing (door A at y 288–400, door B at 1008–1120)
  { kind: "wall", x: 1440, y: 0, w: 32, h: 288 },
  { kind: "wall", x: 1440, y: 400, w: 32, h: 608 },
  { kind: "wall", x: 1440, y: 1120, w: 32, h: 320 },
  // Offices / yard divider (office door at x 1780–1892)
  { kind: "wall", x: 1472, y: 640, w: 308, h: 32 },
  { kind: "wall", x: 1892, y: 640, w: 348, h: 32 },
  // Partition between the two offices (open towards the corridor)
  { kind: "wall", x: 1856, y: 0, w: 24, h: 424 },
  // Desks
  { kind: "desk", x: 1530, y: 90, w: 120, h: 56 },
  { kind: "desk", x: 1530, y: 260, w: 120, h: 56 },
  { kind: "desk", x: 1940, y: 96, w: 140, h: 56 },
  { kind: "desk", x: 2040, y: 300, w: 140, h: 56 },
  // Warehouse racks: four rows of two, cross aisle at x 608–768
  { kind: "shelf", x: 128, y: 192, w: 480, h: 48, tone: 0 },
  { kind: "shelf", x: 768, y: 192, w: 480, h: 48, tone: 1 },
  { kind: "shelf", x: 128, y: 432, w: 480, h: 48, tone: 2 },
  { kind: "shelf", x: 768, y: 432, w: 480, h: 48, tone: 0 },
  { kind: "shelf", x: 128, y: 912, w: 480, h: 48, tone: 1 },
  { kind: "shelf", x: 768, y: 912, w: 480, h: 48, tone: 2 },
  { kind: "shelf", x: 128, y: 1152, w: 480, h: 48, tone: 0 },
  { kind: "shelf", x: 768, y: 1152, w: 480, h: 48, tone: 1 },
  // Pallet stacks on the open floor
  { kind: "crate", x: 300, y: 620, w: 64, h: 64 },
  { kind: "crate", x: 364, y: 620, w: 64, h: 64 },
  { kind: "crate", x: 300, y: 684, w: 64, h: 64 },
  { kind: "crate", x: 900, y: 560, w: 64, h: 64 },
  { kind: "crate", x: 1000, y: 760, w: 64, h: 64 },
  { kind: "crate", x: 1064, y: 760, w: 64, h: 64 },
  // Yard
  { kind: "container", x: 1600, y: 780, w: 256, h: 80, tone: 0 },
  { kind: "container", x: 2080, y: 760, w: 80, h: 224, tone: 2 },
  { kind: "machine", x: 1700, y: 1180, w: 96, h: 64 },
  // Security booth (seeker pen), door at x 2048–2160
  { kind: "wall", x: 1952, y: 1232, w: 96, h: 24 },
  { kind: "wall", x: 2160, y: 1232, w: 80, h: 24 },
  { kind: "wall", x: 1952, y: 1256, w: 24, h: 184 },
];

const decor: DecorDef[] = [
  { kind: "hazard", x: 1420, y: 288, w: 16, h: 112 },
  { kind: "hazard", x: 1420, y: 1008, w: 16, h: 112 },
  { kind: "hazard", x: 2048, y: 1220, w: 112, h: 10 },
  { kind: "paint", x: 640, y: 0, w: 6, h: 1440, tone: 3 },
  { kind: "paint", x: 728, y: 0, w: 6, h: 1440, tone: 3 },
  { kind: "grate", x: 1520, y: 470, w: 160, h: 90 },
  { kind: "stain", x: 980, y: 640, w: 120, h: 70 },
  { kind: "stain", x: 1900, y: 1120, w: 140, h: 80 },
  { kind: "stain", x: 260, y: 1010, w: 90, h: 60 },
  { kind: "cables", x: 1880, y: 440, w: 160, h: 12 },
  { kind: "tracks", x: 1500, y: 700, w: 700, h: 40 },
];

const lights: LightDef[] = [
  { x: 360, y: 320, radius: 260, color: 0xffd9a0, intensity: 0.45 },
  { x: 940, y: 700, radius: 300, color: 0xffb36b, intensity: 0.5, flicker: 0.12 },
  { x: 360, y: 1060, radius: 240, color: 0xffd9a0, intensity: 0.4 },
  { x: 1100, y: 1310, radius: 240, color: 0x9fd8ff, intensity: 0.35 },
  { x: 1660, y: 200, radius: 220, color: 0xfff1d0, intensity: 0.45 },
  { x: 2060, y: 220, radius: 220, color: 0xfff1d0, intensity: 0.45 },
  { x: 1820, y: 1010, radius: 280, color: 0xffb36b, intensity: 0.45 },
  { x: 2100, y: 1340, radius: 160, color: 0x9fe7ff, intensity: 0.5 },
];

const spawns = [
  { x: 64, y: 64 },
  { x: 700, y: 320 },
  { x: 1340, y: 80 },
  { x: 64, y: 1380 },
  { x: 700, y: 1040 },
  { x: 1340, y: 1380 },
  { x: 1650, y: 520 },
  { x: 2150, y: 560 },
  { x: 1520, y: 1300 },
  { x: 1800, y: 920 },
  { x: 1100, y: 1400 },
  { x: 2200, y: 860 },
];

const pickups: PickupDef[] = [
  { id: "hp-a", kind: "health", x: 1340, y: 700, respawnSec: 20 },
  { id: "hp-b", kind: "health", x: 1700, y: 1380, respawnSec: 20 },
  { id: "am-a", kind: "ammo", x: 688, y: 1300, respawnSec: 15 },
  { id: "wp-shotgun", kind: "weapon", weapon: "shotgun", x: 1960, y: 220, respawnSec: 25 },
  { id: "wp-smg", kind: "weapon", weapon: "smg", x: 80, y: 330, respawnSec: 25 },
];

const props: PropSpotDef[] = [
  // Warehouse, north aisle
  { kind: "box", x: 200, y: 90 },
  { kind: "box", x: 236, y: 116, rot: 12 },
  { kind: "barrel", x: 420, y: 64 },
  { kind: "crate", x: 560, y: 110 },
  { kind: "barrel", x: 900, y: 70 },
  { kind: "box", x: 1000, y: 120, rot: -8 },
  { kind: "crate", x: 1180, y: 80 },
  { kind: "bin", x: 1300, y: 150 },
  // Aisle 2
  { kind: "barrel", x: 400, y: 280 },
  { kind: "box", x: 520, y: 380, rot: 20 },
  { kind: "cooler", x: 860, y: 300 },
  { kind: "box", x: 1000, y: 380 },
  { kind: "barrel", x: 1180, y: 300 },
  // Open floor
  { kind: "barrel", x: 220, y: 540 },
  { kind: "tires", x: 600, y: 540 },
  { kind: "box", x: 700, y: 760, rot: -15 },
  { kind: "cooler", x: 480, y: 880 },
  { kind: "barrel", x: 820, y: 870 },
  { kind: "crate", x: 1210, y: 860 },
  { kind: "box", x: 1300, y: 560 },
  { kind: "bin", x: 1380, y: 820 },
  { kind: "cone", x: 1040, y: 520 },
  // Aisle 4
  { kind: "box", x: 200, y: 1050 },
  { kind: "barrel", x: 400, y: 1000 },
  { kind: "crate", x: 540, y: 1100 },
  { kind: "box", x: 900, y: 1000, rot: 25 },
  { kind: "cooler", x: 1100, y: 1100 },
  { kind: "barrel", x: 1300, y: 1050 },
  // South aisle
  { kind: "box", x: 150, y: 1270 },
  { kind: "barrel", x: 600, y: 1300 },
  { kind: "crate", x: 800, y: 1380 },
  { kind: "box", x: 1000, y: 1300 },
  { kind: "bin", x: 1180, y: 1390 },
  // Offices
  { kind: "chair", x: 1590, y: 176 },
  { kind: "chair", x: 1590, y: 346 },
  { kind: "plant", x: 1820, y: 30 },
  { kind: "box", x: 1800, y: 380 },
  { kind: "cooler", x: 1700, y: 30 },
  { kind: "chair", x: 2010, y: 178 },
  { kind: "chair", x: 2110, y: 270 },
  { kind: "plant", x: 2210, y: 30 },
  { kind: "vending", x: 2190, y: 200 },
  { kind: "bin", x: 1920, y: 390 },
  // Corridor
  { kind: "plant", x: 1500, y: 600 },
  { kind: "bin", x: 2200, y: 600 },
  { kind: "chair", x: 2000, y: 500, rot: 30 },
  // Yard
  { kind: "barrel", x: 1520, y: 900 },
  { kind: "barrel", x: 1562, y: 900 },
  { kind: "barrel", x: 1541, y: 940 },
  { kind: "tires", x: 1700, y: 1000 },
  { kind: "tires", x: 1900, y: 1100 },
  { kind: "cone", x: 1660, y: 700 },
  { kind: "cone", x: 1960, y: 1180 },
  { kind: "cone", x: 1840, y: 1210 },
  { kind: "bin", x: 2200, y: 1000 },
  { kind: "crate", x: 1900, y: 880 },
  { kind: "crate", x: 1950, y: 930 },
  { kind: "cooler", x: 1600, y: 1380 },
  { kind: "box", x: 1500, y: 1200 },
];

export const SALVAGE_DEPOT: MapDef = {
  id: "depot",
  name: "Salvage Depot",
  tagline: "Racked warehouse, offices and a yard full of things to hide as. Party map.",
  width: W,
  height: H,
  theme: {
    floor: 0x34322f,
    floorAlt: 0x3c3935,
    grid: 0x47433e,
    wall: 0x5c5850,
    wallTop: 0x7d786e,
    shadow: 0x0b0b0a,
    ambient: 0x161513,
    accents: [0xc8622f, 0x2f6e8a, 0x8a8f3a, 0xe0a33a],
    fog: 0x111110,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  modes: ["deathmatch", "gungame", "hideseek", "prophunt"],
  players: { min: 2, max: 8 },
  party: {
    seekerPen: [
      { x: 2040, y: 1330 },
      { x: 2110, y: 1390 },
      { x: 2180, y: 1320 },
      { x: 2040, y: 1400 },
    ],
    hiderSpawns: [
      { x: 450, y: 560 },
      { x: 520, y: 800 },
      { x: 800, y: 640 },
      { x: 1180, y: 620 },
      { x: 640, y: 860 },
      { x: 1300, y: 700 },
    ],
    shadows: [
      { x: 0, y: 0, w: 128, h: 192 },
      { x: 1248, y: 1200, w: 192, h: 240 },
      { x: 1600, y: 860, w: 256, h: 100 },
      { x: 608, y: 960, w: 160, h: 192 },
      { x: 2160, y: 672, w: 80, h: 320 },
    ],
    hideSpots: [
      { kind: "tarp", x: 420, y: 1330, r: 30 },
      { kind: "tarp", x: 1100, y: 330, r: 30 },
      { kind: "curtain", x: 1500, y: 40, r: 26 },
      { kind: "bush", x: 1520, y: 720, r: 30 },
      { kind: "bush", x: 2210, y: 1100, r: 28 },
    ],
    props,
  },
};
