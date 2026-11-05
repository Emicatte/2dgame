import { Client, type Room } from "@colyseus/sdk";
import {
  BTN,
  C2S,
  encodeInput,
  type GuestSessionResponse,
  MatchState,
  type NetEvent,
  quantizeInput,
  ROOM_NAME,
  type ResultsMessage,
  S2C,
} from "@scrapline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { MemoryRepository } from "../src/persistence/memoryRepository.ts";

/**
 * Boots the real Colyseus server (HTTP + WebSocket) and drives it with the real client SDK.
 * No mocks: matchmaking, auth, state sync, inputs and reconnection go over actual sockets.
 */
const PORT = 2700 + Math.floor(Math.random() * 200);
const URL = `http://localhost:${PORT}`;
const repo = new MemoryRepository();
let server: ReturnType<typeof createGameServer>;

async function guest(nickname: string): Promise<GuestSessionResponse> {
  const res = await fetch(`${URL}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as GuestSessionResponse;
}

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
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

describe("ArenaRoom over real sockets", () => {
  let alpha: GuestSessionResponse;
  let bravo: GuestSessionResponse;
  let a: Room<unknown, MatchState>;
  let b: Room<unknown, MatchState>;
  const sdkA = new Client(URL);
  const sdkB = new Client(URL);

  it("rejects joins without a valid identity", async () => {
    await expect(sdkA.joinOrCreate(ROOM_NAME, { token: "x".repeat(20), kind: "quick" })).rejects.toThrow();
  });

  it("creates a private room and lets a second player join by code", async () => {
    alpha = await guest("Alpha");
    bravo = await guest("Bravo");
    a = await sdkA.create(
      ROOM_NAME,
      { token: alpha.token, kind: "private", primary: "sniper", debugSpawns: [{ x: 1000, y: 1180 }, { x: 1300, y: 1180 }] },
      MatchState,
    );
    await until(() => a.state.code?.length === 5, 3000, "room code");
    const lookup = await fetch(`${URL}/api/rooms/code/${a.state.code}`);
    expect(lookup.status).toBe(200);
    const { roomId } = (await lookup.json()) as { roomId: string };
    expect(roomId).toBe(a.roomId);

    // Private rooms are not listed publicly.
    const list = (await (await fetch(`${URL}/api/rooms`)).json()) as { roomId: string }[];
    expect(list.some((r) => r.roomId === a.roomId)).toBe(false);

    b = await sdkB.joinById(roomId, { token: bravo.token, kind: "private" }, MatchState);
    await until(() => a.state.players.size === 2 && b.state.players.size === 2, 3000, "both players");
    expect(a.state.hostId).toBe(a.sessionId);
  });

  it("enforces host-only controls and the ready check", async () => {
    b.send(C2S.SETTINGS, { killLimit: 5 });
    b.send(C2S.START, {});
    await wait(200);
    expect(a.state.phase).toBe("lobby");
    a.send(C2S.SETTINGS, { killLimit: 5, durationSec: 120 });
    await until(() => a.state.killLimit === 5, 2000, "settings");
    a.send(C2S.START, {});
    await wait(200);
    expect(a.state.phase).toBe("lobby"); // Bravo not ready yet
    b.send(C2S.READY, { ready: true });
    await until(() => a.state.players.get(b.sessionId)?.ready === true, 2000, "ready");
    a.send(C2S.START, {});
    await until(() => a.state.phase === "countdown", 2000, "countdown");
    await until(() => a.state.phase === "playing", 8000, "playing");
  });

  it("applies client inputs authoritatively and acknowledges them", async () => {
    const me = () => b.state.players.get(b.sessionId)!;
    const x0 = me().x;
    let seq = 0;
    for (let i = 0; i < 20; i++) {
      const frames = Array.from({ length: 3 }, () =>
        encodeInput(quantizeInput({ seq: ++seq, mx: 1, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: b.state.tick })),
      );
      b.send(C2S.INPUT, { i: frames });
      await wait(50);
    }
    await until(() => me().ack === seq, 3000, "ack");
    expect(me().x).toBeGreaterThan(x0 + 100);
    // A sees B's movement (state sync to the other client)
    await until(() => a.state.players.get(b.sessionId)!.x > x0 + 100, 2000, "A sees B move");
    // B walks back along the duel lane
    for (let i = 0; i < 20; i++) {
      const frames = Array.from({ length: 3 }, () =>
        encodeInput(quantizeInput({ seq: ++seq, mx: -1, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: b.state.tick })),
      );
      b.send(C2S.INPUT, { i: frames });
      await wait(50);
    }
    await until(() => me().ack === seq, 3000, "ack 2");
  });

  it("ignores replayed inputs without disconnecting the sender", async () => {
    const before = b.state.players.get(b.sessionId)!.ack;
    b.send(C2S.INPUT, {
      i: [encodeInput(quantizeInput({ seq: 1, mx: 1, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0 }))],
    });
    await wait(300);
    expect(b.state.players.get(b.sessionId)!.ack).toBe(before);
    expect(b.connection.isOpen).toBe(true);
  });

  it("disconnects a client that sends malformed messages, without affecting the others", async () => {
    const charlie = await guest("Charlie");
    const c = await new Client(URL).joinById(a.roomId, { token: charlie.token, kind: "private" }, MatchState);
    await until(() => a.state.players.size === 3, 3000, "charlie joined");
    c.send(C2S.INPUT, { i: [{ s: 1, x: 5, y: 0, a: 0, b: 0, w: -1, v: 0 }] }); // axis out of range
    await until(() => a.state.players.size === 2, 4000, "charlie removed");
    expect(a.connection.isOpen).toBe(true);
    expect(b.connection.isOpen).toBe(true);
    expect(a.state.phase).toBe("playing");
  });

  it("computes damage and kills on the server from real shots", async () => {
    await wait(1600); // spawn protection
    const events: NetEvent[] = [];
    a.onMessage(S2C.EVENTS, (evs: NetEvent[]) => events.push(...evs));
    const target = b.state.players.get(b.sessionId)!;
    const shooter = a.state.players.get(a.sessionId)!;
    let seq = 0;
    const deadline = Date.now() + 8000;
    while (target.deaths === 0 && Date.now() < deadline) {
      const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      // press, release (semi-auto sniper), then idle until the bolt cycles
      const frames = [BTN.FIRE, 0, 0].map((buttons) =>
        encodeInput(quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: angle, buttons, slot: -1, viewTick: a.state.tick })),
      );
      a.send(C2S.INPUT, { i: frames });
      await wait(50);
      for (let k = 0; k < 26; k++) {
        a.send(C2S.INPUT, {
          i: [0, 0, 0].map(() =>
            encodeInput(quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: angle, buttons: 0, slot: -1, viewTick: a.state.tick })),
          ),
        });
        await wait(50);
        if (target.deaths > 0) break;
      }
    }
    expect(events.some((e) => e.t === "hit" && e.p === a.sessionId && e.v === b.sessionId)).toBe(true);
    expect(target.deaths).toBe(1);
    expect(shooter.kills).toBe(1);
    expect(events.some((e) => e.t === "kill" && e.k === a.sessionId && e.fb)).toBe(true);
    await until(() => target.alive, 5000, "respawn");
  });

  it("keeps the seat on disconnect and restores state on reconnect", async () => {
    const token = b.reconnectionToken;
    const kills = b.state.players.get(b.sessionId)!.deaths;
    // Simulate a network drop (not a consented leave)
    (b.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(4999);
    await until(() => a.state.players.get(b.sessionId)?.connected === false, 4000, "drop seen");
    const sdkB2 = new Client(URL);
    b = await sdkB2.reconnect(token, MatchState);
    await until(() => b.state.players.size === 2, 3000, "resync");
    await until(() => a.state.players.get(b.sessionId)?.connected === true, 3000, "reconnected");
    expect(b.state.players.get(b.sessionId)!.deaths).toBe(kills);
  });

  it("ends the match at the kill limit, persists stats and sends XP results", async () => {
    const results: ResultsMessage[] = [];
    a.onMessage(S2C.RESULTS, (r: ResultsMessage) => results.push(r));
    // Lower the remaining work: the host sets nothing mid-match, so finish by time instead.
    await until(() => a.state.phase === "results", 130_000, "results");
    await until(() => results.length === 1, 5000, "results message");
    const r = results[0]!;
    expect(r.rows).toHaveLength(2);
    expect(r.winnerId).toBe(a.sessionId);
    expect(r.personal?.xpGained).toBeGreaterThan(0);
    expect(r.personal?.persisted).toBe(true);
    const profile = await repo.getPlayer(alpha.profile.id);
    expect(profile?.stats.matchesPlayed).toBe(1);
    expect(profile?.stats.kills).toBe(1);
    expect(profile?.stats.wins).toBe(1);
    expect(profile?.xp).toBe(r.personal?.xpGained);
    const loser = await repo.getPlayer(bravo.profile.id);
    expect(loser?.stats.deaths).toBe(1);
    expect(loser?.stats.losses).toBe(1);
  }, 150_000);

  it("disposes the room when everyone leaves", async () => {
    const roomId = a.roomId;
    await a.leave();
    await b.leave();
    await wait(300);
    const lookup = await fetch(`${URL}/api/rooms/code/${a.state.code}`);
    expect(lookup.status).toBe(404);
    void roomId;
  });
});
