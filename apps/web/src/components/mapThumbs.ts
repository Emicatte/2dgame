import { MAPS, type MapId } from "@scrapline/shared";
import { renderMap } from "../game/art/mapRenderer.ts";

const cache = new Map<MapId, string>();

/** Small preview of a map, rendered from the same data the game uses. */
export function mapThumb(id: MapId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const map = MAPS[id];
  const thumb = renderMap(map, 400 / map.width);
  const url = thumb.toDataURL("image/jpeg", 0.82);
  cache.set(id, url);
  return url;
}

const pending = new Map<MapId, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/**
 * Same image, rendered one map per idle slot: a page with many cards stays responsive while the
 * previews appear one after the other instead of freezing for all of them at once.
 */
export function mapThumbLater(id: MapId): Promise<string> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (!p) {
    p = queue.then(
      () =>
        new Promise<string>((resolve) => {
          const run = () => resolve(mapThumb(id));
          if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 300 });
          else setTimeout(run, 16);
        }),
    );
    queue = p;
    pending.set(id, p);
  }
  return p;
}
