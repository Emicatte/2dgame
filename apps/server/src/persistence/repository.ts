import type { LeaderboardEntry, MatchFacts, PlayerStats, XpLine } from "@scrapline/shared";

export interface PlayerRecord {
  id: string;
  nickname: string;
  xp: number;
  level: number;
  stats: PlayerStats;
  skin: string;
  primary: string;
  createdAt: Date;
  /** Set by recordMatch: daily challenges this match completed (their XP is already in `xp`). */
  challengeRewards?: XpLine[];
}

/** Everything one player contributes to one finished (or abandoned) match. */
export interface MatchPlayerResult {
  playerId: string;
  kills: number;
  deaths: number;
  placement: number;
  xpGained: number;
  completed: boolean;
  won: boolean;
  shotsFired: number;
  shotsHit: number;
  playtimeSec: number;
  /** Objective play and vehicles (career stats and challenges). */
  captures: number;
  flagCaptures: number;
  flagReturns: number;
  vehicleKills: number;
}

/** The facts the career and the daily challenges are computed from. */
export function matchFacts(r: MatchPlayerResult, mode: string): MatchFacts {
  return {
    mode,
    completed: r.completed,
    won: r.won,
    kills: r.kills,
    deaths: r.deaths,
    captures: r.captures,
    flagCaptures: r.flagCaptures,
    flagReturns: r.flagReturns,
    vehicleKills: r.vehicleKills,
  };
}

export interface MatchRecord {
  id: string;
  roomId: string;
  mapId: string;
  mode: string;
  roomKind: string;
  startedAt: Date;
  endedAt: Date;
  winnerPlayerId: string | null;
  endReason: string;
  players: MatchPlayerResult[];
}

export type LeaderboardSort = "kills" | "wins" | "xp";

/**
 * Persistence boundary. The game server never touches SQL directly, so the in-memory
 * implementation can stand in during local development and tests.
 */
export interface Repository {
  readonly kind: "postgres" | "memory";
  createPlayer(id: string, nickname: string): Promise<PlayerRecord>;
  getPlayer(id: string): Promise<PlayerRecord | null>;
  updateProfile(
    id: string,
    patch: { nickname?: string; skin?: string; primary?: string },
  ): Promise<PlayerRecord | null>;
  touch(id: string): Promise<void>;
  /** Applies all stats/XP changes of a match atomically and returns the updated players. */
  recordMatch(match: MatchRecord): Promise<Map<string, PlayerRecord>>;
  leaderboard(sort: LeaderboardSort, limit: number): Promise<LeaderboardEntry[]>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function emptyStats(): PlayerStats {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    playtimeSec: 0,
  };
}
