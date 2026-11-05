/** Shapes returned by the HTTP API (apps/server/src/api). */

export interface PublicProfile {
  id: string;
  nickname: string;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNext: number;
  stats: PlayerStats;
  skin: string;
  primary: string;
  createdAt: string;
}

export interface PlayerStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  playtimeSec: number;
}

export interface GuestSessionResponse {
  token: string;
  profile: PublicProfile;
}

export interface RoomListing {
  roomId: string;
  code: string;
  map: string;
  phase: string;
  players: number;
  maxPlayers: number;
  hostName: string;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  level: number;
  kills: number;
  wins: number;
  matchesPlayed: number;
  kd: number;
}

export interface ApiError {
  error: string;
}

export function kdRatio(kills: number, deaths: number): number {
  return deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100;
}

export function accuracy(stats: Pick<PlayerStats, "shotsFired" | "shotsHit">): number | null {
  return stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : null;
}
