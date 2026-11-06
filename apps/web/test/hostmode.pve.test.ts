import {
  BTN,
  C2S,
  encodeInput,
  FIRST_CONTACT,
  type MatchState,
  type NetEvent,
  PVE_STATUS,
  type ResultsMessage,
  S2C,
} from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { GameSimulation } from "../../server/src/simulation/GameSimulation.ts";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID } from "../src/p2p/wire.ts";

/**
 * Outbreak in host mode: the host's tab runs the authoritative enemies and mission; guests see
 * the same enemies, props and mission state through the synchronized schema, and co-op rules
 * (downed, revive) work across the link.
 */
const flush = (ms = 3) => new Promise((r) => setTimeout(r, ms));
const HOST = { name: "Hosty", level: 3, skin: "foundry", primary: "rifle" as const, profileId: "host-pve-1" };
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

async function ticks(host: HostRoom, n: number) {
  for (let i = 0; i < n; i++) {
    host.tick();
    await flush(1);
  }
  await flush();
}

async function join(host: HostRoom, n: number) {
  const pending = PeerRoom.join(
    async () => {
      const [g, h] = memoryLinkPair();
      host.acceptLink(h);
      return g;
    },
    {
      build: BUILD_ID,
      name: `Guest${n}`,
      level: 2,
      skin: "foundry",
      primary: "smg",
      profileId: `guest-pve-${n}`,
    },
  );
  let done = false;
  pending.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 50 && !done; i++) {
    await flush();
    host.tick();
  }
  const room = await pending;
  rooms.push(room);
  return room;
}

const simOf = (host: HostRoom) => (host as unknown as { sim: GameSimulation }).sim;
let seq = 0;
const input = (buttons = 0) => ({
  i: [0, 1, 2].map(() => encodeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons, slot: -1, viewTick: 0 })),
});

