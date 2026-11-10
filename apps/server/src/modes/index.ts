import type { GameMode } from "@scrapline/shared";
import type { GameSimulation } from "../simulation/GameSimulation.ts";
import { BattleRoyaleMode } from "./BattleRoyale.ts";
import { BountyMode } from "./Bounty.ts";
import { ChaosMode } from "./Chaos.ts";
import { GunGameMode } from "./GunGame.ts";
import { HideSeekMode } from "./HideSeek.ts";
import { InfectionMode } from "./Infection.ts";
import { MazeMode } from "./Maze.ts";
import type { ModeController } from "./ModeController.ts";
import { FreeRoamMode, HotPotatoMode, RacingMode } from "./PartyModes.ts";
import { PropHuntMode } from "./PropHunt.ts";
import { PursuitMode } from "./Pursuit.ts";
import { SabotageMode } from "./Sabotage.ts";

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
    case "infection":
      return new InfectionMode(sim);
    case "chaos":
      return new ChaosMode(sim);
    case "bounty":
      return new BountyMode(sim);
    case "sabotage":
      return new SabotageMode(sim);
    case "pursuit":
    case "convoy":
      return new PursuitMode(sim, mode);
    case "maze":
    case "parkour":
    case "escape":
    case "nighthunt":
      return new MazeMode(sim, mode);
    case "battleroyale":
      return new BattleRoyaleMode(sim);
    case "hotpotato":
      return new HotPotatoMode(sim);
    case "freeroam":
      return new FreeRoamMode(sim);
    case "racing":
      return new RacingMode(sim);
    default:
      return null;
  }
}
