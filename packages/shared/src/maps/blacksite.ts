import { DIG_WALL, digger } from "./dig.ts";
import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef } from "./types.ts";

/**
 * Black Site: the underground laboratory of Outbreak's fourth mission. Authored as a route, not
 * mirrored: the freight lift lobby (west) → the forced blast door → the atrium, the hub of three
 * wings: security (north), the server room (past security), reactor control (south) → the
 * containment wing (east of the atrium, sealed) → the archive (south-east, behind automatic doors)
 * → primary containment, The Warden's hall (far east) → the service lift out (south of it).
 *
 * Mission doors (blast doors and automatic doors) are NOT solids here: the mission adds them to
 * the collision world while closed. Containment cells have glass fronts (fences: they stop bodies,
 * not bullets or sight) with a broken pane each.
 */

const W = 4400;
const H = 2800;
const T = DIG_WALL;
const { hall, corridor, bedrock } = digger(W, H);

const solids: SolidDef[] = [
  // Freight lift lobby (insertion).
  ...hall(80, 1060, 600, 700, { e: [[260, 440]] }),
  { kind: "machine", x: 520, y: 1100, w: 120, h: 56 },
  { kind: "crate", x: 120, y: 1090, w: 64, h: 64 },
  { kind: "crate", x: 184, y: 1090, w: 64, h: 64 },
  { kind: "container", x: 110, y: 1650, w: 220, h: 64, tone: 1 },
  { kind: "crate", x: 560, y: 1650, w: 64, h: 64 },

  // Entry corridor with the forced blast door (its buckled leaves narrow the way).
  ...corridor(680, 1320, 540, 180, true),
  { kind: "ruin", x: 980, y: 1320, w: 40, h: 34 },
  { kind: "ruin", x: 980, y: 1466, w: 40, h: 34 },

  // Atrium: the hub. West from the lobby, north to security, south to the reactor, east the
  // containment blast door (mission door).
  ...hall(1220, 960, 1000, 880, { w: [[360, 540]], n: [[420, 580]], s: [[420, 580]], e: [[300, 460]] }),
  { kind: "pillar", x: 1420, y: 1140, w: 64, h: 64 },
  { kind: "pillar", x: 1960, y: 1120, w: 64, h: 64 },
  { kind: "pillar", x: 1420, y: 1640, w: 64, h: 64 },
  { kind: "pillar", x: 1960, y: 1640, w: 64, h: 64 },
  { kind: "machine", x: 1600, y: 1580, w: 240, h: 56 },
  { kind: "crate", x: 1480, y: 1460, w: 120, h: 40 },
  { kind: "vending", x: 1256, y: 996, w: 40, h: 70, tone: 0 },
  { kind: "vending", x: 1300, y: 996, w: 40, h: 70, tone: 2 },
  { kind: "rock", x: 1270, y: 1740, w: 60, h: 60 },

  // Security office (north).
  ...corridor(1640, 820, 160, 140, false),
  ...hall(1220, 180, 1000, 640, { s: [[420, 580]], e: [[220, 380]] }),
  { kind: "machine", x: 1680, y: 210, w: 260, h: 48 },
  { kind: "crate", x: 1300, y: 260, w: 200, h: 48 },
  { kind: "crate", x: 1300, y: 460, w: 200, h: 48 },
  { kind: "crate", x: 1300, y: 660, w: 200, h: 48 },
  { kind: "vending", x: 2150, y: 640, w: 40, h: 70, tone: 1 },
  { kind: "container", x: 1980, y: 400, w: 48, h: 200, tone: 3 },

  // Server room (east of security): rows of racks with aisles.
  ...corridor(2220, 400, 240, 160, true),
  ...hall(2460, 180, 760, 640, { w: [[220, 380]], s: [[440, 600]] }),
  { kind: "machine", x: 2580, y: 230, w: 44, h: 220 },
  { kind: "machine", x: 2720, y: 230, w: 44, h: 220 },
  { kind: "machine", x: 2860, y: 230, w: 44, h: 220 },
  { kind: "machine", x: 3000, y: 230, w: 44, h: 220 },
  { kind: "machine", x: 2660, y: 600, w: 180, h: 56 },
  { kind: "tank", x: 3100, y: 600, w: 64, h: 64 },

  // Containment wing (east of the atrium): specimen cells with glass fronts along both sides.
  ...corridor(2220, 1260, 240, 160, true),
  ...corridor(2900, 820, 160, 140, false),
  ...hall(2460, 960, 1020, 880, { w: [[300, 460]], n: [[440, 600]], s: [[300, 460]], e: [[380, 540]] }),
  // North cells.
  { kind: "wall", x: 2724, y: 984, w: T, h: 200 },
  { kind: "fence", x: 2484, y: 1184, w: 150, h: 12 },
  { kind: "wall", x: 3076, y: 984, w: T, h: 200 },
  { kind: "wall", x: 3340, y: 984, w: T, h: 200 },
  { kind: "fence", x: 3190, y: 1184, w: 150, h: 12 },
  // South cells.
  { kind: "wall", x: 2724, y: 1616, w: T, h: 200 },
  { kind: "fence", x: 2484, y: 1604, w: 150, h: 12 },
  { kind: "wall", x: 3076, y: 1616, w: T, h: 200 },
  { kind: "wall", x: 3340, y: 1616, w: T, h: 200 },
  { kind: "fence", x: 3190, y: 1604, w: 150, h: 12 },
  // Specimen tanks in the hall (cover).
  { kind: "tank", x: 2640, y: 1380, w: 72, h: 72 },
  { kind: "tank", x: 3300, y: 1290, w: 72, h: 72 },
  { kind: "machine", x: 2820, y: 1260, w: 120, h: 48 },

  // Archive (south-east), behind automatic doors.
  ...corridor(2220, 2220, 240, 160, true),
  ...corridor(2760, 1840, 160, 140, false),
  ...hall(2460, 1980, 1020, 640, { w: [[240, 400]], n: [[300, 460]] }),
  { kind: "container", x: 3200, y: 2060, w: 48, h: 220, tone: 3 },
  { kind: "container", x: 3320, y: 2060, w: 48, h: 220, tone: 0 },
  { kind: "container", x: 3200, y: 2360, w: 48, h: 220, tone: 1 },
  { kind: "container", x: 3320, y: 2360, w: 48, h: 220, tone: 3 },
  { kind: "crate", x: 2560, y: 2460, w: 140, h: 56 },
  { kind: "crate", x: 2600, y: 2080, w: 120, h: 48 },

  // Reactor control (south).
  ...corridor(1640, 1840, 160, 140, false),
  ...hall(1220, 1980, 1000, 640, { n: [[420, 580]], e: [[240, 400]] }),
  { kind: "tank", x: 1320, y: 2080, w: 200, h: 200 },
  { kind: "machine", x: 1900, y: 2030, w: 220, h: 56 },
  { kind: "machine", x: 1260, y: 2470, w: 140, h: 100 },
  { kind: "machine", x: 1880, y: 2300, w: 56, h: 160 },

  // Primary containment: The Warden's hall. Pillars to break its charges on.
  ...corridor(3480, 1340, 220, 160, true),
  ...hall(3700, 720, 620, 1240, { w: [[620, 780]], s: [[220, 400]] }),
  { kind: "pillar", x: 3850, y: 980, w: 72, h: 72 },
  { kind: "pillar", x: 4150, y: 980, w: 72, h: 72 },
  { kind: "pillar", x: 3850, y: 1620, w: 72, h: 72 },
  { kind: "pillar", x: 4150, y: 1620, w: 72, h: 72 },
  { kind: "ruin", x: 3986, y: 1310, w: 56, h: 56 },

  // Service lift (extraction), south of primary containment.
  ...corridor(3920, 1960, 180, 120, false),
  ...hall(3700, 2080, 620, 580, { n: [[220, 400]] }),
  { kind: "machine", x: 3740, y: 2120, w: 56, h: 100 },
];

