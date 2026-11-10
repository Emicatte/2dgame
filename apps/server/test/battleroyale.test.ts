import {
  BATTLE_ROYALE,
  BTN,
  DROP,
  type InputFrame,
  MAPS,
  MatchState,
  NET,
  NO_WEAPON,
  PlayerState,
  quantizeInput,
  SERVER_TICK_MS,
  validateMap,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { BattleRoyaleMode } from "../src/modes/BattleRoyale.ts";
import { syncModeState } from "../src/modes/sync.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(ids: string[]) {
  let r = 0.37;
  const rng = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  const sim = new GameSimulation(MAPS.island, { tickRate: NET.serverTickRate, rng });
  const state = new MatchState();
  state.mapId = "island";
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
    state.players.set(id, new PlayerState());
  }
  rules.setMode("battleroyale");
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  return { sim, state, ctl: sim.ctl as BattleRoyaleMode };
}

let seq = 0;
/** One tick of input (three input steps, as a client sends). */
function input(sim: GameSimulation, id: string, f: Partial<InputFrame>) {
  sent.add(id);
  sim.enqueue(
    id,
    [0, 1, 2].map(() =>
      quantizeInput({ seq: ++seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: sim.tick, ...f }),
    ),
  );
}
/** Steps `n` ticks; every player idles unless `each` sends something else. */
const step = (sim: GameSimulation, n: number, each?: () => void) => {
  for (let i = 0; i < n; i++) {
    if (each) each();
    for (const id of sim.players.keys()) if (!sent.has(id)) input(sim, id, {});
    sent.clear();
    sim.step(SERVER_TICK_MS, "live");
  }
};
const sent = new Set<string>();
const onIsland = (sim: GameSimulation, p: ServerPlayer) =>
  p.sim.x > 0 && p.sim.y > 0 && p.sim.x < sim.map.width && p.sim.y < sim.map.height;

describe("Battle Royale", () => {
  it("the island is a valid map with named districts and loot", () => {
    expect(validateMap(MAPS.island)).toEqual([]);
    expect(MAPS.island.pois?.length).toBe(16);
    expect(MAPS.island.pickups.filter((p) => p.kind === "chest").length).toBeGreaterThanOrEqual(48);
  });

  it("starts on the bus, unarmed and untouchable; jump, freefall, parachute, landing", () => {
    const { sim, state, ctl } = setup(["a", "b"]);
    const a = sim.players.get("a")!;
    syncModeState(state, sim, []);
    expect(ctl.frozen(a)).toBe(true);
    expect(state.players.get("a")!.frozen).toBe(true);
    expect(a.sim.slots.every((s) => s.id === NO_WEAPON)).toBe(true);
    expect(ctl.playerTargetable(a)).toBe(false);
    // Wait until the bus is over the island, then jump.
    let guard = 0;
    while (!onIsland(sim, { sim: ctl.busAt(sim.tick) } as unknown as ServerPlayer) && guard++ < sec(20))
      step(sim, 1);
    step(sim, 3, () => input(sim, "a", { buttons: BTN.DASH }));
    expect(ctl.frozen(a)).toBe(false);
    expect(a.sim.alt).toBeGreaterThan(DROP.startAlt * 0.9);
    // Freefall steering: holding right moves right while descending.
    const x0 = a.sim.x;
    step(sim, sec(2), () => input(sim, "a", { mx: 1 }));
    expect(a.sim.x).toBeGreaterThan(x0 + 400);
    expect(a.sim.chute).toBe(false);
    // Low enough: the parachute opens by itself; then it lands.
    step(sim, sec(12), () => input(sim, "a", {}));
    expect(a.sim.alt).toBe(0);
    expect(a.sim.chute).toBe(false);
    expect(ctl.playerTargetable(a)).toBe(true);
  });

  it("whoever stays aboard is dropped before the bus leaves the island", () => {
    const { sim, ctl } = setup(["a", "b"]);
    step(sim, sec((2 * BATTLE_ROYALE.busHalfLength) / BATTLE_ROYALE.busSpeed) + 2);
    for (const p of sim.players.values()) {
      expect(ctl.frozen(p)).toBe(false);
      expect(onIsland(sim, p)).toBe(true);
    }
  });

  it("the storm shrinks and hurts outside; last one standing ends the match", () => {
    const { sim, ctl } = setup(["a", "b"]);
    const [a, b] = [sim.players.get("a")!, sim.players.get("b")!];
    step(sim, sec((2 * BATTLE_ROYALE.busHalfLength) / BATTLE_ROYALE.busSpeed) + sec(12));
    expect(a.sim.alt).toBe(0);
    // Skip to the first shrink.
    const first = BATTLE_ROYALE.phases[0]!;
    step(sim, sec(first.waitSec + first.shrinkSec));
    expect(ctl.statusText()).toMatch(/alive/);
    // Put b far outside the zone: it takes damage every second.
    b.sim.x = 5;
    b.sim.y = 5;
    const hp = b.hp;
    step(sim, sec(2.1));
    expect(b.hp).toBeLessThan(hp);
    b.hp = 1;
    step(sim, sec(1.1));
    expect(b.alive).toBe(false);
    expect(ctl.over()).toBe("last-standing");
    expect(ctl.standings()[0]!.id).toBe("a");
  });
});

describe("Battle Royale bots", () => {
  it("jump by themselves, land and go loot a weapon", async () => {
    const { BotDriver } = await import("../src/bots/BotBrain.ts");
    const { sim } = setup(["bot:1", "bot:2"]);
    const driver = new BotDriver();
    let armed = false;
    for (let i = 0; i < sec(70) && !armed; i++) {
      driver.drive(sim, ["bot:1", "bot:2"]);
      sim.step(SERVER_TICK_MS, "live");
      armed = [...sim.players.values()].some((p) => p.sim.slots.some((sl) => sl.id !== NO_WEAPON));
    }
    expect(armed).toBe(true);
    const looter = [...sim.players.values()].find((p) => p.sim.slots.some((sl) => sl.id !== NO_WEAPON))!;
    expect(looter.sim.alt).toBe(0);
  });
});
