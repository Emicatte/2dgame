import {
  BTN,
  collisionWorldFor,
  createPlayerSim,
  type InputFrame,
  MAPS,
  type PlayerState,
  quantizeInput,
  SERVER_TICK_MS,
  stepPlayer,
  toF32,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { ServerClock } from "../src/game/net/clock.ts";
import { SnapshotBuffer } from "../src/game/net/interpolation.ts";
import { Predictor } from "../src/game/net/Predictor.ts";

const world = collisionWorldFor(MAPS.industrial);

function sample(x: number, y: number, alive = true) {
  return { x, y, aim: 0, alive, weapon: 1, hp: 100, protected: false, reloading: false };
}

describe("SnapshotBuffer (remote interpolation)", () => {
  it("blends between the two snapshots around the render time", () => {
    const b = new SnapshotBuffer();
    b.push(10, new Map([["p", sample(0, 0)]]));
    b.push(11, new Map([["p", sample(100, 50)]]));
    expect(b.sample("p", 10.25)).toMatchObject({ x: 25, y: 12.5 });
    expect(b.sample("p", 10)).toMatchObject({ x: 0, y: 0 });
  });

  it("holds the newest state instead of extrapolating past it", () => {
    const b = new SnapshotBuffer();
    b.push(1, new Map([["p", sample(0, 0)]]));
    b.push(2, new Map([["p", sample(10, 0)]]));
    expect(b.sample("p", 5)).toMatchObject({ x: 10 });
  });

  it("does not slide across respawns (teleports and life state changes)", () => {
    const b = new SnapshotBuffer();
    b.push(1, new Map([["p", sample(0, 0)]]));
    b.push(2, new Map([["p", sample(1000, 0)]]));
    const mid = b.sample("p", 1.25)!;
    expect(mid.x === 0 || mid.x === 1000).toBe(true);
    b.push(3, new Map([["p", sample(1000, 0, false)]]));
    expect(b.sample("p", 2.2)?.alive).toBe(true);
    expect(b.sample("p", 2.8)?.alive).toBe(false);
  });

  it("ignores out-of-order snapshots", () => {
    const b = new SnapshotBuffer();
    b.push(5, new Map([["p", sample(50, 0)]]));
    b.push(4, new Map([["p", sample(40, 0)]]));
    expect(b.newestTick).toBe(5);
  });
});

describe("ServerClock", () => {
  it("tracks the server timeline and renders behind it", () => {
    const c = new ServerClock(20);
    // Snapshots arrive every 50ms with variable delay (jitter).
    const delays = [10, 40, 15, 60, 12, 30];
    delays.forEach((d, i) => {
      c.onSnapshot(100 + i, 1000 + i * SERVER_TICK_MS + d);
    });
    const now = 1000 + 6 * SERVER_TICK_MS + 10;
    // The least-delayed packet defines the offset: estimate within one tick of the truth.
    expect(Math.abs(c.serverTick(now) - 106)).toBeLessThan(1);
    expect(c.renderTick(now)).toBeLessThan(c.serverTick(now));
    expect(c.jitterMs()).toBeGreaterThan(0);
  });
});

function frames(n: number, f: Partial<InputFrame>, start: number): InputFrame[] {
  return Array.from({ length: n }, (_, i) =>
    quantizeInput({ seq: start + i, mx: 0, my: 0, aim: 0.3, buttons: 0, slot: -1, viewTick: 0, ...f }),
  );
}

/** Builds the owner view of PlayerState the server would send for a given authoritative sim. */
function serverView(sim: ReturnType<typeof createPlayerSim>, ack: number): PlayerState {
  return {
    x: toF32(sim.x),
    y: toF32(sim.y),
    vx: toF32(sim.vx),
    vy: toF32(sim.vy),
    aim: toF32(sim.aim),
    dash: sim.dash,
    dashCd: sim.dashCd,
    dashDx: toF32(sim.dashDx),
    dashDy: toF32(sim.dashDy),
    dashHeld: sim.dashHeld,
    slot: sim.slot,
    w0: sim.slots[0]!.id,
    m0: sim.slots[0]!.mag,
    r0: sim.slots[0]!.reserve,
    w1: sim.slots[1]!.id,
    m1: sim.slots[1]!.mag,
    r1: sim.slots[1]!.reserve,
    w2: sim.slots[2]!.id,
    m2: sim.slots[2]!.mag,
    r2: sim.slots[2]!.reserve,
    cooldown: sim.cooldown,
    reload: sim.reload,
    swap: sim.swap,
    bloom: toF32(sim.bloom),
    trigger: sim.trigger,
    ack,
  } as unknown as PlayerState;
}

describe("Predictor (client prediction + reconciliation)", () => {
  it("converges to the authoritative result with no visible correction", () => {
    const seed = 99;
    const server = createPlayerSim(1300, 1180, "rifle");
    const p = new Predictor(world, seed);
    p.sim = createPlayerSim(1300, 1180, "rifle");
    const all = [
      ...frames(30, { mx: 1, buttons: BTN.FIRE }, 1),
      ...frames(20, { my: -1, buttons: BTN.DASH }, 31),
      ...frames(25, { mx: -1, my: 1 }, 51),
    ];
    for (const f of all) p.predict(f, true, () => {});
    // Server processed the first 40 inputs; 35 are still in flight.
    for (const f of all.slice(0, 40)) stepPlayer(server, f, { world, seed, alive: true });
    const predictedX = p.sim.x;
    p.reconcile(serverView(server, 40), true);
    expect(p.pendingCount).toBe(35);
    expect(Math.abs(p.sim.x - predictedX)).toBeLessThan(0.05);
    expect(p.lastCorrection).toBeLessThan(0.05);
  });

  it("corrects towards the server when it disagrees (e.g. a server-side pickup or hit)", () => {
    const p = new Predictor(world, 1);
    p.sim = createPlayerSim(1300, 1180, "rifle");
    for (const f of frames(10, { mx: 1 }, 1)) p.predict(f, true, () => {});
    const server = createPlayerSim(1300, 1100, "rifle"); // server says we are elsewhere
    p.reconcile(serverView(server, 10), true);
    expect(p.sim.y).toBeCloseTo(1100, 3);
    // Small corrections are blended visually rather than snapped.
    expect(Math.hypot(p.offsetX, p.offsetY)).toBeGreaterThan(0);
    p.decay(1);
    expect(Math.hypot(p.offsetX, p.offsetY)).toBeLessThan(0.01);
  });

  it("ignores stale acknowledgements", () => {
    const p = new Predictor(world, 1);
    p.sim = createPlayerSim(1300, 1180, "rifle");
    for (const f of frames(10, { mx: 1 }, 1)) p.predict(f, true, () => {});
    const server = createPlayerSim(1300, 1180, "rifle");
    p.reconcile(serverView(server, 8), true);
    const x = p.sim.x;
    p.reconcile(serverView(createPlayerSim(0, 0, "rifle"), 5), true);
    expect(p.sim.x).toBe(x);
  });
});
