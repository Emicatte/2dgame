import { hasLineOfSight, MAPS, mulberry32, NET, PLAYER, quantizeInput } from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { BOT_NAMES, BOT_PROFILES, BotDriver, personalityOf } from "../src/bots/BotBrain.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

const TICK_MS = 1000 / NET.serverTickRate;

function arena(mapId: "industrial" | "urban" = "industrial", seed = 7) {
  const sim = new GameSimulation(MAPS[mapId], { tickRate: NET.serverTickRate, rng: mulberry32(seed) });
  sim.resetForMatch();
  return sim;
}

function add(sim: GameSimulation, id: string): ServerPlayer {
  return sim.addPlayer({
    id,
    playerId: "",
    name: id,
    skin: "ash",
    level: 1,
    primary: "rifle",
    seed: id.length * 31,
  });
}

/** A human who stands still (empty input). */
function idle(sim: GameSimulation, id: string) {
  sim.enqueue(
    id,
    [0, 1, 2].map((i) =>
      quantizeInput({
        seq: sim.tick * 3 + i + 1,
        mx: 0,
        my: 0,
        aim: 0,
        buttons: 0,
        slot: -1,
        viewTick: sim.tick,
      }),
    ),
  );
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
  p.protectedUntil = 0;
}

/** Two free spots of the map that see each other at a fighting distance. */
function facingSpots(sim: GameSimulation): [{ x: number; y: number }, { x: number; y: number }] {
  const s = sim.map.spawns;
  for (const a of s)
    for (const b of s) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 300 && d < 600 && hasLineOfSight(sim.shotWorld, a.x, a.y, b.x, b.y)) return [a, b];
    }
  throw new Error("no facing spawns");
}