solids.push(...bedrock());

const decor: DecorDef[] = [
  // Lift platform and its stripes.
  { kind: "grate", x: 160, y: 1180, w: 340, h: 260 },
  { kind: "hazard", x: 160, y: 1440, w: 340, h: 14 },
  // Corridor: cables, scorch marks from the breach.
  { kind: "cables", x: 700, y: 1330, w: 500, h: 12 },
  { kind: "stain", x: 940, y: 1350, w: 140, h: 120 },
  { kind: "hazard", x: 1220, y: 1320, w: 14, h: 180 },
  // Atrium.
  { kind: "paint", x: 1560, y: 1300, w: 320, h: 120, tone: 0 },
  { kind: "stain", x: 1800, y: 1400, w: 200, h: 160 },
  { kind: "stain", x: 1300, y: 1200, w: 120, h: 120 },
  { kind: "hazard", x: 2180, y: 1260, w: 14, h: 160 },
  // Security, servers.
  { kind: "cables", x: 2480, y: 520, w: 480, h: 12 },
  { kind: "grate", x: 2640, y: 470, w: 380, h: 40 },
  // Containment: decontamination vent grate, stains, cell numbers.
  { kind: "grate", x: 3000, y: 1208, w: 160, h: 384 },
  { kind: "hazard", x: 3000, y: 1196, w: 160, h: 12 },
  { kind: "hazard", x: 3000, y: 1592, w: 160, h: 12 },
  { kind: "stain", x: 2560, y: 1250, w: 200, h: 160 },
  { kind: "stain", x: 3180, y: 1460, w: 220, h: 140 },
  { kind: "paint", x: 2490, y: 990, w: 60, h: 24, tone: 1 },
  { kind: "paint", x: 3106, y: 990, w: 60, h: 24, tone: 1 },
  { kind: "paint", x: 2490, y: 1786, w: 60, h: 24, tone: 1 },
  { kind: "paint", x: 3106, y: 1786, w: 60, h: 24, tone: 1 },
  // Archive vent.
  { kind: "grate", x: 2960, y: 2004, w: 160, h: 592 },
  { kind: "stain", x: 2640, y: 2240, w: 200, h: 160 },
  // Reactor.
  { kind: "cables", x: 1520, y: 2180, w: 380, h: 12 },
  { kind: "cables", x: 1520, y: 2210, w: 380, h: 12 },
  { kind: "hazard", x: 1300, y: 2060, w: 240, h: 12 },
  // Primary containment: vents in two corners, claw marks, the Warden's broken restraints.
  { kind: "grate", x: 3724, y: 744, w: 200, h: 200 },
  { kind: "grate", x: 4096, y: 1736, w: 200, h: 200 },
  { kind: "stain", x: 3920, y: 1240, w: 200, h: 200 },
  { kind: "bones", x: 3800, y: 1400, w: 80, h: 60 },
  { kind: "bones", x: 4180, y: 1200, w: 80, h: 60 },
  { kind: "paint", x: 3760, y: 800, w: 500, h: 1080, tone: 1 },
  // Service lift platform.
  { kind: "grate", x: 3780, y: 2200, w: 460, h: 380 },
  { kind: "hazard", x: 3780, y: 2186, w: 460, h: 14 },
];

