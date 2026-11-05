import { OBJECTIVES, TEAMS } from "@scrapline/shared";
import type Phaser from "phaser";

const NEUTRAL = 0xb9b4aa;

const LETTER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "30px",
  fontStyle: "bold",
  color: "#ece8e0",
  stroke: "#0b0c0e",
  strokeThickness: 6,
};

const TAG_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Chakra Petch, sans-serif",
  fontSize: "12px",
  fontStyle: "bold",
  color: "#ece8e0",
  stroke: "#0b0c0e",
  strokeThickness: 4,
};

const teamColor = (team: number) => (team === 1 || team === 2 ? TEAMS[team].color : NEUTRAL);

/**
 * Domination capture point: the capture area in the owner's colour, a progress ring showing who
 * is turning it, and its letter (the letter and the HUD text carry the meaning, not colour alone).
 */
export class PointView {
  private readonly area: Phaser.GameObjects.Graphics;
  private readonly letter: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    label: string,
  ) {
    this.area = scene.add.graphics().setDepth(6);
    this.letter = scene.add.text(x, y, label, LETTER_STYLE).setOrigin(0.5).setDepth(7).setAlpha(0.9);
  }

  update(owner: number, progress: number): void {
    const r = OBJECTIVES.pointRadius;
    const g = this.area;
    g.clear();
    const c = teamColor(owner);
    g.fillStyle(c, owner ? 0.12 : 0.06).fillCircle(this.x, this.y, r);
    g.lineStyle(2, c, 0.55).strokeCircle(this.x, this.y, r);
    // Dashed inner ring: reads as a zone on every floor palette.
    g.lineStyle(2, 0x0b0c0e, 0.35).strokeCircle(this.x, this.y, r - 6);
    if (Math.abs(progress) > 0.001 && Math.abs(progress) < 0.999) {
      const toward = progress > 0 ? 1 : 2;
      g.lineStyle(6, TEAMS[toward].color, 0.95);
      g.beginPath();
      g.arc(this.x, this.y, r - 3, -Math.PI / 2, -Math.PI / 2 + Math.abs(progress) * Math.PI * 2, false);
      g.strokePath();
    }
    this.letter.setColor(owner === 1 || owner === 2 ? TEAMS[owner].css : "#ece8e0");
  }

  destroy(): void {
    this.area.destroy();
    this.letter.destroy();
  }
}

/** CTF flag: its stand (always shown) and the flag itself where it is (home, carried, dropped). */
export class FlagView {
  private readonly stand: Phaser.GameObjects.Graphics;
  private readonly flag: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.Text;
  private wave = 0;

  constructor(
    scene: Phaser.Scene,
    readonly team: 1 | 2,
    readonly homeX: number,
    readonly homeY: number,
  ) {
    const c = TEAMS[team].color;
    this.stand = scene.add.graphics().setDepth(6);
    this.stand.fillStyle(c, 0.12).fillCircle(homeX, homeY, OBJECTIVES.flagReach + 6);
    this.stand.lineStyle(3, c, 0.7).strokeCircle(homeX, homeY, OBJECTIVES.flagReach + 6);
    this.flag = scene.add.graphics().setDepth(48);
    this.tag = scene.add
      .text(homeX, homeY, `${TEAMS[team].name} flag`, TAG_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(49)
      .setColor(TEAMS[team].css);
  }

  update(x: number, y: number, carried: boolean, dtSec: number): void {
    this.wave += dtSec * 6;
    const c = TEAMS[this.team].color;
    const g = this.flag;
    g.clear();
    // Pole, then a waving pennant.
    const px = carried ? x + 10 : x;
    const py = carried ? y - 6 : y;
    g.lineStyle(3, 0x1b1c1f, 1).lineBetween(px, py + 10, px, py - 34);
    const w = Math.sin(this.wave) * 3;
    g.fillStyle(c, 1);
    g.beginPath();
    g.moveTo(px, py - 34);
    g.lineTo(px + 24, py - 28 + w);
    g.lineTo(px, py - 20);
    g.closePath();
    g.fillPath();
    g.lineStyle(1.5, 0x0b0c0e, 0.8).strokePath();
    this.tag.setPosition(px, py - 38);
  }

  destroy(): void {
    this.stand.destroy();
    this.flag.destroy();
    this.tag.destroy();
  }
}
