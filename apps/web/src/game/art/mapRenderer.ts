import {
  type DecorDef,
  hashString,
  type MapDef,
  mulberry32,
  type SolidDef,
  type ThemeDef,
} from "@scrapline/shared";
import { hex, makeCanvas, roundRect, shade, speckle } from "./canvas.ts";

/**
 * Bakes the static map (floor, decals, shadows, solid props) into one canvas texture.
 * Static geometry costs a single draw call per frame, leaving the frame budget for players and FX.
 */
export function renderMap(map: MapDef, scale = 1): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(map.width * scale, map.height * scale);
  ctx.scale(scale, scale);
  const rand = mulberry32(hashString(map.id));
  detail = scale >= 0.5;
  drawFloor(ctx, map, rand);
  for (const d of map.decor) drawDecor(ctx, d, map.theme, rand);
  drawShadows(ctx, map);
  for (const s of map.solids) drawSolid(ctx, s, map, rand);
  drawBorder(ctx, map);
  return c;
}

/** Fine grain (noise speckle) only matters at full resolution; thumbnails skip it. */
let detail = true;

function drawFloor(ctx: CanvasRenderingContext2D, map: MapDef, rand: () => number) {
  const t = map.theme;
  ctx.fillStyle = hex(t.floor);
  ctx.fillRect(0, 0, map.width, map.height);
  const tile = 128;
  // Slab variation
  for (let y = 0; y < map.height; y += tile) {
    for (let x = 0; x < map.width; x += tile) {
      const v = rand();
      if (v < 0.35) {
        ctx.fillStyle = hex(t.floorAlt, 0.35 + rand() * 0.4);
        ctx.fillRect(x, y, tile, tile);
      }
    }
  }
  if (map.id === "desert") {
    // Dunes: soft wide strokes instead of slabs
    for (let i = 0; i < 220; i++) {
      ctx.strokeStyle = hex(shade(t.floor, rand() < 0.5 ? 0.12 : -0.1), 0.18);
      ctx.lineWidth = 2 + rand() * 6;
      const x = rand() * map.width;
      const y = rand() * map.height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 60, y - 20, x + 140, y + 20, x + 220, y);
      ctx.stroke();
    }
    if (detail) speckle(ctx, 0, 0, map.width, map.height, 0.004, rand, 0x5a4024, 0.35, 2.5);
    if (detail) speckle(ctx, 0, 0, map.width, map.height, 0.003, rand, 0xf2d7a8, 0.3, 1.5);
    return;
  }
  // Panel seams
  ctx.strokeStyle = hex(t.grid, 0.9);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= map.width; x += 64) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, map.height);
  }
  for (let y = 0; y <= map.height; y += 64) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(map.width, y + 0.5);
  }
  ctx.stroke();
  // Bolts at seam intersections
  ctx.fillStyle = hex(shade(t.grid, 0.15), 0.6);
  for (let y = 0; y <= map.height; y += 128)
    for (let x = 0; x <= map.width; x += 128) ctx.fillRect(x - 1, y - 1, 3, 3);
  if (detail) speckle(ctx, 0, 0, map.width, map.height, 0.006, rand, 0x000000, 0.18, 2);
  if (detail) speckle(ctx, 0, 0, map.width, map.height, 0.002, rand, 0xffffff, 0.05, 1.5);
  if (map.id === "neon") {
    // Wet asphalt sheen
    for (let i = 0; i < 40; i++) {
      const x = rand() * map.width;
      const y = rand() * map.height;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 80 + rand() * 120);
      g.addColorStop(0, hex(t.accents[i % t.accents.length]!, 0.05));
      g.addColorStop(1, hex(t.accents[i % t.accents.length]!, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 200, y - 200, 400, 400);
    }
  }
}

