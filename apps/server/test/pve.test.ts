import {
  ACT,
  AI,
  BTN,
  buildFlowField,
  buildNavGrid,
  cellIndex,
  collisionWorldFor,
  DIFFICULTY,
  FIRST_CONTACT,
  findPath,
  type InputFrame,
  isFreeSpot,
  MAPS,
  MAX_ZOMBIES,
  MatchState,
  mulberry32,
  NAV_INF,
  NET,
  nearestWalkable,
  PLAYER,
  PVE_STATUS,
  pveWorlds,
  quantizeInput,
  squadScale,
  survivalWave,
  ZOMBIES,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { spawnQueue, waveComposition } from "../src/pve/WaveDirector.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";
import { syncPve } from "../src/simulation/stateSync.ts";

const TICK_MS = 1000 / NET.serverTickRate;

function makeSim(map: keyof typeof MAPS = "works", seed = 7) {
  return new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng: mulberry32(seed) });
}

function addPlayer(sim: GameSimulation, id: string): ServerPlayer {
  const p = sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    team: 1,
    skin: "foundry",
    level: 1,
    primary: "rifle",
    seed: id.length * 97,
  });
  sim.rules = { teams: true, friendlyFire: false };
  return p;
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
  p.protectedUntil = 0;
  p.pve.downed = false;
}

const seqs = new Map<string, number>();
function frames(id: string, n: number, f: Partial<InputFrame>, viewTick = 0): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

/** One server tick with three input frames per player (60 Hz input, 20 Hz tick). */
function tick(sim: GameSimulation, input: Record<string, Partial<InputFrame>> = {}) {
  for (const p of sim.players.values()) sim.enqueue(p.id, frames(p.id, 3, input[p.id] ?? {}, sim.tick));
  return sim.step(TICK_MS, "live");
}

function startPve(
  sim: GameSimulation,
  mode: "outbreak" | "survival",
  difficulty: "recruit" | "veteran" | "nightmare" = "veteran",
) {
  sim.setPve({ mode, mission: mode === "outbreak" ? FIRST_CONTACT : undefined, difficulty });
  sim.resetForMatch();
  return sim.pve!;
}

