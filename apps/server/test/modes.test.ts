import {
  BTN,
  type InputFrame,
  MAPS,
  MatchState,
  NET,
  OBJECTIVES,
  objectivesFor,
  PLAYER,
  quantizeInput,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

function makeSim(map: keyof typeof MAPS = "industrial") {
  let r = 0.5;
  return new GameSimulation(MAPS[map], {
    tickRate: NET.serverTickRate,
    rng: () => (r = (r * 9301 + 49297) % 1),
  });
}

function add(sim: GameSimulation, id: string, team: number) {
  return sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    skin: "foundry",
    level: 1,
    primary: "rifle",
    seed: 3,
    team,
  });
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.protectedUntil = 0;
}

const seqs = new Map<string, number>();
function input(sim: GameSimulation, id: string, f: Partial<InputFrame>) {
  const s = (seqs.get(id) ?? 0) + 1;
  seqs.set(id, s);
  sim.enqueue(id, [
    quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: sim.tick, ...f }),
  ]);
}

const ticks = (sim: GameSimulation, n: number) => {
  const ev = [];
  for (let i = 0; i < n; i++) ev.push(...sim.step(SERVER_TICK_MS, "live"));
  return ev;
};
const sec = (s: number) => Math.round(s * NET.serverTickRate);

describe("Domination", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    sim.rules = { teams: true, friendlyFire: false };
    sim.setMode("dom");
  });

  it("has three points, A and C mirrored around B at the centre", () => {
    const [a, b, c] = sim.points;
    expect(sim.points.map((p) => p.id)).toEqual(["A", "B", "C"]);
    expect(b).toMatchObject({ x: MAPS.industrial.width / 2, y: MAPS.industrial.height / 2 });
    expect(a!.x + c!.x).toBeCloseTo(MAPS.industrial.width, 5);
    expect(a!.y + c!.y).toBeCloseTo(MAPS.industrial.height, 5);
  });

  it("one player captures a neutral point in captureSec; owned points score over time", () => {
    const p = add(sim, "a", 1);
    const b = sim.points[1]!;
    place(p, b.x + 40, b.y + 60);
    const ev = ticks(sim, sec(OBJECTIVES.captureSec) + 2);
    expect(b.owner).toBe(1);
    expect(ev.some((e) => e.t === "obj" && e.k === "capture" && e.o === "B" && e.team === 1)).toBe(true);
    expect(p.stats.captures).toBe(1);
    const before = sim.teamScores[1];
    ticks(sim, sec(OBJECTIVES.scoreEverySec * 2));
    expect(sim.teamScores[1]).toBeGreaterThanOrEqual(before + 2);
    expect(sim.teamScores[2]).toBe(0);
  });

  it("a contested point does not move; the other team must neutralize before capturing", () => {
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    const pt = sim.points[1]!;
    place(a, pt.x + 40, pt.y + 60);
    ticks(sim, sec(OBJECTIVES.captureSec) + 2);
    expect(pt.owner).toBe(1);
    place(b, pt.x - 40, pt.y + 60);
    const progress = pt.progress;
    ticks(sim, sec(2));
    expect(pt.progress).toBe(progress);
    a.alive = false;
    const ev = ticks(sim, sec(OBJECTIVES.captureSec) + 2);
    expect(ev.some((e) => e.t === "obj" && e.k === "neutral")).toBe(true);
    expect(pt.owner).toBe(0);
    ticks(sim, sec(OBJECTIVES.captureSec));
    expect(pt.owner).toBe(2);
  });

  it("eliminations do not add team score in Domination", () => {
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    place(a, 1000, 1180);
    place(b, 1300, 1180);
    b.hp = 1;
    input(sim, "a", { buttons: BTN.FIRE });
    ticks(sim, 2);
    expect(b.alive).toBe(false);
    expect(a.stats.kills).toBe(1);
    expect(sim.teamScores[1]).toBe(0);
  });
});

