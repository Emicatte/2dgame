import type { WeaponDef } from "@scrapline/shared";
import Phaser from "phaser";
import { settingsStore } from "../../lib/settings.ts";
import { TEX } from "../art/textures.ts";

interface Tracer {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  // Animated streak travelling from (x0,y0) to (x1,y1)
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dist: number;
  speed: number;
  width: number;
}

interface Flash {
  img: Phaser.GameObjects.Image;
  life: number;
  max: number;
  baseScale: number;
}

interface FloatText {
  text: Phaser.GameObjects.Text;
  life: number;
  vy: number;
}

/**
 * Pooled transient effects. Nothing here allocates per shot once the pools are warm, which keeps
 * frame times flat during heavy firefights.
 */
export class Effects {
  private readonly tracers: Tracer[] = [];
  private readonly flashes: Flash[] = [];
  private readonly lights: Flash[] = [];
  private readonly texts: FloatText[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly debris: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly shells: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly rings: Flash[] = [];
  /** Number of live pooled objects, for the debug overlay. */
  active = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.sparks = scene.add
      .particles(0, 0, TEX.spark, {
        emitting: false,
        lifespan: { min: 120, max: 320 },
        speed: { min: 120, max: 520 },
        scale: { start: 1, end: 0.2 },
        alpha: { start: 1, end: 0 },
        rotate: { onEmit: (p) => (p ? Phaser.Math.RadToDeg(Math.atan2(p.velocityY, p.velocityX)) : 0) },
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(40);
    this.debris = scene.add
      .particles(0, 0, TEX.debris, {
        emitting: false,
        lifespan: { min: 400, max: 900 },
        speed: { min: 80, max: 340 },
        scale: { start: 0.9, end: 0.3 },
        alpha: { start: 1, end: 0 },
        rotate: { min: 0, max: 360 },
        drag: 300,
      } as Phaser.Types.GameObjects.Particles.ParticleEmitterConfig)
      .setDepth(15);
    this.smoke = scene.add
      .particles(0, 0, TEX.smoke, {
        emitting: false,
        lifespan: { min: 400, max: 800 },
        speed: { min: 10, max: 60 },
        scale: { start: 0.4, end: 1.4 },
        alpha: { start: 0.35, end: 0 },
      })
      .setDepth(39);
    this.shells = scene.add
      .particles(0, 0, TEX.shell, {
        emitting: false,
        lifespan: 500,
        speed: { min: 60, max: 140 },
        rotate: { min: 0, max: 360 },
        alpha: { start: 1, end: 0 },
        scale: 0.9,
      })
      .setDepth(14);
  }

  private get high(): boolean {
    return settingsStore.get().quality === "high";
  }

  private takeTracer(): Tracer {
    let t = this.tracers.find((x) => x.life <= 0);
    if (!t) {
      const img = this.scene.add
        .image(0, 0, TEX.tracer)
        .setOrigin(1, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(38);
      t = { img, life: 0, max: 0, x0: 0, y0: 0, x1: 0, y1: 0, dist: 0, speed: 0, width: 2 };
      this.tracers.push(t);
    }
    return t;
  }

  private takeFlash(pool: Flash[], texture: string, depth: number): Flash {
    let f = pool.find((x) => x.life <= 0);
    if (!f) {
      const img = this.scene.add.image(0, 0, texture).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth);
      f = { img, life: 0, max: 0, baseScale: 1 };
      pool.push(f);
    }
    f.img.setTexture(texture).setVisible(true);
    return f;
  }

  /** A shot: muzzle flash, light, tracers and impacts. `ends` are per pellet [x, y, hitWall]. */
  shot(
    def: WeaponDef,
    muzzleX: number,
    muzzleY: number,
    aim: number,
    ends: { x: number; y: number; wall: boolean; player: boolean }[],
  ): void {
    const m = this.takeFlash(this.flashes, TEX.muzzle, 37);
    m.img
      .setPosition(muzzleX, muzzleY)
      .setRotation(aim)
      .setOrigin(0.06, 0.5)
      .setScale(def.fx.muzzleScale * (0.85 + Math.random() * 0.3), def.fx.muzzleScale)
      .setAlpha(1)
      .setTint(0xffffff);
    m.life = m.max = 55;
    m.baseScale = def.fx.muzzleScale;

    const l = this.takeFlash(this.lights, TEX.glow, 5);
    l.img
      .setPosition(muzzleX, muzzleY)
      .setOrigin(0.5)
      .setTint(0xffb36b)
      .setAlpha(0.5)
      .setDisplaySize(240 * def.fx.muzzleScale, 240 * def.fx.muzzleScale);
    l.life = l.max = 70;

    for (const end of ends) {
      const t = this.takeTracer();
      const dist = Math.hypot(end.x - muzzleX, end.y - muzzleY);
      Object.assign(t, {
        x0: muzzleX,
        y0: muzzleY,
        x1: end.x,
        y1: end.y,
        dist,
        speed: def.fx.tracerSpeed,
        width: def.fx.tracerWidth,
        life: (dist / def.fx.tracerSpeed) * 1000 + 60,
        max: (dist / def.fx.tracerSpeed) * 1000 + 60,
      });
      t.img
        .setVisible(true)
        .setTint(def.fx.tracerColor)
        .setRotation(Math.atan2(end.y - muzzleY, end.x - muzzleX))
        .setAlpha(0.95);
      if (end.wall) this.impact(end.x, end.y, aim + Math.PI, def);
    }
    if (this.high) {
      this.smoke.emitParticleAt(muzzleX + Math.cos(aim) * 10, muzzleY + Math.sin(aim) * 10, 1);
      if (def.id !== "shotgun" && def.id !== "sniper") {
        this.shells.setParticleTint?.(0xffffff);
        const side = aim + Math.PI / 2;
        this.shells.emitParticleAt(
          muzzleX - Math.cos(aim) * 14 + Math.cos(side) * 6,
          muzzleY - Math.sin(aim) * 14 + Math.sin(side) * 6,
          1,
        );
      }
    }
  }

  impact(x: number, y: number, normalAngle: number, def?: WeaponDef): void {
    const n = this.high ? 6 : 3;
    this.sparks.setParticleTint?.(def?.fx.tracerColor ?? 0xffd89a);
    for (let i = 0; i < n; i++) {
      const a = normalAngle + (Math.random() - 0.5) * 1.6;
      this.sparks.emitParticleAt(x + Math.cos(a) * 2, y + Math.sin(a) * 2, 1);
    }
    if (this.high) this.smoke.emitParticleAt(x, y, 1);
  }

  /** Non-graphic hit feedback: armor sparks in the victim's direction of travel. */
  playerHit(x: number, y: number, fromAngle: number, lethal: boolean): void {
    const n = lethal ? 14 : 7;
    this.sparks.setParticleTint?.(0xff9a5a);
    for (let i = 0; i < n; i++)
      this.sparks.emitParticleAt(x + Math.cos(fromAngle) * 4, y + Math.sin(fromAngle) * 4, 1);
  }

  death(x: number, y: number, color: number): void {
    this.debris.setParticleTint?.(color);
    this.debris.explode(this.high ? 18 : 8, x, y);
    this.sparks.setParticleTint?.(0xffc46b);
    this.sparks.explode(14, x, y);
    this.ringBurst(x, y, 0xff7a2e, 160, 380);
    if (this.high) this.smoke.explode(5, x, y);
  }

  spawn(x: number, y: number): void {
    this.ringBurst(x, y, 0x9fe7ff, 120, 420);
    const l = this.takeFlash(this.lights, TEX.glow, 5);
    l.img.setPosition(x, y).setOrigin(0.5).setTint(0x9fe7ff).setAlpha(0.7).setDisplaySize(260, 260);
    l.life = l.max = 450;
  }

  pickup(x: number, y: number): void {
    this.ringBurst(x, y, 0x7dffb0, 80, 300);
  }

  private ringBurst(x: number, y: number, color: number, size: number, ms: number) {
    const r = this.takeFlash(this.rings, TEX.ring, 36);
    r.img.setPosition(x, y).setOrigin(0.5).setTint(color).setAlpha(0.9).setDisplaySize(10, 10);
    r.baseScale = size;
    r.life = r.max = ms;
  }

  damageNumber(x: number, y: number, amount: number, lethal: boolean): void {
    let ft = this.texts.find((t) => t.life <= 0);
    if (!ft) {
      const text = this.scene.add
        .text(0, 0, "", {
          fontFamily: "JetBrains Mono, monospace",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#ffffff",
          stroke: "#0b0c0e",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(50);
      ft = { text, life: 0, vy: 0 };
      this.texts.push(ft);
    }
    ft.text
      .setText(String(amount))
      .setPosition(x + (Math.random() - 0.5) * 16, y - 20)
      .setColor(lethal ? "#ff7a2e" : "#ffffff")
      .setScale(lethal ? 1.3 : 1)
      .setAlpha(1)
      .setVisible(true);
    ft.life = 650;
    ft.vy = -60;
  }

  update(dtMs: number): void {
    let active = 0;
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      active++;
      t.life -= dtMs;
      const elapsed = t.max - t.life;
      const head = Math.min(t.dist, (elapsed / 1000) * t.speed + 40);
      const streak = Math.min(head, 140, t.dist);
      const ux = (t.x1 - t.x0) / Math.max(1, t.dist);
      const uy = (t.y1 - t.y0) / Math.max(1, t.dist);
      t.img.setPosition(t.x0 + ux * head, t.y0 + uy * head).setDisplaySize(Math.max(2, streak), t.width * 2);
      if (head >= t.dist) t.img.setAlpha(Math.max(0, t.life / 60));
      if (t.life <= 0) t.img.setVisible(false);
    }
    for (const pool of [this.flashes, this.lights]) {
      for (const f of pool) {
        if (f.life <= 0) continue;
        active++;
        f.life -= dtMs;
        const k = Math.max(0, f.life / f.max);
        f.img.setAlpha(k * (pool === this.lights ? 0.55 : 1));
        if (f.life <= 0) f.img.setVisible(false);
      }
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      active++;
      r.life -= dtMs;
      const k = 1 - Math.max(0, r.life / r.max);
      const size = 10 + r.baseScale * Phaser.Math.Easing.Cubic.Out(k);
      r.img.setDisplaySize(size, size).setAlpha((1 - k) * 0.9);
      if (r.life <= 0) r.img.setVisible(false);
    }
    for (const ft of this.texts) {
      if (ft.life <= 0) continue;
      active++;
      ft.life -= dtMs;
      ft.text.y += (ft.vy * dtMs) / 1000;
      ft.vy *= 0.92;
      ft.text.setAlpha(Math.min(1, ft.life / 250));
      if (ft.life <= 0) ft.text.setVisible(false);
    }
    this.active = active;
  }
}
