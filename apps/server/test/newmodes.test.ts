import {
  BOUNTY,
  BTN,
  CHAOS,
  GAME_MODES,
  type GameMode,
  INFECTION,
  type InputFrame,
  isPveMode,
  MAPS,
  MatchState,
  mapsForMode,
  NET,
  type NetEvent,
  NO_WEAPON,
  PlayerState,
  PURSUIT,
  quantizeInput,
  ROLE,
  SABOTAGE,
  SERVER_TICK_MS,
  WEAPONS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { BountyMode } from "../src/modes/Bounty.ts";
import type { ChaosMode } from "../src/modes/Chaos.ts";
import type { InfectionMode } from "../src/modes/Infection.ts";
import type { PursuitMode } from "../src/modes/Pursuit.ts";
import type { SabotageMode } from "../src/modes/Sabotage.ts";
import { syncModeState } from "../src/modes/sync.ts";
import { computeResults } from "../src/players/results.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer, VEHICLE_WRECK } from "../src/simulation/GameSimulation.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(mode: GameMode, map: keyof typeof MAPS, ids: string[], rounds?: number) {
  let r = 0.41;
  const rng = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const sim = new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng });
  const state = new MatchState();
  state.mapId = map;
  const rules = new MatchRules(sim, state, (id) => id.startsWith("bot:"));
  for (const id of ids) {
    sim.addPlayer({
      id,
      playerId: `pid-${id}`,
      name: id,
      skin: "foundry",
      level: 1,
      primary: "rifle",
      seed: 7,
    });
    const ps = new PlayerState();
    ps.name = id;
    state.players.set(id, ps);
  }
  rules.setMode(mode);
  if (rounds) rules.setRounds(rounds);
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  state.phaseEndTick = sim.tick + sec(20 * 60);
  return { sim, state, rules };
}

const seqs = new Map<string, number>();
function hold(sim: GameSimulation, id: string, f: Partial<InputFrame>) {
  const s = (seqs.get(id) ?? 0) + 1;
  seqs.set(id, s);
  sim.enqueue(id, [
    quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: sim.tick, ...f }),
  ]);
}

function ticks(sim: GameSimulation, n: number, each?: () => void): NetEvent[] {
  const ev: NetEvent[] = [];
  for (let i = 0; i < n; i++) {
    each?.();
    ev.push(...sim.step(SERVER_TICK_MS, "live"));
  }
  return ev;
}

function put(p: ServerPlayer, x: number, y: number) {
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
}

function eliminate(sim: GameSimulation, victim: ServerPlayer, killer: ServerPlayer | null, weapon = 1) {
  victim.protectedUntil = 0;
  victim.shield = 0;
  sim.damageFromMode(victim, 999, killer, weapon, victim.sim.x, victim.sim.y);
}

const NEW_MODES = ["infection", "chaos", "bounty", "sabotage", "pursuit", "convoy"] as const;

describe("0.8 modes: registry and maps", () => {
  it("every competitive / party mode has at least one map; Pursuit and Convoy only on maps with ground vehicles", () => {
    for (const m of GAME_MODES) {
      if (isPveMode(m)) continue;
      expect(mapsForMode(m).length, m).toBeGreaterThan(0);
    }
    for (const id of mapsForMode("convoy"))
      expect(MAPS[id].vehicleSpawns?.some((v) => v.kind !== "heli")).toBe(true);
  });

  it("each new mode starts, runs a minute and produces results without errors", () => {
    for (const mode of NEW_MODES) {
      const map = mapsForMode(mode)[0]!;
      const { sim, state, rules } = setup(mode, map, ["a", "b", "c", "d"]);
      ticks(sim, sec(60));
      syncModeState(state, sim, []);
      expect(rules.endReason(sim.tick)).toBeNull();
      const res = computeResults(sim.standings(), {
        tickRate: NET.serverTickRate,
        minParticipationTicks: sec(30),
        completed: true,
        winnerTeam: sim.winningTeam(),
        facts: (p) => sim.ctl!.facts(p),
      });
      expect(res.length).toBe(4);
    }
  });
});

