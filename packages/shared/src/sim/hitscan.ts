import { type CollisionWorld, raycastCircle, raycastSolids } from "./collision.ts";

export interface HitTarget {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface PelletResult {
  /** Distance travelled before stopping (wall, target or max range). */
  dist: number;
  /** Id of the target hit, if any. */
  targetId: string | null;
  /** True when the pellet stopped on a wall (impact sparks). */
  hitWall: boolean;
}

/**
 * Resolves one hitscan pellet: first wall or first target along the ray, whichever is closer.
 * Used by the server (authoritative damage) and by the client (predicted tracer length only).
 */
export function tracePellet(
  world: CollisionWorld,
  ox: number,
  oy: number,
  angle: number,
  range: number,
  targets: readonly HitTarget[],
  shooterId: string,
): PelletResult {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const wallDist = raycastSolids(world, ox, oy, dx, dy, range);
  let best = wallDist;
  let targetId: string | null = null;
  for (const t of targets) {
    if (t.id === shooterId) continue;
    const d = raycastCircle(ox, oy, dx, dy, t.x, t.y, t.r);
    if (d >= 0 && d < best) {
      best = d;
      targetId = t.id;
    }
  }
  return { dist: best, targetId, hitWall: targetId === null && wallDist < range - 0.5 };
}