describe("practice bots", () => {
  it("see a player, react after a moment (not instantly), then shoot and hit", () => {
    const sim = arena();
    const human = add(sim, "human");
    const bot = add(sim, "bot:1");
    sim.resetForMatch();
    const driver = new BotDriver();
    const [a, b] = facingSpots(sim);
    place(human, a.x, a.y);
    place(bot, b.x, b.y);
    let firstShot = -1;
    let firstHit = -1;
    for (let i = 0; i < 20 * 6 && firstHit < 0; i++) {
      driver.drive(sim, ["bot:1"]);
      idle(sim, "human");
      const ev = sim.step(TICK_MS, "live");
      if (firstShot < 0 && ev.some((e) => e.t === "shot" && e.p === bot.id)) firstShot = i;
      if (ev.some((e) => e.t === "hit" && e.v === human.id && e.p === bot.id)) firstHit = i;
      human.hp = PLAYER.maxHealth;
    }
    expect(firstShot).toBeGreaterThanOrEqual(Math.floor(0.3 * 20) - 1);
    expect(firstHit).toBeGreaterThan(0);
  });

  it("a hurt bot under fire breaks line of sight (cover) instead of standing there", () => {
    const sim = arena("urban", 3);
    const human = add(sim, "human");
    const bot = add(sim, "bot:1");
    sim.resetForMatch();
    const driver = new BotDriver();
    const [a, b] = facingSpots(sim);
    place(human, a.x, a.y);
    place(bot, b.x, b.y);
    // It has seen the human, then gets hurt.
    for (let i = 0; i < 20; i++) {
      driver.drive(sim, ["bot:1"]);
      idle(sim, "human");
      sim.step(TICK_MS, "live");
      human.hp = PLAYER.maxHealth;
    }
    bot.hp = PLAYER.maxHealth * 0.25;
    let hidden = -1;
    for (let i = 0; i < 20 * 5 && hidden < 0; i++) {
      driver.drive(sim, ["bot:1"]);
      idle(sim, "human");
      sim.step(TICK_MS, "live");
      human.hp = PLAYER.maxHealth;
      bot.hp = Math.max(1, Math.min(bot.hp, PLAYER.maxHealth * 0.25));
      if (!hasLineOfSight(sim.shotWorld, human.sim.x, human.sim.y, bot.sim.x, bot.sim.y)) hidden = i;
    }
    expect(hidden).toBeGreaterThanOrEqual(0);
  });

  it("three bots left alone fight each other: they move around the map, kill and do not get stuck", () => {
    const sim = arena("industrial", 11);
    const ids = BOT_NAMES.map((_, i) => `bot:${i + 1}`);
    const bots = ids.map((id) => add(sim, id));
    sim.resetForMatch();
    const driver = new BotDriver();
    const travelled = new Map(ids.map((id) => [id, 0]));
    const last = new Map(bots.map((b) => [b.id, { x: b.sim.x, y: b.sim.y }]));
    let kills = 0;
    let hits = 0;
    let shots = 0;
    let thinkMs = 0;
    for (let i = 0; i < 20 * 90; i++) {
      const t0 = performance.now();
      driver.drive(sim, ids);
      thinkMs += performance.now() - t0;
      const ev = sim.step(TICK_MS, "live");
      for (const e of ev) {
        if (e.t === "kill") kills++;
        if (e.t === "hit") hits++;
        if (e.t === "shot") shots++;
      }
      for (const b of bots) {
        const l = last.get(b.id)!;
        const d = Math.hypot(b.sim.x - l.x, b.sim.y - l.y);
        // Respawns teleport: count walking only.
        if (d < 40) travelled.set(b.id, travelled.get(b.id)! + d);
        last.set(b.id, { x: b.sim.x, y: b.sim.y });
      }
    }
    console.log(
      `[bots] 90 s: ${kills} kills, ${shots} shots, ${hits} hits, travelled ${[...travelled.values()].map((v) => Math.round(v)).join("/")} px`,
    );
    console.log(
      `[bots] decision cost ${((thinkMs / (20 * 90 * ids.length)) * 1000).toFixed(0)} µs per bot per tick`,
    );
    expect(kills).toBeGreaterThanOrEqual(2);
    // Imperfect aim: they hit, but not every time.
    expect(hits).toBeGreaterThan(0);
    for (const [id, d] of travelled) expect(d, id).toBeGreaterThan(1500);
  }, 60_000);

  it("only sees what it faces: an enemy behind it at distance goes unnoticed until it turns", () => {
    const sim = arena();
    const human = add(sim, "human");
    const bot = add(sim, "bot:1");
    sim.resetForMatch();
    const driver = new BotDriver();
    const [a, b] = facingSpots(sim);
    place(human, a.x, a.y);
    place(bot, b.x, b.y);
    // Facing directly away from the human.
    const away = Math.atan2(b.y - a.y, b.x - a.x);
    let shots = 0;
    for (let i = 0; i < 20; i++) {
      bot.sim.aim = away;
      bot.sim.x = b.x;
      bot.sim.y = b.y;
      driver.drive(sim, ["bot:1"]);
      idle(sim, "human");
      for (const e of sim.step(TICK_MS, "live")) if (e.t === "shot" && e.p === bot.id) shots++;
    }
    expect(shots).toBe(0);
  });

  it("hears gunfire out of sight and goes to investigate", () => {
    const sim = arena("urban", 3);
    const human = add(sim, "human");
    const bot = add(sim, "bot:2");
    sim.resetForMatch();
    const driver = new BotDriver();
    // Two spawns without line of sight, in earshot.
    const s = sim.map.spawns;
    let pair: [{ x: number; y: number }, { x: number; y: number }] | null = null;
    for (const a of s)
      for (const b of s) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!pair && d > 500 && d < 1200 && !hasLineOfSight(sim.shotWorld, a.x, a.y, b.x, b.y)) pair = [a, b];
      }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    place(human, a.x, a.y);
    place(bot, b.x, b.y);
    const start = Math.hypot(b.x - a.x, b.y - a.y);
    for (let i = 0; i < 20 * 4; i++) {
      driver.drive(sim, ["bot:2"]);
      // The human fires every half second (not at anyone).
      sim.enqueue(
        "human",
        [0, 1, 2].map((k) =>
          quantizeInput({
            seq: sim.tick * 3 + k + 1,
            mx: 0,
            my: 0,
            aim: 0,
            buttons: i % 10 === 0 ? 1 : 0,
            slot: -1,
            viewTick: sim.tick,
          }),
        ),
      );
      sim.step(TICK_MS, "live");
      human.hp = PLAYER.maxHealth;
    }
    const end = Math.hypot(bot.sim.x - human.sim.x, bot.sim.y - human.sim.y);
    expect(end).toBeLessThan(start - 150);
  });

  it("personalities differ in how they weigh the same situation", () => {
    expect(personalityOf("bot:1")).toBe("aggressive");
    expect(personalityOf("bot:2")).toBe("tactical");
    expect(personalityOf("bot:3")).toBe("cautious");
    expect(BOT_PROFILES.aggressive.rangeMult).toBeLessThan(BOT_PROFILES.cautious.rangeMult);
    expect(BOT_PROFILES.aggressive.retreatHp).toBeLessThan(BOT_PROFILES.cautious.retreatHp);
    expect(BOT_PROFILES.tactical.flank).toBe(true);
    expect(BOT_PROFILES.support.supportAllies).toBe(true);
  });
});