describe("Infection", () => {
  it("one infected with claws; survivors keep their guns with endless ammo; the infected cannot be hurt in the pen", () => {
    const { sim } = setup("infection", "industrial", ["a", "b", "c"]);
    const ctl = sim.ctl as InfectionMode;
    const infected = [...sim.players.values()].filter((p) => ctl.sideOf(p.id) === ROLE.SEEKER);
    expect(infected).toHaveLength(1);
    expect(infected[0]!.sim.slots[0]!.id).toBe(WEAPONS.claws.index);
    for (const p of sim.players.values()) {
      if (ctl.sideOf(p.id) !== ROLE.HIDER) continue;
      expect(p.sim.slots[0]!.id).toBe(WEAPONS.rifle.index);
      expect(p.sim.slots[0]!.reserve).toBe(-1);
      expect(p.sim.slots[1]!.id).toBe(WEAPONS.pistol.index);
    }
    ticks(sim, 1);
    const inf = infected[0]!;
    const hp = inf.hp;
    inf.protectedUntil = 0;
    sim.damageFromMode(inf, 50, null, 1, 0, 0);
    expect(inf.hp).toBe(hp);
  });

  it("a fallen survivor comes back infected; the round goes on when the infected falls; all infected ends it", () => {
    const { sim } = setup("infection", "industrial", ["a", "b", "c"]);
    const ctl = sim.ctl as InfectionMode;
    ticks(sim, sec(INFECTION.prepSec) + 2);
    expect(ctl.stage).toBe("hunt");
    const inf = [...sim.players.values()].find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!;
    const [s1, s2] = [...sim.players.values()].filter((p) => ctl.sideOf(p.id) === ROLE.HIDER);
    // The infected falls: they respawn, the round is not over.
    eliminate(sim, inf, s1!);
    ticks(sim, 2);
    expect(ctl.stage).toBe("hunt");
    ticks(sim, sec(INFECTION.respawnSec) + 2);
    expect(inf.alive).toBe(true);
    // A survivor falls: infected, back with claws.
    eliminate(sim, s1!, inf, WEAPONS.claws.index);
    expect(ctl.sideOf(s1!.id)).toBe(ROLE.SEEKER);
    ticks(sim, sec(INFECTION.respawnSec) + 2);
    expect(s1!.alive).toBe(true);
    expect(s1!.sim.slots[0]!.id).toBe(WEAPONS.claws.index);
    expect(ctl.pointsOf(inf.id)).toBe(INFECTION.points.infect);
    // The last survivor is pinged to everybody.
    ticks(sim, sec(INFECTION.lastSurvivorPingSec) + 1);
    expect(ctl.markEntries().get("last")?.l).toContain(s2!.name);
    eliminate(sim, s2!, inf, WEAPONS.claws.index);
    ticks(sim, 2);
    expect(ctl.stage).toBe("break");
    expect(ctl.lastWinner).toBe(ROLE.SEEKER);
  });

  it("survivors win when the timer runs out", () => {
    const { sim } = setup("infection", "industrial", ["a", "b", "c"]);
    const ctl = sim.ctl as InfectionMode;
    ticks(sim, sec(INFECTION.prepSec + INFECTION.huntSec) + 4);
    expect(ctl.lastWinner).toBe(ROLE.HIDER);
  });
});

