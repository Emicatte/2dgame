import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  C2S,
  FIRST_CONTACT,
  type GuestSessionResponse,
  MatchState,
  type NetEvent,
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
 * Outbreak on the dedicated server with the real client SDK (the other transport besides host
 * mode): private co-op room, mission settings, enemies synchronized, quick matchmaking refuses PvE.
 */
const PORT = 3000 + Math.floor(Math.random() * 40);
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
  const cfg = loadConfig({ NODE_ENV: "test", PORT: String(PORT), LOG_LEVEL: "warn" } as NodeJS.ProcessEnv);
  server = createGameServer({ cfg, repo, log: logger });
  await server.listen(PORT, "127.0.0.1");
  for (const name of ["Medic", "Scout", "Quick", "Farmer"]) {
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

describe("Outbreak over real sockets (dedicated server)", () => {
  it("private co-op room: mission and difficulty, start, enemies reach every client", async () => {
    const host = await new Client(URL).create(
      ROOM_NAME,
      { token: guests[0]!.token, kind: "private", mode: "outbreak" },
      MatchState,
    );
    await until(() => host.state.code?.length === 5, 3000, "code");
    expect(host.state.mode).toBe("outbreak");
    expect(host.state.mapId).toBe(FIRST_CONTACT.map);
    const guest: Room<unknown, MatchState> = await new Client(URL).joinById(
      host.roomId,
      { token: guests[1]!.token, kind: "private" },
      MatchState,
    );
    await until(() => host.state.players.size === 2, 3000, "squad");
    // No training targets in co-op.
    expect([...host.state.players.keys()].some((id) => id.startsWith("bot:"))).toBe(false);
    host.send(C2S.SETTINGS, { difficulty: "nightmare" });
    guest.send(C2S.SETTINGS, { difficulty: "recruit" });
    await until(() => guest.state.pve.difficulty === "nightmare", 3000, "difficulty");
    await wait(200);
    expect(guest.state.pve.difficulty).toBe("nightmare");
    const events: NetEvent[] = [];
    guest.onMessage(S2C.EVENTS, (m: NetEvent[]) => events.push(...m));
    let results: ResultsMessage | null = null;
    guest.onMessage(S2C.RESULTS, (m: ResultsMessage) => {
      results = m;
    });
    guest.send(C2S.READY, { ready: true });
    await wait(100);
    host.send(C2S.START, {});
    await until(() => guest.state.phase === "playing", 8000, "playing");
    await until(() => guest.state.zombies.size > 0, 5000, "enemies on the guest");
    expect(guest.state.zombies.size).toBe(host.state.zombies.size);
    expect(guest.state.props.get("generator")?.kind).toBe("generator");
    expect(guest.state.pve.mission).toBe(FIRST_CONTACT.id);
    expect([...guest.state.players.values()].every((p) => p.team === 1)).toBe(true);
    // The run is still going (nobody failed the mission by standing still for a moment).
    await wait(1500);
    expect(guest.state.pve.status).toBe(0);
    expect(results).toBeNull();
    void events;
    await guest.leave();
    await host.leave();
  }, 20_000);

  it("co-op ignores room size and length settings; leaving mid-run is not recorded as a PvP match", async () => {
    const room = await new Client(URL).create(
      ROOM_NAME,
      { token: guests[3]!.token, kind: "private", mode: "survival" },
      MatchState,
    );
    await until(() => room.state.mode === "survival", 3000, "mode");
    const duration = room.state.durationSec;
    room.send(C2S.SETTINGS, { maxPlayers: 8, durationSec: 120, killLimit: 5 });
    await wait(300);
    expect(room.state.maxPlayers).toBe(4);
    expect(room.state.durationSec).toBe(duration);
    room.send(C2S.READY, { ready: true });
    await wait(100);
    room.send(C2S.START, {});
    await until(() => room.state.phase === "playing", 10_000, "playing");
    // biome-ignore lint/suspicious/noExplicitAny: test access to the live room instance
    const inst = matchMaker.getLocalRoomById(room.roomId) as any;
    await until(() => inst.sim.pve.zw.alive > 0, 12_000, "first wave");
    const me = inst.sim.players.get(room.sessionId);
    for (const z of [...inst.sim.pve.zw.zombies.values()])
      inst.sim.pve.damageZombie(z.id, 99_999, me, false, z.x, z.y);
    expect(me.stats.kills).toBeGreaterThan(0);
    const before = repo.matches.length;
    await room.leave();
    await wait(1500);
    // The room is gone and nothing reached the PvP match history, stats or XP.
    expect(repo.matches.length).toBe(before);
    const rec = await repo.getPlayer(guests[3]!.profile.id);
    expect(rec?.stats.kills ?? 0).toBe(0);
    expect(rec?.stats.matchesPlayed ?? 0).toBe(0);
  }, 30_000);

  it("quick matchmaking never creates a PvE room", async () => {
    const q = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token: guests[2]!.token, kind: "quick", mode: "outbreak" },
      MatchState,
    );
    await until(() => !!q.state.mode, 3000, "mode");
    expect(q.state.mode).toBe("deathmatch");
    await q.leave();
  });
});
