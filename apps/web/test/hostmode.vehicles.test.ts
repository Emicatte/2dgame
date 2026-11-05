import {
  airWorldFor,
  BTN,
  C2S,
  collisionWorldFor,
  encodeInput,
  hashString,
  type InputFrame,
  MAPS,
  type MatchState,
  NET,
  quantizeInput,
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
 * Vehicle prediction in real time over a 120 ms RTT link: the guest enters a car and drives a
 * scripted course (throttle, braking, reversing, steering, handbrake drifts, a wall contact) with
 * the real client netcode; the host's simulation is authoritative. Measured: corrections while
 * driving, convergence of the predicted car to the host's car once every input is acknowledged.
 */
const STEP_MS = STEP_DT * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms: { leave(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) await r.leave();
});

describe("host mode vehicle netcode (120 ms RTT, real time)", () => {
  it("the guest drives a car: no mispredictions, exact convergence", async () => {
    const ONE_WAY = 60;
    const host = new HostRoom({
      code: "VEHCL",
      map: "urban",
      host: { name: "Host", level: 1, skin: "foundry", primary: "rifle", profileId: "host-prof-v" },
      headless: true,
      debug: {
        spawns: [
          { x: 700, y: 1230 },
          { x: 700, y: 1330 },
        ],
        vehicles: [{ kind: "car", x: 700, y: 1280, angle: 0 }],
      },
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
        profileId: "guest-prof-v",
      },
    );
    rooms.push(guest);

    const predictor = new Predictor(
      collisionWorldFor(MAPS.urban),
      hashString(guest.sessionId),
      airWorldFor(MAPS.urban),
    );
    let metrics = new NetMetrics();
    const clock = new ServerClock();
    let alive = false;
    let state: MatchState | null = null;
    guest.onStateChange((s) => {
      state = s;
      if (s.phase !== "countdown" && s.phase !== "playing") return;
      clock.onSnapshot(s.tick);
      const me = s.players.get(guest.sessionId);
      if (!me) return;
      alive = me.alive && s.phase === "playing";
      predictor.reconcile(me, alive, me.vehicle ? s.vehicles.get(me.vehicle) : undefined);
      metrics.onPatch(me.ack, predictor.pendingCount, performance.now());
    });
    guest.send(C2S.READY, { ready: true });
    await sleep(300);
    host.send(C2S.START, {});

    // Course: segments of 45 steps (0.75 s).
    const course: Partial<InputFrame>[] = [
      { my: -1 },
      { my: -1, mx: 1 },
      { my: -1 },
      { my: -1, mx: -1 },
      { my: -1, mx: -1, buttons: BTN.DASH },
      { my: 1 },
      { my: 1, mx: 1 },
      {},
      { my: -1, mx: 1 },
      { my: -1 },
    ];
    let step = 0;
    let acc = 0;
    let last = performance.now();
    let mode: "idle" | "enter" | "drive" | "stop" = "idle";
    const outbox: InputFrame[] = [];
    const frame = () => {
      const now = performance.now();
      const dt = Math.min(now - last, 250);
      last = now;
      const phase = (state as MatchState | null)?.phase;
      if (!(phase === "countdown" || phase === "playing") || !clock.ready) return;
      const stalled = metrics.updateStall(now, predictor.pendingCount, NET.inputStallMs, dt);
      if (!stalled && mode !== "stop") {
        acc += dt;
        while (acc >= STEP_MS) {
          acc -= STEP_MS;
          let f: Partial<InputFrame> = {};
          if (mode === "enter") f = { buttons: step % 20 < 3 ? BTN.INTERACT : 0 };
          if (mode === "drive") f = course[Math.floor(step / 45) % course.length]!;
          step++;
          const q = quantizeInput({
            seq: predictor.nextSeq(),
            mx: 0,
            my: 0,
            aim: 0,
            buttons: 0,
            slot: -1,
            viewTick: Math.max(0, clock.renderTick()),
            ...f,
          });
          predictor.predict(q, alive, () => undefined);
          outbox.push(q);
          metrics.generated++;
        }
      } else {
        acc = 0;
      }
      while (outbox.length > 0) {
        guest.send(C2S.INPUT, { i: outbox.splice(0, NET.maxInputsPerMessage).map(encodeInput) });
      }
      metrics.onFrame(now);
    };
    const loop = setInterval(frame, 1000 / 60);
    const me = () => (state as MatchState | null)?.players.get(guest.sessionId);
    try {
      const until = performance.now() + 15_000;
      while ((state as MatchState | null)?.phase !== "playing" && performance.now() < until) await sleep(50);
      await sleep(800);
      mode = "enter";
      const enterBy = performance.now() + 3000;
      while (me()?.vehicle !== "dbg-0" && performance.now() < enterBy) await sleep(20);
      expect(me()?.vehicle).toBe("dbg-0");
      expect(me()?.seat).toBe(0);
      mode = "idle";
      await sleep(500);
      metrics = new NetMetrics();
      predictor.resetStats();
      step = 0;
      mode = "drive";
      await sleep(course.length * 750);
      mode = "stop";
      const settleBy = performance.now() + 3000;
      while (me()?.ack !== predictor.lastSeq && performance.now() < settleBy) await sleep(20);
      await sleep(4 * SERVER_TICK_MS + 2 * ONE_WAY);
    } finally {
      clearInterval(loop);
    }
    const snap = metrics.snapshot(performance.now(), predictor);
    const car = host.state.vehicles.get("dbg-0")!;
    const v = predictor.vehicle!;
    const travelled = Math.hypot(car.x - 700, car.y - 1280);
    console.log(
      `[hostmode vehicles] generated ${snap.generated} pending max ${snap.pendingMaxEver} corrections ${snap.corrections} ` +
        `(snaps ${snap.snaps}, max ${snap.correctionMax}px) car at ${car.x.toFixed(1)},${car.y.toFixed(1)} hp ${car.hp} ` +
        `predicted ${v.x.toFixed(1)},${v.y.toFixed(1)} travelled ${travelled.toFixed(0)}px`,
    );
    expect(travelled).toBeGreaterThan(300);
    expect(me()?.ack).toBe(predictor.lastSeq);
    expect(Math.abs(v.x - car.x)).toBeLessThan(0.01);
    expect(Math.abs(v.y - car.y)).toBeLessThan(0.01);
    expect(Math.abs(v.angle - car.angle)).toBeLessThan(1e-4);
    expect(snap.snaps).toBe(0);
    expect(snap.corrections).toBe(0);
  }, 40_000);
});
