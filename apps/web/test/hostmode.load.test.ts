import {
  ARENA_SCALE,
  BTN,
  C2S,
  encodeInput,
  type InputFrame,
  MAPS,
  type MatchState,
  quantizeInput,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID } from "../src/p2p/wire.ts";

/**
 * Host-mode load: the host's browser runs the whole match. 4v4 Vehicle Mayhem on Urban Warfare,
 * every player starting next to a vehicle and most of them driving, the rest shooting, for 20 s of
 * real time. Measured: the host's tick cost (simulation + state encoding for 7 guests) and the
 * download per guest. Reported, with generous bounds as regression guards.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

// Alpha: beside the car, APC and rover of the west street; Bravo: their mirrors; one walker each.
const V = MAPS.urban.vehicleSpawns!;
const beside = (v: (typeof V)[number]) => ({ x: v.x + (v.x < MAPS.urban.width / 2 ? 48 : -48), y: v.y });
const SPAWNS = [
  ...V.slice(0, 3).map(beside),
  { x: 300 * ARENA_SCALE, y: 1050 * ARENA_SCALE },
  ...V.slice(3, 6).map(beside),
  { x: 3284 * ARENA_SCALE, y: 1510 * ARENA_SCALE },
];

describe("host mode under load (8 players, 6 vehicles)", () => {
  it("keeps the host tick cheap and the per-guest download bounded", async () => {
    const host = new HostRoom({
      code: "LOADT",
      map: "urban",
      host: { name: "Host", level: 1, skin: "foundry", primary: "rifle", profileId: "host-load-0" },
      headless: true,
      debug: { spawns: SPAWNS },
    });
    rooms.push(host);
    const tickMs: number[] = [];
    const tick = host.tick.bind(host);
    host.tick = (elapsed?: number) => {
      const t0 = performance.now();
      tick(elapsed);
      tickMs.push(performance.now() - t0);
    };
    host.start();
    host.send(C2S.SETTINGS, { mode: "mayhem", teamSize: 4 });
    const bytes: number[] = [];
    const guests: PeerRoom[] = [];
    for (let i = 0; i < 7; i++) {
      const slot = i;
      bytes.push(0);
      const g = await PeerRoom.join(
        async () => {
          const [gl, hl] = memoryLinkPair(20);
          const send = hl.send.bind(hl);
          hl.send = (d) => {
            bytes[slot]! += typeof d === "string" ? d.length : d.byteLength;
            send(d);
          };
          host.acceptLink(hl);
          return gl;
        },
        {
          build: BUILD_ID,
          name: `G${i}`,
          level: 1,
          skin: "foundry",
          primary: "rifle",
          profileId: `guest-load-${i}`,
        },
      );
      rooms.push(g);
      guests.push(g);
      g.send(C2S.READY, { ready: true });
    }
    await sleep(300);
    host.send(C2S.START, {});
    const seqs = new Map<string, number>();
    let clock = 0;
    const all: { send(t: string, m: unknown): void; sessionId: string; state: MatchState | null }[] = [
      host as unknown as { send(t: string, m: unknown): void; sessionId: string; state: MatchState },
      ...guests.map(
        (g) => g as unknown as { send(t: string, m: unknown): void; sessionId: string; state: MatchState },
      ),
    ];
    const loop = setInterval(() => {
      clock++;
      all.forEach((r, i) => {
        const frames: InputFrame[] = [];
        for (let k = 0; k < 3; k++) {
          const s = (seqs.get(r.sessionId) ?? 0) + 1;
          seqs.set(r.sessionId, s);
          const t = clock * 3 + k;
          const driver = i % 4 !== 3;
          frames.push(
            quantizeInput({
              seq: s,
              // Drivers: E early, then throttle with weaving; the others strafe and shoot.
              mx: driver ? (Math.floor(t / 70) % 3) - 1 : Math.floor(t / 40) % 2 ? 1 : -1,
              my: driver ? (Math.floor(t / 200) % 4 === 3 ? 1 : -1) : 0,
              aim: ((t / 30) % (2 * Math.PI)) - Math.PI,
              // Drivers press E (one frame every half second) until they are seated.
              buttons:
                (driver && !r.state?.players.get(r.sessionId)?.vehicle && t % 30 === 0 ? BTN.INTERACT : 0) |
                (!driver && t % 20 < 10 ? BTN.FIRE : 0),
              slot: -1,
              viewTick: Math.max(0, (r.state?.tick ?? 0) - 2),
            }),
          );
        }
        r.send(C2S.INPUT, { i: frames.map(encodeInput) });
      });
    }, SERVER_TICK_MS);
    try {
      const until = performance.now() + 15_000;
      while (host.state.phase !== "playing" && performance.now() < until) await sleep(50);
      expect(host.state.phase).toBe("playing");
      tickMs.length = 0;
      bytes.fill(0);
      const t0 = performance.now();
      await sleep(20_000);
      const secs = (performance.now() - t0) / 1000;
      const sorted = [...tickMs].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
      const avg = tickMs.reduce((a, b) => a + b, 0) / Math.max(1, tickMs.length);
      const kbps = bytes.map((b) => b / 1024 / secs);
      const seated = [...host.state.players.values()].filter((ps) => ps.vehicle !== "").length;
      let moved = 0;
      host.state.vehicles.forEach((v) => {
        if (v.vx !== 0 || v.vy !== 0 || v.status !== 0) moved++;
      });
      console.log(
        `[host load] ticks ${tickMs.length} in ${secs.toFixed(1)} s, tick avg ${avg.toFixed(2)} ms p95 ${p(0.95).toFixed(2)} ms ` +
          `p99 ${p(0.99).toFixed(2)} ms max ${p(1).toFixed(2)} ms; seated ${seated}/8, vehicles active ${moved}; ` +
          `download per guest avg ${(kbps.reduce((a, b) => a + b, 0) / kbps.length).toFixed(1)} KB/s max ${Math.max(...kbps).toFixed(1)} KB/s`,
      );
      expect(seated).toBeGreaterThanOrEqual(4);
      expect(avg).toBeLessThan(8);
      expect(p(0.99)).toBeLessThan(25);
      expect(Math.max(...kbps)).toBeLessThan(48);
    } finally {
      clearInterval(loop);
    }
  }, 60_000);
});
