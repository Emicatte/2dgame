import {
  BTN,
  computeMatchXp,
  type InputFrame,
  MAPS,
  MatchState,
  MODE_DEFAULTS,
  NET,
  PLAYER,
  PlayerState,
  quantizeInput,
  SERVER_TICK_MS,
  secToSteps,
  teamSpawns,
  WEAPONS,
} from "@scrapline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { computeResults, resultRows } from "../src/players/results.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

/** Open, wall-free lane of Industrial Arena. */
const LANE_Y = 1180;

function makeSim() {
  let r = 0.5;
  return new GameSimulation(MAPS.industrial, {
    tickRate: NET.serverTickRate,
    rng: () => (r = (r * 9301 + 49297) % 1),
  });
}

function add(sim: GameSimulation, id: string, team = 0, level = 1, primary: "rifle" | "sniper" = "sniper") {
  return sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    skin: "foundry",
    level,
    primary,
    seed: id.length * 97,
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
function frames(id: string, n: number, f: Partial<InputFrame>, viewTick = 0): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

function drain(sim: GameSimulation, maxTicks = 200) {
  const events = [];
  for (let i = 0; i < maxTicks; i++) {
    events.push(...sim.step(SERVER_TICK_MS, "live"));
    if ([...sim.players.values()].every((p) => p.queue.length === 0)) break;
  }
  return events;
}

/** Fires one sniper shot to the right (aim 0), then waits out the bolt. */
function snipe(sim: GameSimulation, id: string) {
  sim.enqueue(id, frames(id, 1, { buttons: BTN.FIRE, aim: 0 }, sim.tick));
  const events = drain(sim);
  const idle = frames(id, secToSteps(60 / WEAPONS.sniper.rpm) + 1, {}, sim.tick);
  for (let i = 0; i < idle.length; i += 20) {
    sim.enqueue(id, idle.slice(i, i + 20));
    events.push(...drain(sim));
  }
  return events;
}

describe("team combat rules (simulation)", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    seqs.clear();
  });

  it("without friendly fire, shots pass through a teammate and hit the enemy behind", () => {
    sim.rules = { teams: true, friendlyFire: false };
    const a = add(sim, "a", 1);
    const mate = add(sim, "mate", 1);
    const enemy = add(sim, "enemy", 2);
    place(a, 1000, LANE_Y);
    place(mate, 1100, LANE_Y);
    place(enemy, 1300, LANE_Y);
    sim.step(SERVER_TICK_MS, "live");
    const events = snipe(sim, "a");
    expect(mate.hp).toBe(PLAYER.maxHealth);
    expect(enemy.hp).toBe(PLAYER.maxHealth - WEAPONS.sniper.damage);
    expect(events.some((e) => e.t === "hit" && e.v === "mate")).toBe(false);
  });

  it("with friendly fire, the teammate in the way takes the shot, and a team kill scores nothing", () => {
    sim.rules = { teams: true, friendlyFire: true };
    const a = add(sim, "a", 1);
    const mate = add(sim, "mate", 1);
    place(a, 1000, LANE_Y);
    place(mate, 1100, LANE_Y);
    sim.step(SERVER_TICK_MS, "live");
    snipe(sim, "a");
    expect(mate.hp).toBe(PLAYER.maxHealth - WEAPONS.sniper.damage);
    snipe(sim, "a");
    expect(mate.alive).toBe(false);
    expect(a.stats.kills).toBe(1);
    expect(sim.teamScores).toEqual([0, 0, 0]);
  });

  it("enemy eliminations score for the team; leader score and winner follow team scores", () => {
    sim.rules = { teams: true, friendlyFire: false };
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    place(a, 1000, LANE_Y);
    place(b, 1300, LANE_Y);
    sim.step(SERVER_TICK_MS, "live");
    snipe(sim, "a");
    snipe(sim, "a");
    expect(b.alive).toBe(false);
    expect(sim.teamScores[1]).toBe(1);
    expect(sim.leaderScore()).toBe(1);
    expect(sim.winningTeam()).toBe(1);
    sim.resetForMatch();
    expect(sim.teamScores).toEqual([0, 0, 0]);
    expect(sim.winningTeam()).toBe(0);
  });

  it("free-for-all keeps the old rules: everyone is a target, the leader is the top fragger", () => {
    const a = add(sim, "a");
    const b = add(sim, "b");
    place(a, 1000, LANE_Y);
    place(b, 1300, LANE_Y);
    sim.step(SERVER_TICK_MS, "live");
    snipe(sim, "a");
    snipe(sim, "a");
    expect(b.alive).toBe(false);
    expect(sim.leaderScore()).toBe(1);
    expect(sim.winningTeam()).toBe(0);
    expect(sim.teamScores).toEqual([0, 0, 0]);
  });

  it("each team spawns on its own half, never on top of anyone", () => {
    sim.rules = { teams: true, friendlyFire: false };
    const alpha = teamSpawns(MAPS.industrial, 1);
    const bravo = teamSpawns(MAPS.industrial, 2);
    expect(alpha.length).toBe(bravo.length);
    expect(alpha.length).toBeGreaterThan(0);
    // Mirrored maps: Bravo's spawns are Alpha's, mirrored through the center.
    for (const [i, s] of alpha.entries()) {
      expect(bravo[i]).toEqual({ x: MAPS.industrial.width - s.x, y: MAPS.industrial.height - s.y });
    }
    const players = ["a1", "a2", "b1", "b2"].map((id, i) => add(sim, id, i < 2 ? 1 : 2));
    for (let round = 0; round < 5; round++) {
      sim.resetForMatch();
      for (const p of players) {
        const own = teamSpawns(MAPS.industrial, p.team);
        expect(own.some((s) => s.x === p.sim.x && s.y === p.sim.y)).toBe(true);
      }
      const spots = new Set(players.map((p) => `${p.sim.x},${p.sim.y}`));
      expect(spots.size).toBe(4);
    }
  });
});

