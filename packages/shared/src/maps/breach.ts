import { digger } from "./dig.ts";
import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";

/**
 * Final Breach: the research complex at the end of the campaign, dug out of rock like Black Site.
 * The loading dock (west) → maintenance tunnels (narrow, infiltration) → the research atrium
 * (waves) → the cryo lab (the decryption rig to defend) → the core descent → the core hall
 * (Subject Zero's arena, vents that wake up as it weakens) → the service shaft (the escape) → the
 * evac hangar (north-east).
 *
 * Mission doors are not solids here: the mission adds them while closed.
 */

const W = 5700;
const H = 3000;
const { hall, corridor, bedrock } = digger(W, H);

const solids: SolidDef[] = [
  // Loading dock (insertion).
  ...hall(80, 1200, 640, 640, { e: [[280, 400]] }),
  { kind: "container", x: 120, y: 1240, w: 220, h: 64, tone: 2 },
  { kind: "crate", x: 560, y: 1700, w: 64, h: 64 },
  { kind: "crate", x: 624, y: 1700, w: 64, h: 64 },
  // Maintenance tunnels: narrow, two junctions.
  ...corridor(720, 1480, 520, 120, true),
  ...hall(1240, 1300, 360, 480, { w: [[180, 300]], n: [[120, 240]] }),
  { kind: "machine", x: 1500, y: 1650, w: 70, h: 100 },
  ...corridor(1360, 900, 120, 400, false),
  ...hall(1240, 560, 600, 340, { s: [[120, 240]], e: [[120, 240]] }),
  { kind: "tank", x: 1280, y: 600, w: 60, h: 60 },
  { kind: "machine", x: 1640, y: 590, w: 160, h: 50 },
  ...corridor(1840, 680, 360, 120, true),
  // Research atrium: the waves.
  ...hall(2200, 400, 1200, 1400, { w: [[280, 400]], s: [[520, 680]], e: [[600, 760]] }),
  { kind: "pillar", x: 2500, y: 640, w: 64, h: 64 },
  { kind: "pillar", x: 3060, y: 640, w: 64, h: 64 },
  { kind: "pillar", x: 2500, y: 1480, w: 64, h: 64 },
  { kind: "pillar", x: 3060, y: 1480, w: 64, h: 64 },
  { kind: "machine", x: 2700, y: 900, w: 220, h: 56 },
  { kind: "machine", x: 2700, y: 1280, w: 220, h: 56 },
  { kind: "vending", x: 2240, y: 440, w: 40, h: 70, tone: 1 },
  { kind: "rock", x: 2240, y: 1700, w: 60, h: 60 },
  { kind: "rock", x: 3300, y: 1700, w: 60, h: 60 },
  // Cryo lab: the decryption rig in the middle, cryo pods for cover.
  ...corridor(2720, 1800, 160, 200, false),
  ...hall(2300, 2000, 1000, 820, { n: [[420, 580]] }),
  { kind: "tank", x: 2420, y: 2120, w: 64, h: 64 },
  { kind: "tank", x: 2420, y: 2620, w: 64, h: 64 },
  { kind: "tank", x: 3140, y: 2120, w: 64, h: 64 },
  { kind: "tank", x: 3140, y: 2620, w: 64, h: 64 },
  { kind: "machine", x: 2600, y: 2300, w: 40, h: 120 },
  { kind: "machine", x: 2960, y: 2300, w: 40, h: 120 },
  // Core descent and the antechamber.
  ...corridor(3400, 1000, 500, 160, true),
  ...hall(3900, 800, 400, 560, { w: [[200, 360]], s: [[180, 320]] }),
  { kind: "crate", x: 3940, y: 840, w: 64, h: 64 },
  { kind: "crate", x: 4200, y: 1240, w: 64, h: 64 },
  // The core hall: Subject Zero's arena. Pillars to break its charges on.
  ...corridor(4080, 1360, 140, 160, false),
  ...hall(3700, 1520, 1100, 1300, { n: [[380, 520]], e: [[560, 720]] }),
  { kind: "pillar", x: 3950, y: 1800, w: 80, h: 80 },
  { kind: "pillar", x: 4470, y: 1800, w: 80, h: 80 },
  { kind: "pillar", x: 3950, y: 2460, w: 80, h: 80 },
  { kind: "pillar", x: 4470, y: 2460, w: 80, h: 80 },
  // The service shaft (escape), debris to weave around, and the evac hangar.
  ...corridor(4800, 2080, 240, 160, true),
  ...hall(5040, 600, 360, 1800, { w: [[1480, 1640]], n: [[100, 260]] }),
  { kind: "ruin", x: 5064, y: 1800, w: 130, h: 40 },
  { kind: "ruin", x: 5246, y: 1400, w: 130, h: 40 },
  { kind: "ruin", x: 5064, y: 1000, w: 130, h: 40 },
  ...corridor(5140, 400, 160, 200, false),
  ...hall(4700, 60, 900, 340, { s: [[440, 600]] }),
  { kind: "container", x: 4740, y: 100, w: 64, h: 200, tone: 0 },
];

