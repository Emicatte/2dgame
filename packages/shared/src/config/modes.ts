/**
 * Game modes and teams. Rules are data: rooms (dedicated server and host mode) read them from
 * here, and every value a host can change is validated against MODE_LIMITS.
 */
import { MATCH_DEFAULTS } from "./game.ts";

export type GameMode = "deathmatch" | "tdm";
export const GAME_MODES: readonly GameMode[] = ["deathmatch", "tdm"];

export const MODE_NAMES: Record<GameMode, string> = {
  deathmatch: "Deathmatch",
  tdm: "Team Deathmatch",
};

/** 0 = no team (free for all), 1 = Alpha, 2 = Bravo. */
export type TeamId = 0 | 1 | 2;
export const TEAM_NONE = 0;
export const TEAM_ALPHA = 1;
export const TEAM_BRAVO = 2;
export const PLAYABLE_TEAMS = [TEAM_ALPHA, TEAM_BRAVO] as const;

export interface TeamDef {
  id: 1 | 2;
  name: string;
  /** Ring, name tag and HUD color (0xRRGGBB). Chosen to stay distinct for common color blindness. */
  color: number;
  css: string;
}

export const TEAMS: Record<1 | 2, TeamDef> = {
  1: { id: 1, name: "Alpha", color: 0x3da5ff, css: "#3da5ff" },
  2: { id: 2, name: "Bravo", color: 0xff8a3d, css: "#ff8a3d" },
};

export function teamName(team: number): string {
  return team === 1 || team === 2 ? TEAMS[team].name : "";
}

export function isTeamMode(mode: string): boolean {
  return mode === "tdm";
}

/** True when `a` may damage `b` under the given rules. Self-damage does not exist. */
export function canDamage(
  a: { id: string; team: number },
  b: { id: string; team: number },
  rules: { teams: boolean; friendlyFire: boolean },
): boolean {
  if (a.id === b.id) return false;
  if (!rules.teams || rules.friendlyFire) return true;
  return a.team === 0 || a.team !== b.team;
}

export interface ModeRules {
  mode: GameMode;
  /** Players per team (team modes); 0 in free-for-all. */
  teamSize: number;
  maxPlayers: number;
  durationSec: number;
  /** Kills (free-for-all) or team score (team modes) that end the match. */
  scoreLimit: number;
  friendlyFire: boolean;
}

export const MODE_DEFAULTS: Record<GameMode, ModeRules> = {
  deathmatch: {
    mode: "deathmatch",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: MATCH_DEFAULTS.durationSec,
    scoreLimit: MATCH_DEFAULTS.killLimit,
    friendlyFire: false,
  },
  // First team release: 2v2, five minutes, first team to 15, no friendly fire.
  tdm: { mode: "tdm", teamSize: 2, maxPlayers: 4, durationSec: 5 * 60, scoreLimit: 15, friendlyFire: false },
};

/** 1v1 … 4v4. */
export const TEAM_SIZE = { min: 1, max: 4 } as const;
