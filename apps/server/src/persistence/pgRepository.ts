import { kdRatio, type LeaderboardEntry, levelFromXp } from "@scrapline/shared";
import { desc, eq, gt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { LeaderboardSort, MatchRecord, PlayerRecord, Repository } from "./repository.ts";
import * as schema from "./schema.ts";
import { matches, matchPlayers, players } from "./schema.ts";

type Row = typeof players.$inferSelect;

function toRecord(r: Row): PlayerRecord {
  return {
    id: r.id,
    nickname: r.nickname,
    xp: r.xp,
    level: r.level,
    skin: r.skin,
    primary: r.primaryWeapon,
    createdAt: r.createdAt,
    stats: {
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      losses: r.losses,
      kills: r.kills,
      deaths: r.deaths,
      shotsFired: r.shotsFired,
      shotsHit: r.shotsHit,
      playtimeSec: r.playtimeSec,
    },
  };
}

export class PgRepository implements Repository {
  readonly kind = "postgres" as const;
  readonly db: NodePgDatabase<typeof schema>;

  constructor(readonly pool: pg.Pool) {
    this.db = drizzle(pool, { schema });
  }

  static connect(url: string, ssl: boolean): PgRepository {
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });
    return new PgRepository(pool);
  }

  async createPlayer(id: string, nickname: string): Promise<PlayerRecord> {
    const [row] = await this.db.insert(players).values({ id, nickname }).returning();
    return toRecord(row!);
  }

  async getPlayer(id: string): Promise<PlayerRecord | null> {
    const row = await this.db.query.players.findFirst({ where: eq(players.id, id) });
    return row ? toRecord(row) : null;
  }

  async updateProfile(
    id: string,
    patch: { nickname?: string; skin?: string; primary?: string },
  ): Promise<PlayerRecord | null> {
    const [row] = await this.db
      .update(players)
      .set({
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.skin !== undefined ? { skin: patch.skin } : {}),
        ...(patch.primary !== undefined ? { primaryWeapon: patch.primary } : {}),
        lastSeenAt: new Date(),
      })
      .where(eq(players.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async touch(id: string): Promise<void> {
    await this.db.update(players).set({ lastSeenAt: new Date() }).where(eq(players.id, id));
  }

  async recordMatch(match: MatchRecord): Promise<Map<string, PlayerRecord>> {
    return this.db.transaction(async (tx) => {
      const known = match.players.length
        ? await tx
            .select({ id: players.id })
            .from(players)
            .where(sql`${players.id} in ${match.players.map((p) => p.playerId)}`)
        : [];
      const knownIds = new Set(known.map((k) => k.id));
      const rows = match.players.filter((p) => knownIds.has(p.playerId));

      await tx.insert(matches).values({
        id: match.id,
        roomId: match.roomId,
        mapId: match.mapId,
        mode: match.mode,
        roomKind: match.roomKind,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        winnerPlayerId:
          match.winnerPlayerId && knownIds.has(match.winnerPlayerId) ? match.winnerPlayerId : null,
        endReason: match.endReason,
      });

      const updated = new Map<string, PlayerRecord>();
      for (const r of rows) {
        await tx.insert(matchPlayers).values({
          matchId: match.id,
          playerId: r.playerId,
          kills: r.kills,
          deaths: r.deaths,
          placement: r.placement,
          xpGained: r.xpGained,
          completed: r.completed,
        });
        // Increment in SQL so concurrent matches of the same player never lose updates.
        const [row] = await tx
          .update(players)
          .set({
            xp: sql`${players.xp} + ${r.xpGained}`,
            matchesPlayed: sql`${players.matchesPlayed} + 1`,
            wins: sql`${players.wins} + ${r.won ? 1 : 0}`,
            losses: sql`${players.losses} + ${r.won ? 0 : 1}`,
            kills: sql`${players.kills} + ${r.kills}`,
            deaths: sql`${players.deaths} + ${r.deaths}`,
            shotsFired: sql`${players.shotsFired} + ${r.shotsFired}`,
            shotsHit: sql`${players.shotsHit} + ${r.shotsHit}`,
            playtimeSec: sql`${players.playtimeSec} + ${r.playtimeSec}`,
            lastSeenAt: new Date(),
          })
          .where(eq(players.id, r.playerId))
          .returning();
        if (!row) continue;
        const level = levelFromXp(row.xp).level;
        if (level !== row.level) {
          await tx.update(players).set({ level }).where(eq(players.id, r.playerId));
          row.level = level;
        }
        updated.set(row.id, toRecord(row));
      }
      return updated;
    });
  }

  async leaderboard(sort: LeaderboardSort, limit: number): Promise<LeaderboardEntry[]> {
    const order = sort === "kills" ? players.kills : sort === "wins" ? players.wins : players.xp;
    const rows = await this.db
      .select()
      .from(players)
      .where(gt(players.matchesPlayed, 0))
      .orderBy(desc(order), players.createdAt)
      .limit(limit);
    return rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      level: r.level,
      kills: r.kills,
      wins: r.wins,
      matchesPlayed: r.matchesPlayed,
      kd: kdRatio(r.kills, r.deaths),
    }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
