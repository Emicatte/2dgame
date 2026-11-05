import { VEHICLES, type VehicleKind } from "@scrapline/shared";
import type Phaser from "phaser";
import { hex, makeCanvas, roundRect, shade } from "./canvas.ts";
import { TEX_SCALE } from "./textures.ts";

/**
 * Procedural top-down vehicle sprites (original art, no external assets). Every body faces +x and
 * is drawn at TEX_SCALE over its hull size, so the sprite matches the collision box exactly.
 */
export const VTEX = {
  body: (kind: VehicleKind) => `veh-${kind}`,
  turret: "veh-turret",
  rotor: "veh-rotor",
  tailRotor: "veh-tail-rotor",
  marker: "veh-marker",
} as const;

const PAINT: Record<VehicleKind, number> = {
  car: 0x8a9aa8,
  offroad: 0x8b7a52,
  armored: 0x56603f,
  heli: 0x6f7d5c,
};

function canvasFor(
  kind: VehicleKind,
  pad = 6,
): [HTMLCanvasElement, CanvasRenderingContext2D, number, number] {
  const def = VEHICLES[kind];
  const w = (def.halfLength + pad) * 2;
  const h = (def.halfWidth + pad) * 2;
  const [c, ctx] = makeCanvas(w * TEX_SCALE, h * TEX_SCALE);
  ctx.scale(TEX_SCALE, TEX_SCALE);
  ctx.translate(w / 2, h / 2);
  return [c, ctx, def.halfLength, def.halfWidth];
}

function wheels(ctx: CanvasRenderingContext2D, hl: number, hw: number, xs: number[], size: [number, number]) {
  ctx.fillStyle = hex(0x141518);
  for (const x of xs) {
    for (const side of [-1, 1]) {
      roundRect(ctx, x - size[0] / 2, side * hw - size[1] / 2 - side * 1, size[0], size[1], 2);
      ctx.fill();
    }
  }
  void hl;
}

function drawCar(): HTMLCanvasElement {
  const [c, ctx, hl, hw] = canvasFor("car");
  const paint = PAINT.car;
  wheels(ctx, hl, hw, [-22, 22], [13, 6]);
  // Body
  ctx.fillStyle = hex(shade(paint, -0.45));
  roundRect(ctx, -hl, -hw + 1, hl * 2, hw * 2 - 2, 9);
  ctx.fill();
  ctx.fillStyle = hex(paint);
  roundRect(ctx, -hl + 2, -hw + 2.5, hl * 2 - 4, hw * 2 - 5, 8);
  ctx.fill();
  // Bonnet crease and roof
  ctx.fillStyle = hex(shade(paint, 0.18));
  roundRect(ctx, 10, -hw + 6, hl - 14, hw * 2 - 12, 4);
  ctx.fill();
  ctx.fillStyle = hex(0x0e1117, 0.92);
  roundRect(ctx, -18, -hw + 4, 30, hw * 2 - 8, 5); // cabin glass
  ctx.fill();
  ctx.fillStyle = hex(shade(paint, -0.1));
  roundRect(ctx, -14, -hw + 7, 20, hw * 2 - 14, 3); // roof
  ctx.fill();
  // Lights
  ctx.fillStyle = hex(0xfff3c4);
  ctx.fillRect(hl - 3, -hw + 4, 2.5, 6);
  ctx.fillRect(hl - 3, hw - 10, 2.5, 6);
  ctx.fillStyle = hex(0xff4d4d);
  ctx.fillRect(-hl + 1, -hw + 4, 2, 5);
  ctx.fillRect(-hl + 1, hw - 9, 2, 5);
  return c;
}

