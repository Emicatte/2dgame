import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/persistence/memoryRepository.ts";
import { runMigrations } from "../src/persistence/migrate.ts";
import { PgRepository } from "../src/persistence/pgRepository.ts";
import type { MatchPlayerResult, Repository } from "../src/persistence/repository.ts";

/**
 * The same contract runs against the in-memory store and, when TEST_DATABASE_URL is set,
 * against a real PostgreSQL database (with migrations applied from drizzle/).
 */
const pgUrl = process.env.TEST_DATABASE_URL;

function result(playerId: string, partial: Partial<MatchPlayerResult>): MatchPlayerResult {
  return {
    playerId,
    kills: 0,
    deaths: 0,
    placement: 1,
    xpGained: 0,
    completed: true,
    won: false,
    shotsFired: 0,
    shotsHit: 0,
    playtimeSec: 0,
    ...partial,
  };
}

function contract(name: string, make: () => Promise<Repository>, cleanup: (r: Repository) => Promise<void>) {
  describe(name, () => {
    let repo: Repository;
    beforeAll(async () => {
      repo = await make();
    });
    afterAll(async () => {
      await cleanup(repo);
    });

    it("creates, reads and updates profiles", async () => {
      const id = randomUUID();
      const created = await repo.createPlayer(id, "Nova");
      expect(created).toMatchObject({ id, nickname: "Nova", xp: 0, level: 1 });
      expect(await repo.getPlayer(id)).toMatchObject({ nickname: "Nova" });
      expect(await repo.getPlayer(randomUUID())).toBeNull();
      const updated = await repo.updateProfile(id, { nickname: "Nova2", primary: "sniper" });
      expect(updated).toMatchObject({ nickname: "Nova2", primary: "sniper" });
    });

    it("records a match atomically and accumulates stats, XP and level", async () => {
      const winner = randomUUID();
      const loser = randomUUID();
      await repo.createPlayer(winner, "Winner");
      await repo.createPlayer(loser, "Loser");
      const base = {
        roomId: "room",
        mapId: "industrial",
        mode: "deathmatch",
        roomKind: "quick",
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        endReason: "time",
      };
      const first = await repo.recordMatch({
        ...base,
        id: randomUUID(),
        winnerPlayerId: winner,
        players: [
          result(winner, {
            kills: 5,
            deaths: 1,
            xpGained: 400,
            won: true,
            shotsFired: 40,
            shotsHit: 20,
            playtimeSec: 60,
          }),
          result(loser, {
            kills: 1,
            deaths: 5,
            placement: 2,
            xpGained: 120,
            shotsFired: 30,
            shotsHit: 6,
            playtimeSec: 60,
          }),
          // Unknown ids (e.g. a deleted profile) are ignored instead of failing the whole match.
          result(randomUUID(), { kills: 3 }),
        ],
      });
      expect(first.get(winner)).toMatchObject({ xp: 400, level: 2 });
      await repo.recordMatch({
        ...base,
        id: randomUUID(),
        winnerPlayerId: loser,
        players: [
          result(winner, { kills: 2, deaths: 3, placement: 2, xpGained: 100 }),
          result(loser, { kills: 3, deaths: 2, xpGained: 300, won: true }),
        ],
      });
      const w = await repo.getPlayer(winner);
      expect(w?.stats).toMatchObject({
        matchesPlayed: 2,
        wins: 1,
        losses: 1,
        kills: 7,
        deaths: 4,
        shotsFired: 40,
        shotsHit: 20,
        playtimeSec: 60,
      });
      expect(w?.xp).toBe(500);
      const l = await repo.getPlayer(loser);
      expect(l?.stats).toMatchObject({ matchesPlayed: 2, wins: 1, losses: 1, kills: 4, deaths: 7 });
    });

    it("ranks the leaderboard", async () => {
      const top = randomUUID();
      await repo.createPlayer(top, "TopGun");
      await repo.recordMatch({
        id: randomUUID(),
        roomId: "r",
        mapId: "neon",
        mode: "deathmatch",
        roomKind: "private",
        startedAt: new Date(),
        endedAt: new Date(),
        winnerPlayerId: top,
        endReason: "kill-limit",
        players: [result(top, { kills: 999, xpGained: 50, won: true })],
      });
      const byKills = await repo.leaderboard("kills", 5);
      expect(byKills[0]).toMatchObject({ nickname: "TopGun", rank: 1, kills: 999 });
      const byXp = await repo.leaderboard("xp", 50);
      expect(byXp.length).toBeGreaterThan(0);
      for (let i = 1; i < byXp.length; i++) expect(byXp[i]!.rank).toBe(i + 1);
    });

    it("reports health", async () => {
      expect(await repo.ping()).toBe(true);
    });
  });
}

contract(
  "MemoryRepository",
  async () => new MemoryRepository(),
  async () => {},
);

if (pgUrl) {
  contract(
    "PgRepository (PostgreSQL)",
    async () => {
      const repo = PgRepository.connect(pgUrl, false);
      await repo.pool.query(
        "drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;",
      );
      await runMigrations(repo.pool);
      return repo;
    },
    async (r) => r.close(),
  );
} else {
  describe.skip("PgRepository (PostgreSQL) — set TEST_DATABASE_URL to run", () => {
    it("skipped", () => {});
  });
}
