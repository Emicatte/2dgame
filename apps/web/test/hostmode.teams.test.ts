import { C2S, encodeInput, type ResultsMessage, S2C } from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID, CLOSE } from "../src/p2p/wire.ts";

/** Team Deathmatch in host mode: the same rules module as the dedicated server, over peer links. */
const flush = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const HOST = {
  name: "Hosty",
  level: 9,
  skin: "foundry",
  primary: "rifle" as const,
  profileId: "host-profile-1",
};
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

function makeHost() {
  const host = new HostRoom({ code: "TEAMS", map: "industrial", host: HOST, headless: true });
  rooms.push(host);
  return host;
}

async function ticks(host: HostRoom, n: number) {
  for (let i = 0; i < n; i++) {
    host.tick();
    await flush(1);
  }
  await flush();
}

async function join(host: HostRoom, n: number, team?: 1 | 2, level = 2) {
  const pending = PeerRoom.join(
    async () => {
      const [g, h] = memoryLinkPair();
      host.acceptLink(h);
      return g;
    },
    {
      build: BUILD_ID,
      name: `Guest${n}`,
      level,
      skin: "foundry",
      primary: "smg",
      profileId: `guest-profile-${n}`,
      ...(team ? { team } : {}),
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

describe("host mode: Team Deathmatch", () => {
  it("host switches to TDM 2v2: guests get teams, a friend joins the host's team, the fifth is refused", async () => {
    const host = makeHost();
    host.send(C2S.SETTINGS, { mode: "tdm" });
    await ticks(host, 1);
    expect(host.state.mode).toBe("tdm");
    expect(host.state.maxPlayers).toBe(4);
    const hostTeam = host.state.players.get(host.sessionId)!.team as 1 | 2;
    expect([1, 2]).toContain(hostTeam);

    const friend = await join(host, 1, hostTeam);
    const g2 = await join(host, 2);
    const g3 = await join(host, 3);
    await ticks(host, 3);
    const teamOf = (id: string) => g3.state.players.get(id)!.team;
    expect(teamOf(friend.sessionId)).toBe(hostTeam);
    expect(teamOf(g2.sessionId)).not.toBe(hostTeam);
    expect(teamOf(g3.sessionId)).not.toBe(hostTeam);
    expect(g3.state.teamSize).toBe(2);
    await expect(join(host, 4)).rejects.toMatchObject({ code: CLOSE.ROOM_FULL });

    // A guest cannot switch into a full team, nor change settings or rebalance.
    g2.send(C2S.TEAM, { team: hostTeam });
    g2.send(C2S.SETTINGS, { teamSize: 4 });
    g2.send(C2S.BALANCE, {});
    await ticks(host, 2);
    expect(teamOf(g2.sessionId)).not.toBe(hostTeam);
    expect(host.state.teamSize).toBe(2);
  });

  it("plays a team match: team scores sync, results carry the winning team", async () => {
    const host = makeHost();
    host.send(C2S.SETTINGS, { mode: "tdm" });
    host.send(C2S.SETTINGS, { durationSec: 120, teamSize: 1 });
    await ticks(host, 1);
    const g = await join(host, 1);
    const results: ResultsMessage[] = [];
    g.onMessage(S2C.RESULTS, (m) => results.push(m as ResultsMessage));
    g.send(C2S.READY, { ready: true });
    await ticks(host, 2);
    host.send(C2S.START, {});
    await ticks(host, 5 * 20 + 2);
    expect(g.state.phase).toBe("playing");
    // Nobody scores in 120 s: a draw. The guest sends an idle input now and then, otherwise the
    // host removes it as inactive (AFK limit 120 s, countdown included).
    let seq = 0;
    for (let t = 0; t < 120 * 20 + 5; t++) {
      if (t % 100 === 0)
        g.send(C2S.INPUT, {
          i: [
            encodeInput({
              seq: ++seq,
              mx: 0,
              my: 0,
              aim: 0,
              buttons: 0,
              slot: -1,
              viewTick: host.state.tick,
            }),
          ],
        });
      host.tick();
      if (t % 20 === 0) await flush(1);
    }
    await flush(10);
    expect(g.state.phase).toBe("results");
    expect(results).toHaveLength(1);
    expect(results[0]!.winnerTeam).toBe(0);
    expect(results[0]!.teamScores).toEqual([0, 0]);
    expect(results[0]!.rows.every((r) => r.team === 1 || r.team === 2)).toBe(true);
  }, 30_000);
});
