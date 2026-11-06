/**
 * Game modes and teams. Rules are data: rooms (dedicated server and host mode) read them from
 * here, and every value a host can change is validated against MODE_LIMITS.
 */
import { MATCH_DEFAULTS } from "./game.ts";

export type GameMode = "deathmatch" | "tdm" | "dom" | "ctf" | "mayhem" | "outbreak" | "survival";
export const GAME_MODES: readonly GameMode[] = [
  "deathmatch",
  "tdm",
  "dom",
  "ctf",
  "mayhem",
  "outbreak",
  "survival",
];
/** Competitive modes (the PvP lobby picker). */
export const PVP_MODES: readonly GameMode[] = ["deathmatch", "tdm", "dom", "ctf", "mayhem"];
/** Cooperative PvE modes: Outbreak missions and Survival Endless. */
export const PVE_MODES: readonly GameMode[] = ["outbreak", "survival"];

/** 1 to 4 humans against the infected; all humans are on one side (team 1), no friendly fire. */
export function isPveMode(mode: string): boolean {
  return mode === "outbreak" || mode === "survival";
}

/** Co-op squad size limits. */
export const PVE_SQUAD = { min: 1, max: 4 } as const;

export const MODE_NAMES: Record<GameMode, string> = {
  deathmatch: "Deathmatch",
  tdm: "Team Deathmatch",
  dom: "Domination",
  ctf: "Capture the Flag",
  mayhem: "Vehicle Mayhem",
  outbreak: "Outbreak",
  survival: "Survival",
};

/** One-line rules shown in the lobby. */
export const MODE_BLURBS: Record<GameMode, string> = {
  deathmatch: "Everyone for themselves. Most eliminations wins.",
  tdm: "Two teams. Every enemy eliminated scores a point.",
  dom: "Hold capture points A, B and C. Each held point scores every few seconds.",
  ctf: "Take the enemy flag to your base while your own flag is home.",
  mayhem: "Team fight on vehicle maps. Eliminations score 1, wrecking a crewed enemy vehicle scores 2.",
  outbreak: "Co-op campaign: 1-4 players, mission objectives, infected, bosses.",
  survival: "Co-op endless waves. How long can the squad hold?",
};

/** What the score limit counts, per mode (lobby badges, HUD). */
export const MODE_SCORE_UNIT: Record<GameMode, string> = {
  deathmatch: "eliminations",
  tdm: "team points",
  dom: "points",
  ctf: "captures",
  mayhem: "team points",
  outbreak: "objectives",
  survival: "waves",
};

/** Modes that only make sense on maps with vehicles. */
export function modeNeedsVehicles(mode: string): boolean {
  return mode === "mayhem";
}

/** Team score comes from objectives only (eliminations do not score). */
export function modeScoresObjectives(mode: string): boolean {
  return mode === "dom" || mode === "ctf";
}

export const OBJECTIVES = {
  /** Domination: capture radius (px). */
  pointRadius: 120,
  /** Seconds for one player to turn a neutral point (more players capture faster, up to 3). */
  captureSec: 6,
  /** Every owned point scores 1 point this often (seconds). */
  scoreEverySec: 5,
  /** CTF: pick-up / return / capture reach (px). */
  flagReach: 44,
  /** A dropped flag returns home after this long untouched (seconds). */
  flagReturnSec: 20,
  /** Vehicle Mayhem: team points for wrecking an enemy vehicle with a crew. */
  wreckPoints: 2,
  /** Vehicle Mayhem: vehicles come back faster. */
  mayhemRespawnFactor: 0.5,
} as const;

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
  return mode === "tdm" || mode === "dom" || mode === "ctf" || mode === "mayhem";
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
  dom: { mode: "dom", teamSize: 2, maxPlayers: 4, durationSec: 8 * 60, scoreLimit: 100, friendlyFire: false },
  ctf: { mode: "ctf", teamSize: 2, maxPlayers: 4, durationSec: 10 * 60, scoreLimit: 3, friendlyFire: false },
  mayhem: {
    mode: "mayhem",
    teamSize: 2,
    maxPlayers: 4,
    durationSec: 6 * 60,
    scoreLimit: 30,
    friendlyFire: false,
  },
  // PvE: the mission (or the squad's survival) ends the match, not a clock or a score. The
  // duration is a safety cap only.
  outbreak: {
    mode: "outbreak",
    teamSize: 0,
    maxPlayers: 4,
    durationSec: 60 * 60,
    scoreLimit: 0,
    friendlyFire: false,
  },
  survival: {
    mode: "survival",
    teamSize: 0,
    maxPlayers: 4,
    durationSec: 90 * 60,
    scoreLimit: 0,
    friendlyFire: false,
  },
};

/** 1v1 … 4v4. */
export const TEAM_SIZE = { min: 1, max: 4 } as const;