describe("MatchRules (shared by the dedicated and browser-hosted rooms)", () => {
  function setup() {
    const sim = makeSim();
    const state = new MatchState();
    const bots = new Set<string>();
    const rules = new MatchRules(sim, state, (id) => bots.has(id));
    const join = (id: string, level = 1, preferred?: number) => {
      const p = add(sim, id, 0, level);
      p.joinedTick = sim.tick++;
      state.players.set(id, new PlayerState());
      return rules.assign(id, preferred);
    };
    return { sim, state, bots, rules, join };
  }

  it("Team Deathmatch defaults: 2v2, five minutes, 15 points, no friendly fire", () => {
    const { state, sim, rules } = setup();
    rules.setMode("tdm");
    expect(MODE_DEFAULTS.tdm).toMatchObject({ teamSize: 2, maxPlayers: 4, durationSec: 300, scoreLimit: 15 });
    expect(state.mode).toBe("tdm");
    expect(state.teamSize).toBe(2);
    expect(state.maxPlayers).toBe(4);
    expect(state.durationSec).toBe(300);
    expect(state.killLimit).toBe(15);
    expect(state.friendlyFire).toBe(false);
    expect(sim.rules).toEqual({ teams: true, friendlyFire: false });
  });

  it("assigns newcomers to the smaller team, honors a preferred team with room, refuses when full", () => {
    const { rules, join } = setup();
    rules.setMode("tdm");
    expect(join("p1")).toBe(1);
    expect(join("p2")).toBe(2);
    expect(join("p3", 1, 2)).toBe(2); // invited to Bravo, Bravo has room
    expect(join("p4", 1, 2)).toBe(1); // Bravo full: goes to Alpha
    expect(join("p5")).toBe(-1); // 2v2 full
    expect(rules.counts()).toEqual([0, 2, 2]);
  });

  it("switching team needs room on the other side; team size changes respect who is present", () => {
    const { rules, join, sim } = setup();
    rules.setMode("tdm");
    join("p1");
    join("p2");
    join("p3");
    expect(sim.players.get("p3")!.team).toBe(1);
    expect(rules.switchTeam("p3", 2)).toBe(true);
    expect(rules.counts()).toEqual([0, 1, 2]);
    expect(rules.switchTeam("p1", 2)).toBe(false); // Bravo full (2/2)
    expect(rules.setTeamSize(1)).toBe(false); // 3 players do not fit 1v1
    expect(rules.setTeamSize(3)).toBe(true);
    expect(rules.switchTeam("p1", 2)).toBe(true);
    expect(rules.counts()).toEqual([0, 0, 3]);
    // Shrinking to 2v2 moves Bravo's newest member back to Alpha.
    expect(rules.setTeamSize(2)).toBe(true);
    expect(rules.counts()).toEqual([0, 1, 2]);
  });

  it("balances by level with a snake draft", () => {
    const { rules, join, sim } = setup();
    rules.setMode("tdm");
    rules.setTeamSize(2);
    join("l20", 20);
    join("l15", 15);
    join("l10", 10);
    join("l1", 1);
    rules.balance();
    const team = (id: string) => sim.players.get(id)!.team;
    // 20 + 1 vs 15 + 10
    expect(team("l20")).toBe(team("l1"));
    expect(team("l15")).toBe(team("l10"));
    expect(team("l20")).not.toBe(team("l15"));
  });

  it("before a match, an empty side is filled by rebalancing; practice targets face the human", () => {
    const { rules, join, sim, bots } = setup();
    rules.setMode("tdm");
    join("p1");
    join("p2");
    rules.switchTeam("p2", 1);
    expect(rules.counts()).toEqual([0, 2, 0]);
    rules.prepareMatch();
    expect(rules.counts()).toEqual([0, 1, 1]);

    const solo = setup();
    solo.rules.setMode("tdm");
    solo.join("human");
    solo.rules.switchTeam("human", 2);
    for (const id of ["bot:1", "bot:2"]) {
      solo.bots.add(id);
      add(solo.sim, id);
      solo.rules.assign(id);
    }
    expect(solo.sim.players.get("bot:1")!.team).toBe(1);
    expect(solo.rules.counts()).toEqual([0, 0, 1]); // bots never count
    void sim;
    void bots;
  });

  it("switching back to Deathmatch clears teams and restores free-for-all limits", () => {
    const { rules, join, sim, state } = setup();
    rules.setMode("tdm");
    join("p1");
    join("p2");
    rules.setMode("deathmatch");
    expect([...sim.players.values()].every((p) => p.team === 0)).toBe(true);
    expect(state.teamSize).toBe(0);
    expect(state.maxPlayers).toBe(MODE_DEFAULTS.deathmatch.maxPlayers);
    expect(sim.rules.teams).toBe(false);
  });

  it("sync mirrors teams and scores into the synchronized state", () => {
    const { rules, join, sim, state } = setup();
    rules.setMode("tdm");
    join("p1");
    join("p2");
    sim.teamScores[1] = 4;
    sim.teamScores[2] = 7;
    rules.sync();
    expect(state.players.get("p1")!.team).toBe(1);
    expect(state.players.get("p2")!.team).toBe(2);
    expect([state.scoreA, state.scoreB]).toEqual([4, 7]);
  });
});

