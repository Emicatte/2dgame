/**
 * Mode benchmark: 8 simulated players with random inputs for 60 s of match time per mode, through
 * the same path a room runs every tick (simulation step, state mirroring, per-viewer filtered
 * encoding). Prints tick cost (ms) and downstream bytes per client per second.
 *
 *   pnpm --filter @scrapline/server exec tsx scripts/modebench.ts
 *
 * Numbers are from the machine it runs on; they are not a 60 FPS claim for any client.
 */
import { Encoder, StateView } from "@colyseus/schema";
import {
  BTN,
  type GameMode,
  hashString,
  MAPS,
  type MapId,
  MatchState,
  NET,
  PlayerState,
  quantizeInput,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { syncModeState } from "../src/modes/sync.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation } from "../src/simulation/GameSimulation.ts";
import { syncDrops, syncPlayerState, syncVehicles } from "../src/simulation/stateSync.ts";

const SECONDS = Number(process.env.BENCH_SECONDS ?? 60);
/** BENCH_PLAYERS=16 for bigger rooms (Battle Royale scaling: 8, 16, 32, 50). */
const PLAYERS = Number(process.env.BENCH_PLAYERS ?? 8);

function bench(mode: GameMode, map: MapId) {
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const sim = new GameSimulation(MAPS[map], { tickRate: NET.serverTickRate, rng });
  const state = new MatchState();
  state.mapId = map;
  const rules = new MatchRules(sim, state, () => false);
  const encoder = new Encoder(state);
  const views: [string, StateView][] = [];
  for (let i = 0; i < PLAYERS; i++) {
    const id = `p${i}`;
    sim.addPlayer({
      id,
      playerId: `pid-${i}`,
      name: id,
      skin: "foundry",
      level: 1,
      primary: "rifle",
      seed: hashString(id),
    });
    const ps = new PlayerState();
    ps.name = id;
    state.players.set(id, ps);
    const v = new StateView();
    v.add(ps);
    views.push([id, v]);
  }
  rules.setMode(mode);
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  state.phaseEndTick = sim.tick + 60 * 60 * NET.serverTickRate;
  const seq = new Map<string, number>();
  const aims = new Map<string, number>();
  const costs: number[] = [];
  let bytes = 0;
  const ticks = SECONDS * NET.serverTickRate;
  for (let t = 0; t < ticks; t++) {
    for (const [id] of views) {
      const frames = [];
      let aim = aims.get(id) ?? rng() * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const s = (seq.get(id) ?? 0) + 1;
        seq.set(id, s);
        aim += (rng() - 0.5) * 0.3;
        frames.push(
          quantizeInput({
            seq: s,
            mx: Math.round(Math.cos(aim)),
            my: Math.round(Math.sin(aim)),
            aim,
            buttons: rng() < 0.3 ? BTN.FIRE : 0,
            slot: -1,
            viewTick: Math.max(0, sim.tick - 2),
          }),
        );
      }
      aims.set(id, aim);
      sim.enqueue(id, frames);
    }
    const t0 = performance.now();
    sim.step(SERVER_TICK_MS, "live");
    state.tick = sim.tick;
    for (const [id, p] of sim.players) syncPlayerState(state.players.get(id)!, p, sim.tick, sim);
    rules.sync();
    syncVehicles(state, sim);
    syncDrops(state, sim);
    syncModeState(state, sim, views);
    const it = { offset: 0 };
    encoder.encode(it);
    const shared = it.offset;
    for (const [, v] of views) bytes += encoder.encodeView(v, shared, it).byteLength;
    encoder.discardChanges();
    costs.push(performance.now() - t0);
    if (sim.modeOver()) {
      // A round mode that finished early: restart it to keep measuring live play.
      rules.prepareMatch();
      sim.resetForMatch();
    }
  }
  costs.sort((a, b) => a - b);
  const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
  return {
    mode,
    map,
    tickAvgMs: Math.round(avg * 1000) / 1000,
    tickP99Ms: Math.round(costs[Math.floor(costs.length * 0.99)]! * 1000) / 1000,
    tickMaxMs: Math.round(costs[costs.length - 1]! * 1000) / 1000,
    downKBps: Math.round((bytes / PLAYERS / SECONDS / 1024) * 100) / 100,
  };
}

/** BENCH_MODES="battleroyale:island,maze:maze-m-4721" picks the runs. */
const runs: [GameMode, MapId][] = process.env.BENCH_MODES
  ? process.env.BENCH_MODES.split(",").map((r) => r.split(":") as [GameMode, MapId])
  : [
      ["deathmatch", "industrial"],
      ["gungame", "industrial"],
      ["hideseek", "depot"],
      ["prophunt", "depot"],
    ];
// Warm-up (JIT) then the measured runs.
bench("deathmatch", "industrial");
for (const [mode, map] of runs) console.log(JSON.stringify({ players: PLAYERS, ...bench(mode, map) }));