function drawOffroad(): HTMLCanvasElement {
  const [c, ctx, hl, hw] = canvasFor("offroad");
  const paint = PAINT.offroad;
  wheels(ctx, hl, hw, [-24, 22], [15, 8]);
  ctx.fillStyle = hex(shade(paint, -0.5));
  roundRect(ctx, -hl, -hw + 1, hl * 2, hw * 2 - 2, 5);
  ctx.fill();
  ctx.fillStyle = hex(paint);
  roundRect(ctx, 0, -hw + 2.5, hl - 2, hw * 2 - 5, 5); // cab + bonnet
  ctx.fill();
  ctx.fillStyle = hex(0x0e1117, 0.9);
  roundRect(ctx, 2, -hw + 5, 14, hw * 2 - 10, 3);
  ctx.fill();
  // Open cargo bed with ribs (the rear passengers sit here)
  ctx.fillStyle = hex(shade(paint, -0.3));
  roundRect(ctx, -hl + 2, -hw + 2.5, hl - 2, hw * 2 - 5, 3);
  ctx.fill();
  ctx.strokeStyle = hex(shade(paint, -0.55));
  ctx.lineWidth = 1.2;
  for (let x = -hl + 8; x < -2; x += 7) {
    ctx.beginPath();
    ctx.moveTo(x, -hw + 4);
    ctx.lineTo(x, hw - 4);
    ctx.stroke();
  }
  // Roll bar and bull bar
  ctx.strokeStyle = hex(0x1b1c1f);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-2, -hw + 2);
  ctx.lineTo(-2, hw - 2);
  ctx.moveTo(hl - 1, -hw + 5);
  ctx.lineTo(hl - 1, hw - 5);
  ctx.stroke();
  ctx.fillStyle = hex(0xfff3c4);
  ctx.fillRect(hl - 5, -hw + 5, 2.5, 5);
  ctx.fillRect(hl - 5, hw - 10, 2.5, 5);
  return c;
}

