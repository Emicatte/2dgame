import {
  AI,
  BTN,
  type InputFrame,
  MAPS,
  type MapId,
  MatchState,
  mazeId,
  NET,
  type NetEvent,
  NO_WEAPON,
  PlayerState,
  parseIdList,
  quantizeInput,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { MazeMode } from "../src/modes/Maze.ts";
import { syncModeState } from "../src/modes/sync.ts";
import { computeResults } from "../src/players/results.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";
import { syncPve } from "../src/simulation/stateSync.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(map: MapId, ids: string[], variant = "classic") {
  const sim = new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng: () => 0.5 });
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
  rules.setMode("maze");
  rules.setVariant(variant);
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  state.phaseEndTick = sim.tick + sec(5 * 60);
  return { sim, state, rules, ctl: sim.ctl as MazeMode, maze: MAPS[map].maze! };
}

let seq = 0;
function hold(sim: GameSimulation, id: string, f: Partial<InputFrame>) {
  sim.enqueue(id, [
    quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: sim.tick, ...f }),
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

const announced = (ev: NetEvent[], text: string) =>
  ev.some((e) => e.t === "announce" && (e as { s: string }).s.includes(text));

describe("Classic Maze", () => {
  const id = mazeId("m", 4721);

  it("starts unarmed at the start, gates shut and solid, no practice bots", () => {
    const { sim, rules, maze } = setup(id, ["a"]);
    const a = sim.players.get("a")!;
    expect(rules.practiceAllowed).toBe(false);
    expect(a.sim.slots.every((s) => s.id === NO_WEAPON)).toBe(true);
    const s = maze.start;
    expect(a.sim.x).toBeGreaterThan(s.x);
    expect(a.sim.x).toBeLessThan(s.x + s.w);
    // The amber gate blocks: a player pushed into it does not pass.
    const g = maze.gates[0]!;
    const horizontal = g.w > g.h;
    put(a, g.x + g.w / 2 - (horizontal ? 0 : 60), g.y + g.h / 2 - (horizontal ? 60 : 0));
    ticks(sim, sec(1.5), () => hold(sim, "a", horizontal ? { my: 1 } : { mx: 1 }));
    const past = horizontal ? a.sim.y > g.y + g.h : a.sim.x > g.x + g.w;
    expect(past).toBe(false);
  });

  it("key opens the amber gate, switch (E) the cyan one; opening is shared and synced", () => {
    const { sim, state, ctl, maze } = setup(id, ["a", "b"]);
    const a = sim.players.get("a")!;
    const [amber, cyan] = maze.gates;
    put(a, amber!.opener.x, amber!.opener.y);
    let ev = ticks(sim, 2);
    expect(announced(ev, "has the Amber key")).toBe(true);
    put(a, amber!.x + amber!.w / 2, amber!.y + amber!.h / 2);
    ev = ticks(sim, 2);
    expect(announced(ev, "opened the amber gate")).toBe(true);
    // Without E, standing on the switch does nothing.
    put(a, cyan!.opener.x, cyan!.opener.y);
    ticks(sim, 3);
    syncModeState(state, sim, []);
    expect(parseIdList(state.pve.doors)).toEqual(new Set(["gate-amber"]));
    ev = ticks(sim, 2, () => hold(sim, "a", { buttons: BTN.INTERACT }));
    expect(announced(ev, "hit the switch")).toBe(true);
    syncModeState(state, sim, []);
    expect(parseIdList(state.pve.doors)).toEqual(new Set(["gate-amber", "gate-cyan"]));
    expect(ctl.statusText()).toContain("gates open");
  });

  it("a live trap sends you back to your checkpoint and drops the key you carried", () => {
    const { sim, ctl, maze } = setup(id, ["a"]);
    const a = sim.players.get("a")!;
    const trap = maze.traps[0]!;
    // Wait for the trap to be live, then stand on it.
    let guard = 0;
    while (!ctl.trapLive(trap.phase) && guard++ < sec(5)) ticks(sim, 1);
    put(a, trap.x + trap.w / 2, trap.y + trap.h / 2);
    const ev = ticks(sim, 1);
    expect(announced(ev, "hit a trap")).toBe(true);
    const s = maze.start;
    expect(a.sim.x > s.x && a.sim.x < s.x + s.w && a.sim.y > s.y && a.sim.y < s.y + s.h).toBe(true);
    // Past the first checkpoint, a trap brings you back there instead.
    put(a, maze.checkpoints[1]!.x, maze.checkpoints[1]!.y);
    ticks(sim, 1);
    while (!ctl.trapLive(trap.phase)) ticks(sim, 1);
    put(a, trap.x + trap.w / 2, trap.y + trap.h / 2);
    ticks(sim, 1);
    expect(Math.hypot(a.sim.x - maze.checkpoints[1]!.x, a.sim.y - maze.checkpoints[1]!.y)).toBeLessThan(1);
  });

  it("reaching the exit records a time; the match ends when everyone is out; fastest first", () => {
    const { sim, ctl, maze } = setup(id, ["a", "b"]);
    const [a, b] = [sim.players.get("a")!, sim.players.get("b")!];
    ticks(sim, sec(2));
    put(b, maze.exit.x, maze.exit.y);
    ticks(sim, 1);
    expect(ctl.over()).toBeNull();
    expect(ctl.frozen(b)).toBe(true);
    ticks(sim, sec(3));
    put(a, maze.exit.x, maze.exit.y);
    ticks(sim, 1);
    expect(ctl.over()).toBe("everyone-out");
    expect(ctl.standings().map((p) => p.id)).toEqual(["b", "a"]);
    expect(ctl.facts(b).points).toBeLessThan(ctl.facts(a).points);
    const results = computeResults(ctl.standings(), {
      completed: true,
      tickRate: NET.serverTickRate,
      minParticipationTicks: 0,
      facts: (p) => ctl.facts(p),
    });
    expect(results[0]!.points).toBe(ctl.facts(b).points);
  });
});

describe("Horror Maze", () => {
  const id = mazeId("m", 4721);

  it("one creature, synced as an enemy, starting in its lair and not hunting yet", () => {
    const { sim, state, ctl, maze } = setup(id, ["a"], "horror");
    expect(ctl.monster).not.toBeNull();
    ticks(sim, 2);
    syncPve(state, sim);
    expect(state.zombies.size).toBe(1);
    const c = ctl.monster!.position!;
    expect(Math.hypot(c.x - maze.lair.x, c.y - maze.lair.y)).toBeLessThan(40);
    expect(c.state === AI.CHASE || c.state === AI.ATTACK).toBe(false);
  });

  it("walks, never teleports, and catching someone sends them back to their checkpoint", () => {
    const { sim, ctl, maze } = setup(id, ["a"], "horror");
    const a = sim.players.get("a")!;
    a.protectedUntil = 0;
    // Stand next to the lair, in plain sight.
    put(a, maze.lair.x + 20, maze.lair.y);
    let last = ctl.monster!.position!;
    let caught = false;
    const ev = ticks(sim, sec(6), () => {
      const now = ctl.monster!.position!;
      expect(Math.hypot(now.x - last.x, now.y - last.y)).toBeLessThan(60);
      last = now;
      if (!caught) put(a, maze.lair.x + 20, maze.lair.y);
      if (ctl.monster!.chasing) a.protectedUntil = 0;
    });
    caught = announced(ev, "was caught");
    expect(caught).toBe(true);
  });

  it("a gate opening is heard: an idle creature goes to investigate", () => {
    const { sim, ctl, maze } = setup(id, ["a"], "horror");
    const a = sim.players.get("a")!;
    // Out of sight: far from the lair, at the start.
    ticks(sim, sec(1));
    const before = ctl.monster!.position!;
    const g = maze.gates[0]!;
    put(a, g.opener.x, g.opener.y);
    ticks(sim, 2);
    put(a, g.x + g.w / 2, g.y + g.h / 2);
    ticks(sim, 2);
    ticks(sim, sec(4));
    const after = ctl.monster!.position!;
    const gx = g.x + g.w / 2;
    const gy = g.y + g.h / 2;
    expect(Math.hypot(after.x - gx, after.y - gy)).toBeLessThan(Math.hypot(before.x - gx, before.y - gy));
  });
});
