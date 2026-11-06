import {
  BTN,
  C2S,
  collisionWorldFor,
  encodeInput,
  hashString,
  type InputFrame,
  MAPS,
  type MatchState,
  NET,
  type NetEvent,
  quantizeInput,
  S2C,
  SERVER_TICK_MS,
  STEP_DT,
} from "@scrapline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ServerClock } from "../src/game/net/clock.ts";
import { NetMetrics } from "../src/game/net/metrics.ts";
import { Predictor } from "../src/game/net/Predictor.ts";
import { HostRoom } from "../src/p2p/HostRoom.ts";
import { memoryLinkPair } from "../src/p2p/link.ts";
import { PeerRoom } from "../src/p2p/PeerRoom.ts";
import { BUILD_ID } from "../src/p2p/wire.ts";

/**
 * Host-mode netcode in real time: the host's 20 Hz loop runs on timers, the guest runs the real
 * client netcode (Predictor, ServerClock, NetMetrics, stall guard) at 60 Hz, and the link adds
 * 60 ms each way (120 ms RTT). Same acceptance criteria as the dedicated-server netaudit matrix.
 */
const STEP_MS = STEP_DT * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

describe("host mode netcode (120 ms RTT, real time)", () => {
  it("bounded pending inputs, exact convergence, predicted shots = host shots", async () => {
    const ONE_WAY = 60;
    const host = new HostRoom({
      code: "NETCD",
      map: "industrial",
      host: { name: "Host", level: 1, skin: "foundry", primary: "rifle", profileId: "host-prof-1" },
      headless: true,
    });
    rooms.push(host);
    host.start();
    const guest = await PeerRoom.join(
      async () => {
        const [g, h] = memoryLinkPair(ONE_WAY);
        host.acceptLink(h);
        return g;
      },
      {
        build: BUILD_ID,
        name: "Guest",
        level: 1,
        skin: "foundry",
        primary: "rifle",
        profileId: "guest-prof-1",
      },
    );
    rooms.push(guest);

    const predictor = new Predictor(collisionWorldFor(MAPS.industrial), hashString(guest.sessionId));
    let metrics = new NetMetrics();
    const clock = new ServerClock();
    let alive = false;
    let state: MatchState | null = null;
    let predictedShots = 0;
    let transitionCorrections = 0;
    let serverShots = 0;
    // Shots are compared by input sequence after the warm-up: a shot predicted just before the
    // counters reset can reach the host (and come back as an event) just after it, which made a
    // plain count differ by one now and then without any disagreement between the two sides.
    let countFromSeq = Number.POSITIVE_INFINITY;
    guest.onStateChange((s) => {
      state = s;
      if (s.phase !== "countdown" && s.phase !== "playing") return;
      clock.onSnapshot(s.tick);
      const me = s.players.get(guest.sessionId);
      if (!me) return;
      alive = me.alive && s.phase === "playing";
      predictor.reconcile(me, alive);
      metrics.onPatch(me.ack, predictor.pendingCount, performance.now());
    });
    guest.onMessage(S2C.EVENTS, (m) => {
      for (const e of m as NetEvent[])
        if (e.t === "shot" && e.p === guest.sessionId && e.s > countFromSeq) serverShots++;
    });

    guest.send(C2S.READY, { ready: true });
    await sleep(300);
    host.send(C2S.START, {});

    // The guest's frame loop (mirrors ArenaScene.update and the netaudit bot).
    let step = 0;
    let acc = 0;
    let last = performance.now();
    let generating = true;
    const outbox: InputFrame[] = [];
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 250);
      last = now;
      const phase = (state as MatchState | null)?.phase;
      if (!(phase === "countdown" || phase === "playing") || !clock.ready) return;
      const stalled = metrics.updateStall(now, predictor.pendingCount, NET.inputStallMs, dt);
      if (generating && !stalled) {
        acc += dt;
        while (acc >= STEP_MS) {
          acc -= STEP_MS;
          const k = step++;
          const seg = Math.floor(k / 40) % 10;
          const a = (seg * Math.PI) / 4;
          const f = quantizeInput({
            seq: predictor.nextSeq(),
            mx: seg < 8 ? Math.round(Math.cos(a)) : 0,
            my: seg < 8 ? Math.round(Math.sin(a)) : 0,
            aim: 0.3,
            buttons: (k % 120 < 18 ? BTN.FIRE : 0) | (k % 150 === 75 ? BTN.DASH : 0),
            slot: -1,
            viewTick: Math.max(0, clock.renderTick()),
          });
          predictor.predict(f, alive, (e) => {
            if (e.kind === "shot" && e.shot.seq > countFromSeq) predictedShots++;
          });
          outbox.push(f);
          metrics.generated++;
        }
      } else {
        acc = 0;
      }
      while (outbox.length > 0) {
        const batch = outbox.splice(0, NET.maxInputsPerMessage).map(encodeInput);
        guest.send(C2S.INPUT, { i: batch });
        metrics.sent += batch.length;
        metrics.messages++;
      }
      metrics.onFrame(now);
    };
    const loop = setInterval(frame, 1000 / 60);
    try {
      // Countdown (5 s) plus 5 s of play.
      const until = performance.now() + 15_000;
      while ((state as MatchState | null)?.phase !== "playing" && performance.now() < until) await sleep(50);
      expect((state as MatchState | null)?.phase).toBe("playing");
      // Warm-up, as in the netaudit matrix: the countdown → match transition is excluded (inputs
      // predicted as frozen during the countdown may be applied live by the host: one small
      // correction at match start, also on the dedicated server).
      await sleep(1000);
      transitionCorrections = predictor.stats.corrections;
      metrics = new NetMetrics();
      predictor.resetStats();
      predictedShots = 0;
      serverShots = 0;
      countFromSeq = predictor.lastSeq;
      await sleep(5000);
      generating = false;
      // Settle: every input acknowledged, prediction equals the host's authoritative state.
      const settleBy = performance.now() + 3000;
      const me = () => (state as MatchState | null)?.players.get(guest.sessionId);
      while (me()?.ack !== predictor.lastSeq && performance.now() < settleBy) await sleep(20);
      await sleep(4 * SERVER_TICK_MS + 2 * ONE_WAY);
    } finally {
      clearInterval(loop);
    }
    const snap = metrics.snapshot(performance.now(), predictor);
    const bound = Math.ceil((2 * ONE_WAY + 2 * SERVER_TICK_MS + 2 * (1000 / 60)) / STEP_MS) + 2;
    const auth = host.state.players.get(guest.sessionId)!;
    console.log(
      `[hostmode netcode] generated ${snap.generated} acked ${snap.acked} pending p95/max ${snap.pendingP95}/${snap.pendingMaxEver} (bound ${bound}) ` +
        `corrections ${snap.corrections} (snaps ${snap.snaps}, max ${snap.correctionMax}px) staleAcks ${snap.staleAcks} ` +
        `shots predicted/host ${predictedShots}/${serverShots} stalls ${snap.stallEvents} (match-start corrections ${transitionCorrections})`,
    );
    expect(snap.generated).toBeGreaterThan(250);
    expect(transitionCorrections).toBeLessThanOrEqual(1);
    expect(auth.ack).toBe(predictor.lastSeq);
    expect(Math.abs(predictor.sim.x - auth.x)).toBeLessThan(0.01);
    expect(Math.abs(predictor.sim.y - auth.y)).toBeLessThan(0.01);
    expect(snap.pendingMaxEver).toBeLessThanOrEqual(bound);
    expect(snap.staleAcks).toBe(0);
    expect(snap.corrections - snap.snaps).toBe(0);
    expect(snap.stallEvents).toBe(0);
    expect(predictedShots).toBe(serverShots);
    expect(serverShots).toBeGreaterThan(0);
  }, 40_000);
});