const EMERGENCY = 0xff3b30;
const COLD = 0xd6ecff;

const lights: LightDef[] = [
  // Emergency lighting: dim red, on while the main power is out (or in a blackout).
  ...(
    [
      [380, 1220],
      [950, 1410],
      [1400, 1100],
      [2050, 1720],
      [1720, 890],
      [1720, 1910],
      [1720, 500],
      [2800, 520],
      [1720, 2300],
      [2700, 1400],
      [3250, 1420],
      [2700, 2300],
      [3300, 2200],
      [4010, 1100],
      [4010, 1700],
      [4010, 2350],
    ] as const
  ).map(
    ([x, y]): LightDef => ({
      x,
      y,
      radius: 210,
      color: EMERGENCY,
      intensity: 0.3,
      flicker: 0.45,
      group: "emergency",
    }),
  ),
  // Main lights (power). Some tubes stutter: containment and the hall never got fixed.
  { x: 380, y: 1400, radius: 320, color: COLD, intensity: 0.38, group: "power" },
  { x: 900, y: 1410, radius: 260, color: COLD, intensity: 0.32, flicker: 0.6, group: "power" },
  { x: 1450, y: 1240, radius: 340, color: COLD, intensity: 0.4, group: "power" },
  { x: 1990, y: 1240, radius: 340, color: COLD, intensity: 0.4, group: "power" },
  { x: 1720, y: 1700, radius: 320, color: COLD, intensity: 0.36, group: "power" },
  { x: 1480, y: 420, radius: 340, color: COLD, intensity: 0.38, group: "power" },
  { x: 1980, y: 600, radius: 300, color: COLD, intensity: 0.34, flicker: 0.2, group: "power" },
  { x: 2700, y: 360, radius: 320, color: 0x7fe0ff, intensity: 0.4, group: "power" },
  { x: 3080, y: 520, radius: 300, color: 0x7fe0ff, intensity: 0.36, group: "power" },
  { x: 1500, y: 2380, radius: 320, color: 0xffd9a0, intensity: 0.36, flicker: 0.15, group: "power" },
  { x: 1420, y: 2180, radius: 240, color: 0x6ad8ff, intensity: 0.45, group: "power" },
  { x: 2000, y: 2400, radius: 300, color: 0xffd9a0, intensity: 0.34, group: "power" },
  { x: 2620, y: 1400, radius: 300, color: COLD, intensity: 0.34, flicker: 0.4, group: "power" },
  { x: 3080, y: 1400, radius: 300, color: COLD, intensity: 0.32, flicker: 0.55, group: "power" },
  { x: 3320, y: 1700, radius: 260, color: COLD, intensity: 0.3, flicker: 0.35, group: "power" },
  { x: 2700, y: 2200, radius: 300, color: 0xffe2b0, intensity: 0.32, flicker: 0.25, group: "power" },
  { x: 3260, y: 2460, radius: 280, color: 0xffe2b0, intensity: 0.3, group: "power" },
  { x: 3860, y: 1100, radius: 300, color: COLD, intensity: 0.34, flicker: 0.45, group: "power" },
  { x: 4160, y: 1340, radius: 320, color: COLD, intensity: 0.36, flicker: 0.3, group: "power" },
  { x: 3860, y: 1720, radius: 300, color: COLD, intensity: 0.32, flicker: 0.6, group: "power" },
  { x: 4010, y: 2380, radius: 360, color: 0xfff1c8, intensity: 0.42, group: "power" },
  // Alarm beacons (pulse red while the alarm sounds).
  { x: 2120, y: 1340, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 2600, y: 1100, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 3300, y: 1720, radius: 260, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  { x: 3600, y: 1420, radius: 220, color: 0xff3d3d, intensity: 0.5, group: "alarm" },
  // Specimen tanks glow on their own.
  { x: 2676, y: 1416, radius: 130, color: 0x7dff9a, intensity: 0.32, flicker: 0.3 },
  { x: 3336, y: 1326, radius: 130, color: 0x7dff9a, intensity: 0.32, flicker: 0.3 },
  { x: 3132, y: 632, radius: 110, color: 0x7dff9a, intensity: 0.28, flicker: 0.2 },
];

const spawns = [
  { x: 220, y: 1300 },
  { x: 300, y: 1360 },
  { x: 380, y: 1300 },
  { x: 460, y: 1360 },
  { x: 220, y: 1500 },
  { x: 300, y: 1560 },
  { x: 380, y: 1500 },
  { x: 460, y: 1560 },
];

const pickups: PickupDef[] = [
  { id: "am-lobby", kind: "ammo", x: 560, y: 1580, respawnSec: 35 },
  { id: "hp-atrium", kind: "health", x: 1300, y: 1520, respawnSec: 45 },
  { id: "am-atrium", kind: "ammo", x: 2120, y: 1720, respawnSec: 30 },
  { id: "wp-shotgun-sec", kind: "weapon", weapon: "shotgun", x: 2100, y: 740, respawnSec: 40 },
  { id: "am-sec", kind: "ammo", x: 1580, y: 600, respawnSec: 35 },
  { id: "am-server", kind: "ammo", x: 3140, y: 720, respawnSec: 35 },
  { id: "hp-reactor", kind: "health", x: 2120, y: 2540, respawnSec: 45 },
  { id: "hp-cont", kind: "health", x: 2600, y: 1540, respawnSec: 40 },
  { id: "am-cont", kind: "ammo", x: 3400, y: 1240, respawnSec: 30 },
  { id: "wp-sniper-archive", kind: "weapon", weapon: "sniper", x: 2560, y: 2380, respawnSec: 45 },
  { id: "am-archive", kind: "ammo", x: 3420, y: 2320, respawnSec: 30 },
  { id: "hp-vault", kind: "health", x: 3600, y: 1460, respawnSec: 40 },
  { id: "am-vault", kind: "ammo", x: 3560, y: 1380, respawnSec: 30 },
  { id: "hp-lift", kind: "health", x: 4250, y: 2600, respawnSec: 40 },
  { id: "am-lift", kind: "ammo", x: 3780, y: 2600, respawnSec: 30 },
];

export const BLACK_SITE: MapDef = {
  id: "blacksite",
  name: "Black Site",
  tagline: "Forty metres under the quarry. The lights remember the power; the cells remember them.",
  width: W,
  height: H,
  theme: {
    floor: 0x1d2225,
    floorAlt: 0x22292d,
    grid: 0x2b3337,
    wall: 0x3d464c,
    wallTop: 0x58646c,
    shadow: 0x050607,
    ambient: 0x090c0e,
    accents: [0x2a7a80, 0x8a2a2a, 0x667a2a, 0x9aa4a8],
    fog: 0x07090a,
  },
  solids,
  decor,
  lights,
  spawns,
  pickups,
  large: true,
  pve: true,
};
