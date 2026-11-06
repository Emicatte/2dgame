import type { WeaponDef } from "@scrapline/shared";
import type Phaser from "phaser";
import { settingsStore } from "../../lib/settings.ts";
import {
  type CrosshairFrame,
  type CrosshairLook,
  CrosshairModel,
  type CrosshairSink,
  drawCrosshair,
  type HitKind,
  lookFromSettings,
  screenSpaceTransform,
} from "./crosshairModel.ts";
import { profileFor } from "./weaponFx.ts";

/**
 * The on-screen crosshair: a screen-space Graphics redrawn every frame from the pure model
 * (crosshairModel.ts). Hit markers live here too, so they always sit on the crosshair.
 */
export class Crosshair {
  readonly model = new CrosshairModel();
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly sink: CrosshairSink;
  private readonly look: CrosshairLook;
  private readonly xf = { x: 0, y: 0, scale: 1 };

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(1000).setScrollFactor(0);
    const g = this.g;
    this.look = lookFromSettings(settingsStore.get());
    this.sink = {
      line: (x1, y1, x2, y2, w, c, a) => {
        g.lineStyle(w, c, a);
        g.lineBetween(x1, y1, x2, y2);
      },
      ring: (x, y, r, w, c, a) => {
        g.lineStyle(w, c, a);
        g.strokeCircle(x, y, r);
      },
      arc: (x, y, r, start, end, w, c, a) => {
        g.lineStyle(w, c, a);
        g.beginPath();
        g.arc(x, y, r, start, end);
        g.strokePath();
      },
      dot: (x, y, r, c, a) => {
        g.fillStyle(c, a);
        g.fillCircle(x, y, r);
      },
    };
  }

  /** Feedback for a confirmed hit of the local player (called by ArenaScene on server events). */
  registerHit(kind: HitKind): void {
    this.model.registerHit(kind);
  }

  /** Cosmetic expansion on a local shot (added on top of the true spread). */
  onShot(def: WeaponDef): void {
    this.model.onShot(profileFor(def).crosshairKickPx);
  }

  /** Hidden this frame (dead, menu open, benchmark autopilot, out of a match). */
  clear(dtMs = 0): void {
    this.model.update(dtMs);
    this.g.clear();
  }

  draw(frame: CrosshairFrame, dtMs: number): void {
    this.model.update(dtMs);
    this.g.clear();
    // Cancel the camera zoom so the centre is exactly under the cursor (see screenSpaceTransform).
    const cam = this.scene.cameras.main;
    const t = screenSpaceTransform(cam.zoom, cam.originX * cam.width, cam.originY * cam.height, this.xf);
    this.g.setPosition(t.x, t.y).setScale(t.scale);
    drawCrosshair(this.sink, lookFromSettings(settingsStore.get(), this.look), frame, this.model);
  }
}
