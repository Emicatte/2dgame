import { kdRatio, type LeaderboardEntry, levelFromXp } from "@scrapline/shared";
import {
  emptyStats,
  type LeaderboardSort,
  type MatchRecord,
  type PlayerRecord,
  type Repository,
} from "./repository.ts";

/**
 * Process-local store used when DATABASE_URL is not set (local development, unit tests).
 * Data is lost on restart; production refuses to boot without PostgreSQL (see config.ts).
 */
export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;
  private readonly players = new Map<string, PlayerRecord>();
  readonly matches: MatchRecord[] = [];

  async createPlayer(id: string, nickname: string): Promise<PlayerRecord> {
    const rec: PlayerRecord = {
      id,
      nickname,
      xp: 0,
      level: 1,
      stats: emptyStats(),
      skin: "foundry",
      primary: "rifle",
      createdAt: new Date(),
    };
    this.players.set(id, rec);
    return structuredClone(rec);
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const p = this.players.get(id);
    return p ? structuredClone(p) : null;
  }

  async updateProfile(
    id: string,
    patch: { nickname?: string; skin?: string; primary?: string },
  ): Promise<PlayerRecord | null> {
    const p = this.players.get(id);
    if (!p) return null;
    if (patch.nickname !== undefined) p.nickname = patch.nickname;
    if (patch.skin !== undefined) p.skin = patch.skin;
    if (patch.primary !== undefined) p.primary = patch.primary;
    return structuredClone(p);
  }

  async touch(): Promise<void> {}

  async recordMatch(match: MatchRecord): Promise<Map<string, PlayerRecord>> {
    this.matches.push(structuredClone(match));
    const out = new Map<string, PlayerRecord>();
    for (const r of match.players) {
      const p = this.players.get(r.playerId);
      if (!p) continue;
      p.xp += r.xpGained;
      p.level = levelFromXp(p.xp).level;
      p.stats.matchesPlayed += 1;
      if (r.won) p.stats.wins += 1;
      else p.stats.losses += 1;
      p.stats.kills += r.kills;
      p.stats.deaths += r.deaths;
      p.stats.shotsFired += r.shotsFired;
      p.stats.shotsHit += r.shotsHit;
      p.stats.playtimeSec += r.playtimeSec;
      out.set(p.id, structuredClone(p));
    }
    return out;
  }

  async leaderboard(sort: LeaderboardSort, limit: number): Promise<LeaderboardEntry[]> {
    const key = (p: PlayerRecord) =>
      sort === "kills" ? p.stats.kills : sort === "wins" ? p.stats.wins : p.xp;
    return [...this.players.values()]
      .filter((p) => p.stats.matchesPlayed > 0)
      .sort((a, b) => key(b) - key(a))
      .slice(0, limit)
      .map((p, i) => ({
        rank: i + 1,
        nickname: p.nickname,
        level: p.level,
        kills: p.stats.kills,
        wins: p.stats.wins,
        matchesPlayed: p.stats.matchesPlayed,
        kd: kdRatio(p.stats.kills, p.stats.deaths),
      }));
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}