describe("host mode: Outbreak co-op", () => {
  it("lobby → mission: enemies and mission state reach the guest; downed guest revived by the host; results recorded once", async () => {
    const host = new HostRoom({ code: "OUTBK", map: "industrial", host: HOST, headless: true });
    rooms.push(host);
    host.send(C2S.SETTINGS, { mode: "outbreak" });
    await ticks(host, 1);
    expect(host.state.mode).toBe("outbreak");
    expect(host.state.mapId).toBe(FIRST_CONTACT.map);
    expect(host.state.pve.mission).toBe(FIRST_CONTACT.id);
    // No training targets in co-op.
    expect([...host.state.players.keys()].some((id) => id.startsWith("bot:"))).toBe(false);
    host.send(C2S.SETTINGS, { difficulty: "recruit" });
    // Unknown mission refused, mission unchanged.
    host.send(C2S.SETTINGS, { mission: "no-such-mission" });
    await ticks(host, 1);
    expect(host.state.pve.difficulty).toBe("recruit");
    expect(host.state.pve.mission).toBe(FIRST_CONTACT.id);

    const guest = await join(host, 1);
    let gstate: MatchState | null = null;
    guest.onStateChange((s) => {
      gstate = s;
    });
    const guestEvents: NetEvent[] = [];
    guest.onMessage(S2C.EVENTS, (m) => guestEvents.push(...(m as NetEvent[])));
    let guestResults: ResultsMessage | null = null;
    guest.onMessage(S2C.RESULTS, (m) => {
      guestResults = m as ResultsMessage;
    });
    // Guests cannot change PvE settings.
    guest.send(C2S.SETTINGS, { difficulty: "nightmare" });
    guest.send(C2S.READY, { ready: true });
    await ticks(host, 3);
    expect(host.state.pve.difficulty).toBe("recruit");
    host.send(C2S.START, {});
    await ticks(host, 5 * 20 + 2);
    expect(host.state.phase).toBe("playing");
    const sim = simOf(host);
    expect(sim.pve).not.toBeNull();
    // Both humans on one side.
    const teams = [...host.state.players.values()].map((p) => p.team);
    expect(new Set(teams)).toEqual(new Set([1]));

    await ticks(host, 10);
    const g = gstate as MatchState | null;
    expect(g?.zombies.size ?? 0).toBeGreaterThan(0);
    expect(g?.zombies.size).toBe(host.state.zombies.size);
    expect(g?.props.get("generator")?.kind).toBe("generator");
    expect(g?.pve.mission).toBe(FIRST_CONTACT.id);
    expect(g?.pve.doors).toBe("");

    // The guest is downed; the host walks over and holds E.
    const gp = sim.players.get(guest.sessionId)!;
    const hp = sim.players.get(host.sessionId)!;
    gp.sim.x = 1500;
    gp.sim.y = 1100;
    hp.sim.x = 1540;
    hp.sim.y = 1100;
    sim.pve!.hurtPlayer(guest.sessionId, 999, null, gp.sim.x, gp.sim.y);
    await ticks(host, 2);
    expect((gstate as MatchState | null)?.players.get(guest.sessionId)?.downed).toBe(true);
    expect(guestEvents.some((e) => e.t === "down" && e.p === guest.sessionId)).toBe(true);
    for (let i = 0; i < 20 * 4 && gp.pve.downed; i++) {
      host.send(C2S.INPUT, input(BTN.INTERACT));
      hp.sim.x = 1540;
      hp.sim.y = 1100;
      await ticks(host, 1);
    }
    expect(gp.pve.downed).toBe(false);
    expect(
      guestEvents.some((e) => e.t === "revive" && e.p === guest.sessionId && e.by === host.sessionId),
    ).toBe(true);
    expect((gstate as MatchState | null)?.players.get(host.sessionId)?.revives).toBe(1);

    // End the run: the mission completes; every player gets the PvE summary with a run id.
    (sim.pve as unknown as { finish(s: number): void }).finish(PVE_STATUS.COMPLETE);
    await ticks(host, 3);
    expect(host.state.phase).toBe("results");
    const res = guestResults as ResultsMessage | null;
    expect(res?.pve?.completed).toBe(true);
    expect(res?.pve?.squad).toHaveLength(2);
    expect(res?.personal?.record?.pve?.runId).toMatch(/^OUTBK-/);
    expect(res?.personal?.record?.kills).toBe(0);
    // Back to the lobby: the enemies are gone.
    await ticks(host, 15 * 20);
    expect(host.state.phase).toBe("lobby");
    expect(host.state.zombies.size).toBe(0);
  }, 30_000);

  it("rejoining under a new seat is no free revive; after a wipe the next PvP match has nobody downed", async () => {
    const host = new HostRoom({ code: "OUTB2", map: "industrial", host: HOST, headless: true });
    rooms.push(host);
    host.send(C2S.SETTINGS, { mode: "survival" });
    await ticks(host, 1);
    const g1 = await join(host, 2);
    g1.send(C2S.READY, { ready: true });
    await ticks(host, 3);
    host.send(C2S.START, {});
    await ticks(host, 5 * 20 + 2);
    expect(host.state.phase).toBe("playing");
    const sim = simOf(host);
    const p1 = sim.players.get(g1.sessionId)!;
    sim.pve!.hurtPlayer(g1.sessionId, 999, null, p1.sim.x, p1.sim.y);
    await ticks(host, 2);
    expect(p1.pve.downed).toBe(true);

    // The downed guest leaves and comes back as a "new" player.
    rooms.splice(rooms.indexOf(g1), 1);
    await g1.leave();
    await ticks(host, 5);
    const g2 = await join(host, 3);
    let gstate: MatchState | null = null;
    g2.onStateChange((st) => {
      gstate = st;
    });
    await ticks(host, 20 * 3);
    const p2 = sim.players.get(g2.sessionId)!;
    expect(p2.alive).toBe(false);
    expect((gstate as MatchState | null)?.players.get(g2.sessionId)?.alive).toBe(false);

    // The host goes down too: nobody stands, the run fails, back to the lobby.
    const hp = sim.players.get(host.sessionId)!;
    hp.protectedUntil = 0;
    sim.pve!.hurtPlayer(host.sessionId, 999, null, hp.sim.x, hp.sim.y);
    await ticks(host, 20 * 3);
    expect(host.state.phase).toBe("results");
    expect(host.state.players.get(host.sessionId)?.downed).toBe(true);
    await ticks(host, 15 * 20);
    expect(host.state.phase).toBe("lobby");

    // Deathmatch next: no stale downed flag reaches the guest's prediction.
    host.send(C2S.SETTINGS, { mode: "deathmatch" });
    g2.send(C2S.READY, { ready: true });
    await ticks(host, 3);
    host.send(C2S.START, {});
    await ticks(host, 5 * 20 + 5);
    expect(host.state.phase).toBe("playing");
    expect(sim.pve).toBeNull();
    const g = gstate as MatchState | null;
    expect(g?.players.get(host.sessionId)?.downed).toBe(false);
    expect(g?.players.get(g2.sessionId)?.downed).toBe(false);
  }, 40_000);
});
