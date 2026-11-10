import {
  BTN,
  type GameMode,
  MAPS,
  type MapId,
  MatchState,
  NET,
  PlayerState,
  quantizeInput,
  ROLE,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { HideSeekMode } from "../src/modes/HideSeek.ts";
import type { PuzzleRaceMode } from "../src/modes/PuzzleRace.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation } from "../src/simulation/GameSimulation.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(mode: GameMode, map: MapId, ids: string[], variant?: string) {
  let r = 0.37;
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
  if (variant) rules.setVariant(variant);
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  state.phaseEndTick = sim.tick + sec(20 * 60);
  return { sim };
}

let seq = 0;
function tick(sim: GameSimulation, id: string, buttons: number) {
  sim.enqueue(id, [
    quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons, slot: -1, viewTick: sim.tick }),
  ]);
  sim.step(SERVER_TICK_MS, "live");
}

describe("Puzzle Race", () => {
  it("the right order scores, a wrong switch resets, a new code follows", () => {
    const { sim } = setup("puzzlerace", "maze-s-1207", ["a", "b"]);
    const ctl = sim.ctl as PuzzleRaceMode;
    const a = sim.players.get("a")!;
    for (let i = 0; i < 3; i++) tick(sim, "a", 0);
    const press = (letter: string) => {
      const m = [...ctl.markEntries().values()].find((q) => q.l === letter)!;
      a.sim.x = m.x;
      a.sim.y = m.y;
      tick(sim, "a", BTN.INTERACT);
      tick(sim, "a", 0);
    };
    const code = () => ctl.statusText().split(" · best")[0]!.replace("Code: ", "").split(" · ");
    const first = code();
    expect(first).toHaveLength(4);
    press(first[1]!); // wrong: resets
    for (const l of first) press(l);
    expect(ctl.facts(a).points).toBe(1);
    expect(ctl.standings()[0]!.id).toBe("a");
    expect(ctl.over()).toBeNull();
    for (let n = 0; n < 2; n++) for (const l of code()) press(l);
    expect(ctl.over()).toBe("solved");
  });
});

describe("Hide & Seek, Closing zone", () => {
  it("the zone shrinks during the hunt and reveals hiders outside it", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b", "c"], "closing");
    const ctl = sim.ctl as HideSeekMode;
    const hider = [...sim.players.values()].find((p) => p.team === ROLE.HIDER)!;
    for (let i = 0; i < sec(30 + 170); i++) sim.step(SERVER_TICK_MS, "live");
    expect(ctl.stage).toBe("hunt");
    const zone = ctl.markEntries().get("zone")!;
    expect(zone.r).toBeLessThan(Math.hypot(MAPS.depot.width, MAPS.depot.height));
    hider.sim.x = zone.x > MAPS.depot.width / 2 ? 80 : MAPS.depot.width - 80;
    hider.sim.y = zone.y > MAPS.depot.height / 2 ? 80 : MAPS.depot.height - 80;
    sim.step(SERVER_TICK_MS, "live");
    expect(Math.hypot(hider.sim.x - zone.x, hider.sim.y - zone.y)).toBeGreaterThan(zone.r);
    expect(ctl.masked(hider)).toBe(false);
  });
});
