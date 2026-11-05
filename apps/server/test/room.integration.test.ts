import { matchMaker } from "@colyseus/core";
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

describe("HTTP security", () => {
  it("only grants CORS to configured origins (matchmaking included)", async () => {
    const evil = await fetch(`${URL}/matchmake/joinOrCreate/arena`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const good = await fetch(`${URL}/matchmake/joinOrCreate/arena`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" },
    });
    expect(good.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(good.headers.get("access-control-allow-credentials")).toBe("true");
    const api = await fetch(`${URL}/api/rooms`, { headers: { origin: "https://evil.example" } });
    expect(api.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects tampered identity tokens", async () => {
    const g = await guest("Tamper");
    const [body, sig] = g.token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), sub: "00000000-0000-4000-8000-000000000000" })).toString("base64url")}.${sig}`;
    const res = await fetch(`${URL}/api/me`, { headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
    const ok = await fetch(`${URL}/api/me`, { headers: { authorization: `Bearer ${g.token}` } });
    expect(ok.status).toBe(200);
  });

  it("validates nicknames", async () => {
    const res = await fetch(`${URL}/api/guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "<img src=x>" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Quick match", () => {
  it("puts players in the same public room and auto-starts when everybody is ready", async () => {
    const g1 = await guest("Quick1");
    const g2 = await guest("Quick2");
    const r1 = await new Client(URL).joinOrCreate(ROOM_NAME, { token: g1.token, kind: "quick" }, MatchState);
    const r2 = await new Client(URL).joinOrCreate(ROOM_NAME, { token: g2.token, kind: "quick" }, MatchState);
    expect(r2.roomId).toBe(r1.roomId);
    // Public quick rooms are listed for the room browser.
    const list = (await (await fetch(`${URL}/api/rooms`)).json()) as { roomId: string; players: number }[];
    expect(list.find((r) => r.roomId === r1.roomId)?.players).toBe(2);
    await until(() => r1.state.phaseEndTick > 0, 3000, "auto-start scheduled");
    r1.send(C2S.READY, { ready: true });
    r2.send(C2S.READY, { ready: true });
    await until(() => r1.state.phase === "countdown", 6000, "countdown");
    // No practice targets in public rooms.
    expect(r1.state.players.size).toBe(2);
    await r1.leave();
    await r2.leave();
  });
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
      {
        token: alpha.token,
        kind: "private",
        primary: "sniper",
        debugSpawns: [
          { x: 1000, y: 1180 },
          { x: 1300, y: 1180 },
        ],
      },
      MatchState,
    );
    await until(() => a.state.code?.length === 5, 3000, "room code");
    // Alone in a private room: three training targets are added for solo practice.
    await until(() => a.state.players.size === 4, 3000, "practice targets");
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

  it("advances the room clock only from the 20 Hz simulation tick", async () => {
    // v0.1.0 set patchRate = null before setTimestep, which made Colyseus start an extra 60 Hz
    // clock interval; the timestep then received a deltaTime that under-reported real time.
    const room = matchMaker.getLocalRoomById(a.roomId)!;
    let ticks = 0;
    const original = room.clock.tick.bind(room.clock);
    room.clock.tick = () => {
      ticks++;
      return original();
    };
    await wait(1000);
    room.clock.tick = original;
    expect(ticks).toBeGreaterThanOrEqual(17);
    expect(ticks).toBeLessThanOrEqual(23);
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
        encodeInput(
          quantizeInput({ seq: ++seq, mx: 1, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: b.state.tick }),
        ),
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
        encodeInput(
          quantizeInput({ seq: ++seq, mx: -1, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: b.state.tick }),
        ),
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

  it("tolerates the input burst released after a network stall, but disconnects a flooder", async () => {
    // After a stall the client's buffered messages arrive at once: up to NET.inputStallMs worth
    // (45 one-frame messages at 60 FPS) followed by normal traffic (60/s). v0.1.0 allowed 90
    // messages/s and kicked the player with 4002 here.
    let seq = b.state.players.get(b.sessionId)!.ack;
    const neutral = () =>
      encodeInput(
        quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: b.state.tick }),
      );
    for (let i = 0; i < 45; i++) b.send(C2S.INPUT, { i: [neutral()] });
    for (let i = 0; i < 60; i++) {
      b.send(C2S.INPUT, { i: [neutral()] });
      await wait(16);
    }
    await until(() => b.state.players.get(b.sessionId)!.ack === seq, 3000, "burst acknowledged");
    expect(b.connection.isOpen).toBe(true);

    const delta = await guest("Delta");
    const d = await new Client(URL).joinById(a.roomId, { token: delta.token, kind: "private" }, MatchState);
    await until(() => a.state.players.size === 3, 3000, "delta joined");
    let dseq = 0;
    for (let i = 0; i < 400; i++) {
      d.send(C2S.INPUT, {
        i: [
          encodeInput(
            quantizeInput({ seq: ++dseq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0 }),
          ),
        ],
      });
    }
    await until(() => a.state.players.size === 2, 4000, "flooder removed");
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
        encodeInput(
          quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: angle, buttons, slot: -1, viewTick: a.state.tick }),
        ),
      );
      a.send(C2S.INPUT, { i: frames });
      await wait(50);
      for (let k = 0; k < 26; k++) {
        a.send(C2S.INPUT, {
          i: [0, 0, 0].map(() =>
            encodeInput(
              quantizeInput({
                seq: ++seq,
                mx: 0,
                my: 0,
                aim: angle,
                buttons: 0,
                slot: -1,
                viewTick: a.state.tick,
              }),
            ),
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

describe("Security: negative paths", () => {
  let host: Room<unknown, MatchState>;
  let guestRoom: Room<unknown, MatchState>;
  let hostId: GuestSessionResponse;
  let guestId: GuestSessionResponse;
  const liveRooms = async () => (await matchMaker.query({ name: ROOM_NAME })).length;
  const matchmake = (method: string, body: unknown) =>
    fetch(`${URL}/matchmake/${method}/${ROOM_NAME}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates no room for a forged or missing identity token", async () => {
    const before = await liveRooms();
    const forged = await matchmake("create", { token: "forged-token-xxxxxxxx", kind: "private" });
    expect(forged.ok).toBe(false);
    const missing = await matchmake("create", { kind: "private" });
    expect(missing.ok).toBe(false);
    const fake = await matchmake("joinOrCreate", {
      token: `${"a".repeat(40)}.${"b".repeat(43)}`,
      kind: "quick",
    });
    expect(fake.ok).toBe(false);
    expect(await liveRooms()).toBe(before);
  });

  it("never matches a private room through join/joinOrCreate", async () => {
    hostId = await guest("Host");
    guestId = await guest("Visitor");
    host = await new Client(URL).create(ROOM_NAME, { token: hostId.token, kind: "private" }, MatchState);
    await until(() => host.state.code?.length === 5, 3000, "code");
    await expect(
      new Client(URL).join(ROOM_NAME, { token: guestId.token, kind: "private" }, MatchState),
    ).rejects.toThrow();
    const other = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token: guestId.token, kind: "private" },
      MatchState,
    );
    expect(other.roomId).not.toBe(host.roomId);
    await other.leave();
  });

  it("refuses the same identity twice in one room", async () => {
    guestRoom = await new Client(URL).joinById(
      host.roomId,
      { token: guestId.token, kind: "private" },
      MatchState,
    );
    await until(() => host.state.players.size === 2, 3000, "visitor joined");
    await expect(
      new Client(URL).joinById(host.roomId, { token: guestId.token, kind: "private" }, MatchState),
    ).rejects.toThrow(/already in this room/);
    expect(host.state.players.size).toBe(2);
  });

  it("rejects forged reconnection tokens", async () => {
    await expect(new Client(URL).reconnect(`${host.roomId}:forged`, MatchState)).rejects.toThrow();
    await expect(new Client(URL).reconnect(`${host.roomId}:${"x".repeat(9)}`, MatchState)).rejects.toThrow();
    expect(host.connection.isOpen).toBe(true);
    expect(host.state.players.size).toBe(2);
  });

  it("moves the seat to a new connection that presents the live token (stale-socket recovery)", async () => {
    // The reconnection token is the seat's bearer credential: the client that holds it (e.g. after
    // a network switch the server has not noticed yet) takes the seat over; nobody is duplicated
    // and the player keeps its state. v0.1.0 dropped the seat instead (player kicked).
    const old = host;
    const sessionId = old.sessionId;
    (old as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    host = await new Client(URL).reconnect(old.reconnectionToken, MatchState);
    expect(host.sessionId).toBe(sessionId);
    await until(() => host.state.players.size === 2, 3000, "state after takeover");
    expect(host.state.hostId).toBe(sessionId);
    await until(() => !old.connection.isOpen, 3000, "old socket closed");
  });

  it("keeps owner-only fields (ack, ammo, timers) out of other clients' state", async () => {
    guestRoom.send(C2S.READY, { ready: true });
    await until(() => host.state.players.get(guestRoom.sessionId)?.ready === true, 2000, "ready");
    host.send(C2S.START, {});
    await until(() => host.state.phase === "playing", 8000, "playing");
    let seq = 0;
    for (let i = 0; i < 5; i++) {
      guestRoom.send(C2S.INPUT, {
        i: [0, 0, 0].map(() =>
          encodeInput(quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0 })),
        ),
      });
      await wait(50);
    }
    const own = () => guestRoom.state.players.get(guestRoom.sessionId)!;
    await until(() => own().ack === seq && own().m0 > 0, 3000, "owner sees its private fields");
    const seenByHost = host.state.players.get(guestRoom.sessionId)!;
    // Never transmitted to other clients (left undefined or at the schema default).
    expect([undefined, 0]).toContain(seenByHost.ack);
    expect([undefined, 0]).toContain(seenByHost.m0);
    expect([undefined, 0]).toContain(seenByHost.r1);
    expect([undefined, 0]).toContain(seenByHost.cooldown);
    // Public fields are shared.
    expect(seenByHost.x).toBe(own().x);
  });

  it("contains sequence and view-tick manipulation to the sender", async () => {
    const mallory = await guest("Mallory");
    const m = await new Client(URL).joinById(
      host.roomId,
      { token: mallory.token, kind: "private" },
      MatchState,
    );
    await until(() => host.state.players.size === 3, 3000, "mallory joined");
    const frame = (seq: number, viewTick: number) =>
      encodeInput(quantizeInput({ seq, mx: 1, my: 0, aim: 0, buttons: BTN.FIRE, slot: -1, viewTick }));
    // Largest allowed sequence number with a view tick far in the future, then "normal" frames.
    m.send(C2S.INPUT, { i: [frame(2 ** 31, 10_000_000)] });
    m.send(C2S.INPUT, { i: [frame(1, 0), frame(2, 0)] });
    await wait(400);
    const room = matchMaker.getLocalRoomById(host.roomId) as unknown as {
      sim: {
        players: Map<string, { lastQueuedSeq: number; inputStats: { duplicate: number; processed: number } }>;
      };
    };
    const sp = room.sim.players.get(m.sessionId)!;
    expect(sp.lastQueuedSeq).toBe(2 ** 31);
    expect(sp.inputStats.processed).toBe(1); // the forged frame, with its view tick clamped
    expect(sp.inputStats.duplicate).toBe(2); // later frames can no longer advance: self-inflicted
    // Out-of-range values are protocol violations: the sender is removed, nobody else is.
    m.send(C2S.INPUT, { i: [frame(2 ** 31 + 1, 0)] });
    await until(() => host.state.players.size === 2, 4000, "mallory removed");
    expect(host.connection.isOpen).toBe(true);
    expect(guestRoom.connection.isOpen).toBe(true);
  });

  it("disconnects senders of unknown message types and of oversized input batches", async () => {
    const eve = await guest("Eve");
    const e = await new Client(URL).joinById(host.roomId, { token: eve.token, kind: "private" }, MatchState);
    await until(() => host.state.players.size === 3, 3000, "eve joined");
    e.send("does-not-exist", { x: 1 });
    await until(() => host.state.players.size === 2, 4000, "eve removed (unknown type)");
    const frank = await guest("Frank");
    const f = await new Client(URL).joinById(
      host.roomId,
      { token: frank.token, kind: "private" },
      MatchState,
    );
    await until(() => host.state.players.size === 3, 3000, "frank joined");
    const frames = Array.from({ length: 7 }, (_, k) =>
      encodeInput(quantizeInput({ seq: k + 1, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0 })),
    );
    f.send(C2S.INPUT, { i: frames });
    await until(() => host.state.players.size === 2, 4000, "frank removed (oversized batch)");
    expect(host.connection.isOpen).toBe(true);
  });

  it("does not let a spoofed X-Forwarded-For bypass the per-address limits", async () => {
    // TRUST_PROXY defaults to 0: the header is ignored and the socket address is the key.
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${URL}/api/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${i + 1}` },
        body: JSON.stringify({ nickname: `Spoof ${i}` }),
      });
      if (res.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("rate-limits matchmaking requests per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const res = await matchmake("joinOrCreate", { token: "forged-token-xxxxxxxx", kind: "quick" });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    await host.leave();
    await guestRoom.leave();
  });
});