function drawDecor(ctx: CanvasRenderingContext2D, d: DecorDef, t: ThemeDef, rand: () => number) {
  const accent = t.accents[d.tone ?? 0] ?? t.accents[0]!;
  ctx.save();
  switch (d.kind) {
    case "hazard": {
      ctx.beginPath();
      ctx.rect(d.x, d.y, d.w, d.h);
      ctx.clip();
      ctx.fillStyle = hex(0x1a1a1a, 0.9);
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = hex(0xe0a33a, 0.85);
      const span = d.w + d.h;
      for (let i = -span; i < span; i += 24) {
        ctx.beginPath();
        if (d.w >= d.h) {
          ctx.moveTo(d.x + i, d.y + d.h);
          ctx.lineTo(d.x + i + 12, d.y + d.h);
          ctx.lineTo(d.x + i + 12 + d.h, d.y);
          ctx.lineTo(d.x + i + d.h, d.y);
        } else {
          ctx.moveTo(d.x, d.y + i);
          ctx.lineTo(d.x, d.y + i + 12);
          ctx.lineTo(d.x + d.w, d.y + i + 12 + d.w);
          ctx.lineTo(d.x + d.w, d.y + i + d.w);
        }
        ctx.fill();
      }
      break;
    }
    case "paint": {
      ctx.fillStyle = hex(accent, d.w > 100 && d.h > 100 ? 0.12 : 0.55);
      ctx.fillRect(d.x, d.y, d.w, d.h);
      if (d.w > 100 && d.h > 100) {
        ctx.strokeStyle = hex(accent, 0.5);
        ctx.lineWidth = 3;
        ctx.strokeRect(d.x + 4, d.y + 4, d.w - 8, d.h - 8);
      }
      break;
    }
    case "grate": {
      ctx.fillStyle = hex(0x0d0e10, 0.85);
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = hex(0x5a5f66, 0.7);
      ctx.lineWidth = 2;
      for (let x = d.x + 6; x < d.x + d.w; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, d.y + 3);
        ctx.lineTo(x, d.y + d.h - 3);
        ctx.stroke();
      }
      ctx.strokeRect(d.x + 1, d.y + 1, d.w - 2, d.h - 2);
      break;
    }
    case "stain": {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = hex(0x050505, 0.12 + rand() * 0.1);
        ctx.beginPath();
        ctx.ellipse(
          d.x + d.w / 2 + (rand() - 0.5) * d.w * 0.4,
          d.y + d.h / 2 + (rand() - 0.5) * d.h * 0.4,
          (d.w / 2) * (0.5 + rand() * 0.5),
          (d.h / 2) * (0.5 + rand() * 0.5),
          rand() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
    case "cables": {
      ctx.strokeStyle = hex(0x101114, 0.9);
      ctx.lineWidth = 4;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y + k * 6);
        ctx.bezierCurveTo(
          d.x + d.w * 0.3,
          d.y + 14 + k * 6,
          d.x + d.w * 0.7,
          d.y - 10 + k * 6,
          d.x + d.w,
          d.y + k * 6,
        );
        ctx.stroke();
      }
      break;
    }
    case "neonSign": {
      ctx.shadowColor = hex(accent);
      ctx.shadowBlur = 22;
      ctx.fillStyle = hex(accent, 0.95);
      roundRect(ctx, d.x, d.y, d.w, d.h, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hex(0xffffff, 0.7);
      roundRect(ctx, d.x + 2, d.y + d.h / 2 - 1, d.w - 4, 2, 1);
      ctx.fill();
      // Spill light on the street
      const horizontal = d.w >= d.h;
      const g = horizontal
        ? ctx.createLinearGradient(0, d.y, 0, d.y + 120)
        : ctx.createLinearGradient(d.x, 0, d.x + 120, 0);
      g.addColorStop(0, hex(accent, 0.22));
      g.addColorStop(1, hex(accent, 0));
      ctx.fillStyle = g;
      if (horizontal) ctx.fillRect(d.x - 20, d.y + d.h, d.w + 40, 120);
      else ctx.fillRect(d.x + d.w, d.y - 20, 120, d.h + 40);
      break;
    }
    case "puddle": {
      ctx.fillStyle = hex(0x05060a, 0.55);
      ctx.beginPath();
      ctx.ellipse(d.x + d.w / 2, d.y + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0x9fb8ff, 0.18);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(d.x + d.w / 2 - 6, d.y + d.h / 2 - 4, d.w / 3, d.h / 4, 0, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
      break;
    }
    case "crosswalk": {
      ctx.fillStyle = hex(0xe8e4dc, 0.16);
      const vertical = d.h > d.w;
      for (let i = 0; i < (vertical ? d.w : d.h); i += 18) {
        if (vertical) ctx.fillRect(d.x + i, d.y, 9, d.h);
        else ctx.fillRect(d.x, d.y + i, d.w, 9);
      }
      break;
    }
    case "sand": {
      const g = ctx.createRadialGradient(
        d.x + d.w / 2,
        d.y + d.h / 2,
        4,
        d.x + d.w / 2,
        d.y + d.h / 2,
        Math.max(d.w, d.h) / 2,
      );
      g.addColorStop(0, hex(0xe7c48e, 0.45));
      g.addColorStop(1, hex(0xe7c48e, 0));
      ctx.fillStyle = g;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      break;
    }
    case "tracks": {
      ctx.fillStyle = hex(0x6b4c2c, 0.22);
      const vertical = d.h > d.w;
      for (let i = 0; i < (vertical ? d.h : d.w); i += 14) {
        if (vertical) {
          ctx.fillRect(d.x, d.y + i, 12, 6);
          ctx.fillRect(d.x + d.w - 12, d.y + i, 12, 6);
        } else {
          ctx.fillRect(d.x + i, d.y, 6, 12);
          ctx.fillRect(d.x + i, d.y + d.h - 12, 6, 12);
        }
      }
      break;
    }
    case "bones": {
      ctx.fillStyle = hex(0xefe6d2, 0.7);
      ctx.fillRect(d.x, d.y + d.h / 2 - 2, d.w, 4);
      ctx.beginPath();
      ctx.arc(d.x, d.y + d.h / 2 - 3, 4, 0, Math.PI * 2);
      ctx.arc(d.x, d.y + d.h / 2 + 3, 4, 0, Math.PI * 2);
      ctx.arc(d.x + d.w, d.y + d.h / 2 - 3, 4, 0, Math.PI * 2);
      ctx.arc(d.x + d.w, d.y + d.h / 2 + 3, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/**
 * Soft drop shadows without canvas filters (CSS blur on a large canvas is extremely slow on
 * software renderers): shadows are drawn on a 1/8-size canvas and upscaled with smoothing.
 */
function drawShadows(ctx: CanvasRenderingContext2D, map: MapDef) {
  const tall = new Set(["building", "container", "machine", "wall", "tank", "ruin"]);
  const k = 1 / 8;
  const [sc, sctx] = makeCanvas(map.width * k, map.height * k);
  sctx.scale(k, k);
  sctx.fillStyle = hex(map.theme.shadow, 0.6);
  for (const s of map.solids) {
    const off = tall.has(s.kind) ? 16 : 9;
    sctx.fillRect(s.x + off * 0.6, s.y + off, s.w, s.h);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sc, 0, 0, map.width, map.height);
  ctx.restore();
}

function bevel(ctx: CanvasRenderingContext2D, s: SolidDef, top: number, side: number, r = 3) {
  ctx.fillStyle = hex(side);
  roundRect(ctx, s.x, s.y, s.w, s.h, r);
  ctx.fill();
  ctx.fillStyle = hex(top);
  roundRect(ctx, s.x + 2, s.y + 2, s.w - 4, s.h - 6, r);
  ctx.fill();
}

function drawSolid(ctx: CanvasRenderingContext2D, s: SolidDef, map: MapDef, rand: () => number) {
  const t = map.theme;
  const accent = t.accents[s.tone ?? 0] ?? t.accents[0]!;
  ctx.save();
  switch (s.kind) {
    case "container": {
      const base = accent;
      bevel(ctx, s, base, shade(base, -0.45), 2);
      ctx.strokeStyle = hex(shade(base, -0.3), 0.9);
      ctx.lineWidth = 2;
      const horizontal = s.w >= s.h;
      const len = horizontal ? s.w : s.h;
      for (let i = 10; i < len - 6; i += 9) {
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(s.x + i, s.y + 5);
          ctx.lineTo(s.x + i, s.y + s.h - 8);
        } else {
          ctx.moveTo(s.x + 5, s.y + i);
          ctx.lineTo(s.x + s.w - 7, s.y + i);
        }
        ctx.stroke();
      }
      ctx.fillStyle = hex(shade(base, 0.25), 0.6);
      if (horizontal) ctx.fillRect(s.x + 4, s.y + 3, s.w - 8, 3);
      else ctx.fillRect(s.x + 3, s.y + 4, 3, s.h - 8);
      // Corner castings
      ctx.fillStyle = hex(0x1b1c20);
      for (const [cx, cy] of [
        [s.x + 2, s.y + 2],
        [s.x + s.w - 8, s.y + 2],
        [s.x + 2, s.y + s.h - 10],
        [s.x + s.w - 8, s.y + s.h - 10],
      ] as const) {
        ctx.fillRect(cx, cy, 6, 6);
      }
      break;
    }
    case "wall": {
      bevel(ctx, s, t.wallTop, t.wall, 2);
      ctx.fillStyle = hex(shade(t.wallTop, 0.18), 0.5);
      if (s.w >= s.h) ctx.fillRect(s.x + 3, s.y + 3, s.w - 6, 2);
      else ctx.fillRect(s.x + 3, s.y + 3, 2, s.h - 8);
      if (detail) speckle(ctx, s.x, s.y, s.w, s.h - 4, 0.02, rand, 0x000000, 0.25, 1.5);
      break;
    }
    case "crate": {
      const base = map.id === "neon" ? 0x3a3550 : 0x7a5a36;
      bevel(ctx, s, base, shade(base, -0.45), 3);
      ctx.strokeStyle = hex(shade(base, -0.35));
      ctx.lineWidth = 3;
      ctx.strokeRect(s.x + 6, s.y + 6, s.w - 12, s.h - 14);
      if (s.w > 40 && s.h > 40) {
        ctx.beginPath();
        ctx.moveTo(s.x + 6, s.y + 6);
        ctx.lineTo(s.x + s.w - 6, s.y + s.h - 8);
        ctx.moveTo(s.x + s.w - 6, s.y + 6);
        ctx.lineTo(s.x + 6, s.y + s.h - 8);
        ctx.stroke();
      } else if (map.id === "neon") {
        ctx.fillStyle = hex(0x3fff9c, 0.35);
        ctx.fillRect(s.x + 4, s.y + 4, s.w - 8, s.h - 10);
      }
      break;
    }
    case "pillar": {
      bevel(ctx, s, shade(t.wallTop, 0.05), t.wall, 4);
      ctx.fillStyle = hex(0xe0a33a, 0.8);
      ctx.fillRect(s.x + 4, s.y + s.h - 12, s.w - 8, 4);
      break;
    }
    case "machine": {
      bevel(ctx, s, 0x3e4a55, 0x22292f, 4);
      ctx.fillStyle = hex(0x1a1f24);
      ctx.fillRect(s.x + 10, s.y + 10, s.w - 20, s.h - 26);
      ctx.fillStyle = hex(0x5a6a78);
      for (let y = s.y + 14; y < s.y + s.h - 18; y += 7) ctx.fillRect(s.x + 14, y, s.w - 28, 3);
      ctx.fillStyle = hex(0xff7a2e, 0.9);
      ctx.fillRect(s.x + 8, s.y + s.h - 14, 10, 4);
      ctx.fillStyle = hex(0x7dffb0, 0.9);
      ctx.fillRect(s.x + 22, s.y + s.h - 14, 6, 4);
      break;
    }
    case "building": {
      bevel(ctx, s, t.wallTop, t.wall, 2);
      ctx.strokeStyle = hex(shade(t.wallTop, 0.2), 0.6);
      ctx.lineWidth = 3;
      ctx.strokeRect(s.x + 8, s.y + 8, s.w - 16, s.h - 20);
      // Roof clutter: AC units, vents
      const units = Math.max(2, Math.floor((s.w * s.h) / 22000));
      for (let i = 0; i < units; i++) {
        const w = 28 + rand() * 30;
        const h = 22 + rand() * 20;
        const x = s.x + 16 + rand() * Math.max(1, s.w - w - 32);
        const y = s.y + 16 + rand() * Math.max(1, s.h - h - 36);
        ctx.fillStyle = hex(shade(t.wallTop, -0.25));
        roundRect(ctx, x + 3, y + 4, w, h, 3);
        ctx.fill();
        ctx.fillStyle = hex(shade(t.wallTop, 0.25));
        roundRect(ctx, x, y, w, h, 3);
        ctx.fill();
        ctx.strokeStyle = hex(shade(t.wallTop, -0.1));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Edge light strip in the building's accent
      ctx.fillStyle = hex(accent, 0.75);
      ctx.fillRect(s.x + 4, s.y + s.h - 8, s.w - 8, 2);
      break;
    }
    case "vending": {
      bevel(ctx, s, 0x22202e, 0x111018, 3);
      ctx.shadowColor = hex(accent);
      ctx.shadowBlur = 16;
      ctx.fillStyle = hex(accent, 0.85);
      roundRect(ctx, s.x + 5, s.y + 5, s.w - 10, s.h - 16, 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = hex(0xffffff, 0.35);
      ctx.fillRect(s.x + 7, s.y + 7, s.w - 14, 2);
      break;
    }
    case "car": {
      const horizontal = s.w >= s.h;
      const base = accent;
      ctx.fillStyle = hex(shade(base, -0.6));
      roundRect(ctx, s.x, s.y, s.w, s.h, 12);
      ctx.fill();
      ctx.fillStyle = hex(shade(base, -0.2));
      roundRect(ctx, s.x + 3, s.y + 2, s.w - 6, s.h - 6, 11);
      ctx.fill();
      ctx.fillStyle = hex(0x0b0d14, 0.9);
      if (horizontal) {
        roundRect(ctx, s.x + s.w * 0.28, s.y + 8, s.w * 0.44, s.h - 20, 6);
      } else {
        roundRect(ctx, s.x + 8, s.y + s.h * 0.28, s.w - 18, s.h * 0.44, 6);
      }
      ctx.fill();
      ctx.fillStyle = hex(0xfff3c4, 0.9);
      if (horizontal) {
        ctx.fillRect(s.x + s.w - 6, s.y + 8, 3, 8);
        ctx.fillRect(s.x + s.w - 6, s.y + s.h - 20, 3, 8);
      } else {
        ctx.fillRect(s.x + 8, s.y + s.h - 7, 8, 3);
        ctx.fillRect(s.x + s.w - 18, s.y + s.h - 7, 8, 3);
      }
      break;
    }
    case "rock": {
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      const pts: [number, number][] = [];
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 0.9 + rand() * 0.12;
        pts.push([
          cx + Math.cos(a) * (s.w / 2) * Math.min(1, k * 1.05),
          cy + Math.sin(a) * (s.h / 2) * Math.min(1, k * 1.05),
        ]);
      }
      const poly = (dx: number, dy: number) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy)));
        ctx.closePath();
      };
      ctx.fillStyle = hex(0x5e4630);
      poly(0, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x8c6e4c);
      poly(0, 0);
      ctx.fill();
      ctx.fillStyle = hex(0xa98a62, 0.8);
      ctx.beginPath();
      ctx.ellipse(cx - s.w * 0.12, cy - s.h * 0.15, s.w * 0.25, s.h * 0.18, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0x4a3524, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - s.w * 0.2, cy + s.h * 0.1);
      ctx.lineTo(cx + s.w * 0.15, cy - s.h * 0.05);
      ctx.stroke();
      break;
    }
    case "sandbag": {
      const horizontal = s.w >= s.h;
      const bag = 0xb59c6c;
      ctx.fillStyle = hex(shade(bag, -0.4));
      roundRect(ctx, s.x, s.y + 2, s.w, s.h, 8);
      ctx.fill();
      const len = horizontal ? s.w : s.h;
      for (let i = 0; i < len; i += 28) {
        ctx.fillStyle = hex(i % 56 === 0 ? bag : shade(bag, -0.08));
        if (horizontal) roundRect(ctx, s.x + i + 1, s.y + 1, Math.min(30, s.w - i - 1), s.h - 4, 8);
        else roundRect(ctx, s.x + 1, s.y + i + 1, s.w - 2, Math.min(30, s.h - i - 1) - 2, 8);
        ctx.fill();
      }
      break;
    }
    case "ruin": {
      bevel(ctx, s, 0xb58e64, 0x6e5034, 1);
      ctx.strokeStyle = hex(0x6e5034, 0.7);
      ctx.lineWidth = 1;
      const horizontal = s.w >= s.h;
      for (let i = 0; i < (horizontal ? s.w : s.h); i += 16) {
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(s.x + i, s.y + 2);
          ctx.lineTo(s.x + i, s.y + s.h - 4);
        } else {
          ctx.moveTo(s.x + 2, s.y + i);
          ctx.lineTo(s.x + s.w - 2, s.y + i);
        }
        ctx.stroke();
      }
      if (detail) speckle(ctx, s.x, s.y, s.w, s.h, 0.05, rand, 0x3a2614, 0.4, 2);
      break;
    }
    case "tank": {
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      if (map.id === "desert" && s.w === s.h) {
        // Water tower seen from above
        ctx.fillStyle = hex(0x4a3a2a);
        ctx.beginPath();
        ctx.arc(cx + 4, cy + 6, s.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hex(0x7a8a8a);
        ctx.beginPath();
        ctx.arc(cx, cy, s.w / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hex(0x5a6a6a);
        ctx.lineWidth = 3;
        for (let r = 12; r < s.w / 2; r += 14) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = hex(0xb85c38);
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Wrecked armored vehicle
        ctx.fillStyle = hex(0x3d4433);
        roundRect(ctx, s.x, s.y, s.w, s.h, 8);
        ctx.fill();
        ctx.fillStyle = hex(0x2a2f24);
        ctx.fillRect(s.x, s.y, s.w, 12);
        ctx.fillRect(s.x, s.y + s.h - 12, s.w, 12);
        ctx.fillStyle = hex(0x58614a);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(s.w, s.h) * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hex(0x2a2f24);
        ctx.fillRect(cx, cy - 4, s.w * 0.45, 8);
        ctx.fillStyle = hex(0x1a1a1a, 0.5);
        ctx.beginPath();
        ctx.ellipse(cx - s.w * 0.2, cy + 6, 18, 10, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function drawBorder(ctx: CanvasRenderingContext2D, map: MapDef) {
  const b = 18;
  ctx.fillStyle = hex(map.theme.shadow, 0.85);
  ctx.fillRect(0, 0, map.width, 6);
  ctx.fillRect(0, map.height - 6, map.width, 6);
  ctx.fillRect(0, 0, 6, map.height);
  ctx.fillRect(map.width - 6, 0, 6, map.height);
  const g = ctx.createLinearGradient(0, 0, b * 4, 0);
  g.addColorStop(0, hex(map.theme.shadow, 0.5));
  g.addColorStop(1, hex(map.theme.shadow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, b * 4, map.height);
  ctx.save();
  ctx.translate(map.width, map.height);
  ctx.rotate(Math.PI);
  ctx.fillRect(0, 0, b * 4, map.height);
  ctx.restore();
  const gv = ctx.createLinearGradient(0, 0, 0, b * 4);
  gv.addColorStop(0, hex(map.theme.shadow, 0.5));
  gv.addColorStop(1, hex(map.theme.shadow, 0));
  ctx.fillStyle = gv;
  ctx.fillRect(0, 0, map.width, b * 4);
  ctx.save();
  ctx.translate(map.width, map.height);
  ctx.rotate(Math.PI);
  ctx.fillRect(0, 0, map.width, b * 4);
  ctx.restore();
}
