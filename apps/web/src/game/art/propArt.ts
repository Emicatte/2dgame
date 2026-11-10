import { DISGUISES, type DisguiseDef, type DisguiseKind } from "@scrapline/shared";

/**
 * Procedural art of the transformable objects (Prop Hunt) and of the same objects as map clutter
 * in other modes. One drawing function for both: a disguised player and a real object of the same
 * kind are drawn by the very same code into the very same texture, so they are identical pixel
 * for pixel. Everything is drawn around (0, 0), unrotated; the caller places and rotates it.
 */

function hex(c: number, a = 1): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws one object of `kind` centred on (0, 0). */
export function drawPropShape(ctx: CanvasRenderingContext2D, def: DisguiseDef): void {
  const { w, h } = def;
  const x = -w / 2;
  const y = -h / 2;
  // Contact shadow (part of the object, so baked and live objects match).
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(3, 5, w * 0.52, h * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  switch (def.kind as DisguiseKind) {
    case "crate": {
      ctx.fillStyle = hex(0x5a4126);
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x7a5a36);
      rr(ctx, x + 2, y + 2, w - 4, h - 5, 3);
      ctx.fill();
      ctx.strokeStyle = hex(0x4a3420);
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 5, y + 5, w - 10, h - 12);
      ctx.beginPath();
      ctx.moveTo(x + 5, y + 5);
      ctx.lineTo(x + w - 5, y + h - 7);
      ctx.moveTo(x + w - 5, y + 5);
      ctx.lineTo(x + 5, y + h - 7);
      ctx.stroke();
      break;
    }
    case "barrel": {
      const r = w / 2;
      ctx.fillStyle = hex(0x6b2a22);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x9a3d2e);
      ctx.beginPath();
      ctx.arc(0, -1, r - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0x4a1d18);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -1, r - 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hex(0x2a1a16);
      ctx.beginPath();
      ctx.arc(r * 0.35, -r * 0.35, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "chair": {
      ctx.fillStyle = hex(0x2a2e35);
      rr(ctx, x + 2, y + 2, w - 4, h - 4, 6);
      ctx.fill();
      ctx.fillStyle = hex(0x3d4f6b);
      rr(ctx, x + 5, y + 7, w - 10, h - 12, 5);
      ctx.fill();
      ctx.fillStyle = hex(0x2e3d55);
      rr(ctx, x + 4, y + 1, w - 8, 7, 3);
      ctx.fill();
      break;
    }
    case "box": {
      ctx.fillStyle = hex(0x8a6a42);
      rr(ctx, x, y, w, h, 2);
      ctx.fill();
      ctx.fillStyle = hex(0xb08a58);
      rr(ctx, x + 1, y + 1, w - 2, h - 4, 2);
      ctx.fill();
      ctx.fillStyle = hex(0xd8c49a, 0.9);
      ctx.fillRect(-2, y + 1, 4, h - 4);
      break;
    }
    case "bin": {
      const r = w / 2;
      ctx.fillStyle = hex(0x22402e);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x35644a);
      ctx.beginPath();
      ctx.arc(0, -1, r - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0x1c3426);
      ctx.lineWidth = 2;
      for (let a = 0; a < 6; a++) {
        ctx.beginPath();
        ctx.moveTo(Math.cos((a * Math.PI) / 3) * 4, -1 + Math.sin((a * Math.PI) / 3) * 4);
        ctx.lineTo(Math.cos((a * Math.PI) / 3) * (r - 4), -1 + Math.sin((a * Math.PI) / 3) * (r - 4));
        ctx.stroke();
      }
      break;
    }
    case "cooler": {
      ctx.fillStyle = hex(0x1d4f7a);
      rr(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = hex(0x2f78b0);
      rr(ctx, x + 2, y + 2, w - 4, h - 6, 3);
      ctx.fill();
      ctx.fillStyle = hex(0xe8eef4);
      rr(ctx, x + 2, y + 2, w - 4, 6, 3);
      ctx.fill();
      ctx.fillStyle = hex(0xe8eef4);
      ctx.fillRect(-5, y + h - 9, 10, 3);
      break;
    }
    case "plant": {
      ctx.fillStyle = hex(0x6b4a33);
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x3f7a3a);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 8, 4, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hex(0x5aa04f);
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tires": {
      const r = w / 2;
      ctx.fillStyle = hex(0x161616);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0x343434);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -1, r - 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hex(0x2a2a2a);
      ctx.beginPath();
      ctx.arc(0, -1, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x0c0c0c);
      ctx.beginPath();
      ctx.arc(0, -1, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "cone": {
      ctx.fillStyle = hex(0x2a2a2a);
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = hex(0xff6a1f);
      ctx.beginPath();
      ctx.arc(0, -1, w * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex(0xf2f2f2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -1, w * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "vending": {
      ctx.fillStyle = hex(0x111018);
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x22202e);
      rr(ctx, x + 2, y + 2, w - 4, h - 5, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x3fa0ff, 0.85);
      rr(ctx, x + 6, y + 5, w - 22, h - 14, 2);
      ctx.fill();
      ctx.fillStyle = hex(0xffffff, 0.35);
      ctx.fillRect(x + 8, y + 7, w - 26, 2);
      ctx.fillStyle = hex(0xffd27a);
      ctx.fillRect(x + w - 13, y + 8, 6, 4);
      ctx.fillRect(x + w - 13, y + 15, 6, 4);
      break;
    }
    case "lamp": {
      // Floor lamp from above: a round shade with the bulb glow.
      const r = w / 2;
      ctx.fillStyle = hex(0x6b5a3a);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0xd9c48a);
      ctx.beginPath();
      ctx.arc(0, -1, r - 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0xfff1c0, 0.95);
      ctx.beginPath();
      ctx.arc(0, -1, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tv": {
      ctx.fillStyle = hex(0x2a2a2e);
      rr(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = hex(0x3c3c42);
      rr(ctx, x + 2, y + 2, w - 4, h - 6, 4);
      ctx.fill();
      ctx.fillStyle = hex(0x4f6b7a);
      rr(ctx, x + 5, y + 5, w - 16, h - 12, 5);
      ctx.fill();
      ctx.fillStyle = hex(0xffffff, 0.18);
      ctx.fillRect(x + 7, y + 7, w - 22, 3);
      ctx.fillStyle = hex(0x9a9a9a);
      ctx.beginPath();
      ctx.arc(x + w - 6, y + 9, 2, 0, Math.PI * 2);
      ctx.arc(x + w - 6, y + 16, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bag": {
      // Black trash bag: a lumpy blob with a knot.
      ctx.fillStyle = hex(0x1b1d22);
      ctx.beginPath();
      ctx.ellipse(0, 1, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x2c3038);
      ctx.beginPath();
      ctx.ellipse(-3, -1, w / 2 - 4, h / 2 - 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x4a505c, 0.8);
      ctx.beginPath();
      ctx.ellipse(-6, -5, 5, 3, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x101114);
      ctx.beginPath();
      ctx.arc(w / 2 - 6, -h / 2 + 6, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "toolbox": {
      ctx.fillStyle = hex(0x8a1f1f);
      rr(ctx, x, y, w, h, 2);
      ctx.fill();
      ctx.fillStyle = hex(0xc0392b);
      rr(ctx, x + 1, y + 1, w - 2, h - 4, 2);
      ctx.fill();
      ctx.fillStyle = hex(0x2a2a2e);
      ctx.fillRect(x + w / 2 - 7, y + 3, 14, 3);
      ctx.fillStyle = hex(0xd0d0d0);
      ctx.fillRect(x + 3, y + h / 2, 3, 3);
      ctx.fillRect(x + w - 6, y + h / 2, 3, 3);
      break;
    }
    case "extinguisher": {
      const r = w / 2;
      ctx.fillStyle = hex(0x8a1a12);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0xd8352a);
      ctx.beginPath();
      ctx.arc(0, -1, r - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x2a2a2e);
      ctx.fillRect(-2, -r, 4, r);
      ctx.fillRect(0, -r, r + 2, 3);
      break;
    }
    case "gascan": {
      ctx.fillStyle = hex(0x9a3a12);
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = hex(0xd9581f);
      rr(ctx, x + 1, y + 1, w - 2, h - 4, 3);
      ctx.fill();
      ctx.strokeStyle = hex(0x9a3a12);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + w - 8, y + h - 7);
      ctx.stroke();
      ctx.fillStyle = hex(0x2a2a2e);
      ctx.fillRect(x + w - 6, y + 2, 4, 6);
      break;
    }
    case "sofa": {
      ctx.fillStyle = hex(0x3a2a4a);
      rr(ctx, x, y, w, h, 7);
      ctx.fill();
      ctx.fillStyle = hex(0x5a4272);
      rr(ctx, x + 2, y + 2, w - 4, 10, 5);
      ctx.fill();
      ctx.fillStyle = hex(0x6d5288);
      rr(ctx, x + 7, y + 12, w / 2 - 9, h - 17, 4);
      ctx.fill();
      rr(ctx, 2, y + 12, w / 2 - 9, h - 17, 4);
      ctx.fill();
      ctx.fillStyle = hex(0x4a3560);
      rr(ctx, x + 1, y + 10, 6, h - 13, 3);
      ctx.fill();
      rr(ctx, x + w - 7, y + 10, 6, h - 13, 3);
      ctx.fill();
      break;
    }
    case "speaker": {
      ctx.fillStyle = hex(0x18191c);
      rr(ctx, x, y, w, h, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x26282d);
      rr(ctx, x + 1, y + 1, w - 2, h - 4, 3);
      ctx.fill();
      ctx.fillStyle = hex(0x0e0f11);
      ctx.beginPath();
      ctx.arc(0, 2, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(0x3a3d44);
      ctx.beginPath();
      ctx.arc(0, 2, w * 0.12, 0, Math.PI * 2);
      ctx.arc(0, y + 6, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Texture size for a kind (room for the shadow and any rotation). */
export function propCanvasSize(def: DisguiseDef): number {
  return Math.ceil(Math.hypot(def.w, def.h) + 12);
}

/** A canvas holding one object of `kind`, centred. */
export function propCanvas(def: DisguiseDef, scale = 2): HTMLCanvasElement {
  const size = propCanvasSize(def);
  const c = document.createElement("canvas");
  c.width = size * scale;
  c.height = size * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(size / 2, size / 2);
  drawPropShape(ctx, def);
  return c;
}

export function propTextureKey(index: number): string {
  return `prop-${DISGUISES[index]?.kind ?? "crate"}`;
}
