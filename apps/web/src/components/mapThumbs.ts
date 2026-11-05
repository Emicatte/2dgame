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
