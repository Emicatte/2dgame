import { SKINS, type SkinDef, WEAPON_LIST, type WeaponDef } from "@scrapline/shared";
import type Phaser from "phaser";
import { hex, makeCanvas, radialGlow, roundRect, shade } from "./canvas.ts";
import { generateVehicleTextures } from "./vehicleArt.ts";

/**
 * All sprites are drawn procedurally at boot: original art, no external assets to license,
 * and crisp at any zoom because textures are rendered at 2x their on-screen size.
 */
export const TEX_SCALE = 2;

export const TEX = {
  soldier: (skin: string) => `soldier-${skin}`,
  weapon: (w: WeaponDef | string) => `weapon-${typeof w === "string" ? w : w.id}`,
  foot: "foot",
  shadow: "shadow",
  glow: "glow",
  glowSoft: "glow-soft",
  muzzle: "muzzle",
  tracer: "tracer",
  spark: "spark",
  smoke: "smoke",
  debris: "debris",
  shell: "shell",
  ring: "ring",
  pickupHealth: "pickup-health",
  pickupAmmo: "pickup-ammo",
  pickupBase: "pickup-base",
  laser: "laser",
} as const;

function add(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}

function drawSoldier(skin: SkinDef): HTMLCanvasElement {
  const S = TEX_SCALE;
  const size = 56 * S;
  const [c, ctx] = makeCanvas(size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(S, S);
  // Facing +x. Shoulders/torso
  const body = skin.primary;
  ctx.lineJoin = "round";
  // Backpack
  ctx.fillStyle = hex(shade(body, -0.35));
  roundRect(ctx, -19, -11, 11, 22, 4);
  ctx.fill();
  ctx.fillStyle = hex(shade(body, -0.15));
  roundRect(ctx, -17, -8, 7, 16, 2);
  ctx.fill();
  // Shoulder plate
  ctx.fillStyle = hex(body);
  ctx.strokeStyle = hex(shade(body, -0.55));
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(-2, 0, 11, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Accent trims on the shoulders
  ctx.fillStyle = hex(skin.accent);
  roundRect(ctx, -6, -16, 7, 4, 1.5);
  ctx.fill();
  roundRect(ctx, -6, 12, 7, 4, 1.5);
  ctx.fill();
  // Arms reaching to the weapon
  ctx.strokeStyle = hex(shade(body, -0.25));
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(12, -3);
  ctx.moveTo(0, 11);
  ctx.lineTo(16, 2);
  ctx.stroke();
  // Gloves
  ctx.fillStyle = hex(0x1d1e22);
  ctx.beginPath();
  ctx.arc(12.5, -3, 2.8, 0, Math.PI * 2);
  ctx.arc(16.5, 2, 2.8, 0, Math.PI * 2);
  ctx.fill();
  // Helmet
  const helmet = shade(body, 0.12);
  ctx.fillStyle = hex(helmet);
  ctx.strokeStyle = hex(shade(body, -0.6));
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(1, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Helmet stripe
  ctx.strokeStyle = hex(skin.accent);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(4, 0);
  ctx.stroke();
  // Visor
  ctx.strokeStyle = hex(skin.visor);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(1, 0, 6.2, -0.75, 0.75);
  ctx.stroke();
  ctx.strokeStyle = hex(0xffffff, 0.55);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(1, 0, 6.2, -0.55, -0.15);
  ctx.stroke();
  return c;
}

function drawWeapon(w: WeaponDef): HTMLCanvasElement {
  const S = TEX_SCALE;
  const shapes: Record<string, { len: number; h: number }> = {
    pistol: { len: 16, h: 6 },
    rifle: { len: 34, h: 7 },
    smg: { len: 24, h: 7 },
    shotgun: { len: 32, h: 8 },
    sniper: { len: 46, h: 7 },
    mg: { len: 40, h: 9 },
    doorgun: { len: 32, h: 8 },
  };
  const sh = shapes[w.id] ?? { len: 24, h: 7 };
  const [c, ctx] = makeCanvas((sh.len + 4) * S, (sh.h + 10) * S);
  ctx.scale(S, S);
  ctx.translate(2, (sh.h + 10) / 2);
  const metal = 0x2a2c31;
  const edge = 0x111216;
  const accent = w.fx.tracerColor;
  ctx.strokeStyle = hex(edge);
  ctx.lineWidth = 1;
  // Body
  ctx.fillStyle = hex(metal);
  roundRect(ctx, 0, -sh.h / 2, sh.len * 0.62, sh.h, 1.5);
  ctx.fill();
  ctx.stroke();
  // Barrel
  ctx.fillStyle = hex(0x3a3d44);
  const bh = w.id === "shotgun" ? 4 : 2.6;
  roundRect(ctx, sh.len * 0.55, -bh / 2, sh.len * 0.45, bh, 1);
  ctx.fill();
  ctx.stroke();
  if (w.id === "rifle" || w.id === "smg") {
    // Magazine
    ctx.fillStyle = hex(0x1e2024);
    roundRect(ctx, sh.len * 0.3, sh.h / 2 - 1, 4, 5, 1);
    ctx.fill();
  }
  if (w.id === "sniper") {
    ctx.fillStyle = hex(0x15161a);
    roundRect(ctx, sh.len * 0.25, -sh.h / 2 - 3, sh.len * 0.3, 3.5, 1.5);
    ctx.fill();
    ctx.fillStyle = hex(0x9fe7ff, 0.9);
    ctx.fillRect(sh.len * 0.25 + 1, -sh.h / 2 - 2.2, 2, 2);
  }
  if (w.id === "shotgun") {
    ctx.fillStyle = hex(0x6b4a30);
    roundRect(ctx, sh.len * 0.42, -sh.h / 2 + 1, sh.len * 0.16, sh.h - 2, 1);
    ctx.fill();
  }
  // Accent stripe matching the tracer color: readable weapon identity from top-down
  ctx.fillStyle = hex(accent, 0.9);
  ctx.fillRect(sh.len * 0.12, -sh.h / 2 + 1, sh.len * 0.18, 1.4);
  return c;
}

function drawFoot(): HTMLCanvasElement {
  const S = TEX_SCALE;
  const [c, ctx] = makeCanvas(12 * S, 8 * S);
  ctx.scale(S, S);
  ctx.fillStyle = hex(0x16171a);
  ctx.beginPath();
  ctx.ellipse(6, 4, 5.5, 3.3, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function drawShadow(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

function drawMuzzle(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 32);
  ctx.translate(4, 16);
  const g = ctx.createLinearGradient(0, 0, 60, 0);
  g.addColorStop(0, "rgba(255,255,240,1)");
  g.addColorStop(0.35, "rgba(255,210,120,0.95)");
  g.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(22, -9);
  ctx.lineTo(60, 0);
  ctx.lineTo(22, 9);
  ctx.lineTo(0, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.ellipse(6, 0, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function drawTracer(): HTMLCanvasElement {
  // Horizontal streak: transparent tail → bright head. Scaled on X to the shot length.
  const [c, ctx] = makeCanvas(128, 8);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 2, 128, 4);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(40, 0, 88, 8);
  return c;
}

function drawSpark(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(16, 4);
  const g = ctx.createLinearGradient(0, 0, 16, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 1, 16, 2);
  return c;
}

function drawSmoke(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(48, 48);
  const g = ctx.createRadialGradient(24, 24, 2, 24, 24, 24);
  g.addColorStop(0, "rgba(220,220,220,0.5)");
  g.addColorStop(1, "rgba(220,220,220,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);
  return c;
}

function drawDebris(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(10, 10);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(1, 2);
  ctx.lineTo(9, 0);
  ctx.lineTo(8, 8);
  ctx.lineTo(2, 9);
  ctx.closePath();
  ctx.fill();
  return c;
}

function drawShell(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(8, 4);
  ctx.fillStyle = "#d9a441";
  ctx.fillRect(0, 0, 8, 4);
  ctx.fillStyle = "#8a6420";
  ctx.fillRect(0, 0, 2, 4);
  return c;
}

function drawRing(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

function drawLaser(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(64, 4);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0.9)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 1, 64, 2);
  return c;
}

function drawPickup(kind: "health" | "ammo" | "base"): HTMLCanvasElement {
  const S = TEX_SCALE;
  const size = 40 * S;
  const [c, ctx] = makeCanvas(size, size);
  ctx.scale(S, S);
  if (kind === "base") {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(20, 20, 17, 0, Math.PI * 2);
    ctx.stroke();
    return c;
  }
  const body = kind === "health" ? 0xe8e4dc : 0x3b4a2c;
  ctx.fillStyle = hex(shade(body, -0.5));
  roundRect(ctx, 7, 9, 26, 24, 3);
  ctx.fill();
  ctx.fillStyle = hex(body);
  roundRect(ctx, 7, 7, 26, 24, 3);
  ctx.fill();
  if (kind === "health") {
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(17, 11, 6, 16);
    ctx.fillRect(12, 16, 16, 6);
  } else {
    ctx.fillStyle = "#d9a441";
    for (let i = 0; i < 4; i++) ctx.fillRect(11 + i * 5, 12, 3, 12);
    ctx.fillStyle = "#8a6420";
    for (let i = 0; i < 4; i++) ctx.fillRect(11 + i * 5, 12, 3, 3);
  }
  return c;
}

export function generateTextures(scene: Phaser.Scene): void {
  for (const skin of SKINS) add(scene, TEX.soldier(skin.id), drawSoldier(skin));
  for (const w of WEAPON_LIST) add(scene, TEX.weapon(w), drawWeapon(w));
  add(scene, TEX.foot, drawFoot());
  add(scene, TEX.shadow, drawShadow());
  add(scene, TEX.glow, radialGlow(128, 1, 1.6));
  add(scene, TEX.glowSoft, radialGlow(256, 0.9, 2.6));
  add(scene, TEX.muzzle, drawMuzzle());
  add(scene, TEX.tracer, drawTracer());
  add(scene, TEX.spark, drawSpark());
  add(scene, TEX.smoke, drawSmoke());
  add(scene, TEX.debris, drawDebris());
  add(scene, TEX.shell, drawShell());
  add(scene, TEX.ring, drawRing());
  add(scene, TEX.laser, drawLaser());
  add(scene, TEX.pickupHealth, drawPickup("health"));
  add(scene, TEX.pickupAmmo, drawPickup("ammo"));
  add(scene, TEX.pickupBase, drawPickup("base"));
  generateVehicleTextures(scene);
}
