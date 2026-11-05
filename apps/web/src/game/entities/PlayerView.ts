import { NO_WEAPON, PLAYER, TEAMS, type WeaponDef, weaponByIndex } from "@scrapline/shared";
import Phaser from "phaser";
import { TEX, TEX_SCALE } from "../art/textures.ts";

const NAME_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "13px",
  color: "#e8e4dc",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

/**
 * Visual representation of one player. Body faces the aim direction, feet step along the movement
 * direction, the weapon kicks back on every shot. Purely cosmetic: position comes from prediction
 * (local player) or interpolation (remote players).
 */
export class PlayerView {
  readonly root: Phaser.GameObjects.Container;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly marker: Phaser.GameObjects.Image;
  private readonly footL: Phaser.GameObjects.Image;
  private readonly footR: Phaser.GameObjects.Image;
  private readonly weapon: Phaser.GameObjects.Image;
  private readonly body: Phaser.GameObjects.Image;
  private readonly ring: Phaser.GameObjects.Image;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly laser: Phaser.GameObjects.Image;
  private weaponIndex = -1;
  private skin = "";
  private stepPhase = 0;
  private moveAngle = 0;
  private kick = 0;
  private lastX = 0;
  private lastY = 0;
  private hpShown = 100;
  private team = 0;
  visibleAlive = true;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly id: string,
    readonly isLocal: boolean,
    name: string,
    skin: string,
  ) {
    this.shadow = scene.add.image(0, 6, TEX.shadow).setDisplaySize(52, 40);
    // Ground marker: instant friend/foe readability on every map palette.
    this.marker = scene.add
      .image(0, 0, TEX.ring)
      .setDisplaySize(50, 50)
      .setTint(isLocal ? 0x4fd8ff : 0xff5a3d)
      .setAlpha(isLocal ? 0.55 : 0.7);
    this.footL = scene.add.image(0, 0, TEX.foot).setScale(1 / TEX_SCALE);
    this.footR = scene.add.image(0, 0, TEX.foot).setScale(1 / TEX_SCALE);
    this.weapon = scene.add
      .image(0, 0, TEX.weapon("rifle"))
      .setOrigin(0.1, 0.5)
      .setScale(1 / TEX_SCALE);
    this.body = scene.add.image(0, 0, TEX.soldier(skin)).setScale(1 / TEX_SCALE);
    this.ring = scene.add.image(0, 0, TEX.ring).setDisplaySize(56, 56).setAlpha(0).setTint(0x9fe7ff);
    this.laser = scene.add
      .image(0, 0, TEX.laser)
      .setOrigin(0, 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xff4040)
      .setAlpha(0);
    this.nameText = scene.add.text(0, -40, name, NAME_STYLE).setOrigin(0.5, 1);
    if (isLocal) this.nameText.setVisible(false);
    this.hpBar = scene.add.graphics();
    this.root = scene.add.container(0, 0, [
      this.shadow,
      this.marker,
      this.footL,
      this.footR,
      this.laser,
      this.weapon,
      this.body,
      this.ring,
      this.hpBar,
      this.nameText,
    ]);
    this.root.setDepth(isLocal ? 21 : 20);
    this.setSkin(skin);
  }

  setSkin(skin: string): void {
    if (skin === this.skin) return;
    this.skin = skin;
    const key = TEX.soldier(skin);
    this.body.setTexture(this.scene.textures.exists(key) ? key : TEX.soldier("foundry"));
  }

  setName(name: string): void {
    if (this.nameText.text !== name) this.nameText.setText(name);
  }

  /**
   * Team modes: ground marker and name tag take the team color (Alpha blue, Bravo orange), so
   * allies and enemies read instantly; 0 restores the free-for-all look (you cyan, others red).
   */
  setTeam(team: number): void {
    if (team === this.team) return;
    this.team = team;
    if (team === 1 || team === 2) {
      this.marker.setTint(TEAMS[team].color).setAlpha(this.isLocal ? 0.6 : 0.8);
      this.nameText.setColor(TEAMS[team].css);
    } else {
      this.marker.setTint(this.isLocal ? 0x4fd8ff : 0xff5a3d).setAlpha(this.isLocal ? 0.55 : 0.7);
      this.nameText.setColor(String(NAME_STYLE.color));
    }
  }

  private setWeapon(index: number): WeaponDef | undefined {
    const def = index === NO_WEAPON ? undefined : weaponByIndex(index);
    if (index !== this.weaponIndex) {
      this.weaponIndex = index;
      if (def) this.weapon.setTexture(TEX.weapon(def));
      this.weapon.setVisible(!!def);
    }
    return def;
  }

  recoil(def: WeaponDef): void {
    this.kick = Math.min(14, this.kick + def.fx.recoilKickPx);
  }

  /** Called every rendered frame. `world` allows trimming the laser at walls. */
  update(
    x: number,
    y: number,
    aim: number,
    alive: boolean,
    weaponIndex: number,
    hp: number,
    isProtected: boolean,
    dtSec: number,
    laserLength: number,
  ): void {
    this.root.setPosition(x, y);
    this.visibleAlive = alive;
    this.root.setVisible(alive);
    if (!alive) {
      this.lastX = x;
      this.lastY = y;
      return;
    }
    const def = this.setWeapon(weaponIndex);

    const vx = (x - this.lastX) / Math.max(dtSec, 1e-3);
    const vy = (y - this.lastY) / Math.max(dtSec, 1e-3);
    this.lastX = x;
    this.lastY = y;
    const speed = Math.min(800, Math.hypot(vx, vy));
    if (speed > 20)
      this.moveAngle = Phaser.Math.Angle.RotateTo(this.moveAngle, Math.atan2(vy, vx), dtSec * 14);
    this.stepPhase += (speed / PLAYER.maxSpeed) * dtSec * 13;
    const stride = Math.min(1, speed / PLAYER.maxSpeed) * 7;
    const fx = Math.cos(this.moveAngle);
    const fy = Math.sin(this.moveAngle);
    const px = -fy;
    const py = fx;
    const s = Math.sin(this.stepPhase);
    this.footL.setPosition(fx * s * stride + px * 7, fy * s * stride + py * 7).setRotation(this.moveAngle);
    this.footR.setPosition(-fx * s * stride - px * 7, -fy * s * stride - py * 7).setRotation(this.moveAngle);

    this.kick = Math.max(0, this.kick - dtSec * 90);
    const bob = 1 + Math.abs(s) * 0.025 * Math.min(1, speed / PLAYER.maxSpeed);
    this.body.setRotation(aim).setScale(bob / TEX_SCALE);
    const wx = Math.cos(aim) * (8 - this.kick);
    const wy = Math.sin(aim) * (8 - this.kick);
    this.weapon
      .setPosition(wx + Math.cos(aim + Math.PI / 2) * 3, wy + Math.sin(aim + Math.PI / 2) * 3)
      .setRotation(aim);

    this.ring.setAlpha(isProtected ? 0.5 + Math.sin(performance.now() / 90) * 0.25 : 0);

    if (def?.fx.laserSight && laserLength > 0) {
      this.laser
        .setPosition(Math.cos(aim) * 24, Math.sin(aim) * 24)
        .setRotation(aim)
        .setDisplaySize(Math.max(0, laserLength - 24), 1.5)
        .setAlpha(this.isLocal ? 0.35 : 0.6);
    } else {
      this.laser.setAlpha(0);
    }

    if (!this.isLocal) {
      this.hpShown += (hp - this.hpShown) * Math.min(1, dtSec * 12);
      this.hpBar.clear();
      if (hp < PLAYER.maxHealth) {
        const w = 36;
        const frac = Math.max(0, this.hpShown / PLAYER.maxHealth);
        this.hpBar.fillStyle(0x0b0c0e, 0.8).fillRect(-w / 2 - 1, -36, w + 2, 5);
        this.hpBar.fillStyle(frac > 0.35 ? 0xe8e4dc : 0xff4d4d, 1).fillRect(-w / 2, -35, w * frac, 3);
      }
    }
  }

  get bodyRadius(): number {
    return PLAYER.radius;
  }

  destroy(): void {
    this.root.destroy(true);
  }
}