solids.push(...bedrock());

const decor: DecorDef[] = [
  { kind: "hazard", x: 120, y: 1460, w: 14, h: 160 },
  { kind: "cables", x: 740, y: 1490, w: 480, h: 12 },
  { kind: "cables", x: 1350, y: 920, w: 12, h: 360 },
  { kind: "stain", x: 1300, y: 1400, w: 160, h: 140 },
  { kind: "paint", x: 2560, y: 1060, w: 500, h: 160, tone: 0 },
  { kind: "stain", x: 2900, y: 600, w: 200, h: 160 },
  { kind: "hazard", x: 2720, y: 1760, w: 160, h: 14 },
  { kind: "grate", x: 2700, y: 2350, w: 200, h: 200 },
  { kind: "stain", x: 2440, y: 2400, w: 180, h: 160 },
  { kind: "cables", x: 3420, y: 1010, w: 460, h: 12 },
  { kind: "hazard", x: 4080, y: 1500, w: 140, h: 14 },
  // Core hall: vent grates (they wake up as the boss weakens), the core's scorch.
  { kind: "grate", x: 3724, y: 1544, w: 260, h: 260 },
  { kind: "grate", x: 4516, y: 1544, w: 260, h: 260 },
  { kind: "grate", x: 3724, y: 2536, w: 260, h: 260 },
  { kind: "grate", x: 4516, y: 2536, w: 260, h: 260 },
  { kind: "grate", x: 4180, y: 1544, w: 120, h: 1252 },
  { kind: "grate", x: 3724, y: 2110, w: 1052, h: 120 },
  { kind: "stain", x: 4100, y: 2060, w: 300, h: 260 },
  { kind: "bones", x: 3900, y: 2200, w: 80, h: 60 },
  { kind: "bones", x: 4560, y: 2000, w: 80, h: 60 },
  { kind: "hazard", x: 4776, y: 2060, w: 24, h: 14 },
  { kind: "cables", x: 5080, y: 700, w: 12, h: 1600 },
  { kind: "grate", x: 4800, y: 120, w: 720, h: 220 },
  { kind: "hazard", x: 4800, y: 340, w: 720, h: 14 },
];

const COLD = 0xd6ecff;
const EMERGENCY = 0xff3b30;

