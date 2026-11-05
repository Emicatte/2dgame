import { BTN, C2S, encodeInput, type NetEvent, type ResultsMessage, S2C } from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { breakLink, memoryLinkPair, type PeerLink } from "../src/p2p/link.ts";
import { JoinError, PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID, CLOSE } from "../src/p2p/wire.ts";

const flush = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const HOST = {
  name: "Hosty",
  level: 3,
  skin: "foundry",
  primary: "rifle" as const,
  profileId: "host-profile-1",
};
const guestHello = (n: number) => ({
  build: BUILD_ID,
  name: `Guest${n}`,
  level: 2,
  skin: "foundry",
  primary: "smg" as const,
  profileId: `guest-profile-${n}`,
});

const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

function makeHost(): HostRoom {
  const host = new HostRoom({ code: "ABCDE", map: "industrial", host: HOST, headless: true });
  rooms.push(host);
  return host;
}

/** A connector that hands the host one end of a fresh memory pipe each time. */
function connector(host: HostRoom, links: PeerLink[] = []) {
  return async () => {
    const [guestEnd, hostEnd] = memoryLinkPair();
    host.acceptLink(hostEnd);
    links.push(guestEnd);
    return guestEnd;
  };
}

/** Joins while the host ticks (the first full state goes out at the end of a tick). */
async function join(host: HostRoom, n: number, links: PeerLink[] = [], resume?: string): Promise<PeerRoom> {
  const pending = PeerRoom.join(connector(host, links), guestHello(n), resume);
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

async function ticks(host: HostRoom, n: number) {
  for (let i = 0; i < n; i++) {
    host.tick();
    await flush(1);
  }
  await flush();
}

describe("host mode: browser-hosted room", () => {
  it("a guest joins and sees the same lobby; owner-only fields reach only their owner", async () => {
    const host = makeHost();
    // Alone in the lobby, the host gets three practice targets (as on the dedicated server).
    expect(host.state.players.size).toBe(4);
    const guest = await join(host, 1);
    await ticks(host, 3);

    expect(guest.roomId).toBe("ABCDE");
    expect(guest.state.code).toBe("ABCDE");
    expect(guest.state.phase).toBe("lobby");
    expect(guest.state.hostId).toBe(host.sessionId);
    // Targets leave as soon as a second human is present.
    expect([...guest.state.players.keys()].sort()).toEqual([guest.sessionId, host.sessionId].sort());
    expect(guest.state.players.get(host.sessionId)?.name).toBe("Hosty");
    expect(guest.state.players.get(guest.sessionId)?.name).toBe("Guest1");
    // Owner-only reconciliation fields: present for yourself, absent for others.
    expect(guest.state.players.get(guest.sessionId)?.ack).toBe(0);
    expect(guest.state.players.get(host.sessionId)?.ack).toBeUndefined();
    expect(guest.state.players.get(host.sessionId)?.vx).toBeUndefined();
    // The host's own view (authoritative state) sees the guest.
    expect(host.state.players.get(guest.sessionId)?.connected).toBe(true);
    expect(guest.state.tick).toBe(host.state.tick);
  });

  it("plays a match: ready, start, countdown, inputs move the guest, results reach both players", async () => {
    const host = makeHost();
    const guest = await join(host, 1);
    const hostResults: ResultsMessage[] = [];
    const guestResults: ResultsMessage[] = [];
    const guestEvents: NetEvent[][] = [];
    host.onMessage(S2C.RESULTS, (m) => hostResults.push(m as ResultsMessage));
    guest.onMessage(S2C.RESULTS, (m) => guestResults.push(m as ResultsMessage));
    guest.onMessage(S2C.EVENTS, (m) => guestEvents.push(m as NetEvent[]));

    // Host cannot start before the guest is ready.
    host.send(C2S.START, {});
    await ticks(host, 1);
    expect(host.state.phase).toBe("lobby");
    host.send(C2S.SETTINGS, { durationSec: 120, killLimit: 5 });
    guest.send(C2S.READY, { ready: true });
    await ticks(host, 2);
    expect(guest.state.players.get(guest.sessionId)?.ready).toBe(true);
    expect(guest.state.durationSec).toBe(120);
    // A guest cannot change settings or start.
    guest.send(C2S.SETTINGS, { durationSec: 600 });
    guest.send(C2S.START, {});
    await ticks(host, 1);
    expect(host.state.durationSec).toBe(120);
    expect(host.state.phase).toBe("lobby");

    host.send(C2S.START, {});
    await ticks(host, 1);
    expect(guest.state.phase).toBe("countdown");
    // Countdown (5 s) then the match.
    await ticks(host, 5 * 20 + 2);
    expect(guest.state.phase).toBe("playing");
    expect(guest.state.players.get(guest.sessionId)?.alive).toBe(true);

    // Walk right for one second, firing: 3 frames per tick at 60 Hz input.
    const before = host.state.players.get(guest.sessionId)!.x;
    let seq = 0;
    for (let t = 0; t < 20; t++) {
      const frames = [0, 1, 2].map(() =>
        encodeInput({
          seq: ++seq,
          mx: 1,
          my: 0,
          aim: 0,
          buttons: t % 2 === 0 ? BTN.FIRE : 0,
          slot: -1,
          viewTick: host.state.tick,
        }),
      );
      guest.send(C2S.INPUT, { i: frames });
      await flush(1);
      host.tick();
    }
    await ticks(host, 3);
    const me = guest.state.players.get(guest.sessionId)!;
    expect(me.x).toBeGreaterThan(before + 20);
    expect(me.ack).toBe(seq);
    // Gameplay events (the guest's own shots) reach the guest.
    expect(guestEvents.flat().some((e) => e.t === "shot" && e.p === guest.sessionId)).toBe(true);

    // Run the clock out (120 s) and check results.
    await ticks(host, 120 * 20 + 5);
    expect(guest.state.phase).toBe("results");
    expect(hostResults).toHaveLength(1);
    expect(guestResults).toHaveLength(1);
    const g = guestResults[0]!;
    expect(g.rows.map((r) => r.id).sort()).toEqual([guest.sessionId, host.sessionId].sort());
    expect(g.personal?.record).toBeDefined();
    expect(g.personal?.persisted).toBe(false);
    expect(g.personal?.xpGained).toBeGreaterThan(0);
    // Each player gets their own personal result.
    expect(hostResults[0]!.personal?.placement).not.toBeUndefined();
  }, 30_000);

  it("a dropped guest keeps the seat and takes it back on reconnect", async () => {
    const host = makeHost();
    const links: PeerLink[] = [];
    const guest = await join(host, 1, links);
    const id = guest.sessionId;
    let dropped = 0;
    let reconnected = 0;
    guest.onDrop(() => dropped++);
    guest.onReconnect(() => reconnected++);

    breakLink(links[0]!);
    // The host holds the seat (disconnected) ...
    expect(host.state.players.get(id)?.connected).toBe(false);
    await flush(20);
    expect(dropped).toBe(1);

    // The guest retries through the connector; keep ticking so the full state goes out.
    for (let i = 0; i < 40 && reconnected === 0; i++) await ticks(host, 1);
    expect(reconnected).toBe(1);
    expect(guest.sessionId).toBe(id);
    expect(host.state.players.get(id)?.connected).toBe(true);
    expect(host.state.players.size).toBe(2);
    await ticks(host, 2);
    expect(guest.state.players.get(id)?.connected).toBe(true);
  });

  it("a page reload rejoins the held seat with the stored token", async () => {
    const host = makeHost();
    const links: PeerLink[] = [];
    const first = await join(host, 1, links);
    const token = first.reconnectionToken;
    breakLink(links[0]!);
    // The old tab is gone: stop its retries.
    await first.leave();
    await ticks(host, 1);
    const second = await join(host, 1, [], token);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("refuses a second seat for the same profile, a different build, and a full room", async () => {
    const host = makeHost();
    await join(host, 1);
    await expect(join(host, 1)).rejects.toMatchObject({ code: CLOSE.DUPLICATE });

    const [g, h] = memoryLinkPair();
    host.acceptLink(h);
    const wrongBuild = PeerRoom.join(async () => g, { ...guestHello(9), build: "other-build" });
    await expect(wrongBuild).rejects.toBeInstanceOf(JoinError);
    await expect(wrongBuild).rejects.toMatchObject({ code: CLOSE.VERSION });

    host.send(C2S.SETTINGS, { maxPlayers: 2 });
    await ticks(host, 1);
    await expect(join(host, 2)).rejects.toMatchObject({ code: CLOSE.ROOM_FULL });
  });

  it("removes a guest that sends malformed or unknown messages; host can kick", async () => {
    const host = makeHost();
    const bad = await join(host, 1);
    const left: number[] = [];
    bad.onLeave((c) => left.push(c));
    bad.send(C2S.INPUT, { i: "not frames" });
    await ticks(host, 2);
    expect(left).toEqual([CLOSE.PROTOCOL]);
    expect(host.state.players.has(bad.sessionId)).toBe(false);

    const other = await join(host, 2);
    const kicked: number[] = [];
    other.onLeave((c) => kicked.push(c));
    host.send(C2S.KICK, { id: other.sessionId });
    await ticks(host, 2);
    expect(kicked).toEqual([CLOSE.KICKED]);
  });

  it("guests learn when the host closes the arena", async () => {
    const host = makeHost();
    const guest = await join(host, 1);
    const left: number[] = [];
    guest.onLeave((c) => left.push(c));
    await host.leave();
    await flush(20);
    expect(left).toEqual([CLOSE.HOST_CLOSED]);
  });

  it("measures round-trip time to the host", async () => {
    const host = makeHost();
    const guest = await join(host, 1);
    const rtt = await new Promise<number>((resolve) => guest.ping(resolve));
    expect(rtt).toBeGreaterThanOrEqual(0);
    expect(rtt).toBeLessThan(1000);
  });
});
