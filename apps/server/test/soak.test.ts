import {
  BTN,
  bodyFits,
  collisionWorldFor,
  type InputFrame,
  isFreeSpot,
  MAPS,
  MatchState,
  mulberry32,
  NET,
  PLAYER,
  quantizeInput,
  SERVER_TICK_MS,
  VEHICLES,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, VEHICLE_GONE } from "../src/simulation/GameSimulation.ts";

/**
 * Soak: ten simulated minutes of 4v4 Vehicle Mayhem and of Capture the Flag with pseudo-random
 * players who walk, shoot, enter, drive, change seats and leave vehicles, disconnect and come
 * back. After every tick the invariants must hold; step cost and bounded memory are reported.
 */
function soak(mode: "mayhem" | "ctf", map: "urban" | "mountain", minutes: number) {
  const sim = new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng: mulberry32(7) });
  const state = new MatchState();
  const rules = new MatchRules(sim, state, () => false);
  rules.setMode(mode);
  rules.setTeamSize(4);
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
  for (const [i, id] of ids.entries()) {
    sim.addPlayer({
      id,
      playerId: `pid-${id}`,
      name: id,
      skin: "foundry",
      level: 1 + i,
      primary: "rifle",
      seed: i * 31,
    });
    rules.assign(id);
  }
  // Everybody starts around the middle, where the vehicles are brought too: constant contact.
  const cx = MAPS[map].width / 2;
  const cy = MAPS[map].height / 2;
  sim.spawnOverride = [
    { x: cx - 420, y: cy - 260 },
    { x: cx - 420, y: cy + 260 },
    { x: cx - 520, y: cy },
    { x: cx - 300, y: cy + 380 },
    { x: cx + 420, y: cy + 260 },
    { x: cx + 420, y: cy - 260 },
    { x: cx + 520, y: cy },
    { x: cx + 300, y: cy - 380 },
  ].filter((p) => isFreeSpot(collisionWorldFor(MAPS[map]), p));
  const fleet = [
    { id: "s-car", kind: "car" as const, x: cx - 250, y: cy, angle: 0 },
    { id: "s-apc", kind: "armored" as const, x: cx + 250, y: cy, angle: Math.PI },
    { id: "s-rover", kind: "offroad" as const, x: cx, y: cy - 320, angle: Math.PI / 2 },
    { id: "s-heli", kind: "heli" as const, x: cx, y: cy + 340, angle: 0 },
    { id: "s-car2", kind: "car" as const, x: cx - 650, y: cy + 120, angle: 0 },
  ].filter((v) => bodyFits(collisionWorldFor(MAPS[map]), v, VEHICLES[v.kind]));
  sim.setVehicleOverride(fleet);
  rules.prepareMatch();
  sim.resetForMatch();
  const rand = mulberry32(99);
  const seq = new Map<string, number>();
  const plan = new Map<string, { mx: number; my: number; aim: number; buttons: number; until: number }>();
  const world = collisionWorldFor(MAPS[map]);
  const ticks = minutes * 60 * NET.serverTickRate;
  const stepMs: number[] = [];
  let events = 0;
  let vehicleTicks = 0;
  let maxEvents = 0;
  for (let t = 0; t < ticks; t++) {
    for (const id of ids) {
      const p = sim.players.get(id)!;
      // Disconnect / reconnect now and then (seat must be released at once).
      if (rand() < 0.0005) p.connected = !p.connected;
      if (!p.connected) continue;
      let cur = plan.get(id);
      if (!cur || cur.until <= t) {
        const r = rand();
        // Head for the nearest enemy (or a vehicle) most of the time, wander otherwise.
        let tx = p.sim.x;
        let ty = p.sim.y;
        let best = Number.POSITIVE_INFINITY;
        for (const o of sim.players.values()) {
          if (o.team === p.team || !o.alive) continue;
          const d = Math.hypot(o.sim.x - p.sim.x, o.sim.y - p.sim.y);
          if (d < best) {
            best = d;
            tx = o.sim.x;
            ty = o.sim.y;
          }
        }
        if (rand() < 0.3) {
          const v = [...sim.vehicles.values()][Math.floor(rand() * sim.vehicles.size)];
          if (v) {
            tx = v.sim.x;
            ty = v.sim.y;
          }
        }
        const chase = rand() < 0.7;
        const dx = tx - p.sim.x;
        const dy = ty - p.sim.y;
        cur = {
          mx: chase ? Math.sign(Math.round(dx / 60)) : Math.floor(rand() * 3) - 1,
          my: chase ? Math.sign(Math.round(dy / 60)) : Math.floor(rand() * 3) - 1,
          aim: Math.atan2(dy, dx) + (rand() - 0.5) * 0.3,
          buttons:
            (r < 0.15 ? BTN.INTERACT : 0) |
            (r > 0.5 ? BTN.FIRE : 0) |
            (rand() < 0.05 ? BTN.SEAT : 0) |
            (rand() < 0.08 ? BTN.DASH : 0),
          until: t + 2 + Math.floor(rand() * 40),
        };
        plan.set(id, cur);
      }
      const frames: InputFrame[] = [];
      for (let k = 0; k < 3; k++) {
        const s = (seq.get(id) ?? 0) + 1;
        seq.set(id, s);
        // Edge buttons only on the first frame of a plan step.
        const edge = k === 0 ? cur.buttons : cur.buttons & (BTN.FIRE | BTN.DASH);
        frames.push(
          quantizeInput({ seq: s, ...cur, buttons: edge, slot: -1, viewTick: Math.max(0, sim.tick - 2) }),
        );
      }
      sim.enqueue(id, frames);
    }
    const t0 = performance.now();
    const ev = sim.step(SERVER_TICK_MS, "live");
    stepMs.push(performance.now() - t0);
    events += ev.length;
    for (const p of sim.players.values()) if (p.vehicle) vehicleTicks++;
    maxEvents = Math.max(maxEvents, ev.length);

    // ---- invariants
    const seatOf = new Map<string, string>();
    for (const v of sim.vehicles.values()) {
      expect(Number.isFinite(v.sim.x) && Number.isFinite(v.sim.y) && Number.isFinite(v.sim.angle)).toBe(true);
      expect(v.sim.x).toBeGreaterThanOrEqual(0);
      expect(v.sim.y).toBeGreaterThanOrEqual(0);
      expect(v.sim.x).toBeLessThanOrEqual(world.width);
      expect(v.sim.y).toBeLessThanOrEqual(world.height);
      expect(v.hp).toBeGreaterThanOrEqual(0);
      if (v.status === VEHICLE_GONE) expect(v.seats.every((s) => s === null)).toBe(true);
      expect(v.contacts.size).toBeLessThan(200);
      v.seats.forEach((id, i) => {
        if (!id) return;
        expect(seatOf.has(id)).toBe(false); // nobody in two seats
        seatOf.set(id, `${v.id}#${i}`);
        const p = sim.players.get(id)!;
        expect(p.vehicle).toBe(v.id);
        expect(p.seat).toBe(i);
        expect(p.alive).toBe(true);
        expect(p.connected).toBe(true);
      });
    }
    for (const p of sim.players.values()) {
      expect(Number.isFinite(p.sim.x) && Number.isFinite(p.sim.y)).toBe(true);
      if (p.vehicle) expect(seatOf.get(p.id)).toBe(`${p.vehicle}#${p.seat}`);
      expect(p.hp).toBeGreaterThanOrEqual(0);
      expect(p.hp).toBeLessThanOrEqual(PLAYER.maxHealth);
    }
    if (mode === "ctf") {
      for (const f of sim.flags) {
        if (f.carrier) {
          const c = sim.players.get(f.carrier)!;
          expect(c.alive && !c.vehicle && c.team !== f.team).toBe(true);
        }
      }
    }
  }
  const sorted = [...stepMs].sort((a, b) => a - b);
  const kills = [...sim.players.values()].reduce((s, p) => s + p.stats.kills, 0);
  const wrecks = [...sim.players.values()].reduce((s, p) => s + p.stats.vehicleKills, 0);
  const seatedTicks = vehicleTicks;
  return {
    seatedTicks,
    fleet: fleet.length,
    avg: stepMs.reduce((a, b) => a + b, 0) / stepMs.length,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
    max: sorted.at(-1)!,
    events,
    maxEvents,
    kills,
    wrecks,
    scores: [sim.teamScores[1], sim.teamScores[2]],
  };
}