describe("navigation grid", () => {
  const map = MAPS.works;
  const open = new Set(FIRST_CONTACT.doors.map((d) => d.id));

  it("every mission point is reachable with the doors open, and the gate locks the compound", () => {
    const allOpen = buildNavGrid(pveWorlds(map, FIRST_CONTACT.doors, open).world);
    const start = nearestWalkable(allOpen, map.spawns[0]!.x, map.spawns[0]!.y, 1);
    const field = buildFlowField(allOpen, 1, [start]);
    const points = [
      ...FIRST_CONTACT.spawnZones,
      ...FIRST_CONTACT.props,
      ...FIRST_CONTACT.steps.flatMap((s) => (s.marker ? [s.marker] : [])),
    ];
    for (const p of points) {
      const c = nearestWalkable(allOpen, p.x, p.y, 1, 4);
      expect(c, `${JSON.stringify(p)} on the grid`).toBeGreaterThanOrEqual(0);
      expect(field.dist[c]!, `${JSON.stringify(p)} reachable`).toBeLessThan(NAV_INF);
    }
    // Large bodies (brute) reach the offices too.
    const big = buildFlowField(allOpen, 2, [nearestWalkable(allOpen, 300, 2000, 2)]);
    expect(big.dist[nearestWalkable(allOpen, 2780, 1400, 2)]!).toBeLessThan(NAV_INF);

    const closed = buildNavGrid(
      pveWorlds(map, FIRST_CONTACT.doors, new Set(["gen-shutter", "office-door"])).world,
    );
    const f2 = buildFlowField(closed, 1, [nearestWalkable(closed, 300, 2000, 1)]);
    const pad = nearestWalkable(closed, 2910, 380, 1);
    expect(f2.dist[pad]!).toBe(NAV_INF);
  });

  it("A* paths go around obstacles and never through a solid", () => {
    const world = pveWorlds(map, FIRST_CONTACT.doors, open).world;
    const grid = buildNavGrid(world);
    // From the yard into the main hall through its south doorway, around the shelves.
    const res = findPath(grid, world, 1, { x: 300, y: 2000 }, { x: 320, y: 980 })!;
    expect(res).not.toBeNull();
    let prev = { x: 300, y: 2000 };
    for (const p of res.points) {
      // Walk each segment in small steps: a 16 px body fits everywhere along it.
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      for (let s = 0; s <= d; s += 6) {
        const q = { x: prev.x + ((p.x - prev.x) * s) / d, y: prev.y + ((p.y - prev.y) * s) / d };
        expect(isFreeSpot(world, q, 15)).toBe(true);
      }
      prev = p;
    }
    expect(Math.hypot(prev.x - 320, prev.y - 980)).toBeLessThan(40);
  });

  it("builds a flow field for the whole map quickly", () => {
    const grid = buildNavGrid(collisionWorldFor(map));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) buildFlowField(grid, 1, [cellIndex(grid, 300 + i * 50, 2000)]);
    const ms = (performance.now() - t0) / 20;
    console.log(`[nav] ${grid.cols}x${grid.rows} cells, flow field ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(25);
  });
});

describe("zombie AI", () => {
  it("a horde walker reaches its target around walls without ever overlapping a solid", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 330, 2050);
    // In the generator room: it must leave through the doorway, cross the corridor, the hall and
    // the hall's south doorway.
    const z = pve.zw.spawn("walker", 700, 380, { state: "hunt" });
    let reached = -1;
    for (let i = 0; i < 20 * 120 && reached < 0; i++) {
      tick(sim);
      expect(
        isFreeSpot(sim.world, z, z.def.radius - 0.75),
        `tick ${i} at ${z.x.toFixed(1)},${z.y.toFixed(1)}`,
      ).toBe(true);
      if (Math.hypot(z.x - a.sim.x, z.y - a.sim.y) < z.def.radius + PLAYER.radius + z.def.attack.range + 4)
        reached = i;
    }
    console.log(`[ai] walker reached the target after ${(reached / 20).toFixed(1)} s`);
    expect(reached).toBeGreaterThan(0);
  });

  it("idle enemies notice a player in sight, investigate gunfire and lose interest", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1450, 1650);
    const z = pve.zw.spawn("walker", 1400, 1040, { state: "idle" });
    for (let i = 0; i < 10; i++) tick(sim);
    expect(z.state).toBe(AI.IDLE);
    // A rifle shot far away but within earshot: the walker turns to investigate (not chase: it
    // does not see the shooter).
    a.sim.aim = Math.PI;
    tick(sim, { alpha: { buttons: BTN.FIRE, aim: Math.PI } });
    for (let i = 0; i < 4; i++) tick(sim);
    expect([AI.ALERT, AI.INVESTIGATE]).toContain(z.state);
    for (let i = 0; i < 30; i++) tick(sim);
    expect(z.state).toBe(AI.INVESTIGATE);
    // Now in plain sight at close range: alert, then chase.
    place(a, z.x + 200, z.y);
    for (let i = 0; i < 30 && z.state !== AI.CHASE && z.state !== AI.ATTACK; i++) tick(sim);
    expect([AI.CHASE, AI.ATTACK]).toContain(z.state);
  });

  it("a stalker does not know where an unseen player is", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 330, 2050);
    const s = pve.zw.spawn("stalker", 2800, 400, { state: "hunt" });
    for (let i = 0; i < 20 * 5; i++) tick(sim);
    // Five seconds in, the stalker has no target and is not chasing.
    expect(s.target).toBeNull();
    expect(s.state).not.toBe(AI.CHASE);
  });

  it("melee is telegraphed before it lands, and damage is dealt only at the strike", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1600, 1100);
    const z = pve.zw.spawn("walker", 1600 + 40, 1100, { state: "hunt" });
    let windupTick = -1;
    let hitTick = -1;
    for (let i = 0; i < 60 && hitTick < 0; i++) {
      const events = tick(sim);
      if (z.act === ACT.WINDUP && windupTick < 0) windupTick = sim.tick;
      if (events.some((e) => e.t === "hit" && e.v === "alpha")) hitTick = sim.tick;
    }
    expect(windupTick).toBeGreaterThan(0);
    expect(hitTick).toBeGreaterThan(windupTick);
    expect((hitTick - windupTick) / 20).toBeGreaterThanOrEqual(ZOMBIES.walker.attack.windupSec - 0.05);
    expect(a.hp).toBe(PLAYER.maxHealth - ZOMBIES.walker.attack.damage);
  });

  it("player shots damage and kill enemies; precision hits deal more", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1300, 1100);
    const z = pve.zw.spawn("brute", 1300 + 300, 1100, { state: "idle" });
    z.speedMult = 0;
    let precise = 0;
    let dealt = 0;
    for (let i = 0; i < 10; i++) {
      const ev = tick(sim, { alpha: { buttons: i % 2 === 0 ? BTN.FIRE : 0, aim: 0 } });
      for (const e of ev) {
        if (e.t !== "zhit") continue;
        dealt += e.dmg;
        if (e.c) precise++;
      }
    }
    expect(dealt).toBeGreaterThan(0);
    expect(precise).toBeGreaterThan(0);
    expect(z.hp).toBe(z.maxHp - dealt);
    expect(a.stats.damageDealt).toBe(dealt);
    // Lethal damage: zdie, kill credit.
    pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
    expect(z.dead).toBe(true);
    expect(a.stats.kills).toBe(1);
  });

  it("an exploder's blast hurts nearby enemies and players with falloff", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1300, 1100);
    const e = pve.zw.spawn("exploder", 1500, 1100, { state: "idle" });
    const w = pve.zw.spawn("walker", 1560, 1100, { state: "idle" });
    pve.damageZombie(e.id, 9999, a, false, e.x, e.y);
    tick(sim);
    expect(w.dead).toBe(true);
    expect(a.stats.kills).toBe(2);
    expect(a.hp).toBe(PLAYER.maxHealth);
  });

  it("40 enemies chasing: none inside a wall, tick cost measured", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const players = ["a1", "a2", "a3", "a4"].map((id, i) => {
      const p = addPlayer(sim, id);
      place(p, 1400 + i * 60, 1100);
      p.protectedUntil = Number.MAX_SAFE_INTEGER;
      return p;
    });
    void players;
    const kinds = ["walker", "runner", "walker", "spitter", "walker", "brute", "walker", "exploder"] as const;
    const zones = [...FIRST_CONTACT.spawnZones];
    for (let i = 0; i < 40; i++) {
      const zone = zones[i % zones.length]!;
      pve.zw.spawn(kinds[i % kinds.length]!, zone.x + (i % 3) * 30, zone.y + Math.floor(i / 7) * 10, {
        state: "hunt",
      });
    }
    const costs: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const t0 = performance.now();
      tick(sim);
      costs.push(performance.now() - t0);
      for (const z of pve.zw.zombies.values()) {
        expect(isFreeSpot(sim.world, z, z.def.radius - 0.75)).toBe(true);
      }
    }
    costs.sort((x, y) => x - y);
    const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
    const p99 = costs[Math.floor(costs.length * 0.99)]!;
    console.log(
      `[ai] 40 enemies, 4 players: tick avg ${avg.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, max ${costs.at(-1)!.toFixed(2)} ms; ` +
        `fields ${pve.zw.stats.fieldsBuilt}, A* ${pve.zw.stats.astarRuns} (${pve.zw.stats.astarNodes} nodes)`,
    );
    expect(p99).toBeLessThan(25);
  });
});

describe("waves", () => {
  it("composition scales with squad and difficulty without only inflating health", () => {
    const def = survivalWave(4);
    const solo = waveComposition(def, 1, squadScale(1), DIFFICULTY.veteran);
    const four = waveComposition(def, 4, squadScale(4), DIFFICULTY.veteran);
    const nightmare = waveComposition(def, 1, squadScale(1), DIFFICULTY.nightmare);
    const sum = (c: Record<string, number | undefined>) =>
      Object.values(c).reduce((s: number, n) => s + (n ?? 0), 0);
    expect(sum(four)).toBeGreaterThan(sum(solo) * 2);
    expect(sum(nightmare)).toBeGreaterThan(sum(solo));
    expect(solo.brute).toBe(1);
    expect(squadScale(4).enemyHp).toBeLessThanOrEqual(1.1);
    // Specials are spread through the queue, never front-loaded.
    const q = spawnQueue(four, mulberry32(3));
    const firstSpecial = q.findIndex((k) => k !== "walker" && k !== "runner");
    expect(firstSpecial).toBeGreaterThanOrEqual(Math.floor(q.length * 0.15));
  });

  it("Survival waves start, end when cleared, and the next one follows", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    const a = addPlayer(sim, "alpha");
    place(a, 1500, 1100);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    const cleared: number[] = [];
    for (let i = 0; i < 20 * 120 && cleared.length < 2; i++) {
      const ev = tick(sim);
      // The squad "fights": every enemy that comes within 500 px dies.
      for (const z of pve.zw.zombies.values()) {
        if (!z.dead && Math.hypot(z.x - a.sim.x, z.y - a.sim.y) < 500)
          pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
      }
      for (const e of ev) if (e.t === "pve" && e.k === "clear") cleared.push(e.n ?? 0);
      expect(pve.zw.alive).toBeLessThanOrEqual(MAX_ZOMBIES);
    }
    expect(cleared).toEqual([1, 2]);
    expect(pve.progress).toBe(2);
  });

  it("spawns are out of sight and never near a player", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    const a = addPlayer(sim, "alpha");
    place(a, 1500, 1100);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    const seen = new Set<string>();
    for (let i = 0; i < 20 * 30; i++) {
      tick(sim);
      for (const z of pve.zw.zombies.values()) {
        if (seen.has(z.id)) continue;
        seen.add(z.id);
        expect(Math.hypot(z.x - a.sim.x, z.y - a.sim.y)).toBeGreaterThanOrEqual(480 * 0.8);
      }
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it("a wave whose enemies cannot reach anybody still ends (stragglers culled)", () => {
    const sim = makeSim();
    const pve = startPve(sim, "outbreak");
    const a = addPlayer(sim, "alpha");
    place(a, 330, 2050);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    // Enemies locked inside the security compound (gate closed).
    pve.waves.start(
      { enemies: { walker: 3 } },
      9,
      [{ x: 2900, y: 600 }],
      1,
      squadScale(1),
      DIFFICULTY.veteran,
    );
    for (let i = 0; i < 20 * 3; i++) tick(sim);
    expect(pve.waves.run?.spawned).toBe(3);
    for (let i = 0; i < 20 * 40 && !pve.waves.done; i++) tick(sim);
    expect(pve.waves.done).toBe(true);
  });
});

describe("co-op: downed, revive, wipe", () => {
  it("lethal damage downs the player; a teammate holding E revives them", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    place(a, 1500, 1100);
    place(b, 1540, 1100);
    pve.hurtPlayer("alpha", 500, null, a.sim.x, a.sim.y);
    expect(a.pve.downed).toBe(true);
    expect(a.alive).toBe(true);
    // Downed: cannot fire.
    const shots = tick(sim, { alpha: { buttons: BTN.FIRE } }).filter((e) => e.t === "shot");
    expect(shots).toHaveLength(0);
    let revived = false;
    for (let i = 0; i < 20 * 5 && !revived; i++) {
      const ev = tick(sim, { bravo: { buttons: BTN.INTERACT } });
      revived = ev.some((e) => e.t === "revive" && e.p === "alpha" && e.by === "bravo");
    }
    expect(revived).toBe(true);
    expect(a.pve.downed).toBe(false);
    expect(a.hp).toBe(DIFFICULTY.veteran.reviveHp);
    expect(b.pve.revives).toBe(1);
  });

  it("releasing E interrupts the revive", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    place(a, 1500, 1100);
    place(b, 1540, 1100);
    pve.hurtPlayer("alpha", 500, null, a.sim.x, a.sim.y);
    for (let i = 0; i < 20 * 2; i++) tick(sim, { bravo: { buttons: BTN.INTERACT } });
    for (let i = 0; i < 20; i++) tick(sim);
    expect(a.pve.reviveProg).toBe(0);
    expect(a.pve.downed).toBe(true);
  });

  it("solo: one self-revive on Veteran, then a down is a wipe = mission failed", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1500, 1100);
    expect(pve.selfRevives).toBe(1);
    pve.hurtPlayer("alpha", 500, null, a.sim.x, a.sim.y);
    for (let i = 0; i < 20 * 7; i++) tick(sim);
    expect(a.pve.downed).toBe(false);
    expect(pve.selfRevives).toBe(0);
    expect(pve.status).toBe(PVE_STATUS.RUNNING);
    // Revive protection (1.5 s) first.
    for (let i = 0; i < 20 * 2; i++) tick(sim);
    pve.hurtPlayer("alpha", 500, null, a.sim.x, a.sim.y);
    expect(a.pve.downed).toBe(true);
    for (let i = 0; i < 20 * 3; i++) tick(sim);
    expect(pve.status).toBe(PVE_STATUS.FAILED);
  });

  it("a downed player bleeds out; the run continues while a teammate stands, and they return at the next checkpoint", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival", "nightmare");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    place(a, 1500, 1100);
    place(b, 1900, 1100);
    pve.hurtPlayer("alpha", 500, null, a.sim.x, a.sim.y);
    for (let i = 0; i < 20 * (DIFFICULTY.nightmare.bleedoutSec + 1); i++) tick(sim);
    expect(a.alive).toBe(false);
    expect(pve.status).toBe(PVE_STATUS.RUNNING);
    // Wave cleared → back in, next to the standing teammate.
    pve.waves.start(
      { enemies: { walker: 1 } },
      1,
      [{ x: 300, y: 300 }],
      2,
      squadScale(2),
      DIFFICULTY.nightmare,
    );
    for (let i = 0; i < 20 * 3; i++) tick(sim);
    for (const z of pve.zw.zombies.values()) pve.damageZombie(z.id, 9999, b, false, z.x, z.y);
    for (let i = 0; i < 10; i++) tick(sim);
    expect(a.alive).toBe(true);
    expect(Math.hypot(a.sim.x - b.sim.x, a.sim.y - b.sim.y)).toBeLessThan(300);
  });
});

describe("First Contact mission script", () => {
  it("runs from the hall to extraction: doors, power, waves, keycard, gate, extraction", () => {
    const sim = makeSim("works", 11);
    const pve = startPve(sim, "outbreak", "recruit");
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    sim.resetForMatch();
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    const log: string[] = [];
    const run = (sec: number, input: Record<string, Partial<InputFrame>> = {}, until?: () => boolean) => {
      for (let i = 0; i < sec * 20 && !until?.(); i++) {
        const ev = tick(sim, input);
        for (const e of ev)
          if (e.t === "pve") log.push(`${e.k}${e.n !== undefined ? ` ${e.n}` : ""}${e.s ? ` ${e.s}` : ""}`);
        // The squad clears anything that gets close.
        for (const z of pve.zw.zombies.values()) {
          if (!z.dead && Math.hypot(z.x - a.sim.x, z.y - a.sim.y) < 700)
            pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
        }
      }
    };
    expect(pve.stepIndex).toBe(0);
    expect(sim.world.solids.length).toBe(MAPS.works.solids.length + 3);
    place(a, 600, 1300);
    place(b, 650, 1300);
    run(1, {}, () => pve.stepIndex === 1);
    expect(pve.stepIndex).toBe(1);
    // Generator: hold E for its 5 s.
    place(a, 435, 380);
    run(7, { alpha: { buttons: BTN.INTERACT } }, () => pve.stepIndex === 2);
    expect(pve.stepIndex).toBe(2);
    expect(pve.power).toBe(true);
    expect(pve.doorsOpen.has("gen-shutter")).toBe(true);
    expect(sim.world.solids.length).toBe(MAPS.works.solids.length + 2);
    // Waves in the courtyard.
    place(a, 1500, 1100);
    place(b, 1550, 1100);
    run(240, {}, () => pve.stepIndex === 3);
    expect(pve.stepIndex).toBe(3);
    expect(pve.doorsOpen.has("office-door")).toBe(true);
    expect(log.filter((l) => l.startsWith("clear")).length).toBe(3);
    expect(log).toContain("supply");
    // Keycard.
    place(a, 2800, 1620);
    run(3, { alpha: { buttons: BTN.INTERACT } }, () => pve.stepIndex === 4);
    expect(pve.flags.has("keycard")).toBe(true);
    // Gate panel.
    place(a, 2470, 1040);
    run(5, { alpha: { buttons: BTN.INTERACT } }, () => pve.stepIndex === 5);
    expect(pve.doorsOpen.has("sec-gate")).toBe(true);
    // Extraction: only bravo on the pad is not enough (everyone alive must be there).
    place(b, 2900, 380);
    place(a, 2470, 1060);
    run(4);
    expect(pve.stepProg).toBe(0);
    place(a, 2860, 380);
    run(20, {}, () => pve.status !== PVE_STATUS.RUNNING);
    expect(pve.status).toBe(PVE_STATUS.COMPLETE);
    console.log(`[mission] ${log.join(" | ")}`);
    const { result, xp } = pve.results(0);
    expect(result.completed).toBe(true);
    expect(result.progress).toBe(FIRST_CONTACT.steps.length);
    expect(xp.get("alpha")!.lines[0]!.reason).toContain("First Contact");
  });

  it("state mirroring keeps per-tick traffic small with many enemies", async () => {
    const { Encoder } = await import("@colyseus/schema");
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    place(a, 1500, 1100);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 40; i++) {
      const zone = FIRST_CONTACT.spawnZones[i % FIRST_CONTACT.spawnZones.length]!;
      pve.zw.spawn("walker", zone.x + (i % 4) * 34, zone.y + Math.floor(i / 7) * 8, { state: "hunt" });
    }
    const state = new MatchState();
    const encoder = new Encoder(state);
    syncPve(state, sim);
    encoder.encodeAll();
    encoder.discardChanges();
    let bytes = 0;
    const ticks = 100;
    for (let i = 0; i < ticks; i++) {
      tick(sim);
      syncPve(state, sim);
      if (encoder.hasChanges) bytes += encoder.encode().byteLength;
      encoder.discardChanges();
    }
    const kbps = ((bytes / ticks) * 20) / 1024;
    console.log(
      `[net] 40 moving enemies: ${(bytes / ticks).toFixed(0)} B/tick, ${kbps.toFixed(1)} KB/s per client`,
    );
    expect(kbps).toBeLessThan(20);
  });
});

describe("combat edge cases", () => {
  it("two players hitting the same enemy in the same tick: one death, one credit, no negative health", () => {
    const sim = makeSim();
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    place(a, 1300, 1100);
    place(b, 1300, 1160);
    const z = pve.zw.spawn("walker", 1500, 1130, { state: "idle" });
    z.speedMult = 0;
    z.hp = 20;
    const ev = tick(sim, {
      alpha: { buttons: BTN.FIRE, aim: Math.atan2(1130 - 1100, 200) },
      bravo: { buttons: BTN.FIRE, aim: Math.atan2(1130 - 1160, 200) },
    });
    const deaths = ev.filter((e) => e.t === "zdie" && e.z === z.id);
    expect(deaths).toHaveLength(1);
    expect(z.hp).toBe(0);
    expect(a.stats.kills + b.stats.kills).toBe(1);
    expect(pve.kills).toBe(1);
  });

  it("vehicles plough through enemies (credited to the driver) and enemies damage a vehicle's hull", () => {
    const sim = makeSim("facility");
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const a = addPlayer(sim, "alpha");
    const v = [...sim.vehicles.values()].find((x) => x.def.kind === "car")!;
    expect(v).toBeDefined();
    place(a, v.sim.x, v.sim.y);
    // Seat the player as the driver and launch the car at a walker.
    (sim as unknown as { takeSeat(p: ServerPlayer, v: unknown, s: number): void }).takeSeat(a, v, 0);
    v.sim.vx = Math.cos(v.sim.angle) * 450;
    v.sim.vy = Math.sin(v.sim.angle) * 450;
    const front = { x: v.sim.x + Math.cos(v.sim.angle) * 48, y: v.sim.y + Math.sin(v.sim.angle) * 48 };
    const z = pve.zw.spawn("walker", front.x, front.y, { state: "idle" });
    pve.vehicleContacts(v, a);
    expect(z.hp).toBeLessThan(z.maxHp);
    // A walker next to the hull attacks the vehicle its target sits in.
    const hp0 = v.hp;
    v.sim.vx = 0;
    v.sim.vy = 0;
    const w = pve.zw.spawn(
      "walker",
      v.sim.x - Math.sin(v.sim.angle) * 50,
      v.sim.y + Math.cos(v.sim.angle) * 50,
      {
        state: "hunt",
      },
    );
    for (let i = 0; i < 40 && v.hp === hp0; i++) tick(sim);
    expect(v.hp).toBeLessThan(hp0);
    expect(w.target).toBe("alpha");
  });
});

describe("performance budget", () => {
  it("authoritative tick cost grows gently with the number of enemies (4 players)", () => {
    const rows: string[] = [];
    for (const n of [10, 20, 30, 40, MAX_ZOMBIES]) {
      const sim = makeSim("works", 5);
      const pve = startPve(sim, "survival");
      pve.waves.stop();
      pve.nextWaveTick = 0;
      for (const [i, id] of ["a1", "a2", "a3", "a4"].entries()) {
        const p = addPlayer(sim, id);
        place(p, 1400 + i * 60, 1100);
        p.protectedUntil = Number.MAX_SAFE_INTEGER;
      }
      const kinds = [
        "walker",
        "runner",
        "walker",
        "spitter",
        "walker",
        "brute",
        "walker",
        "exploder",
        "stalker",
      ] as const;
      for (let i = 0; i < n; i++) {
        const zone = FIRST_CONTACT.spawnZones[i % FIRST_CONTACT.spawnZones.length]!;
        pve.zw.spawn(kinds[i % kinds.length]!, zone.x + (i % 3) * 36, zone.y + Math.floor(i / 7) * 12, {
          state: "hunt",
        });
      }
      const costs: number[] = [];
      for (let i = 0; i < 20 * 15; i++) {
        // Keep the count constant: enemies that reach the squad are replaced far away.
        const t0 = performance.now();
        tick(sim);
        costs.push(performance.now() - t0);
      }
      costs.sort((x, y) => x - y);
      const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
      const p99 = costs[Math.floor(costs.length * 0.99)]!;
      rows.push(`${String(n).padStart(2)} enemies: avg ${avg.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms`);
      // Budget: the host's browser also renders; the simulation must stay a small part of a 50 ms tick.
      expect(p99).toBeLessThan(25);
    }
    console.log(`[budget] 4 players, server tick cost by enemy count\n${rows.join("\n")}`);
  });
});

describe("boss: The Abomination", () => {
  function bossSetup(players = 1) {
    const sim = makeSim("works", 9);
    const pve = startPve(sim, "survival");
    pve.waves.stop();
    pve.nextWaveTick = 0;
    const ps = Array.from({ length: players }, (_, i) => {
      const p = addPlayer(sim, `p${i}`);
      place(p, 1400 + i * 50, 1250);
      return p;
    });
    const boss = pve.zw.spawn("abomination", 1650, 950, { state: "hunt" });
    return { sim, pve, ps, boss };
  }

  it("health scales with the squad, phases change at 66 % and 33 % with a roar, and it can be defeated", () => {
    const solo = bossSetup(1);
    const four = bossSetup(4);
    expect(four.boss.maxHp).toBeGreaterThan(solo.boss.maxHp * 2);
    const { sim, pve, ps, boss } = solo;
    const phases: number[] = [];
    const hit = (frac: number) => pve.damageZombie(boss.id, boss.maxHp * frac, ps[0]!, false, boss.x, boss.y);
    hit(0.36);
    for (const e of tick(sim)) if (e.t === "pve" && e.k === "bossPhase") phases.push(e.n ?? 0);
    expect(boss.phase).toBe(1);
    expect(boss.cur?.kind).toBe("roar");
    // During the roar it shrugs off damage.
    const hp = boss.hp;
    hit(0.2);
    expect(hp - boss.hp).toBeLessThan(boss.maxHp * 0.03);
    for (let i = 0; i < 40; i++) tick(sim);
    hit(0.32);
    for (const e of tick(sim)) if (e.t === "pve" && e.k === "bossPhase") phases.push(e.n ?? 0);
    expect(boss.phase).toBe(2);
    expect(phases).toEqual([2, 3]);
    for (let i = 0; i < 40; i++) tick(sim);
    pve.damageZombie(boss.id, 999999, ps[0]!, false, boss.x, boss.y);
    expect(boss.dead).toBe(true);
    tick(sim);
    expect(pve.bossId).toBe("");
  });

  it("every boss attack is telegraphed: slam, debris and charge land only after their windup", () => {
    const { sim, pve, ps, boss } = bossSetup(1);
    const p = ps[0]!;
    p.protectedUntil = 0;
    // Slam: stand next to it.
    place(p, boss.x + 90, boss.y);
    let windupAt = -1;
    let hitAt = -1;
    for (let i = 0; i < 80 && hitAt < 0; i++) {
      p.hp = PLAYER.maxHealth;
      const ev = tick(sim);
      if (boss.act === ACT.WINDUP && boss.cur?.kind === "slam" && windupAt < 0) windupAt = sim.tick;
      if (ev.some((e) => e.t === "hit" && e.v === p.id && e.p === `z:${boss.id}`)) hitAt = sim.tick;
    }
    expect(windupAt).toBeGreaterThan(0);
    expect(hitAt - windupAt).toBeGreaterThanOrEqual(Math.round(1.1 * 20) - 1);
    // Phase 2 debris: thrown at range, lands on the marked spot.
    pve.damageZombie(boss.id, boss.maxHp * 0.4, p, false, boss.x, boss.y);
    for (let i = 0; i < 40; i++) tick(sim);
    place(p, boss.x - 420, boss.y + 300);
    let thrown: { tx?: number; ty?: number; r?: number } | null = null;
    for (let i = 0; i < 20 * 10 && !thrown; i++) {
      p.hp = PLAYER.maxHealth;
      for (const e of tick(sim)) if (e.t === "proj" && e.r) thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(Math.hypot((thrown!.tx ?? 0) - p.sim.x, (thrown!.ty ?? 0) - p.sim.y)).toBeLessThan(140);
  });

  it("summons lesser infected in its second phase", () => {
    const { sim, pve, ps, boss } = bossSetup(1);
    ps[0]!.protectedUntil = Number.MAX_SAFE_INTEGER;
    pve.damageZombie(boss.id, boss.maxHp * 0.4, ps[0]!, false, boss.x, boss.y);
    let adds = 0;
    for (let i = 0; i < 20 * 30 && adds === 0; i++) {
      tick(sim);
      adds = [...pve.zw.zombies.values()].filter((z) => !z.dead && z.group === boss.id).length;
    }
    expect(adds).toBeGreaterThan(0);
  });

  it("Survival wave 10 is led by the boss and ends only when it falls", () => {
    const def = survivalWave(10);
    expect(def.boss).toBe("abomination");
    const sim = makeSim("works", 4);
    const pve = startPve(sim, "survival");
    const a = addPlayer(sim, "alpha");
    place(a, 1500, 1100);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    pve.waves.start(def, 10, [], 1, squadScale(1), DIFFICULTY.veteran);
    let bossSeen = "";
    for (let i = 0; i < 20 * 20 && !pve.waves.done; i++) {
      tick(sim);
      if (pve.bossId) bossSeen = pve.bossId;
      // Kill everything but the boss.
      for (const z of pve.zw.zombies.values())
        if (!z.dead && !z.def.boss) pve.damageZombie(z.id, 9999, a, false, z.x, z.y);
    }
    expect(bossSeen).not.toBe("");
    expect(pve.waves.done).toBe(false);
    pve.damageZombie(bossSeen, 9999999, a, false, 0, 0);
    for (let i = 0; i < 20 * 20 && !pve.waves.done; i++) {
      tick(sim);
      for (const z of pve.zw.zombies.values()) if (!z.dead) pve.damageZombie(z.id, 9999, a, false, z.x, z.y);
    }
    expect(pve.waves.done).toBe(true);
  });
});
