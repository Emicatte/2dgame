import { ZOMBIE_LIST, type ZombieDef } from "@scrapline/shared";
import type Phaser from "phaser";
import { hex, makeCanvas, roundRect, shade } from "./canvas.ts";
import { TEX_SCALE } from "./textures.ts";

/**
 * Procedural top-down infected (original art, generated at boot like every other sprite). Facing
 * +x: hunched shoulders, head pushed forward, arms reaching. Each kind has a readable silhouette:
 * runners lean and are thin, brutes are wide with a heavy plate, spitters carry a glowing sac,
 * stalkers are dark and low, exploders are swollen with hazard-yellow pustules.
 */
export const ZTEX = {
  body: (kind: string) => `zombie-${kind}`,
  acid: "acid-puddle",
  spit: "acid-spit",
  prop: (kind: string) => `prop-${kind}`,
} as const;

function radialGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: number,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hex(color, alpha));
  g.addColorStop(1, hex(color, 0));
  return g;
}

function drawZombie(def: ZombieDef): HTMLCanvasElement {
  const S = TEX_SCALE;
  const r = def.radius;
  const size = Math.ceil(r * 3.6) * S;
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const body = def.color;
  const dark = shade(body, -0.5);
  const accent = def.accent;
  const wide =
    def.kind === "brute" || def.kind === "abomination"
      ? 1.25
      : def.kind === "runner"
        ? 0.8
        : def.kind === "exploder"
          ? 1.15
          : 1;
  // Arms reaching forward.
  ctx.strokeStyle = hex(shade(body, -0.15));
  ctx.lineWidth = def.kind === "brute" ? 9 : def.kind === "abomination" ? 13 : 5;
  const reach = def.kind === "stalker" ? 1.25 : def.kind === "runner" ? 1.1 : 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, side * r * 0.62 * wide);
    ctx.quadraticCurveTo(r * 0.55, side * r * 0.85 * wide, r * 1.05 * reach, side * r * 0.42);
    ctx.stroke();
    ctx.fillStyle = hex(shade(accent, -0.25));
    ctx.beginPath();
    ctx.arc(r * 1.05 * reach, side * r * 0.42, def.kind === "brute" ? 5.5 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Torso.
  ctx.fillStyle = hex(body);
  ctx.strokeStyle = hex(dark);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(-r * 0.12, 0, r * 0.62, r * 0.82 * wide, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Torn clothing / plates.
  ctx.fillStyle = hex(shade(body, -0.28));
  ctx.beginPath();
  ctx.ellipse(-r * 0.32, r * 0.18 * wide, r * 0.3, r * 0.42 * wide, 0.3, 0, Math.PI * 2);
  ctx.fill();
  if (def.kind === "brute") {
    ctx.fillStyle = hex(shade(body, -0.35));
    roundRect(ctx, -r * 0.55, -r * 0.7, r * 0.45, r * 1.4, 4);
    ctx.fill();
    ctx.strokeStyle = hex(accent, 0.6);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  if (def.kind === "spitter") {
    const g = radialGlow(ctx, -r * 0.35, 0, r * 0.55, accent, 0.9);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(-r * 0.35, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  if (def.kind === "exploder") {
    for (const [px, py, pr] of [
      [-0.3, -0.45, 0.26],
      [0.05, 0.5, 0.22],
      [-0.5, 0.25, 0.18],
      [0.2, -0.15, 0.16],
    ] as const) {
      ctx.fillStyle = hex(accent, 0.95);
      ctx.beginPath();
      ctx.arc(px * r, py * r, pr * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hex(shade(accent, 0.5), 0.9);
      ctx.beginPath();
      ctx.arc(px * r - 1, py * r - 1, pr * r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (def.kind === "abomination") {
    // Fused bodies: extra masses, a second head, exposed glowing tissue.
    for (const [px, py, pr, tone] of [
      [-0.45, -0.5, 0.42, -0.2],
      [-0.5, 0.45, 0.38, -0.3],
      [0.05, -0.62, 0.3, 0.05],
      [-0.1, 0.6, 0.32, -0.1],
    ] as const) {
      ctx.fillStyle = hex(shade(body, tone));
      ctx.strokeStyle = hex(dark);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(px * r, py * r, pr * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = radialGlow(ctx, -r * 0.2, 0, r * 0.5, accent, 0.85);
    ctx.beginPath();
    ctx.arc(-r * 0.2, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hex(shade(body, 0.1));
    ctx.beginPath();
    ctx.arc(r * 0.05, -r * 0.42, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Head, pushed forward.
  const hr = def.kind === "brute" ? r * 0.36 : def.kind === "abomination" ? r * 0.3 : r * 0.42;
  ctx.fillStyle = hex(shade(body, 0.12));
  ctx.strokeStyle = hex(dark);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(r * 0.38, 0, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eyes (forward-facing glints: makes the facing readable at a glance).
  ctx.fillStyle = hex(accent);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.38 + hr * 0.55, side * hr * 0.38, Math.max(1.3, hr * 0.17), 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function drawPuddle(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, hex(0xc6ff4a, 0.75));
  g.addColorStop(0.55, hex(0x7fbf2a, 0.5));
  g.addColorStop(1, hex(0x3f6a16, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = 54 + Math.sin(i * 2.7) * 6 + Math.cos(i * 1.3) * 4;
    const x = 64 + Math.cos(a) * rr;
    const y = 64 + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return c;
}

function drawSpit(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(48, 48);
  ctx.fillStyle = radialGlow(ctx, 24, 24, 22, 0xc6ff4a, 1);
  ctx.beginPath();
  ctx.arc(24, 24, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(0xf0ffc0);
  ctx.beginPath();
  ctx.arc(20, 20, 5, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Mission props: generator, keycard, gate panel, terminal, supply crate, loot (ammo, health). */
function drawProp(kind: string): HTMLCanvasElement {
  const S = TEX_SCALE;
  const size = 64 * S;
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  ctx.lineJoin = "round";
  const plate = (w: number, h: number, fill: number, stroke: number) => {
    ctx.fillStyle = hex(fill);
    ctx.strokeStyle = hex(stroke);
    ctx.lineWidth = 1.5;
    roundRect(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();
  };
  switch (kind) {
    case "generator":
      plate(46, 30, 0x3a3f45, 0x15171a);
      ctx.fillStyle = hex(0xe0a33a);
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * 7 - 2, -10, 4, 20);
      ctx.fillStyle = hex(0x101114);
      ctx.fillRect(-20, -13, 8, 6);
      break;
    case "keycard":
      ctx.rotate(-0.3);
      plate(26, 17, 0x2f6e8a, 0x0b0c0e);
      ctx.fillStyle = hex(0xe8e4dc);
      ctx.fillRect(-10, -5, 8, 6);
      ctx.fillStyle = hex(0x9fe7ff);
      ctx.fillRect(2, -6, 7, 2);
      ctx.fillRect(2, -2, 9, 2);
      break;
    case "panel":
    case "terminal":
      plate(28, 34, 0x2a2d30, 0x0b0c0e);
      ctx.fillStyle = hex(kind === "panel" ? 0xff8a3d : 0x7dffb0, 0.9);
      ctx.fillRect(-9, -11, 18, 10);
      ctx.fillStyle = hex(0x6a7078);
      for (let i = 0; i < 3; i++) ctx.fillRect(-9 + i * 7, 4, 4, 4);
      break;
    case "supply":
      plate(44, 34, 0x4e5a3a, 0x15171a);
      ctx.strokeStyle = hex(0x2a3020);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-22, -17);
      ctx.lineTo(22, 17);
      ctx.moveTo(22, -17);
      ctx.lineTo(-22, 17);
      ctx.stroke();
      ctx.fillStyle = hex(0xe8e4dc);
      ctx.fillRect(-4, -12, 8, 24);
      ctx.fillRect(-12, -4, 24, 8);
      break;
    case "ammo":
      plate(20, 14, 0x6e6430, 0x15171a);
      ctx.fillStyle = hex(0xffd27a);
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 5 - 1.5, -4, 3, 8);
      break;
    case "health":
      plate(18, 18, 0xe8e4dc, 0x15171a);
      ctx.fillStyle = hex(0xff5a5a);
      ctx.fillRect(-2.5, -7, 5, 14);
      ctx.fillRect(-7, -2.5, 14, 5);
      break;
    case "medical":
      // A field medical case: white shell, red cross, a dark strap.
      plate(34, 24, 0xdcd8cf, 0x15171a);
      ctx.fillStyle = hex(0x3a3e43);
      ctx.fillRect(-17, -2, 34, 4);
      ctx.fillStyle = hex(0xd83a3a);
      ctx.fillRect(-3, -9, 6, 18);
      ctx.fillRect(-9, -3, 18, 6);
      ctx.fillStyle = hex(0x6a7078);
      ctx.fillRect(-5, -15, 10, 3);
      break;
    case "radio":
      // A field radio with its antenna and a green dial.
      plate(34, 22, 0x3a3f2e, 0x0b0c0e);
      ctx.strokeStyle = hex(0x9aa0a8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, -11);
      ctx.lineTo(20, -24);
      ctx.stroke();
      ctx.fillStyle = hex(0x7dffb0, 0.95);
      ctx.fillRect(-12, -6, 12, 7);
      ctx.fillStyle = hex(0x15171a);
      for (let i = 0; i < 3; i++) ctx.fillRect(4, -6 + i * 5, 8, 2);
      break;
  }
  return c;
}

export function generateZombieTextures(scene: Phaser.Scene): void {
  const add = (key: string, canvas: HTMLCanvasElement) => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
  };
  for (const def of ZOMBIE_LIST) add(ZTEX.body(def.kind), drawZombie(def));
  add(ZTEX.acid, drawPuddle());
  add(ZTEX.spit, drawSpit());
  for (const k of [
    "generator",
    "keycard",
    "panel",
    "terminal",
    "supply",
    "ammo",
    "health",
    "medical",
    "radio",
  ]) {
    add(ZTEX.prop(k), drawProp(k));
  }
}
