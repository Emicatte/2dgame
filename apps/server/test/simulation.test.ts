import {
  BTN,
  type InputFrame,
  MAPS,
  NET,
  PLAYER,
  quantizeInput,
  SERVER_TICK_MS,
  secToSteps,
  WEAPONS,
} from "@scrapline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

/** Open area of Industrial Arena used to stage duels without walls in between. */
const ARENA_Y = 1180;

function makeSim() {
  let r = 0.5;
  return new GameSimulation(MAPS.industrial, {
    tickRate: NET.serverTickRate,
    rng: () => (r = (r * 9301 + 49297) % 1),
  });
}

function addPlayer(
  sim: GameSimulation,
  id: string,
  primary: "rifle" | "sniper" | "shotgun" = "rifle",
): ServerPlayer {
  return sim.addPlayer({
    id,
    playerId: `00000000-0000-0000-0000-00000000000${id.length}`,
    name: id,
    skin: "foundry",
    level: 1,
    primary,
    seed: id.length * 97,
  });
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
  p.protectedUntil = 0;
}

const seqs = new Map<string, number>();
function frames(id: string, n: number, f: Partial<InputFrame>, viewTick = 0): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

/** Runs ticks until every queued input is consumed. */
function drain(sim: GameSimulation, maxTicks = 200) {
  const events = [];
  for (let i = 0; i < maxTicks; i++) {
    events.push(...sim.step(SERVER_TICK_MS, "live"));
    if ([...sim.players.values()].every((p) => p.queue.length === 0)) break;
  }
  return events;
}