describe("Capture the Flag", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    sim.rules = { teams: true, friendlyFire: false };
    sim.setMode("ctf");
  });

  it("take, carry home, score; the flag goes back to its stand", () => {
    const a = add(sim, "a", 1);
    const enemyFlag = sim.flags.find((f) => f.team === 2)!;
    const ownFlag = sim.flags.find((f) => f.team === 1)!;
    place(a, enemyFlag.homeX, enemyFlag.homeY);
    const ev = ticks(sim, 1);
    expect(enemyFlag.carrier).toBe("a");
    expect(ev.some((e) => e.t === "obj" && e.k === "take")).toBe(true);
    place(a, ownFlag.homeX, ownFlag.homeY);
    const ev2 = ticks(sim, 1);
    expect(ev2.some((e) => e.t === "obj" && e.k === "score" && e.team === 1)).toBe(true);
    expect(sim.teamScores[1]).toBe(1);
    expect(enemyFlag).toMatchObject({ carrier: null, home: true, x: enemyFlag.homeX, y: enemyFlag.homeY });
    expect(a.stats.flagCaptures).toBe(1);
  });

  it("no capture while your own flag is away; a dropped flag is returned by touch or by time", () => {
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    const flag1 = sim.flags.find((f) => f.team === 1)!;
    const flag2 = sim.flags.find((f) => f.team === 2)!;
    place(a, flag2.homeX, flag2.homeY);
    place(b, flag1.homeX + 300, flag1.homeY);
    ticks(sim, 1);
    // B takes A's flag too: A cannot score while it is away.
    place(b, flag1.homeX, flag1.homeY);
    ticks(sim, 1);
    expect(flag1.carrier).toBe("b");
    place(a, flag1.homeX, flag1.homeY + 2);
    ticks(sim, 1);
    expect(sim.teamScores[1]).toBe(0);
    // B dies: the flag drops where B was; A touches it and it goes home.
    b.hp = 0;
    b.alive = false;
    ticks(sim, 1);
    expect(flag1.carrier).toBeNull();
    expect(flag1.home).toBe(false);
    place(a, flag1.x, flag1.y);
    const ev = ticks(sim, 1);
    expect(ev.some((e) => e.t === "obj" && e.k === "return")).toBe(true);
    expect(flag1.home).toBe(true);
    // A now scores with B's flag.
    place(a, flag1.homeX, flag1.homeY);
    ticks(sim, 1);
    expect(sim.teamScores[1]).toBe(1);
    // A dropped flag left alone returns after flagReturnSec.
    place(a, flag2.homeX, flag2.homeY);
    ticks(sim, 1);
    a.alive = false;
    ticks(sim, 1);
    expect(flag2.home).toBe(false);
    ticks(sim, sec(OBJECTIVES.flagReturnSec) + 1);
    expect(flag2.home).toBe(true);
  });

  it("flag carriers cannot enter vehicles", () => {
    const urban = makeSim("urban");
    urban.rules = { teams: true, friendlyFire: false };
    urban.setMode("ctf");
    const a = add(urban, "a", 1);
    const flag2 = urban.flags.find((f) => f.team === 2)!;
    place(a, flag2.homeX, flag2.homeY);
    ticks(urban, 1);
    expect(urban.carriesFlag(a)).toBe(true);
    const car = [...urban.vehicles.values()][0]!;
    car.sim.x = a.sim.x + car.def.halfLength + 30;
    car.sim.y = a.sim.y;
    car.sim.angle = 0;
    input(urban, "a", { buttons: BTN.INTERACT });
    ticks(urban, 1);
    expect(a.vehicle).toBeNull();
  });
});

describe("Vehicle Mayhem", () => {
  it("is played on a vehicle map; wrecking a crewed enemy vehicle scores 2, eliminations 1", () => {
    expect(MatchRules.mapForMode("mayhem", "industrial")).toBe("urban");
    expect(MatchRules.mapForMode("mayhem", "airbase")).toBeNull();
    expect(MatchRules.mapForMode("tdm", "industrial")).toBeNull();
    const sim = makeSim("urban");
    const state = new MatchState();
    const rules = new MatchRules(sim, state, () => false);
    rules.setMode("mayhem");
    expect(sim.mode).toBe("mayhem");
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    const car = sim.vehicles.get("car-a")!;
    place(b, car.sim.x + car.def.halfWidth + 30, car.sim.y);
    input(sim, "b", { buttons: BTN.INTERACT });
    ticks(sim, 1);
    expect(b.vehicle).toBe("car-a");
    sim.damageVehicle(car, 10_000, a, car.sim.x, car.sim.y);
    expect(sim.teamScores[1]).toBe(2 + (b.alive ? 0 : 1));
    expect(a.stats.vehicleKills).toBe(1);
  });

  it("objective positions exist on every map and flags stand on free ground", () => {
    for (const map of Object.values(MAPS)) {
      const o = objectivesFor(map);
      expect(o.points).toHaveLength(3);
      for (const t of [1, 2] as const) expect(o.flags[t].x).toBeGreaterThan(0);
    }
  });
});