function drawArmored(): HTMLCanvasElement {
  const [c, ctx, hl, hw] = canvasFor("armored");
  const paint = PAINT.armored;
  // Tracks
  ctx.fillStyle = hex(0x18191b);
  roundRect(ctx, -hl, -hw, hl * 2, 9, 3);
  ctx.fill();
  roundRect(ctx, -hl, hw - 9, hl * 2, 9, 3);
  ctx.fill();
  ctx.strokeStyle = hex(0x2c2e31);
  ctx.lineWidth = 1;
  for (let x = -hl + 3; x < hl; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x, -hw + 1);
    ctx.lineTo(x, -hw + 8);
    ctx.moveTo(x, hw - 8);
    ctx.lineTo(x, hw - 1);
    ctx.stroke();
  }
  // Hull with a sloped glacis at the nose
  ctx.fillStyle = hex(shade(paint, -0.45));
  ctx.beginPath();
  ctx.moveTo(-hl + 2, -hw + 6);
  ctx.lineTo(hl - 12, -hw + 6);
  ctx.lineTo(hl, -hw + 14);
  ctx.lineTo(hl, hw - 14);
  ctx.lineTo(hl - 12, hw - 6);
  ctx.lineTo(-hl + 2, hw - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hex(paint);
  roundRect(ctx, -hl + 5, -hw + 9, hl * 2 - 20, hw * 2 - 18, 3);
  ctx.fill();
  // Hatches, vision blocks, rivets
  ctx.fillStyle = hex(shade(paint, -0.25));
  roundRect(ctx, -hl + 9, -hw + 12, 16, 12, 2);
  ctx.fill();
  roundRect(ctx, -hl + 9, hw - 24, 16, 12, 2);
  ctx.fill();
  roundRect(ctx, 14, -10, 10, 8, 2);
  ctx.fill();
  ctx.fillStyle = hex(0x9fd8ff, 0.7);
  ctx.fillRect(hl - 9, -6, 2, 4);
  ctx.fillRect(hl - 9, 2, 2, 4);
  ctx.fillStyle = hex(shade(paint, 0.25));
  for (const [x, y] of [
    [-hl + 6, -hw + 10],
    [hl - 16, -hw + 10],
    [-hl + 6, hw - 10],
    [hl - 16, hw - 10],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function drawTurret(): HTMLCanvasElement {
  const S = TEX_SCALE;
  const [c, ctx] = makeCanvas(64 * S, 32 * S);
  ctx.scale(S, S);
  ctx.translate(18, 16);
  const paint = PAINT.armored;
  ctx.fillStyle = hex(0x232528);
  roundRect(ctx, 6, -2.2, 38, 4.4, 1.5); // barrel
  ctx.fill();
  ctx.fillStyle = hex(0x111214);
  ctx.fillRect(40, -3, 5, 6); // muzzle brake
  ctx.fillStyle = hex(shade(paint, -0.4));
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(shade(paint, 0.1));
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(shade(paint, -0.25));
  roundRect(ctx, -6, -9, 10, 18, 3); // gun shield
  ctx.fill();
  return c;
}

function drawHeli(): HTMLCanvasElement {
  const [c, ctx, hl, hw] = canvasFor("heli", 8);
  const paint = PAINT.heli;
  // Tail boom and fin
  ctx.fillStyle = hex(shade(paint, -0.35));
  roundRect(ctx, -hl, -3.5, hl, 7, 3);
  ctx.fill();
  ctx.fillStyle = hex(shade(paint, -0.15));
  roundRect(ctx, -hl, -10, 7, 20, 2);
  ctx.fill();
  // Skids
  ctx.strokeStyle = hex(0x1c1d20);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, -hw + 1);
  ctx.lineTo(26, -hw + 1);
  ctx.moveTo(-14, hw - 1);
  ctx.lineTo(26, hw - 1);
  ctx.stroke();
  // Fuselage
  ctx.fillStyle = hex(shade(paint, -0.45));
  ctx.beginPath();
  ctx.ellipse(8, 0, 30, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(paint);
  ctx.beginPath();
  ctx.ellipse(8, 0, 28, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cockpit canopy
  ctx.fillStyle = hex(0x0e1117, 0.92);
  ctx.beginPath();
  ctx.ellipse(26, 0, 11, 11, 0, -Math.PI / 2, Math.PI / 2);
  ctx.fill();
  ctx.fillStyle = hex(0x9fe7ff, 0.25);
  ctx.beginPath();
  ctx.ellipse(28, -4, 5, 3, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Doors (side gunners)
  ctx.fillStyle = hex(shade(paint, -0.3));
  ctx.fillRect(-6, -14, 14, 3);
  ctx.fillRect(-6, 11, 14, 3);
  // Rotor hub
  ctx.fillStyle = hex(0x1b1c1f);
  ctx.beginPath();
  ctx.arc(4, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

function drawRotor(): HTMLCanvasElement {
  const S = TEX_SCALE;
  const r = 52;
  const [c, ctx] = makeCanvas(r * 2 * S, r * 2 * S);
  ctx.scale(S, S);
  ctx.translate(r, r);
  // Faint disc: where the blades sweep (reads as "rotor" even at full spin).
  ctx.fillStyle = hex(0xd8dccf, 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex(0x15161a, 0.9);
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI) / 2);
    roundRect(ctx, 3, -2.2, r - 4, 4.4, 2);
    ctx.fill();
    ctx.restore();
  }
  return c;
}

function drawTailRotor(): HTMLCanvasElement {
  const S = TEX_SCALE;
  const [c, ctx] = makeCanvas(20 * S, 20 * S);
  ctx.scale(S, S);
  ctx.translate(10, 10);
  ctx.fillStyle = hex(0x15161a, 0.9);
  ctx.fillRect(-9, -1.2, 18, 2.4);
  ctx.fillRect(-1.2, -9, 2.4, 18);
  return c;
}

/** Ring drawn under occupied vehicles in the team's colour (tinted at runtime). */
function drawMarker(): HTMLCanvasElement {
  const S = TEX_SCALE;
  const [c, ctx] = makeCanvas(24 * S, 24 * S);
  ctx.scale(S, S);
  ctx.translate(12, 12);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(9, 0);
  ctx.lineTo(0, 9);
  ctx.lineTo(-9, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hex(0x0b0c0e, 0.6);
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(4, 0);
  ctx.lineTo(0, 4);
  ctx.lineTo(-4, 0);
  ctx.closePath();
  ctx.fill();
  return c;
}

export function generateVehicleTextures(scene: Phaser.Scene): void {
  const add = (key: string, canvas: HTMLCanvasElement) => {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.textures.addCanvas(key, canvas);
  };
  add(VTEX.body("car"), drawCar());
  add(VTEX.body("offroad"), drawOffroad());
  add(VTEX.body("armored"), drawArmored());
  add(VTEX.body("heli"), drawHeli());
  add(VTEX.turret, drawTurret());
  add(VTEX.rotor, drawRotor());
  add(VTEX.tailRotor, drawTailRotor());
  add(VTEX.marker, drawMarker());
}
