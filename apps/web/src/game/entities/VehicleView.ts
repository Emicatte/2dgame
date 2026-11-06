import { TEAMS, VEHICLES, type VehicleDef, type VehicleKind } from "@scrapline/shared";
import Phaser from "phaser";
import type { GraphicsQuality } from "../../lib/settings.ts";
import { TEX, TEX_SCALE } from "../art/textures.ts";
import { VTEX } from "../art/vehicleArt.ts";

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "12px",
  color: "#e8e4dc",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

/** Ground vehicles sit above pickups and below players; flying helicopters above everything. */
const DEPTH_GROUND = 17;
const DEPTH_AIR = 44;

export interface VehicleRender {
  x: number;
  y: number;
  angle: number;
  alt: number;
  rotor: number;
  hp: number;
  /** 0 ready, 1 wreck, 2 gone. */
  status: number;
  /** Team of the occupants (0 = empty or free-for-all). */
  team: number;
  occupied: boolean;
  /** Aim of the operator of the turret / chin gun, if any (world angle). */
  gunAim: number | null;
  /** Shown above the vehicle (driver's name), or "". */
  label: string;
  /** Highlight: the local player can enter it right now. */
  enterable: boolean;
}

/**
 * Visual representation of one vehicle: hull, turret or chin gun, rotor blur and altitude shadow
 * for the helicopter, team marker, health bar, and smoke as it takes damage. Purely cosmetic: the
 * pose comes from prediction (local driver) or interpolation.
 */
