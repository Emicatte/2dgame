import {
  C2S,
  disguiseByName,
  HIDE_SEEK,
  MATCH_DEFAULTS,
  NET,
  type NetEvent,
  PROP_HUNT,
  ROLE,
  S2C,
} from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { PropHuntMode } from "../../server/src/modes/PropHunt.ts";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID } from "../src/p2p/wire.ts";

/**
 * Host mode is what production runs: the arena creator's browser hosts the match. These tests
 * drive the real HostRoom and a real guest PeerRoom over an in-memory link, so what the guest
 * decodes is exactly what a WebRTC guest would receive.
 */
const flush = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const sec = (s: number) => Math.round(s * NET.serverTickRate);
const HOST = {
  name: "Hosty",
  level: 3,
  skin: "foundry",
  primary: "rifle" as const,
  profileId: "host-profile-1",
};
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

async function arena(map: "depot" | "industrial") {
  const host = new HostRoom({ code: "PARTY", map, host: HOST, headless: true });
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
  return { host, guest };
}

async function ticks(host: HostRoom, n: number) {
  for (let i = 0; i < n; i++) {
    host.tick();
    if (i % 5 === 0) await flush(1);
  }
  await flush(5);
}

async function start(host: HostRoom, guest: PeerRoom, settings: Record<string, unknown>) {
  host.send(C2S.SETTINGS, settings);
  await ticks(host, 2);
  guest.send(C2S.READY, { ready: true });
  await ticks(host, 2);
  host.send(C2S.START, {});
  await ticks(host, sec(MATCH_DEFAULTS.countdownSec) + 2);
}

describe("host mode: party modes", () => {
  it("Gun Game: both clients start on the ladder; no practice bots with a guest; the guest sees its level", async () => {
    const { host, guest } = await arena("industrial");
    await start(host, guest, { mode: "gungame" });
    expect(host.state.phase).toBe("playing");
    expect(host.state.mode).toBe("gungame");
    expect([...guest.state.players.keys()].some((id) => id.startsWith("bot:"))).toBe(false);
    const me = guest.state.players.get(guest.sessionId)!;
    expect(me.gg).toBe(0);
    // The guest's own (owner-only) weapon slot is the ladder's first weapon: the pistol.
    expect(me.w0).toBe(0);
  });

  it("Hide & Seek: a seeking guest never receives the hidden host's position, events or ghost", async () => {
    const { host, guest } = await arena("depot");
    // Seekers rotate in join order; the host joined first. Put the guest first so it seeks.
    const sim = host.debugSim()!;
    const hp = sim.players.get(host.sessionId)!;
    sim.players.delete(host.sessionId);
    sim.players.set(host.sessionId, hp);
    const events: NetEvent[] = [];
    guest.onMessage(S2C.EVENTS, (m) => events.push(...(m as NetEvent[])));
    await start(host, guest, { mode: "hideseek" });
    expect(guest.state.players.get(guest.sessionId)!.role).toBe(ROLE.SEEKER);
    expect(guest.state.players.get(host.sessionId)!.role).toBe(ROLE.HIDER);
    // The seeker is frozen in the pen during the hiding time.
    expect(guest.state.players.get(guest.sessionId)!.frozen).toBe(true);
    expect(guest.state.round.stage).toBe("prep");
    const hostP = sim.players.get(host.sessionId)!;
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      hostP.sim.x = 150 + i * 3;
      hostP.sim.y = 330;
      await ticks(host, 1);
      seen.add(Math.round(guest.state.players.get(host.sessionId)!.x));
      expect(guest.state.allies.size).toBe(0);
    }
    expect(seen.size).toBe(1);
    expect(guest.state.players.get(host.sessionId)!.masked).toBe(true);
    expect(events.some((e) => (e.t === "spawn" || e.t === "dash") && e.p === host.sessionId)).toBe(false);
    // The host's own tab has its ghost (it runs the simulation).
    expect(host.state.allies.has(host.sessionId)).toBe(true);
    await ticks(host, sec(HIDE_SEEK.prepSec));
    expect(guest.state.round.stage).toBe("hunt");
    expect(guest.state.players.get(guest.sessionId)!.frozen).toBe(false);
  });

  it("Prop Hunt: abilities travel as messages; the hunting guest gets the objects only when the hunt starts", async () => {
    const { host, guest } = await arena("depot");
    const sim = host.debugSim()!;
    const hp = sim.players.get(host.sessionId)!;
    sim.players.delete(host.sessionId);
    sim.players.set(host.sessionId, hp);
    await start(host, guest, { mode: "prophunt" });
    const ctl = sim.ctl as PropHuntMode;
    expect(ctl.sideOf(guest.sessionId)).toBe(ROLE.SEEKER);
    expect(guest.state.disguises.size).toBe(0);
    const hostP = sim.players.get(host.sessionId)!;
    hostP.sim.x = 1000;
    hostP.sim.y = 650;
    host.send(C2S.ABILITY, { a: "transform", k: disguiseByName("barrel")!.index });
    await ticks(host, 2);
    expect(ctl.kindOf(hostP)?.kind).toBe("barrel");
    expect(guest.state.disguises.size).toBe(0);
    // A guest cannot use prop abilities as a hunter (ignored, not an error).
    guest.send(C2S.ABILITY, { a: "taunt" });
    await ticks(host, sec(PROP_HUNT.prepSec) + 2);
    expect(guest.state.round.stage).toBe("hunt");
    expect(guest.state.disguises.size).toBe(ctl.objects.size);
    expect(guest.state.allies.size).toBe(0);
  });

  it("round modes refuse to start alone", async () => {
    const host = new HostRoom({ code: "SOLO1", map: "depot", host: HOST, headless: true });
    rooms.push(host);
    const notices: string[] = [];
    host.onMessage(S2C.NOTICE, (m) => notices.push((m as { text: string }).text));
    host.send(C2S.SETTINGS, { mode: "prophunt" });
    host.tick();
    // No practice bots in a round mode.
    expect([...host.state.players.keys()].some((id) => id.startsWith("bot:"))).toBe(false);
    host.send(C2S.START, {});
    host.tick();
    expect(host.state.phase).toBe("lobby");
    expect(notices.some((t) => /at least 2/.test(t))).toBe(true);
  });
});
