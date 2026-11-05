import Phaser from "phaser";
import { generateTextures } from "../art/textures.ts";

/** Generates all procedural textures once, then hands over to the arena. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    generateTextures(this);
    this.game.events.emit("boot-complete");
    this.scene.start("arena");
  }
}