export class VehicleView {
  readonly root: Phaser.GameObjects.Container;
  readonly def: VehicleDef;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly hull: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly turret: Phaser.GameObjects.Image | null = null;
  private readonly gun: Phaser.GameObjects.Image | null = null;
  private readonly rotor: Phaser.GameObjects.Image | null = null;
  private readonly tailRotor: Phaser.GameObjects.Image | null = null;
  private readonly marker: Phaser.GameObjects.Image;
  private readonly highlight: Phaser.GameObjects.Image;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private rotorAngle = 0;
  private smokeTimer = 0;
  private hpShown: number;
  private lastX = 0;
  private lastY = 0;
  /** World-space smoke / dust emitter hook, set by the scene. */
  onSmoke: ((x: number, y: number, burning: boolean) => void) | null = null;
  onDust: ((x: number, y: number) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    readonly id: string,
    readonly kind: VehicleKind,
  ) {
    this.def = VEHICLES[kind];
    this.hpShown = this.def.maxHp;
    const len = this.def.halfLength * 2;
    this.shadow = scene.add
      .image(0, 0, VTEX.body(kind))
      .setScale(1 / TEX_SCALE)
      .setTint(0x000000)
      .setAlpha(0.35);
    this.highlight = scene.add
      .image(0, 0, TEX.ring)
      .setDisplaySize(len + 40, len + 40)
      .setTint(0x9fe7ff)
      .setAlpha(0);
    this.body = scene.add.image(0, 0, VTEX.body(kind)).setScale(1 / TEX_SCALE);
    const parts: Phaser.GameObjects.GameObject[] = [this.body];
    if (kind === "armored") {
      const seat = this.def.seats.find((s) => s.mounted)!;
      this.turret = scene.add
        .image(seat.ox, seat.oy, VTEX.turret)
        .setOrigin(18 / 64, 0.5)
        .setScale(1 / TEX_SCALE);
      parts.push(this.turret);
    }
    if (kind === "heli") {
      this.gun = scene.add
        .image(this.def.halfLength - 10, 6, TEX.weapon("doorgun"))
        .setOrigin(0.1, 0.5)
        .setScale(1 / TEX_SCALE);
      this.rotor = scene.add
        .image(4, 0, VTEX.rotor)
        .setScale(1 / TEX_SCALE)
        .setAlpha(0.9);
      this.tailRotor = scene.add
        .image(-this.def.halfLength + 3, -9, VTEX.tailRotor)
        .setScale(1 / TEX_SCALE)
        .setAlpha(0.9);
      parts.unshift(this.gun);
      parts.push(this.rotor, this.tailRotor);
    }
    this.hull = scene.add.container(0, 0, parts);
    this.marker = scene.add
      .image(0, 0, VTEX.marker)
      .setScale(0.75 / TEX_SCALE)
      .setAlpha(0);
    this.hpBar = scene.add.graphics();
    this.label = scene.add.text(0, 0, "", LABEL_STYLE).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [
      this.shadow,
      this.highlight,
      this.hull,
      this.marker,
      this.hpBar,
      this.label,
    ]);
    this.root.setDepth(DEPTH_GROUND);
  }

  update(r: VehicleRender, dtSec: number, quality: GraphicsQuality): void {
    const visible = r.status !== 2;
    this.root.setVisible(visible);
    if (!visible) return;
    const wreck = r.status === 1;
    this.root.setPosition(r.x, r.y);
    this.root.setDepth(r.alt > 0.35 ? DEPTH_AIR : DEPTH_GROUND);
    // Lift: the hull grows slightly and its shadow slides away (light from the top-left).
    const lift = 1 + r.alt * 0.14;
    this.hull.setRotation(r.angle).setScale(lift);
    this.shadow
      .setRotation(r.angle)
      .setPosition(6 + r.alt * 46, 8 + r.alt * 60)
      .setAlpha(0.35 - r.alt * 0.15)
      .setScale((1 + r.alt * 0.05) / TEX_SCALE);
    this.body.setTint(wreck ? 0x3a3330 : 0xffffff);
    this.turret?.setTint(wreck ? 0x3a3330 : 0xffffff);

    if (this.turret) {
      const local = r.gunAim === null ? 0 : r.gunAim - r.angle;
      this.turret.setRotation(Phaser.Math.Angle.RotateTo(this.turret.rotation, local, dtSec * 8));
    }
    if (this.gun) {
      const seat = this.def.seats.find((s) => s.mounted)!;
      const local = r.gunAim === null ? 0 : Phaser.Math.Angle.Wrap(r.gunAim - r.angle);
      const clamped = Phaser.Math.Clamp(local, -seat.arc, seat.arc);
      this.gun.setRotation(clamped);
    }
    if (this.rotor && this.tailRotor) {
      this.rotorAngle += dtSec * (4 + r.rotor * 38);
      this.rotor.setRotation(this.rotorAngle).setAlpha(wreck ? 0 : 0.55 + (1 - r.rotor) * 0.4);
      this.tailRotor.setRotation(this.rotorAngle * 1.7).setAlpha(wreck ? 0 : 0.9);
    }

    // Team marker on the roof (shape + colour; the label below carries the name).
    if (r.occupied && !wreck && (r.team === 1 || r.team === 2)) {
      this.marker.setTint(TEAMS[r.team].color).setAlpha(0.9);
    } else {
      this.marker.setAlpha(0);
    }
    this.highlight.setAlpha(r.enterable && !wreck ? 0.35 + Math.sin(performance.now() / 160) * 0.15 : 0);

    const top = -(this.def.halfWidth + 22) * lift;
    if (this.label.text !== r.label) this.label.setText(r.label);
    this.label.setPosition(0, top - 8).setVisible(r.label !== "" && !wreck);
    if (r.team === 1 || r.team === 2) this.label.setColor(TEAMS[r.team].css);
    else this.label.setColor(String(LABEL_STYLE.color));

    this.hpShown += (r.hp - this.hpShown) * Math.min(1, dtSec * 10);
    this.hpBar.clear();
    const frac = Math.max(0, this.hpShown / this.def.maxHp);
    if (!wreck && frac < 0.999) {
      const w = 54;
      this.hpBar.fillStyle(0x0b0c0e, 0.8).fillRect(-w / 2 - 1, top - 4, w + 2, 6);
      this.hpBar.fillStyle(frac > 0.35 ? 0xe8e4dc : 0xff4d4d, 1).fillRect(-w / 2, top - 3, w * frac, 4);
    }

    // Smoke grows with damage; wrecks burn. Dust from fast cornering and rotor wash.
    this.smokeTimer -= dtSec;
    const damage = 1 - r.hp / this.def.maxHp;
    if (this.smokeTimer <= 0 && (wreck || damage > 0.5)) {
      this.smokeTimer = wreck ? 0.06 : damage > 0.75 ? 0.1 : 0.22;
      const back = Math.cos(r.angle) * -this.def.halfLength * 0.4;
      const backY = Math.sin(r.angle) * -this.def.halfLength * 0.4;
      this.onSmoke?.(r.x + back, r.y + backY, wreck || damage > 0.75);
    }
    const vx = (r.x - this.lastX) / Math.max(dtSec, 1e-3);
    const vy = (r.y - this.lastY) / Math.max(dtSec, 1e-3);
    this.lastX = r.x;
    this.lastY = r.y;
    const speed = Math.hypot(vx, vy);
    if (quality === "high" && !wreck && r.alt < 0.1 && speed > 120 && speed < 2000) {
      const heading = Math.atan2(vy, vx);
      const slip = Math.abs(Phaser.Math.Angle.Wrap(heading - r.angle));
      if (slip > 0.35 && slip < Math.PI - 0.35 && Math.random() < 0.5) {
        this.onDust?.(
          r.x - Math.cos(r.angle) * this.def.halfLength * 0.6,
          r.y - Math.sin(r.angle) * this.def.halfLength * 0.6,
        );
      }
    }
    if (quality === "high" && this.rotor && r.rotor > 0.6 && r.alt < 0.6 && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      this.onDust?.(r.x + Math.cos(a) * 50, r.y + Math.sin(a) * 50);
    }
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
