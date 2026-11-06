import type { ReactElement } from "react";
import {
  type CrosshairFrame,
  type CrosshairSink,
  drawCrosshair,
  HIT_MS,
  KILL_RING_MS,
  lookFromSettings,
} from "../game/combat/crosshairModel.ts";
import type { Settings } from "../lib/settings.ts";

const TILE = 100;
const H = 92;
/** Floor, label and state of each preview tile. */
const TILES = [
  { floor: "#1c1f24", ink: "#b9b4aa", label: "standing", gap: 4, kill: false },
  { floor: "#b9b2a2", ink: "#1a1c20", label: "moving", gap: 13, kill: false },
  { floor: "#24272d", ink: "#b9b4aa", label: "kill", gap: 6, kill: true },
] as const;
const W = TILE * TILES.length;

const css = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/**
 * Live preview of the crosshair settings, drawn by the same geometry the game uses
 * (crosshairModel.drawCrosshair) into SVG: standing still on a dark floor, moving (wider true
 * spread) on a light floor to judge the outline, and the elimination indicator.
 */
export function CrosshairPreview({ settings }: { settings: Settings }) {
  const look = lookFromSettings(settings);
  const els: ReactElement[] = [];
  const sink: CrosshairSink = {
    line: (x1, y1, x2, y2, w, c, a) => {
      els.push(
        <line
          key={els.length}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={css(c)}
          strokeOpacity={a}
          strokeWidth={w}
        />,
      );
    },
    ring: (x, y, r, w, c, a) => {
      els.push(
        <circle
          key={els.length}
          cx={x}
          cy={y}
          r={r}
          fill="none"
          stroke={css(c)}
          strokeOpacity={a}
          strokeWidth={w}
        />,
      );
    },
    arc: (x, y, r, start, end, w, c, a) => {
      const sweep = end - start;
      if (sweep >= Math.PI * 2 - 1e-3) {
        sink.ring(x, y, r, w, c, a);
        return;
      }
      const x0 = x + Math.cos(start) * r;
      const y0 = y + Math.sin(start) * r;
      const x1 = x + Math.cos(end) * r;
      const y1 = y + Math.sin(end) * r;
      const large = sweep > Math.PI ? 1 : 0;
      els.push(
        <path
          key={els.length}
          d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`}
          fill="none"
          stroke={css(c)}
          strokeOpacity={a}
          strokeWidth={w}
        />,
      );
    },
    dot: (x, y, r, c, a) => {
      els.push(<circle key={els.length} cx={x} cy={y} r={r} fill={css(c)} fillOpacity={a} />);
    },
  };
  TILES.forEach((t, i) => {
    const frame: CrosshairFrame = {
      x: TILE * i + TILE / 2,
      y: H / 2 - 7,
      mode: "active",
      trueGapPx: t.gap,
      reload: null,
      cooldown: null,
    };
    const model = t.kill
      ? { kick: 0, hit: "kill" as const, hitLife: HIT_MS.kill * 0.7, killLife: KILL_RING_MS * 0.45 }
      : { kick: 0, hit: null, hitLife: 0, killLife: 0 };
    drawCrosshair(sink, look, frame, model);
  });
  return (
    <svg
      className="xh-preview"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Crosshair preview: ${look.style} style standing on a dark floor, moving on a light floor, and the elimination indicator`}
      data-testid="crosshair-preview"
    >
      {TILES.map((t, i) => (
        <rect key={t.label} x={TILE * i} y={0} width={TILE} height={H} fill={t.floor} />
      ))}
      {els}
      {TILES.map((t, i) => (
        <text
          key={t.label}
          x={TILE * i + TILE / 2}
          y={H - 8}
          textAnchor="middle"
          className="xh-preview__label"
          fill={t.ink}
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
}
