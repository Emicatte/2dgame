import type { Rect, Vec2 } from "../sim/math.ts";
import type { MapDef, SolidDef } from "./types.ts";

/**
 * Arena maps at about twice the surface (×1.375 per side ≈ ×1.9 area), keeping their layout:
 * positions spread out while objects keep their size (a crate stays a crate), walls and fences
 * stretch along their length so rooms and corridors stay closed, floor markings scale with the
 * map. The new open ground then gets cover: crates and sandbags on a grid wherever nothing stands
 * nearby (no roads, spawns, pickups, vehicles or objectives), placed in point-mirrored pairs so the
 * maps stay fair for both halves. 1.375 = 11/8 keeps every coordinate an exact binary fraction,
 * so mirrored pairs stay exactly mirrored.
 */
export const ARENA_SCALE = 1.375;

const THIN = 32;

function scaleSolid(s: SolidDef, k: number): SolidDef {
  if (s.w <= THIN && s.h > s.w) return { ...s, x: (s.x + s.w / 2) * k - s.w / 2, y: s.y * k, h: s.h * k };
  if (s.h <= THIN && s.w > s.h) return { ...s, y: (s.y + s.h / 2) * k - s.h / 2, x: s.x * k, w: s.w * k };
  return { ...s, x: (s.x + s.w / 2) * k - s.w / 2, y: (s.y + s.h / 2) * k - s.h / 2 };
}

const pt = <T extends Vec2>(p: T, k: number): T => ({ ...p, x: p.x * k, y: p.y * k });
const box = <T extends Rect>(r: T, k: number): T => ({
  ...r,
  x: r.x * k,
  y: r.y * k,
  w: r.w * k,
  h: r.h * k,
});

function distToRect(p: Vec2, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function expandArena(map: MapDef, k = ARENA_SCALE): MapDef {
  const W = map.width * k;
  const H = map.height * k;
  const solids = map.solids.map((s) => scaleSolid(s, k));
  const decor = map.decor.map((d) => box(d, k));
  const spawns = map.spawns.map((p) => pt(p, k));
  const pickups = map.pickups.map((p) => pt(p, k));
  const vehicleSpawns = map.vehicleSpawns?.map((v) => pt(v, k));
  const objectives = map.objectives && {
    points: map.objectives.points.map((p) => pt(p, k)),
    flags: { 1: pt(map.objectives.flags[1], k), 2: pt(map.objectives.flags[2], k) },
  };
  const teamSpawns = map.teamSpawns && {
    1: map.teamSpawns[1].map((p) => pt(p, k)),
    2: map.teamSpawns[2].map((p) => pt(p, k)),
  };

  // Cover on the new open ground, in mirrored pairs.
  const keepClear: Vec2[] = [
    ...spawns,
    ...pickups,
    ...(vehicleSpawns ?? []),
    ...(objectives ? [...objectives.points, objectives.flags[1], objectives.flags[2]] : []),
    ...(teamSpawns ? [...teamSpawns[1], ...teamSpawns[2]] : []),
  ];
  const floorKept = decor.filter(
    (d) => d.kind === "road" || d.kind === "lane" || d.kind === "helipad" || d.kind === "crosswalk",
  );
  const added: SolidDef[] = [];
  const STEP = 224;
  let n = 0;
  for (let y = STEP; y < H - STEP / 2; y += STEP)
    for (let x = STEP; x < W / 2 - 120; x += STEP) {
      const p = { x, y };
      if ([...solids, ...added].some((s) => distToRect(p, s) < 170)) continue;
      if (keepClear.some((q) => Math.hypot(q.x - x, q.y - y) < 170)) continue;
      if (floorKept.some((d) => distToRect(p, d) < 60)) continue;
      const crate = n++ % 2 === 0;
      const s: SolidDef = crate
        ? { kind: "crate", x: x - 28, y: y - 28, w: 56, h: 56 }
        : { kind: "sandbag", x: x - 70, y: y - 16, w: 140, h: 32 };
      added.push(s, { ...s, x: W - s.x - s.w, y: H - s.y - s.h });
    }

  return {
    ...map,
    width: W,
    height: H,
    solids: [...solids, ...added],
    decor,
    lights: map.lights.map((l) => ({ ...l, x: l.x * k, y: l.y * k, radius: l.radius * k })),
    spawns,
    pickups,
    ...(vehicleSpawns ? { vehicleSpawns } : {}),
    ...(objectives ? { objectives } : {}),
    ...(teamSpawns ? { teamSpawns } : {}),
  };
}
