import type { Vec2 } from "../sim/math.ts";
import { mulberry32 } from "../sim/rng.ts";
import type { DecorDef, LightDef, MapDef, PickupDef, SolidDef, SolidKind, VehicleSpawnDef } from "./types.ts";

/**
 * Scrapline Isle, the Battle Royale map: 4×4 districts of 1024 px separated by roads, each built
 * from its kind's rules (city blocks, houses, yards, docks, a fort, a lab, farms, woods, villages)
 * with a name. Generated once from a fixed seed (identical on every machine), sized for the first
 * Battle Royale scale (up to 16 players); larger maps come with the 32/50-player work.
 */

export const ISLAND_SIZE = 4096;
const BLOCK = 1024;
const ROAD = 112;
const MARGIN = 96;

type District =
  | "city"
  | "residential"
  | "industrial"
  | "port"
  | "military"
  | "lab"
  | "farm"
  | "forest"
  | "village";

const LAYOUT: readonly District[] = [
  "port",
  "village",
  "forest",
  "military",
  "residential",
  "city",
  "industrial",
  "farm",
  "farm",
  "industrial",
  "city",
  "residential",
  "forest",
  "lab",
  "village",
  "port",
];

const NAMES: Record<District, readonly string[]> = {
  city: ["Midtown", "Old Town"],
  residential: ["Maple Rows", "Cinder Heights"],
  industrial: ["Ironyard", "Smelter Works"],
  port: ["Rustwater Docks", "Saltgate Pier"],
  military: ["Fort Cinder"],
  lab: ["Hollow Labs"],
  farm: ["Kettle Farms", "Dry Acres"],
  forest: ["Pinecrest Woods", "Blackroot"],
  village: ["Little Haven", "Copper Bend"],
};

export interface PoiDef extends Vec2 {
  name: string;
  kind: District;
}

