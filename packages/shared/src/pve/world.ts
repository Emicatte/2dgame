import { type MapDef, SHOOT_THROUGH, type SolidDef } from "../maps/types.ts";
import { buildCollisionWorld, type CollisionWorld } from "../sim/collision.ts";
import type { DoorDef } from "./missions.ts";

/**
 * Collision worlds of a PvE map with its mission doors: a closed door is a solid for movement and
 * bullets; an open one is not there. The authoritative room and every client build the same worlds
 * from the same open-door list (PveState.doors), so prediction stays exact; the cache keeps a
 * door change to one rebuild per machine.
 */

export interface PveWorlds {
  world: CollisionWorld;
  shotWorld: CollisionWorld;
}

const cache = new Map<string, PveWorlds>();

export function parseIdList(s: string): Set<string> {
  return new Set(s ? s.split(",").filter(Boolean) : []);
}

export function formatIdList(ids: Iterable<string>): string {
  return [...ids].sort().join(",");
}

export function closedDoorSolids(doors: readonly DoorDef[], open: ReadonlySet<string>): SolidDef[] {
  return doors
    .filter((d) => !open.has(d.id))
    .map((d) => ({ kind: "wall" as const, x: d.x, y: d.y, w: d.w, h: d.h }));
}

export function pveWorlds(map: MapDef, doors: readonly DoorDef[], open: ReadonlySet<string>): PveWorlds {
  const closed = doors.filter((d) => !open.has(d.id)).map((d) => d.id);
  const key = `${map.id}|${closed.sort().join(",")}`;
  let w = cache.get(key);
  if (!w) {
    const extra = closedDoorSolids(doors, open);
    w = {
      world: buildCollisionWorld(map.width, map.height, [...map.solids, ...extra]),
      shotWorld: buildCollisionWorld(map.width, map.height, [
        ...map.solids.filter((s) => !SHOOT_THROUGH.has(s.kind)),
        ...extra,
      ]),
    };
    if (cache.size > 32) cache.clear();
    cache.set(key, w);
  }
  return w;
}