describe("soak (simulated time)", () => {
  it("10 minutes of 4v4 Vehicle Mayhem on Urban Warfare keep every invariant", () => {
    const r = soak("mayhem", "urban", 10);
    console.log(
      `[soak mayhem] step avg ${r.avg.toFixed(3)} ms p99 ${r.p99.toFixed(3)} ms max ${r.max.toFixed(2)} ms; events ${r.events} (max ${r.maxEvents}/tick); kills ${r.kills}, wrecks ${r.wrecks}, score ${r.scores.join(":")}; ${r.fleet} vehicles, player-ticks seated ${r.seatedTicks}`,
    );
    expect(r.avg).toBeLessThan(2);
    expect(r.kills).toBeGreaterThan(20);
    expect(r.seatedTicks).toBeGreaterThan(1000);
  }, 240_000);

  it("10 minutes of 4v4 Capture the Flag on Mountain Outpost keep every invariant", () => {
    const r = soak("ctf", "mountain", 10);
    console.log(
      `[soak ctf] step avg ${r.avg.toFixed(3)} ms p99 ${r.p99.toFixed(3)} ms max ${r.max.toFixed(2)} ms; events ${r.events}; kills ${r.kills}, score ${r.scores.join(":")}`,
    );
    expect(r.avg).toBeLessThan(2);
  }, 240_000);
});
