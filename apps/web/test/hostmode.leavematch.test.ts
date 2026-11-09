import { C2S, MATCH_DEFAULTS, NET } from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID } from "../src/p2p/wire.ts";

/** "Leave match" leaves the running match only: the player stays in the arena (and team). */
const flush = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const sec = (s: number) => Math.round(s * NET.serverTickRate);
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

async function ticks(host: HostRoom, n: number) {
  for (let i = 0; i < n; i++) {
    host.tick();
    if (i % 5 === 0) await flush(1);
  }
  await flush(5);
}

async function arenaWithGuest() {
  const host = new HostRoom({
    code: "LEAVE",
    map: "industrial",
    host: { name: "Hosty", level: 3, skin: "foundry", primary: "rifle", profileId: "host-profile-1" },
    headless: true,
  });
  rooms.push(host);
  const pending = PeerRoom.join(
    async () => {
      const [g, h] = memoryLinkPair();
      host.acceptLink(h);
      return g;
    },
    {
      build: BUILD_ID,
      name: "Guesty",
      level: 2,
      skin: "foundry",
      primary: "smg",
      profileId: "guest-profile-1",
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
  const guest = await pending;
  rooms.push(guest);
  guest.send(C2S.READY, { ready: true });
  await ticks(host, 2);
  host.send(C2S.START, {});
  await ticks(host, sec(MATCH_DEFAULTS.countdownSec) + 2);
  return { host, guest };
}

describe("host mode: leave match vs leave arena", () => {
  it("the guest leaves the match but stays in the arena; back in at the next match", async () => {
    const { host, guest } = await arenaWithGuest();
    const sim = host.debugSim()!;
    expect(host.state.phase).toBe("playing");
    guest.send(C2S.LEAVE_MATCH, {});
    await ticks(host, sec(5));
    // Still in the room (state and simulation), out of the match, no death counted, no respawn.
    expect(host.state.players.has(guest.sessionId)).toBe(true);
    const gp = sim.players.get(guest.sessionId)!;
    expect(gp.away).toBe(true);
    expect(gp.alive).toBe(false);
    expect(gp.stats.deaths).toBe(0);
    expect(guest.state.players.get(guest.sessionId)?.away).toBe(true);
    // The host keeps playing: the match goes on.
    expect(host.state.phase).toBe("playing");
    // Next match: back in.
    (host as unknown as { endMatch(r: string): void }).endMatch("time");
    (host as unknown as { backToLobby(): void }).backToLobby();
    guest.send(C2S.READY, { ready: true });
    await ticks(host, 2);
    host.send(C2S.START, {});
    await ticks(host, sec(MATCH_DEFAULTS.countdownSec) + 2);
    expect(gp.away).toBe(false);
    expect(gp.alive).toBe(true);
  });

  it("when nobody is left playing, the match ends instead of running empty", async () => {
    const { host, guest } = await arenaWithGuest();
    guest.send(C2S.LEAVE_MATCH, {});
    host.send(C2S.LEAVE_MATCH, {});
    await ticks(host, 3);
    expect(host.state.phase).toBe("results");
    expect(host.state.players.size).toBe(2);
  });
});