describe("Chaos Arena", () => {
  it("a rule is announced at once and changes within 30–45 s; weapon rules arm everybody, then give the weapons back", () => {
    const { sim } = setup("chaos", "industrial", ["a", "b"]);
    const ctl = sim.ctl as ChaosMode;
    const ev = ticks(sim, 1);
    const first = ctl.rule!;
    expect(ev.some((e) => e.t === "announce" && e.s === first.name)).toBe(true);
    const ev2 = ticks(sim, sec(CHAOS.maxSec) + 1);
    expect(ev2.some((e) => e.t === "announce")).toBe(true);
    // Force a weapon rule, then a plain one.
    const a = sim.players.get("a")!;
    const rockets = CHAOS.rules.find((r) => r.weapon === "rpg")!;
    const before = a.sim.slots.map((s) => s.id);
    (ctl as unknown as { rule: unknown }).rule = null;
    ctl.ruleEnd = sim.tick + 1;
    // Drive the rotation until the rocket rule comes up (deterministic rng).
    for (let i = 0; i < 200 && ctl.rule?.id !== rockets.id; i++) {
      ctl.ruleEnd = sim.tick + 1;
      ticks(sim, 1);
      if (ctl.rule && !ctl.rule.weapon) continue;
    }
    if (ctl.rule?.id === rockets.id) {
      expect(a.sim.slots[0]!.id).toBe(WEAPONS.rpg.index);
      expect(a.sim.slots[1]!.id).toBe(NO_WEAPON);
    }
    for (let i = 0; i < 200 && ctl.rule?.weapon; i++) {
      ctl.ruleEnd = sim.tick + 1;
      ticks(sim, 1);
    }
    expect(a.sim.slots.map((s) => s.id)).toEqual(before);
  });

  it("damage rules scale every hit; vampire heals the attacker", () => {
    const { sim } = setup("chaos", "industrial", ["a", "b"]);
    const ctl = sim.ctl as ChaosMode;
    ticks(sim, 1);
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    ctl.rule = CHAOS.rules.find((r) => r.id === "double")!;
    b.protectedUntil = 0;
    sim.damageFromMode(b, 20, a, 1, 0, 0);
    expect(b.hp).toBe(100 - 40);
    ctl.rule = CHAOS.rules.find((r) => r.id === "vampire")!;
    a.hp = 50;
    sim.damageFromMode(b, 20, a, 1, 0, 0);
    expect(a.hp).toBe(60);
  });
});

describe("Bounty Hunt", () => {
  it("a target is chosen and scores while alive; taking them down claims the bounty and passes it on", () => {
    const { sim, state } = setup("bounty", "industrial", ["a", "b", "c"]);
    const ctl = sim.ctl as BountyMode;
    ticks(sim, 1);
    const target = sim.players.get(ctl.target!)!;
    ticks(sim, sec(BOUNTY.targetEverySec * 3));
    expect(ctl.pointsOf(target.id)).toBe(3);
    syncModeState(state, sim, []);
    expect(state.marks.get("bounty")?.k).toBe("target");
    expect(state.modeText).toContain(target.name);
    const hunter = [...sim.players.values()].find((p) => p !== target)!;
    eliminate(sim, target, hunter);
    expect(ctl.pointsOf(hunter.id)).toBe(BOUNTY.claimPoints);
    expect(ctl.target).toBe(hunter.id);
    const other = [...sim.players.values()].find((p) => p !== target && p !== hunter)!;
    eliminate(sim, target, other);
    expect(ctl.pointsOf(other.id)).toBe(0); // the target was already down
  });

  it("the point limit ends the match", () => {
    const { sim, rules, state } = setup("bounty", "industrial", ["a", "b"]);
    const ctl = sim.ctl as BountyMode;
    ticks(sim, 1);
    const t = sim.players.get(ctl.target!)!;
    (ctl as unknown as { points: Map<string, number> }).points.set(t.id, state.killLimit);
    expect(rules.endReason(sim.tick)).toBe("score-limit");
    expect(sim.standings()[0]!.id).toBe(t.id);
  });
});