describe("GameSimulation", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    seqs.clear();
  });

  it("processes inputs in order, acks the last one and drops duplicates", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    const batch = frames("a", 5, { mx: 1 });
    expect(sim.enqueue("a", batch).accepted).toBe(5);
    expect(sim.enqueue("a", batch).dropped).toBe(5);
    drain(sim);
    expect(a.lastProcessedSeq).toBe(5);
    expect(a.sim.x).toBeGreaterThan(1300);
  });

  it("never processes more inputs than real time allows (speed hack protection)", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    sim.enqueue("a", frames("a", NET.maxQueuedInputs + 10, { mx: 1 }));
    expect(a.queue.length).toBe(NET.maxQueuedInputs);
    // A full queue evicts its oldest frames: the newest intent is kept.
    expect(a.inputStats.overflow).toBe(10);
    expect(a.queue[0]!.seq).toBe(11);
    sim.step(SERVER_TICK_MS, "live");
    // One 50ms tick at 60 inputs/s permits three inputs.
    expect(a.inputStats.processed).toBe(3);
  });

  it("a flooding client never exceeds real time plus the bounded bank over any window", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    // Idle long enough to fill the bank, then send twice the legal rate for 5 seconds.
    for (let i = 0; i < 100; i++) sim.step(SERVER_TICK_MS, "live");
    const ticks = 100;
    for (let i = 0; i < ticks; i++) {
      sim.enqueue("a", frames("a", 6, { mx: 1 }));
      sim.step(SERVER_TICK_MS, "live");
    }
    const realTime = (ticks * SERVER_TICK_MS * NET.inputRate) / 1000;
    expect(a.inputStats.processed).toBeLessThanOrEqual(realTime + NET.maxInputCreditSeconds * NET.inputRate);
  });

  it("does not let a client bank more idle time than the cap, nor spend it in one tick", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    // Ten seconds without inputs, then a burst of 60.
    for (let i = 0; i < 200; i++) sim.step(SERVER_TICK_MS, "live");
    sim.enqueue("a", frames("a", 60, { mx: 1 }));
    sim.step(SERVER_TICK_MS, "live");
    // The backlog is consumed at most inputCatchUpRate times faster than real time.
    expect(a.inputStats.processed).toBe(3 * NET.inputCatchUpRate);
    let ticks = 1;
    while (a.queue.length > 0 && ticks < 100) {
      sim.step(SERVER_TICK_MS, "live");
      ticks++;
    }
    // In total no more than the bank plus real time was consumed.
    expect(a.inputStats.processed).toBeLessThanOrEqual(
      NET.maxInputCreditSeconds * NET.inputRate + (ticks * SERVER_TICK_MS * NET.inputRate) / 1000,
    );
  });

  it("applies the inputs that piled up during a network stall without a standing backlog", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    // Client sends 60/s; the uplink stalls for 0.7 s (14 ticks), then everything arrives at once.
    let seqSent = 0;
    const send = (n: number) => {
      sim.enqueue("a", frames("a", n, { mx: 1 }));
      seqSent += n;
    };
    for (let i = 0; i < 20; i++) {
      send(3);
      sim.step(SERVER_TICK_MS, "live");
    }
    for (let i = 0; i < 14; i++) sim.step(SERVER_TICK_MS, "live");
    send(42);
    for (let i = 0; i < 40; i++) {
      send(3);
      sim.step(SERVER_TICK_MS, "live");
    }
    // Every input was applied (none trimmed or evicted) and the queue is back to steady state.
    expect(a.inputStats.trimmed + a.inputStats.overflow).toBe(0);
    expect(a.queue.length).toBeLessThanOrEqual(3);
    expect(a.lastProcessedSeq).toBeGreaterThanOrEqual(seqSent - 3);
  });

  it("trims a standing backlog that real-time consumption can never drain", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    // A 50-frame backlog arrives while the bank is empty, then the client keeps sending 60/s.
    sim.enqueue("a", frames("a", 50, { mx: 1 }));
    for (let i = 0; i < 60; i++) {
      sim.enqueue("a", frames("a", 3, { mx: 1 }));
      sim.step(SERVER_TICK_MS, "live");
    }
    expect(a.inputStats.trimmed).toBeGreaterThan(0);
    expect(a.queue.length).toBeLessThanOrEqual(NET.standingQueueFrames + 3);
  });

  it("keeps a weapon switch that was inside trimmed or evicted frames", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    const burst = frames("a", NET.maxQueuedInputs + 5, {});
    burst[2] = { ...burst[2]!, slot: 1 };
    sim.enqueue("a", burst);
    expect(a.queue[0]!.slot).toBe(1);
  });

  it("catches up after a server stall instead of building a permanent backlog", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    sim.enqueue("a", frames("a", 50, { mx: 1 }));
    // One delayed tick of 800 ms: all 48 inputs that real time allows are processed.
    sim.step(800, "live");
    expect(a.lastProcessedSeq).toBe(48);
  });

  it("applies damage on the server and kills, then respawns with protection", () => {
    const a = addPlayer(sim, "a", "sniper");
    const b = addPlayer(sim, "b");
    place(a, 1000, ARENA_Y);
    place(b, 1300, ARENA_Y);
    sim.step(SERVER_TICK_MS, "live");
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE, aim: 0 }, sim.tick));
    const events = drain(sim);
    const hit = events.find((e) => e.t === "hit");
    expect(hit).toMatchObject({ p: "a", v: "b", dmg: WEAPONS.sniper.damage });
    expect(b.hp).toBe(PLAYER.maxHealth - WEAPONS.sniper.damage);

    // Second sniper shot after the cooldown is lethal
    const idle = frames("a", secToSteps(60 / WEAPONS.sniper.rpm), {}, sim.tick);
    for (let i = 0; i < idle.length; i += 20) {
      sim.enqueue("a", idle.slice(i, i + 20));
      drain(sim);
    }
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE }, sim.tick));
    const ev2 = drain(sim);
    expect(ev2.some((e) => e.t === "kill" && e.k === "a" && e.v === "b" && e.fb)).toBe(true);
    expect(b.alive).toBe(false);
    expect(a.stats.kills).toBe(1);
    expect(b.stats.deaths).toBe(1);

    for (let i = 0; i < sim.secToTicks(PLAYER.respawnSeconds) + 1; i++) sim.step(SERVER_TICK_MS, "live");
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(PLAYER.maxHealth);
    expect(b.protectedUntil).toBeGreaterThan(sim.tick);
  });

  it("does not damage players under spawn protection", () => {
    const a = addPlayer(sim, "a", "sniper");
    const b = addPlayer(sim, "b");
    place(a, 1000, ARENA_Y);
    place(b, 1300, ARENA_Y);
    b.protectedUntil = sim.tick + 100;
    sim.step(SERVER_TICK_MS, "live");
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE }, sim.tick));
    drain(sim);
    expect(b.hp).toBe(PLAYER.maxHealth);
  });

  it("walls block shots", () => {
    const a = addPlayer(sim, "a", "sniper");
    const b = addPlayer(sim, "b");
    // The wall at x 608..640 spans y 448..704 on Industrial Arena
    place(a, 560, 600);
    place(b, 700, 600);
    sim.step(SERVER_TICK_MS, "live");
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE }, sim.tick));
    const events = drain(sim);
    expect(events.some((e) => e.t === "hit")).toBe(false);
    expect(b.hp).toBe(PLAYER.maxHealth);
  });

  it("lag compensation hits where the shooter saw the target", () => {
    const a = addPlayer(sim, "a", "sniper");
    const b = addPlayer(sim, "b");
    place(a, 1000, ARENA_Y);
    place(b, 1300, ARENA_Y);
    sim.step(SERVER_TICK_MS, "live");
    const seenTick = sim.tick;
    // Target moves out of the line of fire on the server...
    b.sim.y = ARENA_Y + 120;
    sim.step(SERVER_TICK_MS, "live");
    sim.step(SERVER_TICK_MS, "live");
    // ...but the shooter fired at what they were rendering two ticks ago.
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE, aim: 0 }, seenTick));
    const events = drain(sim);
    expect(events.some((e) => e.t === "hit" && e.v === "b")).toBe(true);
  });

  it("caps how far back a client can rewind", () => {
    const a = addPlayer(sim, "a", "sniper");
    const b = addPlayer(sim, "b");
    place(a, 1000, ARENA_Y);
    place(b, 1300, ARENA_Y);
    sim.step(SERVER_TICK_MS, "live");
    const oldTick = sim.tick;
    b.sim.y = ARENA_Y + 200;
    for (let i = 0; i < sim.maxRewindTicks + 5; i++) sim.step(SERVER_TICK_MS, "live");
    sim.enqueue("a", frames("a", 1, { buttons: BTN.FIRE }, oldTick));
    const events = drain(sim);
    expect(events.some((e) => e.t === "hit")).toBe(false);
  });

  it("chooses spawns away from living enemies and never on top of them", () => {
    const a = addPlayer(sim, "a");
    const b = addPlayer(sim, "b");
    const s0 = MAPS.industrial.spawns[0]!;
    place(a, s0.x, s0.y);
    const pos = sim.chooseSpawn("b");
    expect(Math.hypot(pos.x - s0.x, pos.y - s0.y)).toBeGreaterThan(800);
    sim.spawn(b, false);
    expect(Math.hypot(b.sim.x - a.sim.x, b.sim.y - a.sim.y)).toBeGreaterThan(PLAYER.radius * 3);
  });

  it("weapon pickups require the interact key; health pickups heal on touch", () => {
    const a = addPlayer(sim, "a");
    const shotgun = MAPS.industrial.pickups.find((p) => p.kind === "weapon" && p.weapon === "shotgun")!;
    place(a, shotgun.x, shotgun.y);
    sim.step(SERVER_TICK_MS, "live");
    expect(sim.pickups.get(shotgun.id)!.active).toBe(true);
    sim.enqueue("a", frames("a", 1, { buttons: BTN.INTERACT }, sim.tick));
    drain(sim);
    expect(sim.pickups.get(shotgun.id)!.active).toBe(false);
    expect(a.sim.slots[2]!.id).toBe(WEAPONS.shotgun.index);

    const health = MAPS.industrial.pickups.find((p) => p.kind === "health")!;
    place(a, health.x, health.y);
    a.hp = 20;
    sim.step(SERVER_TICK_MS, "live");
    expect(a.hp).toBe(70);
    expect(sim.pickups.get(health.id)!.active).toBe(false);
  });

  it("frozen mode (countdown) acks inputs but blocks movement and firing", () => {
    const a = addPlayer(sim, "a");
    place(a, 1300, ARENA_Y);
    sim.enqueue("a", frames("a", 3, { mx: 1, buttons: BTN.FIRE }, 0));
    sim.step(SERVER_TICK_MS, "frozen");
    expect(a.lastProcessedSeq).toBe(3);
    expect(a.sim.x).toBe(1300);
    expect(a.sim.slots[0]!.mag).toBe(WEAPONS.rifle.magSize);
  });

  it("ranks by kills, then deaths", () => {
    const a = addPlayer(sim, "a");
    const b = addPlayer(sim, "b");
    const c = addPlayer(sim, "c");
    a.stats.kills = 3;
    a.stats.deaths = 5;
    b.stats.kills = 3;
    b.stats.deaths = 1;
    c.stats.kills = 7;
    expect(sim.standings().map((p) => p.id)).toEqual(["c", "b", "a"]);
  });
});
