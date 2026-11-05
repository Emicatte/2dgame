import { Client, type Room } from "@colyseus/sdk";
import {
  BTN,
  C2S,
  encodeInput,
  type GuestSessionResponse,
  MatchState,
  type NetEvent,
  quantizeInput,
  type ResultsMessage,
  ROOM_NAME,
  S2C,
} from "@scrapline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { MemoryRepository } from "../src/persistence/memoryRepository.ts";

/**
 * Team Deathmatch on the real Colyseus server with the real client SDK: matchmaking per mode,
 * team assignment and capacity, team switching and balancing, team scoring, match end at the
 * score limit, team results and persisted XP.
 */
const PORT = 2950 + Math.floor(Math.random() * 40);
const URL = `http://localhost:${PORT}`;
const repo = new MemoryRepository();
let server: ReturnType<typeof createGameServer>;
const guests: GuestSessionResponse[] = [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, timeoutMs = 5000, label = "condition") {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await wait(20);
  }
}

beforeAll(async () => {
  logger.level = "warn";
  const cfg = loadConfig({
    NODE_ENV: "test",
    PORT: String(PORT),
    ENABLE_DEBUG_ROUTES: "true",
    LOG_LEVEL: "warn",
  } as NodeJS.ProcessEnv);
  server = createGameServer({ cfg, repo, log: logger });
  await server.listen(PORT, "127.0.0.1");
  // Guest creation is rate limited per address (10/min): create the five identities once.
  for (const name of ["Ace", "Bolt", "Cobra", "Drift", "Echo"]) {
    const res = await fetch(`${URL}/api/guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: name }),
    });
    expect(res.status).toBe(201);
    guests.push((await res.json()) as GuestSessionResponse);
  }
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const token = (i: number) => guests[i]!.token;

async function privateRoomWithGuests(n: number, opts: Record<string, unknown> = {}) {
  const host = await new Client(URL).create(
    ROOM_NAME,
    { token: token(0), kind: "private", primary: "sniper", ...opts },
    MatchState,
  );
  await until(() => host.state.code?.length === 5, 3000, "code");
  const others: Room<unknown, MatchState>[] = [];
  for (let i = 1; i <= n; i++) {
    others.push(
      await new Client(URL).joinById(host.roomId, { token: token(i), kind: "private" }, MatchState),
    );
  }
  return { host, others };
}

describe("Team Deathmatch over real sockets", () => {
  it("quick matchmaking is per mode: TDM players share a 2v2 room on opposite teams, deathmatch elsewhere", async () => {
    const t1 = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token: token(0), kind: "quick", mode: "tdm" },
      MatchState,
    );
    const t2 = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token: token(1), kind: "quick", mode: "tdm" },
      MatchState,
    );
    const dm = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token: token(2), kind: "quick", mode: "deathmatch" },
      MatchState,
    );
    expect(t2.roomId).toBe(t1.roomId);
    expect(dm.roomId).not.toBe(t1.roomId);
    await until(() => t1.state.players.size === 2, 3000, "both in TDM room");
    expect(t1.state.mode).toBe("tdm");
    expect(t1.state.maxPlayers).toBe(4);
    expect(t1.state.teamSize).toBe(2);
    const teams = [...t1.state.players.values()].map((p) => p.team).sort();
    expect(teams).toEqual([1, 2]);
    expect(dm.state.mode).toBe("deathmatch");
    await until(() => dm.state.players.size === 1, 3000, "dm sync");
    expect(dm.state.players.get(dm.sessionId)!.team).toBe(0);
    await Promise.all([t1.leave(), t2.leave(), dm.leave()]);
  });

  it("private room: host switches to TDM; capacity is 2× team size; invites, switching and balance", async () => {
    const { host, others } = await privateRoomWithGuests(1);
    const [b] = others as [Room<unknown, MatchState>];
    // Only the host changes the mode.
    b.send(C2S.SETTINGS, { mode: "tdm" });
    await wait(200);
    expect(host.state.mode).toBe("deathmatch");
    host.send(C2S.SETTINGS, { mode: "tdm" });
    await until(() => host.state.mode === "tdm" && b.state.mode === "tdm", 3000, "tdm");
    expect(b.state.teamSize).toBe(2);
    expect(b.state.durationSec).toBe(300);
    expect(b.state.killLimit).toBe(15);
    expect(b.state.friendlyFire).toBe(false);
    await until(() => b.state.players.size === 2, 3000, "targets gone");
    const team = (r: Room<unknown, MatchState>, id: string) => r.state.players.get(id)?.team ?? -1;
    const hostTeam = team(host, host.sessionId);
    expect([1, 2]).toContain(hostTeam);
    expect(team(host, b.sessionId)).toBe(hostTeam === 1 ? 2 : 1);

    // "Invite to my team": the third player asks for the host's team and gets it.
    const c = await new Client(URL).joinById(
      host.roomId,
      { token: token(2), kind: "private", team: hostTeam },
      MatchState,
    );
    await until(() => team(host, c.sessionId) === hostTeam, 3000, "invited to host team");
    // That team is now full (2/2): switching into it is refused, the other way works.
    b.send(C2S.TEAM, { team: hostTeam });
    await wait(200);
    expect(team(host, b.sessionId)).not.toBe(hostTeam);
    const d = await new Client(URL).joinById(host.roomId, { token: token(3), kind: "private" }, MatchState);
    await until(() => host.state.players.size === 4, 3000, "four players");
    // 2v2 is full: a fifth player is refused.
    await expect(
      new Client(URL).joinById(host.roomId, { token: token(4), kind: "private" }, MatchState),
    ).rejects.toThrow();
    // Host grows the teams to 3v3: capacity follows.
    host.send(C2S.SETTINGS, { teamSize: 3 });
    await until(() => host.state.maxPlayers === 6, 3000, "3v3");
    // Balance: sizes stay even.
    host.send(C2S.BALANCE, {});
    await wait(300);
    const counts = [1, 2].map((t) => [...host.state.players.values()].filter((p) => p.team === t).length);
    expect(counts).toEqual([2, 2]);
    // Back to Deathmatch clears teams.
    host.send(C2S.SETTINGS, { mode: "deathmatch" });
    await until(() => [...host.state.players.values()].every((p) => p.team === 0), 3000, "teams cleared");
    expect(host.state.maxPlayers).toBe(8);
    await Promise.all([host.leave(), b.leave(), c.leave(), d.leave()]);
  });

  it("1v1 TDM: enemy kills score for the team, the match ends at the score limit with team results", async () => {
    const { host, others } = await privateRoomWithGuests(1, {
      // Team spawns from the debug list: first half Alpha, second half Bravo (same lane).
      debugSpawns: [
        { x: 1000, y: 1180 },
        { x: 1000, y: 1180 },
        { x: 1300, y: 1180 },
        { x: 1300, y: 1180 },
      ],
    });
    const [b] = others as [Room<unknown, MatchState>];
    const results: ResultsMessage[] = [];
    const bResults: ResultsMessage[] = [];
    host.onMessage(S2C.RESULTS, (r: ResultsMessage) => results.push(r));
    b.onMessage(S2C.RESULTS, (r: ResultsMessage) => bResults.push(r));
    const events: NetEvent[] = [];
    b.onMessage(S2C.EVENTS, (evs: NetEvent[]) => events.push(...evs));
    host.send(C2S.SETTINGS, { mode: "tdm" });
    await until(() => host.state.mode === "tdm", 3000, "tdm");
    host.send(C2S.SETTINGS, { teamSize: 1, killLimit: 5, durationSec: 120 });
    await until(() => host.state.teamSize === 1 && host.state.killLimit === 5, 3000, "1v1 to 5");
    // Host on Alpha (left spawn), guest on Bravo.
    if (host.state.players.get(host.sessionId)!.team !== 1) {
      b.send(C2S.TEAM, { team: 2 });
      host.send(C2S.TEAM, { team: 1 });
    }
    await until(() => host.state.players.get(host.sessionId)!.team === 1, 3000, "host on Alpha");
    b.send(C2S.READY, { ready: true });
    await until(() => host.state.players.get(b.sessionId)?.ready === true, 3000, "ready");
    host.send(C2S.START, {});
    await until(() => host.state.phase === "playing", 9000, "playing");

    const me = () => host.state.players.get(host.sessionId)!;
    const target = () => host.state.players.get(b.sessionId)!;
    let seq = 0;
    const playStart = Date.now();
    const deadline = Date.now() + 110_000;
    while (host.state.phase === "playing" && Date.now() < deadline) {
      // Completion XP (and so the win) needs 60 s of participation: hold the last kill until then.
      const holdLastKill = host.state.scoreA >= 4 && Date.now() - playStart < 62_000;
      if (!target().alive || target().protected || holdLastKill) {
        await wait(100);
        continue;
      }
      const angle = Math.atan2(target().y - me().y, target().x - me().x);
      const send = (buttons: number) =>
        host.send(C2S.INPUT, {
          i: [buttons, 0, 0].map((bt) =>
            encodeInput(
              quantizeInput({
                seq: ++seq,
                mx: 0,
                my: 0,
                aim: angle,
                buttons: bt,
                slot: -1,
                viewTick: host.state.tick,
              }),
            ),
          ),
        });
      send(BTN.FIRE);
      for (let k = 0; k < 26 && host.state.phase === "playing"; k++) {
        await wait(50);
        send(0);
      }
    }
    await until(() => host.state.phase === "results", 5000, "results phase");
    expect(host.state.scoreA).toBe(5);
    expect(host.state.scoreB).toBe(0);
    expect(host.state.winnerTeam).toBe(1);
    expect(b.state.winnerTeam).toBe(1);
    expect(events.some((e) => e.t === "kill" && e.k === host.sessionId)).toBe(true);
    await until(() => results.length === 1 && bResults.length === 1, 5000, "results messages");
    expect(results[0]!.winnerTeam).toBe(1);
    expect(results[0]!.teamScores).toEqual([5, 0]);
    expect(results[0]!.rows.find((r) => r.id === host.sessionId)?.team).toBe(1);
    expect(results[0]!.personal?.xpLines.some((l) => l.reason === "Team victory")).toBe(true);
    expect(bResults[0]!.personal?.xpLines.some((l) => /victory/i.test(l.reason))).toBe(false);
    const winner = await repo.getPlayer(guests[0]!.profile.id);
    const loser = await repo.getPlayer(guests[1]!.profile.id);
    expect(winner?.stats.wins).toBeGreaterThanOrEqual(1);
    expect(loser?.stats.losses).toBeGreaterThanOrEqual(1);
    // Rematch keeps the teams.
    await until(() => host.state.phase === "lobby", 20_000, "back to lobby");
    expect(host.state.players.get(host.sessionId)!.team).toBe(1);
    expect(host.state.players.get(b.sessionId)!.team).toBe(2);
    await Promise.all([host.leave(), b.leave()]);
  }, 150_000);
});