describe("Sabotage", () => {
  function teams(sim: GameSimulation, ctl: SabotageMode) {
    const all = [...sim.players.values()];
    return {
      atk: all.filter((p) => p.team === ctl.attackTeam),
      def: all.filter((p) => p.team === ctl.defendTeam),
    };
  }

  it("planting takes 3 s held on a site; the fuse wins the round for the attackers; no respawns in a round", () => {
    const { sim, state } = setup("sabotage", "industrial", ["a", "b", "c", "d"], 4);
    const ctl = sim.ctl as SabotageMode;
    ticks(sim, sec(SABOTAGE.prepSec) + 2);
    expect(ctl.stage).toBe("hunt");
    const { atk, def } = teams(sim, ctl);
    expect(atk.length).toBeGreaterThan(0);
    expect(def.length).toBeGreaterThan(0);
    const planter = atk[0]!;
    const site = ctl.sites[0]!;
    ticks(sim, sec(SABOTAGE.plantSec) + 2, () => {
      put(planter, site.x, site.y);
      hold(sim, planter.id, { buttons: BTN.INTERACT });
    });
    expect(ctl.device).not.toBeNull();
    syncModeState(state, sim, []);
    expect(state.marks.get("device")?.a).toBe("Hold to defuse the device");
    // A defender falls: out until the next round.
    eliminate(sim, def[0]!, planter);
    ticks(sim, sec(2));
    expect(def[0]!.alive).toBe(false);
    ticks(sim, sec(SABOTAGE.fuseSec - 1));
    expect(ctl.stage).toBe("break");
    expect(ctl.wins[ctl.attackTeam]).toBe(1);
    expect(sim.teamScores[ctl.attackTeam]).toBe(1);
  });

  it("defusing wins it for the defenders; the clock too; sides swap at half time; the match ends after the rounds", () => {
    const { sim } = setup("sabotage", "industrial", ["a", "b", "c", "d"], 2);
    const ctl = sim.ctl as SabotageMode;
    ticks(sim, sec(SABOTAGE.prepSec) + 2);
    const first = ctl.attackTeam;
    const { atk, def } = teams(sim, ctl);
    const site = ctl.sites[1]!;
    ticks(sim, sec(SABOTAGE.plantSec) + 2, () => {
      put(atk[0]!, site.x, site.y);
      hold(sim, atk[0]!.id, { buttons: BTN.INTERACT });
    });
    const d = ctl.device!;
    ticks(sim, sec(SABOTAGE.defuseSec) + 2, () => {
      put(def[0]!, d.x, d.y);
      hold(sim, def[0]!.id, { buttons: BTN.INTERACT });
    });
    expect(ctl.wins[ctl.defendTeam]).toBe(1);
    ticks(sim, sec(SABOTAGE.breakSec) + 2);
    expect(ctl.round).toBe(2);
    expect(ctl.attackTeam).not.toBe(first);
    ticks(sim, sec(SABOTAGE.prepSec + SABOTAGE.liveSec) + 4);
    expect(ctl.wins[ctl.defendTeam]).toBe(1);
    ticks(sim, sec(SABOTAGE.breakSec) + 2);
    expect(sim.modeOver()).toBe("rounds");
  });
});

describe("Vehicle Pursuit and Convoy", () => {
  it("Pursuit: the checkpoints in order, then the destination, win the round for the runners", () => {
    const map = mapsForMode("pursuit")[0]!;
    const { sim, state } = setup("pursuit", map, ["a", "b"], 2);
    const ctl = sim.ctl as PursuitMode;
    expect(sim.vehicles.size).toBeGreaterThan(0);
    ticks(sim, sec(PURSUIT.prepSec) + 2);
    const runner = [...sim.players.values()].find((p) => p.team === ctl.attackTeam)!;
    // The destination first does nothing: the checkpoints come first.
    put(runner, ctl.goal.x, ctl.goal.y);
    ticks(sim, 2);
    expect(ctl.stage).toBe("hunt");
    for (const cp of ctl.checkpoints) {
      put(runner, cp.x, cp.y);
      ticks(sim, 2);
    }
    expect(ctl.next).toBe(ctl.checkpoints.length);
    syncModeState(state, sim, []);
    expect(state.marks.get("goal")?.p).toBe(100);
    put(runner, ctl.goal.x, ctl.goal.y);
    ticks(sim, 2);
    expect(ctl.wins[ctl.attackTeam]).toBe(1);
  });

  it("Convoy: an armored truck parks on the escorts' side; wrecking it wins the round for the interceptors", () => {
    const map = mapsForMode("convoy")[0]!;
    const { sim, state } = setup("convoy", map, ["a", "b"], 2);
    const ctl = sim.ctl as PursuitMode;
    expect(ctl.truckId).not.toBeNull();
    const truck = sim.vehicles.get(ctl.truckId!)!;
    expect(truck).toBeDefined();
    syncModeState(state, sim, []);
    expect(state.marks.get("truck")?.l).toBe("Convoy truck");
    ticks(sim, sec(PURSUIT.prepSec) + 2);
    truck.hp = 0;
    truck.status = VEHICLE_WRECK;
    ticks(sim, 2);
    expect(ctl.wins[ctl.defendTeam]).toBe(1);
  });
});