export function buildIsland(seed: number): MapDef {
  const rng = mulberry32(seed);
  const solids: SolidDef[] = [];
  const decor: DecorDef[] = [];
  const lights: LightDef[] = [];
  const pickups: PickupDef[] = [];
  const pois: PoiDef[] = [];
  const used: Record<string, number> = {};

  /** Places a solid inside the block if it keeps `gap` px from the block's other solids. */
  const place = (
    block: SolidDef[],
    kind: SolidKind,
    x: number,
    y: number,
    w: number,
    h: number,
    gap = 72,
    tone?: number,
  ): boolean => {
    for (const o of block)
      if (x < o.x + o.w + gap && x + w + gap > o.x && y < o.y + o.h + gap && y + h + gap > o.y) return false;
    block.push({ kind, x: Math.round(x), y: Math.round(y), w, h, ...(tone !== undefined ? { tone } : {}) });
    return true;
  };
  const scatter = (
    block: SolidDef[],
    bx: number,
    by: number,
    n: number,
    make: () => [SolidKind, number, number, number?],
  ) => {
    for (let tries = 0, placed = 0; placed < n && tries < n * 25; tries++) {
      const [kind, w, h, tone] = make();
      const x = bx + MARGIN + rng() * (BLOCK - 2 * MARGIN - w);
      const y = by + MARGIN + rng() * (BLOCK - 2 * MARGIN - h);
      if (place(block, kind, x, y, w, h, 80, tone)) placed++;
    }
  };

  LAYOUT.forEach((kind, i) => {
    const bx = (i % 4) * BLOCK;
    const by = Math.floor(i / 4) * BLOCK;
    const block: SolidDef[] = [];
    const inner = BLOCK - 2 * MARGIN;
    switch (kind) {
      case "city":
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++) {
            const w = 170 + Math.floor(rng() * 60);
            const h = 150 + Math.floor(rng() * 70);
            place(
              block,
              "building",
              bx + MARGIN + 30 + a * 285,
              by + MARGIN + 30 + b * 285,
              w,
              h,
              70,
              (a + b) % 4,
            );
          }
        break;
      case "residential":
        for (let a = 0; a < 4; a++)
          for (let b = 0; b < 3; b++)
            place(
              block,
              "building",
              bx + MARGIN + 20 + a * 210,
              by + MARGIN + 40 + b * 280,
              130,
              110,
              70,
              (a * 3 + b) % 4,
            );
        break;
      case "industrial":
        scatter(block, bx, by, 9, () =>
          rng() < 0.5
            ? ["container", 240, 72, Math.floor(rng() * 4)]
            : ["container", 72, 240, Math.floor(rng() * 4)],
        );
        scatter(block, bx, by, 3, () => ["tank", 120, 120]);
        scatter(block, bx, by, 3, () => ["machine", 150, 110]);
        break;
      case "port": {
        const west = i % 4 === 0;
        const wx = west ? bx : bx + BLOCK - 300;
        block.push({ kind: "water", x: wx, y: by + MARGIN, w: 300, h: inner });
        const sx = west ? bx + 360 : bx + MARGIN;
        for (let r = 0; r < 4; r++)
          place(block, "container", sx + (r % 2) * 280, by + MARGIN + 60 + r * 200, 240, 72, 60, r % 4);
        scatter(block, bx, by, 6, () => ["crate", 56, 56]);
        break;
      }
      case "military":
        place(block, "building", bx + 380, by + 360, 200, 150, 60, 2);
        for (let a = 0; a < 4; a++) {
          const ang = (a / 4) * Math.PI * 2;
          const cx = bx + BLOCK / 2 + Math.cos(ang) * 300;
          const cy = by + BLOCK / 2 + Math.sin(ang) * 300;
          place(block, "sandbag", cx - 70, cy - 16, 140, 32, 50);
        }
        scatter(block, bx, by, 4, () => ["wall", 24, 180]);
        scatter(block, bx, by, 4, () => ["crate", 56, 56]);
        break;
      case "lab":
        place(block, "building", bx + 300, by + 330, 420, 300, 60, 1);
        for (let a = 0; a < 6; a++) place(block, "pillar", bx + 220 + a * 120, by + 230, 40, 40, 40);
        for (let a = 0; a < 6; a++) place(block, "pillar", bx + 220 + a * 120, by + 720, 40, 40, 40);
        scatter(block, bx, by, 4, () => ["machine", 120, 90]);
        break;
      case "farm":
        for (let f = 0; f < 3; f++) {
          const fx = bx + MARGIN + 40 + f * 280;
          const fy = by + MARGIN + 80 + Math.floor(rng() * 300);
          block.push({ kind: "fence", x: fx, y: fy, w: 200, h: 12 });
          block.push({ kind: "fence", x: fx, y: fy + 260, w: 200, h: 12 });
        }
        place(block, "building", bx + 600, by + 620, 220, 160, 60, 0);
        scatter(block, bx, by, 5, () => ["crate", 56, 56]);
        break;
      case "forest":
        scatter(block, bx, by, 26, () => {
          const s = 40 + Math.floor(rng() * 50);
          return ["rock", s, s];
        });
        break;
      case "village":
        scatter(block, bx, by, 6, () => [
          "building",
          140 + Math.floor(rng() * 40),
          110 + Math.floor(rng() * 30),
          Math.floor(rng() * 4),
        ]);
        scatter(block, bx, by, 4, () => ["crate", 56, 56]);
        break;
    }
    solids.push(...block);

    const list = NAMES[kind];
    const n = used[kind] ?? 0;
    used[kind] = n + 1;
    const center = { x: bx + BLOCK / 2, y: by + BLOCK / 2 };
    pois.push({ name: list[n % list.length]!, kind, ...center });
    lights.push({ ...center, radius: 360, color: 0xffd9a0, intensity: 0.3 });

    // Loot: chests near cover, plus a medkit and an ammo box per district.
    const isFree = (x: number, y: number, r: number) =>
      block.every((o) => {
        const nx = Math.max(o.x, Math.min(x, o.x + o.w));
        const ny = Math.max(o.y, Math.min(y, o.y + o.h));
        return (x - nx) ** 2 + (y - ny) ** 2 > r * r;
      });
    let chests = 0;
    for (let tries = 0; chests < 4 && tries < 200; tries++) {
      const x = bx + MARGIN + 40 + rng() * (inner - 80);
      const y = by + MARGIN + 40 + rng() * (inner - 80);
      if (!isFree(x, y, 70)) continue;
      pickups.push({
        id: `chest-${i}-${chests}`,
        kind: "chest",
        x: Math.round(x),
        y: Math.round(y),
        respawnSec: 9999,
      });
      chests++;
    }
    for (const kindP of ["health", "ammo"] as const)
      for (let tries = 0; tries < 100; tries++) {
        const x = bx + MARGIN + 40 + rng() * (inner - 80);
        const y = by + MARGIN + 40 + rng() * (inner - 80);
        if (!isFree(x, y, 60)) continue;
        pickups.push({
          id: `${kindP}-${i}`,
          kind: kindP,
          x: Math.round(x),
          y: Math.round(y),
          respawnSec: 9999,
        });
        break;
      }
  });

  // Roads on the block borders.
  for (let k = 1; k < 4; k++) {
    decor.push({ kind: "road", x: k * BLOCK - ROAD / 2, y: 0, w: ROAD, h: ISLAND_SIZE });
    decor.push({ kind: "road", x: 0, y: k * BLOCK - ROAD / 2, w: ISLAND_SIZE, h: ROAD });
  }
  // Spawns (unused by Battle Royale itself, kept for map validation and other tools): crossroads.
  const spawns: Vec2[] = [];
  for (let a = 1; a < 4; a++) for (let b = 1; b < 4; b++) spawns.push({ x: a * BLOCK, y: b * BLOCK });

  // Vehicles parked on the roads, between the crossroads (Battle Royale and Free Roam).
  const kinds = ["car", "offroad", "car", "armored", "offroad", "car", "offroad", "car"] as const;
  const vehicleSpawns: VehicleSpawnDef[] = kinds.map((kind, i) => {
    const k = 1 + (i % 3);
    const along = 512 + Math.floor(i / 3) * BLOCK;
    return i % 2 === 0
      ? { id: `v-${i}`, kind, x: k * BLOCK, y: along, angle: Math.PI / 2 }
      : { id: `v-${i}`, kind, x: along, y: k * BLOCK, angle: 0 };
  });

  return {
    vehicleSpawns,
    id: "island",
    name: "Scrapline Isle",
    tagline: "Sixteen districts, one storm. The Battle Royale map.",
    width: ISLAND_SIZE,
    height: ISLAND_SIZE,
    theme: {
      floor: 0x2f3a2e,
      floorAlt: 0x354234,
      grid: 0x3d4a3b,
      wall: 0x5c5850,
      wallTop: 0x7d786e,
      shadow: 0x0b0b0a,
      ambient: 0x151815,
      accents: [0xc8622f, 0x2f6e8a, 0x8a8f3a, 0xe0a33a],
      fog: 0x101210,
    },
    solids,
    decor,
    lights,
    spawns,
    pickups,
    large: true,
    modes: ["battleroyale", "freeroam"],
    players: { min: 2, max: 16 },
    pois,
  };
}
