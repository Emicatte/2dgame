import type { GameMode } from "@scrapline/shared";
import type { GameSimulation } from "../simulation/GameSimulation.ts";
import { GunGameMode } from "./GunGame.ts";
import { HideSeekMode } from "./HideSeek.ts";
import type { ModeController } from "./ModeController.ts";
import { PropHuntMode } from "./PropHunt.ts";

export type { ModeController } from "./ModeController.ts";

/**
 * The controller of a mode, or null for the modes built into GameSimulation (Deathmatch, TDM,
 * Domination, CTF, Vehicle Mayhem) and the PvE runtime (Outbreak, Survival).
 */
export function createModeController(mode: GameMode, sim: GameSimulation): ModeController | null {
  switch (mode) {
    case "gungame":
      return new GunGameMode(sim);
    case "hideseek":
      return new HideSeekMode(sim);
    case "prophunt":
      return new PropHuntMode(sim);
    default:
      return null;
  }
}
