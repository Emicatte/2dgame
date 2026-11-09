import type { Rect } from "../sim/math.ts";
import type { SolidDef } from "./types.ts";

/** Wall thickness of dug-out maps. */
export const DIG_WALL = 24;

export type Side = "n" | "s" | "e" | "w";
export type Gaps = Partial<Record<Side, [number, number][]>>;

/** Four walls of a room, each side split around its doorway gaps ([from, to] along the side). */
export function room(x: number, y: number, w: number, h: number, gaps: Gaps = {}): SolidDef[] {
  const T = DIG_WALL;
  const out: SolidDef[] = [];
  const run = (side: Side, len: number, place: (a: number, b: number) => SolidDef) => {
    const cuts = [...(gaps[side] ?? [])].sort((p, q) => p[0] - q[0]);
    let at = 0;
    for (const [a, b] of cuts) {
      if (a > at) out.push(place(at, a));
      at = b;
    }
    if (at < len) out.push(place(at, len));
  };
  run("n", w, (a, b) => ({ kind: "wall", x: x + a, y, w: b - a, h: T }));
  run("s", w, (a, b) => ({ kind: "wall", x: x + a, y: y + h - T, w: b - a, h: T }));
  run("w", h, (a, b) => ({ kind: "wall", x, y: y + a, w: T, h: b - a }));
  run("e", h, (a, b) => ({ kind: "wall", x: x + w - T, y: y + a, w: T, h: b - a }));
  return out;
}

/**
 * A map dug out of solid rock: rooms (`hall`) and corridors are carved, and `bedrock()` fills
 * everything else. Without it the gaps between rooms would be open floor (walkable, spawnable)
 * outside the building.
 */
export function digger(W: number, H: number) {
  const T = DIG_WALL;
  const dug: Rect[] = [];
  return {
    hall(x: number, y: number, w: number, h: number, gaps: Gaps = {}): SolidDef[] {
      dug.push({ x, y, w, h });
      return room(x, y, w, h, gaps);
    },
    /** A corridor between two rooms: its two side walls. */
    corridor(x: number, y: number, w: number, h: number, horizontal: boolean): SolidDef[] {
      dug.push(horizontal ? { x, y: y - T, w, h: h + 2 * T } : { x: x - T, y, w: w + 2 * T, h });
      return horizontal
        ? [
            { kind: "wall", x, y: y - T, w, h: T },
            { kind: "wall", x, y: y + h, w, h: T },
          ]
        : [
            { kind: "wall", x: x - T, y, w: T, h },
            { kind: "wall", x: x + w, y, w: T, h },
          ];
    },
    /**
     * Rock everywhere not dug, as horizontal bands: at every y where a dug rectangle starts or
     * ends, the band's uncovered x-intervals become rock; identical intervals in consecutive bands
     * are merged.
     */
    bedrock(): SolidDef[] {
      const ys = [...new Set([0, H, ...dug.flatMap((r) => [r.y, r.y + r.h])])].sort((a, b) => a - b);
      let open = new Map<string, SolidDef>();
      const out: SolidDef[] = [];
      for (let i = 0; i + 1 < ys.length; i++) {
        const y0 = ys[i]!;
        const y1 = ys[i + 1]!;
        const cover = dug
          .filter((r) => r.y <= y0 && r.y + r.h >= y1)
          .map((r) => [r.x, r.x + r.w] as const)
          .sort((a, b) => a[0] - b[0]);
        const rock: [number, number][] = [];
        let at = 0;
        for (const [a, b] of cover) {
          if (a > at) rock.push([at, a]);
          at = Math.max(at, b);
        }
        if (at < W) rock.push([at, W]);
        const next = new Map<string, SolidDef>();
        for (const [a, b] of rock) {
          const key = `${a}:${b}`;
          const prev = open.get(key);
          if (prev) {
            prev.h = y1 - prev.y;
            next.set(key, prev);
          } else {
            const r: SolidDef = { kind: "wall", x: a, y: y0, w: b - a, h: y1 - y0 };
            out.push(r);
            next.set(key, r);
          }
        }
        open = next;
      }
      return out;
    },
  };
}