const lights: LightDef[] = [
  // Main lights (the complex has power).
  { x: 400, y: 1520, radius: 340, color: COLD, intensity: 0.36, group: "power" },
  { x: 980, y: 1540, radius: 220, color: COLD, intensity: 0.26, flicker: 0.5, group: "power" },
  { x: 1420, y: 1540, radius: 260, color: COLD, intensity: 0.3, flicker: 0.3, group: "power" },
  { x: 1540, y: 730, radius: 300, color: COLD, intensity: 0.3, flicker: 0.4, group: "power" },
  { x: 2500, y: 900, radius: 380, color: COLD, intensity: 0.4, group: "power" },
  { x: 3100, y: 900, radius: 380, color: COLD, intensity: 0.4, group: "power" },
  { x: 2800, y: 1550, radius: 380, color: COLD, intensity: 0.38, group: "power" },
  { x: 2800, y: 2400, radius: 420, color: 0x8fe8ff, intensity: 0.4, group: "power" },
  { x: 3650, y: 1080, radius: 260, color: COLD, intensity: 0.3, flicker: 0.5, group: "power" },
  { x: 4100, y: 1080, radius: 300, color: COLD, intensity: 0.34, group: "power" },
  { x: 3980, y: 1840, radius: 360, color: 0xffd0e8, intensity: 0.36, flicker: 0.25, group: "power" },
  { x: 4520, y: 1840, radius: 360, color: 0xffd0e8, intensity: 0.36, flicker: 0.35, group: "power" },
  { x: 3980, y: 2500, radius: 360, color: 0xffd0e8, intensity: 0.36, flicker: 0.3, group: "power" },
  { x: 4520, y: 2500, radius: 360, color: 0xffd0e8, intensity: 0.36, flicker: 0.45, group: "power" },
  { x: 5220, y: 2000, radius: 300, color: COLD, intensity: 0.32, flicker: 0.4, group: "power" },
  { x: 5220, y: 1200, radius: 300, color: COLD, intensity: 0.32, flicker: 0.4, group: "power" },
  { x: 5150, y: 230, radius: 420, color: 0xfff1c8, intensity: 0.42, group: "power" },
  // Emergency lights (the blackout in the last phase, and anywhere the power fails).
  ...(
    [
      [3980, 1700],
      [4520, 1700],
      [3980, 2640],
      [4520, 2640],
      [4250, 2170],
      [5220, 1600],
      [5220, 800],
    ] as const
  ).map(
    ([x, y]): LightDef => ({
      x,
      y,
      radius: 220,
      color: EMERGENCY,
      intensity: 0.32,
      flicker: 0.45,
      group: "emergency",
    }),
  ),
  // Alarm beacons: the core hall and the escape route.
  { x: 4250, y: 1600, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 4250, y: 2740, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 5220, y: 2160, radius: 240, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 5220, y: 700, radius: 240, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  // The rig and the cryo pods glow on their own.
  { x: 2800, y: 2450, radius: 160, color: 0x7dffb0, intensity: 0.4, flicker: 0.15 },
  { x: 2452, y: 2152, radius: 110, color: 0x8fe8ff, intensity: 0.28 },
  { x: 3172, y: 2652, radius: 110, color: 0x8fe8ff, intensity: 0.28 },
];

const spawns = [
  { x: 260, y: 1400 },
  { x: 340, y: 1460 },
  { x: 420, y: 1400 },
  { x: 500, y: 1460 },
  { x: 260, y: 1580 },
  { x: 340, y: 1640 },
  { x: 420, y: 1580 },
  { x: 500, y: 1640 },
];

const pickups: PickupDef[] = [
  { id: "am-dock", kind: "ammo", x: 640, y: 1260, respawnSec: 35 },
  { id: "hp-tunnel", kind: "health", x: 1300, y: 1720, respawnSec: 45 },
  { id: "am-atrium-w", kind: "ammo", x: 2280, y: 1100, respawnSec: 30 },
  { id: "hp-atrium", kind: "health", x: 3320, y: 460, respawnSec: 45 },
  { id: "am-atrium-e", kind: "ammo", x: 3320, y: 1400, respawnSec: 30 },
  { id: "wp-shotgun-atrium", kind: "weapon", weapon: "shotgun", x: 2280, y: 1600, respawnSec: 40 },
  { id: "am-cryo", kind: "ammo", x: 2360, y: 2400, respawnSec: 30 },
  { id: "hp-cryo", kind: "health", x: 3240, y: 2400, respawnSec: 45 },
  { id: "wp-sniper-ante", kind: "weapon", weapon: "sniper", x: 4240, y: 860, respawnSec: 60 },
  { id: "am-ante", kind: "ammo", x: 3960, y: 1300, respawnSec: 30 },
  // The core hall: little, far between, slow to come back (manage it).
  { id: "am-core-w", kind: "ammo", x: 3760, y: 2170, respawnSec: 50 },
  { id: "am-core-e", kind: "ammo", x: 4740, y: 1900, respawnSec: 50 },
  { id: "hp-core", kind: "health", x: 4740, y: 2440, respawnSec: 60 },
  { id: "am-shaft", kind: "ammo", x: 5340, y: 1600, respawnSec: 30 },
  { id: "hp-hangar", kind: "health", x: 5540, y: 340, respawnSec: 45 },
  { id: "am-hangar", kind: "ammo", x: 4840, y: 340, respawnSec: 30 },
];

export const FINAL_BREACH: MapDef = {
  id: "breach",
  name: "Final Breach",
  tagline: "Where it started. Where it ends, one way or the other.",
  width: W,
  height: H,
  theme: {
    floor: 0x1f2024,
    floorAlt: 0x24262b,
    grid: 0x2d2f35,
    wall: 0x3f4148,
    wallTop: 0x5c5f68,
    shadow: 0x050506,
    ambient: 0x0b0b0e,
    accents: [0x7a2a5a, 0x2a7a80, 0x8a2a2a, 0x9aa0a8],
    fog: 0x08080a,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  large: true,
  pve: true,
};
