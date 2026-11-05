import { PLAYER } from "../config/game.ts";
import type { Vec2 } from "../sim/math.ts";
import { collisionWorldFor, isFreeSpot } from "./index.ts";
import { type MapDef, teamSpawns } from "./types.ts";

export interface CapturePointDef extends Vec2 {
  id: string;
  /** Letter shown on the map and in the HUD. */
  label: string;
}

export interface MapObjectives {
  /** Domination: A (Alpha side), B (centre), C (Bravo side). */
  points: CapturePointDef[];
  /** Capture the Flag: flag stand of each team (index 1 Alpha, 2 Bravo). */
  flags: { 1: Vec2; 2: Vec2 };
}

const cache = new Map<string, MapObjectives>();

function centroid(points: readonly Vec2[]): Vec2 {
  const n = Math.max(1, points.length);
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Nearest spot to `p` where a player fits (spiral search on a 16 px grid). */
function freeNear(map: MapDef, p: Vec2, clearance = PLAYER.radius * 3): Vec2 {
  const world = collisionWorldFor(map);
  for (let r = 0; r <= 640; r += 16) {
    const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 16);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const q = { x: Math.round(p.x + Math.cos(a) * r), y: Math.round(p.y + Math.sin(a) * r) };
      if (isFreeSpot(world, q, clearance)) return q;
    }
  }
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * Objective positions of a map. Maps may author them; otherwise they are derived the same way on
 * every machine from the (point-symmetric) team spawns: the flags stand just in front of each
 * team's spawn area, point B sits at the centre and A / C halfway between the centre and the
 * spawns. Symmetric maps therefore get symmetric objectives.
 */
export function objectivesFor(map: MapDef): MapObjectives {
  const hit = cache.get(map.id);
  if (hit) return hit;
  const center = { x: map.width / 2, y: map.height / 2 };
  const a = centroid(teamSpawns(map, 1));
  const toward = (from: Vec2, k: number) => ({
    x: from.x + (center.x - from.x) * k,
    y: from.y + (center.y - from.y) * k,
  });
  const pa = freeNear(map, toward(a, 0.5));
  // Exact mirror of A keeps C fair even where the search had to move A.
  const pc = { x: map.width - pa.x, y: map.height - pa.y };
  const fa = freeNear(map, toward(a, 0.18));
  const fb = { x: map.width - fa.x, y: map.height - fa.y };
  const out: MapObjectives = map.objectives ?? {
    points: [
      { id: "A", label: "A", ...pa },
      // Capture is by radius: the exact centre keeps B fair even when a monument stands on it.
      { id: "B", label: "B", ...center },
      { id: "C", label: "C", ...pc },
    ],
    flags: { 1: fa, 2: fb },
  };
  cache.set(map.id, out);
  return out;
}
