import Phaser from "phaser";
import { ArenaScene } from "./scenes/ArenaScene.ts";
import { BootScene } from "./scenes/BootScene.ts";

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    // WebGL first; Phaser falls back to Canvas where WebGL is unavailable (filters are skipped there).
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#0e0f11",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
    },
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: "high-performance",
    },
    fps: { target: 60, smoothStep: false },
    disableContextMenu: true,
    audio: { noAudio: true },
    banner: false,
    scene: [BootScene, ArenaScene],
  });
}
