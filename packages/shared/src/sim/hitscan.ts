import type { VehicleDef } from "../config/vehicles.ts";
import { type CollisionWorld, raycastCircle, raycastSolids } from "./collision.ts";
import { raycastBody } from "./vehicle.ts";

export interface HitTarget {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Flying target (helicopter or one of its occupants): only tall solids stand in between. */
  air?: boolean;
  /** Vehicle hull: an oriented box instead of a circle. */
  body?: { angle: number; def: VehicleDef };
  /**
   * Vehicle id shared by a hull and its exposed occupants. A pellet that crosses an exposed
   * occupant hits the occupant, not the hull around them.
   */
  group?: string;
  occupant?: boolean;
}

export interface TraceOptions {
  /** Tall solids only; required to shoot at or from the air. */
  airWorld?: CollisionWorld;
  /** The shooter is in a flying helicopter. */
  shooterAir?: boolean;
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
 *
 * Two heights exist: the ground (every solid blocks) and the air (only tall solids block). A shot
 * between the ground and the air, or within the air, is stopped by tall solids only.
 */
export function tracePellet(
  world: CollisionWorld,
  ox: number,
  oy: number,
  angle: number,
  range: number,
  targets: readonly HitTarget[],
  shooterId: string,
  opts?: TraceOptions,
): PelletResult {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const wallGround = raycastSolids(world, ox, oy, dx, dy, range);
  const wallAir = opts?.airWorld ? raycastSolids(opts.airWorld, ox, oy, dx, dy, range) : wallGround;
  const shooterAir = !!opts?.shooterAir;
  const stop = shooterAir ? wallAir : wallGround;
  let best = Number.POSITIVE_INFINITY;
  let hit: HitTarget | null = null;
  const occupantHits: { t: HitTarget; d: number }[] = [];
  for (const t of targets) {
    if (t.id === shooterId) continue;
    const d = t.body
      ? raycastBody({ x: t.x, y: t.y, angle: t.body.angle }, t.body.def, ox, oy, dx, dy)
      : raycastCircle(ox, oy, dx, dy, t.x, t.y, t.r);
    if (d < 0) continue;
    const limit = shooterAir || t.air ? wallAir : wallGround;
    if (d >= limit) continue;
    if (t.occupant) occupantHits.push({ t, d });
    if (d < best) {
      best = d;
      hit = t;
    }
  }
  if (hit?.body && hit.group) {
    let occ: { t: HitTarget; d: number } | null = null;
    for (const o of occupantHits) if (o.t.group === hit.group && (!occ || o.d < occ.d)) occ = o;
    if (occ) {
      hit = occ.t;
      best = occ.d;
    }
  }
  if (!hit) return { dist: stop, targetId: null, hitWall: stop < range - 0.5 };
  return { dist: best, targetId: hit.id, hitWall: false };
}
