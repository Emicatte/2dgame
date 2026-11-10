import {
  MAPS,
  type MapId,
  MatchState,
  NET,
  PlayerState,
  SERVER_TICK_MS,
  validateMap,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { HotPotatoMode, RacingMode } from "../src/modes/PartyModes.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation } from "../src/simulation/GameSimulation.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(map: MapId, mode: "hotpotato" | "freeroam" | "racing", ids: string[]) {
  const sim = new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng: () => 0.3 });
  const state = new MatchState();
  state.mapId = map;
  const rules = new MatchRules(sim, state, () => false);
  for (const id of ids) {
    sim.addPlayer({
      id,
      playerId: `p-${id}`,
      name: id,
      skin: "foundry",
      level: 1,
      primary: "rifle",
      seed: 7,
    });
    state.players.set(id, new PlayerState());
  }
  rules.setMode(mode);
  rules.prepareMatch();
  sim.resetForMatch();
  return { sim, state };
}
const step = (sim: GameSimulation, n: number) => {
  for (let i = 0; i < n; i++) sim.step(SERVER_TICK_MS, "live");
};

describe("Hot Potato, Free Roam, Racing", () => {
  it("hot potato: touch passes the charge, it goes off on the holder, last one wins", () => {
    const { sim } = setup("industrial", "hotpotato", ["a", "b"]);
    const ctl = sim.ctl as HotPotatoMode;
    const h = sim.players.get(ctl.holder)!;
    const o = [...sim.players.values()].find((p) => p.id !== h.id)!;
    o.sim.x = h.sim.x + 20;
    o.sim.y = h.sim.y;
    step(sim, 1);
    expect(ctl.holder).toBe(o.id);
    o.sim.x += 900;
    step(sim, sec(26));
    expect(sim.players.get(o.id)!.alive).toBe(false);
    expect(ctl.over()).toBe("last-standing");
    expect(ctl.standings()[0]!.id).toBe(h.id);
  });

  it("free roam: nobody can hurt anybody; the island has vehicles", () => {
    expect(validateMap(MAPS.island)).toEqual([]);
    const { sim } = setup("island", "freeroam", ["a", "b"]);
    expect(sim.vehicles.size).toBeGreaterThanOrEqual(8);
    const [a, b] = [sim.players.get("a")!, sim.players.get("b")!];
    expect(sim.ctl!.damageScale(a, b)).toBe(0);
  });

  it("racing: a car per player on the grid, checkpoints in order, laps", () => {
    const { sim } = setup("urban", "racing", ["a", "b"]);
    const ctl = sim.ctl as RacingMode;
    const cars = [...sim.vehicles.keys()].filter((id) => id.startsWith("race-"));
    expect(cars.length).toBe(2);
    expect(ctl.statusText()).toContain("3 laps");
    const marks = [...ctl.markEntries().values()];
    const a = sim.players.get("a")!;
    // Visit the course in order three times.
    for (let lap = 0; lap < 3; lap++)
      for (let i = 1; i <= marks.length; i++) {
        const m = marks[i % marks.length]!;
        a.sim.x = m.x;
        a.sim.y = m.y;
        step(sim, 1);
      }
    expect(ctl.frozen(a)).toBe(true);
    expect(ctl.standings()[0]!.id).toBe("a");
  });
});