describe("team results and XP", () => {
  it("the whole winning team wins (Team victory XP); losers and draws get no victory", () => {
    const sim = makeSim();
    const a1 = add(sim, "a1", 1);
    const a2 = add(sim, "a2", 1);
    const b1 = add(sim, "b1", 2);
    for (const p of [a1, a2, b1]) p.stats.activeTicks = 100_000;
    b1.stats.kills = 9; // top fragger on the losing team
    const results = computeResults(sim.standings(), {
      tickRate: NET.serverTickRate,
      minParticipationTicks: 10,
      completed: true,
      winnerTeam: 1,
    });
    const byId = new Map(results.map((r) => [r.player.id, r]));
    expect(byId.get("a1")!.won).toBe(true);
    expect(byId.get("a2")!.won).toBe(true);
    expect(byId.get("b1")!.won).toBe(false);
    expect(byId.get("a2")!.xp.lines.some((l) => l.reason === "Team victory")).toBe(true);
    expect(byId.get("b1")!.xp.lines.some((l) => /victory|podium/i.test(l.reason))).toBe(false);
    expect(resultRows(results).map((r) => r.team)).toEqual(results.map((r) => r.player.team));

    const draw = computeResults(sim.standings(), {
      tickRate: NET.serverTickRate,
      minParticipationTicks: 10,
      completed: true,
      winnerTeam: 0,
    });
    expect(draw.every((r) => !r.won)).toBe(true);
  });

  it("free-for-all XP is unchanged", () => {
    const base = {
      completed: true,
      kills: 3,
      placement: 1,
      playerCount: 4,
      firstBlood: false,
      bestStreak: 0,
      shotsFired: 0,
      shotsHit: 0,
    };
    expect(computeMatchXp(base).lines.map((l) => l.reason)).toContain("Victory");
    expect(computeMatchXp({ ...base, team: { won: false } }).lines.map((l) => l.reason)).not.toContain(
      "Victory",
    );
  });
});
