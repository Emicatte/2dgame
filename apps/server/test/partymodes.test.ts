import { Decoder, Encoder, StateView } from "@colyseus/schema";
import {
  BTN,
  DISGUISES,
  disguiseByName,
  GUN_GAME,
  gunGameWeapon,
  HIDE_SEEK,
  type InputFrame,
  MAPS,
  MatchState,
  NET,
  type NetEvent,
  NO_WEAPON,
  PlayerState,
  PROP_HUNT,
  quantizeInput,
  ROLE,
  SERVER_TICK_MS,
  WEAPONS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { GunGameMode } from "../src/modes/GunGame.ts";
import type { HideSeekMode } from "../src/modes/HideSeek.ts";
import type { PropHuntMode } from "../src/modes/PropHunt.ts";
import { syncModeState } from "../src/modes/sync.ts";
import { computeResults } from "../src/players/results.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";
import { syncPlayerState } from "../src/simulation/stateSync.ts";

const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(
  mode: "gungame" | "hideseek" | "prophunt",
  map: keyof typeof MAPS,
  ids: string[],
  opts: { variant?: string; rounds?: number } = {},
) {
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
  if (opts.variant) rules.setVariant(opts.variant);
  if (opts.rounds) rules.setRounds(opts.rounds);
  rules.prepareMatch();
  sim.resetForMatch();
  state.phase = "playing";
  state.phaseEndTick = sim.tick + sec(20 * 60);
  return { sim, state, rules };
}

const seqs = new Map<string, number>();
function input(sim: GameSimulation, id: string, f: Partial<InputFrame>, frames = 1) {
  const batch: InputFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const s = (seqs.get(`${id}`) ?? 0) + 1;
    seqs.set(id, s);
    batch.push(
      quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: sim.tick, ...f }),
    );
  }
  sim.enqueue(id, batch);
}

function ticks(sim: GameSimulation, n: number): NetEvent[] {
  const ev: NetEvent[] = [];
  for (let i = 0; i < n; i++) ev.push(...sim.step(SERVER_TICK_MS, "live"));
  return ev;
}

function put(p: ServerPlayer, x: number, y: number) {
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
}

/** Eliminates `victim` as if `killer` had shot them with `weapon` (deterministic). */
function eliminate(sim: GameSimulation, victim: ServerPlayer, killer: ServerPlayer | null, weapon: number) {
  victim.protectedUntil = 0;
  sim.damageFromMode(victim, 999, killer, weapon, victim.sim.x, victim.sim.y);
}

describe("Gun Game", () => {
  it("everyone starts on the first ladder weapon, alone in its slots, endless reserve; no vehicles, no weapon pickups", () => {
    // Urban Warfare has vehicles and weapon pickups: Gun Game turns both off.
    const { sim } = setup("gungame", "urban", ["a", "b"]);
    expect(sim.vehicles.size).toBe(0);
    for (const pk of sim.pickups.values()) if (pk.def.kind !== "health") expect(pk.active).toBe(false);
    for (const p of sim.players.values()) {
      expect(p.sim.slots.map((s) => s.id)).toEqual([
        WEAPONS[GUN_GAME.ladder[0]!].index,
        NO_WEAPON,
        NO_WEAPON,
      ]);
      expect(p.sim.slots[0]!.reserve).toBe(-1);
    }
  });

  it("an elimination with the ladder weapon moves the killer to the next weapon at once", () => {
    const { sim } = setup("gungame", "industrial", ["a", "b"]);
    const ctl = sim.ctl as GunGameMode;
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    eliminate(sim, b, a, WEAPONS[gunGameWeapon(0)].index);
    expect(ctl.levelOf(a)).toBe(1);
    expect(a.sim.slots[0]!.id).toBe(WEAPONS[gunGameWeapon(1)].index);
    // Wrong weapon (not the ladder weapon): nothing.
    sim.spawn(b, false);
    eliminate(sim, b, a, WEAPONS.sniper.index);
    expect(ctl.levelOf(a)).toBe(1);
  });

  it("fast respawn with spawn protection", () => {
    const { sim } = setup("gungame", "industrial", ["a", "b"]);
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    eliminate(sim, b, a, WEAPONS[gunGameWeapon(0)].index);
    expect(b.alive).toBe(false);
    ticks(sim, sec(GUN_GAME.respawnSec) + 1);
    expect(b.alive).toBe(true);
    expect(b.protectedUntil).toBeGreaterThan(sim.tick);
  });

  it("killed by somebody behind you on the ladder: back one level", () => {
    const { sim } = setup("gungame", "industrial", ["a", "b"]);
    const ctl = sim.ctl as GunGameMode;
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    for (let i = 0; i < 3; i++) {
      eliminate(sim, b, a, WEAPONS[gunGameWeapon(ctl.levelOf(a))].index);
      sim.spawn(b, false);
    }
    expect(ctl.levelOf(a)).toBe(3);
    const ev = ticks(sim, 1);
    expect(ev.length).toBeGreaterThanOrEqual(0);
    eliminate(sim, a, b, WEAPONS[gunGameWeapon(0)].index);
    expect(ctl.levelOf(b)).toBe(1);
    expect(ctl.levelOf(a)).toBe(2);
  });

  it("an elimination with the final weapon wins: the match ends, the winner ranks first", () => {
    const { sim, rules } = setup("gungame", "industrial", ["a", "b", "c"]);
    const ctl = sim.ctl as GunGameMode;
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    for (let l = 0; l < GUN_GAME.ladder.length - 1; l++) {
      eliminate(sim, b, a, WEAPONS[gunGameWeapon(ctl.levelOf(a))].index);
      sim.spawn(b, false);
    }
    expect(ctl.levelOf(a)).toBe(ctl.finalLevel);
    expect(rules.endReason(sim.tick)).toBeNull();
    eliminate(sim, b, a, WEAPONS[gunGameWeapon(ctl.finalLevel)].index);
    expect(rules.endReason(sim.tick)).toBe("ladder");
    expect(sim.standings()[0]!.id).toBe("a");
    const facts = ctl.facts(a);
    expect(facts.extra.gungameWins).toBe(1);
    expect(facts.points).toBe(GUN_GAME.ladder.length);
  });

  it("time out with a tie on the top level: overtime, then the first to stand alone wins", () => {
    const { sim, state, rules } = setup("gungame", "industrial", ["a", "b"]);
    const ctl = sim.ctl as GunGameMode;
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    state.phaseEndTick = sim.tick + 1;
    ticks(sim, 2);
    expect(rules.endReason(sim.tick)).toBeNull();
    expect(ctl.overtimeActive).toBe(true);
    expect(state.phaseEndTick).toBe(sim.tick + sec(GUN_GAME.overtimeSec));
    eliminate(sim, b, a, WEAPONS[gunGameWeapon(0)].index);
    expect(rules.endReason(sim.tick)).toBe("ladder");
  });

  it("results: points = ladder level, XP for levels climbed is capped and only for completed matches", () => {
    const { sim } = setup("gungame", "industrial", ["a", "b"]);
    const ctl = sim.ctl as GunGameMode;
    const a = sim.players.get("a")!;
    const b = sim.players.get("b")!;
    for (let i = 0; i < 4; i++) {
      eliminate(sim, b, a, WEAPONS[gunGameWeapon(ctl.levelOf(a))].index);
      sim.spawn(b, false);
    }
    a.stats.activeTicks = sec(120);
    b.stats.activeTicks = sec(120);
    const done = computeResults(sim.standings(), {
      tickRate: NET.serverTickRate,
      minParticipationTicks: sec(60),
      completed: true,
      facts: (p) => ctl.facts(p),
    });
    expect(done[0]!.points).toBe(5);
    expect(done[0]!.xp.lines.some((l) => l.reason.includes("weapon levels"))).toBe(true);
    expect(done[0]!.persist.extra?.gungameLevels).toBe(4);
    const short = computeResults(sim.standings(), {
      tickRate: NET.serverTickRate,
      minParticipationTicks: sec(600),
      completed: true,
      facts: (p) => ctl.facts(p),
    });
    expect(short[0]!.xp.lines.some((l) => l.reason.includes("weapon levels"))).toBe(false);
    expect(short[0]!.persist.extra).toBeUndefined();
  });
});

describe("Hide & Seek", () => {
  it("one seeker for up to five players: in the pen, frozen and armed; hiders unarmed with less health", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b", "c"]);
    const ctl = sim.ctl as HideSeekMode;
    const seekers = [...sim.players.values()].filter((p) => ctl.sideOf(p.id) === ROLE.SEEKER);
    expect(seekers.map((p) => p.id)).toEqual(["a"]);
    const pen = MAPS.depot.party!.seekerPen;
    const s = seekers[0]!;
    expect(pen.some((q) => q.x === s.sim.x && q.y === s.sim.y)).toBe(true);
    expect(s.sim.slots.filter((x) => x.id !== NO_WEAPON).length).toBe(2);
    for (const h of [...sim.players.values()].filter((p) => p !== s)) {
      expect(h.sim.slots.every((x) => x.id === NO_WEAPON)).toBe(true);
      expect(h.hp).toBe(HIDE_SEEK.hiderHealth);
    }
    // The seeker cannot move while the hiders hide.
    const x0 = s.sim.x;
    input(sim, "a", { mx: -1 }, 20);
    ticks(sim, 10);
    expect(s.sim.x).toBe(x0);
    expect(ctl.stage).toBe("prep");
  });

  it("after the hiding time the hunt starts and the seeker moves", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b"]);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    expect(ctl.stage).toBe("hunt");
    const s = sim.players.get("a")!;
    const x0 = s.sim.x;
    input(sim, "a", { mx: -1 }, 30);
    ticks(sim, 4);
    expect(s.sim.x).toBeLessThan(x0);
  });

  it("a hider out of sight is masked: the public pose never follows them; seen, it becomes public and 'spot' fires", () => {
    const { sim, state } = setup("hideseek", "depot", ["a", "b"]);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const seeker = sim.players.get("a")!;
    const hider = sim.players.get("b")!;
    // Behind the warehouse racks, far from the seeker in the booth.
    put(hider, 200, 330);
    ticks(sim, 2);
    expect(ctl.masked(hider)).toBe(true);
    const ps = state.players.get("b")!;
    syncPlayerState(ps, hider, sim.tick, sim);
    expect(ps.masked).toBe(true);
    expect(ps.x).not.toBe(hider.sim.x);
    put(hider, 260, 330);
    syncPlayerState(ps, hider, sim.tick, sim);
    expect(ps.x).not.toBe(260);
    // In plain view of the seeker, same room, nothing in between.
    put(seeker, 700, 330);
    put(hider, 900, 330);
    const ev = ticks(sim, 1);
    expect(ctl.masked(hider)).toBe(false);
    expect(ev.some((e) => e.t === "spot" && e.p === "b")).toBe(true);
    syncPlayerState(ps, hider, sim.tick, sim);
    expect(ps.masked).toBe(false);
    expect(ps.x).toBe(900);
  });

  it("shadows and hiding spots: only seen from close by", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b"]);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const seeker = sim.players.get("a")!;
    const hider = sim.players.get("b")!;
    // Shadow zone in the north-west corner (0,0,128,192): seen from 100 px, not from 300.
    put(hider, 60, 100);
    put(seeker, 360, 100);
    ticks(sim, sec(1));
    expect(ctl.masked(hider)).toBe(true);
    put(seeker, 160, 100);
    ticks(sim, 1);
    expect(ctl.masked(hider)).toBe(false);
    // Under a tarp (420,1330 r 30): only within the spot range.
    put(hider, 420, 1330);
    put(seeker, 560, 1330);
    ticks(sim, sec(1));
    expect(ctl.masked(hider)).toBe(true);
    put(seeker, 470, 1330);
    ticks(sim, 1);
    expect(ctl.masked(hider)).toBe(false);
  });

  it("events about a masked hider reach only their own side", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b", "c"]);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const b = sim.players.get("b")!;
    put(b, 200, 330);
    ticks(sim, 1);
    const spawnEv: NetEvent = { t: "spawn", p: "b", x: 200, y: 330 };
    const dashEv: NetEvent = { t: "dash", p: "b" };
    expect(ctl.eventVisible("a", spawnEv)).toBe(false);
    expect(ctl.eventVisible("a", dashEv)).toBe(false);
    expect(ctl.eventVisible("c", dashEv)).toBe(true);
    expect(ctl.eventVisible("b", dashEv)).toBe(true);
    expect(sim.eventsFor("a", [spawnEv, dashEv, { t: "round", s: "hunt", n: 1 }])).toEqual([
      { t: "round", s: "hunt", n: 1 },
    ]);
  });

  it("all hiders found: the seekers win the round; next round the seeker role rotates; the match ends after its rounds", () => {
    const { sim, rules } = setup("hideseek", "depot", ["a", "b", "c"], { rounds: 2 });
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const a = sim.players.get("a")!;
    for (const id of ["b", "c"]) eliminate(sim, sim.players.get(id)!, a, WEAPONS.smg.index);
    // Found hiders are out until the next round.
    expect(sim.players.get("b")!.respawnTick).toBe(0);
    ticks(sim, 1);
    expect(ctl.stage).toBe("break");
    expect(ctl.lastWinner).toBe(ROLE.SEEKER);
    expect(ctl.pointsOf("a")).toBe(2 * HIDE_SEEK.points.find);
    ticks(sim, sec(HIDE_SEEK.breakSec) + 1);
    expect(ctl.round).toBe(2);
    expect(ctl.stage).toBe("prep");
    expect(ctl.sideOf("b")).toBe(ROLE.SEEKER);
    expect(ctl.sideOf("a")).toBe(ROLE.HIDER);
    expect([...sim.players.values()].every((p) => p.alive)).toBe(true);
    // Round 2: the hiders survive the timer.
    ticks(sim, sec(HIDE_SEEK.prepSec + HIDE_SEEK.huntSec) + 2);
    expect(ctl.lastWinner).toBe(ROLE.HIDER);
    expect(ctl.pointsOf("a")).toBeGreaterThan(2 * HIDE_SEEK.points.find + HIDE_SEEK.points.survive);
    ticks(sim, sec(HIDE_SEEK.breakSec) + 1);
    expect(rules.endReason(sim.tick)).toBe("rounds");
  });

  it("Infection variant: a found hider joins the seekers", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b", "c"], { variant: "infect" });
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const b = sim.players.get("b")!;
    eliminate(sim, b, sim.players.get("a")!, WEAPONS.smg.index);
    expect(ctl.sideOf("b")).toBe(ROLE.SEEKER);
    ticks(sim, sec(2) + 1);
    expect(b.alive).toBe(true);
    expect(b.sim.slots[0]!.id).toBe(WEAPONS.smg.index);
    expect(ctl.stage).toBe("hunt");
  });

  it("Blackout variant: with the lights out only the flashlight cone (or arm's length) finds a hider", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b"], { variant: "blackout" });
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    ticks(sim, sec(HIDE_SEEK.blackout.onSec) + 1);
    expect(ctl.dark).toBe(true);
    const seeker = sim.players.get("a")!;
    const hider = sim.players.get("b")!;
    put(seeker, 700, 330);
    put(hider, 1000, 330);
    seeker.sim.aim = Math.PI; // facing away
    ticks(sim, sec(1));
    expect(ctl.masked(hider)).toBe(true);
    seeker.sim.aim = 0; // flashlight on the hider
    ctl.step();
    expect(ctl.masked(hider)).toBe(false);
  });

  it("the seeker leaving ends the round; one human left ends the match", () => {
    const { sim, rules } = setup("hideseek", "depot", ["a", "b", "c"]);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    sim.removePlayer("a");
    ticks(sim, 1);
    expect(ctl.stage).toBe("break");
    expect(ctl.lastWinner).toBe(ROLE.HIDER);
    sim.removePlayer("b");
    expect(rules.endReason(sim.tick)).toBe("opponents-left");
  });

  it("somebody joining mid-match watches until the next round", () => {
    const { sim } = setup("hideseek", "depot", ["a", "b"]);
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const late = sim.addPlayer({
      id: "z",
      playerId: "pid-z",
      name: "z",
      skin: "foundry",
      level: 1,
      primary: "rifle",
      seed: 1,
    });
    sim.spawnLater(late, 1);
    ticks(sim, sec(3));
    expect(late.alive).toBe(false);
  });

  it("start needs two players", () => {
    const { rules } = setup("hideseek", "depot", ["a"]);
    expect(rules.startBlocker()).toMatch(/at least 2/);
  });
});

describe("Prop Hunt", () => {
  const ph = (ids = ["a", "b", "c"]) => {
    const s = setup("prophunt", "depot", ids);
    return { ...s, ctl: s.sim.ctl as PropHuntMode };
  };

  it("fills most of the map's spots with real objects under random ids; props are always masked; hunters frozen", () => {
    const { sim, ctl } = ph();
    const spots = MAPS.depot.party!.props.length;
    expect(ctl.objects.size).toBeGreaterThan(spots * 0.6);
    expect(ctl.objects.size).toBeLessThanOrEqual(spots);
    for (const id of ctl.objects.keys()) expect(id).toMatch(/^[0-9a-z]{6}$/);
    const hunter = [...sim.players.values()].find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!;
    const props = [...sim.players.values()].filter((p) => ctl.sideOf(p.id) === ROLE.HIDER);
    expect(hunter.sim.slots[0]!.id).toBe(WEAPONS.shotgun.index);
    for (const p of props) {
      expect(ctl.masked(p)).toBe(true);
      expect(ctl.publicPose(p)).not.toBeNull();
    }
    expect(ctl.frozen(hunter)).toBe(true);
    expect(ctl.canSeeObjects(hunter.id)).toBe(false);
    expect(ctl.canSeeObjects(props[0]!.id)).toBe(true);
  });

  it("transform: only into objects present on the map, with that object's body, health scaled", () => {
    const { sim, ctl } = ph();
    const p = sim.players.get("b")!;
    put(p, 700, 700);
    const crate = disguiseByName("crate")!;
    ctl.ability(p, { a: "transform", k: crate.index });
    expect(ctl.kindOf(p)?.kind).toBe("crate");
    expect(sim.ctl!.body(p)).toEqual({ radius: crate.radius, speed: crate.speed });
    expect(p.hp).toBe(crate.health);
    expect(ctl.objectOf(p)!.owner).toBe("b");
    // A kind that is not on this map is refused.
    const absent = DISGUISES.find((d) => !MAPS.depot.party!.props.some((s) => s.kind === d.kind));
    if (absent) {
      ctl.ability(p, { a: "transform", k: absent.index });
      expect(ctl.kindOf(p)?.kind).toBe("crate");
    }
  });

  it("a big object does not fit in a narrow gap", () => {
    const { sim, ctl } = ph();
    const p = sim.players.get("b")!;
    // The aisle at x 1248–1440 next to the rack row ends at y 240: just below a rack edge.
    put(p, 1262, 260);
    const ev = (() => {
      ctl.ability(p, { a: "transform", k: disguiseByName("vending")!.index });
      return ticks(sim, 1);
    })();
    expect(ctl.kindOf(p)).toBeUndefined();
    expect(ev.some((e) => e.t === "msg" && e.p === "b")).toBe(true);
  });

  it("when the hunt starts, undisguised props become objects and every id is renewed", () => {
    const { sim, ctl } = ph();
    const before = new Set(ctl.objects.keys());
    ticks(sim, sec(PROP_HUNT.prepSec) + 1);
    expect(ctl.stage).toBe("hunt");
    for (const p of sim.players.values()) {
      if (ctl.sideOf(p.id) === ROLE.HIDER) expect(ctl.kindOf(p)).toBeDefined();
    }
    for (const id of ctl.objects.keys()) expect(before.has(id)).toBe(false);
    const hunter = [...sim.players.values()].find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!;
    expect(ctl.canSeeObjects(hunter.id)).toBe(true);
    expect(ctl.frozen(hunter)).toBe(false);
  });

  function huntWithProp() {
    const s = ph(["a", "b"]);
    const { sim, ctl } = s;
    const hunter = sim.players.get("a")!;
    const prop = sim.players.get("b")!;
    put(prop, 1000, 650);
    ctl.ability(prop, { a: "transform", k: disguiseByName("barrel")!.index });
    ticks(sim, sec(PROP_HUNT.prepSec) + 1);
    return { ...s, hunter, prop };
  }

  it("shooting a disguised player damages them; no penalty", () => {
    const { sim, ctl, hunter, prop } = huntWithProp();
    put(hunter, 1000, 590);
    const hp0 = hunter.hp;
    const php0 = prop.hp;
    input(sim, "a", { aim: Math.PI / 2, buttons: BTN.FIRE, viewTick: sim.tick });
    const ev = ticks(sim, 2);
    expect(prop.hp).toBeLessThan(php0);
    expect(hunter.hp).toBe(hp0);
    expect(ev.some((e) => e.t === "dhit")).toBe(true);
    expect(ev.some((e) => e.t === "penalty")).toBe(false);
    expect(ctl.masked(prop)).toBe(true);
  });

  it("shooting an innocent object costs the hunter health", () => {
    const { sim, ctl, hunter } = huntWithProp();
    const innocent = [...ctl.objects.values()].find(
      (o) => !o.owner && o.x > 150 && o.x < 1300 && o.y > 500 && o.y < 900,
    )!;
    put(hunter, innocent.x, innocent.y - 60);
    const hp0 = hunter.hp;
    input(sim, "a", { aim: Math.PI / 2, buttons: BTN.FIRE, viewTick: sim.tick });
    const ev = ticks(sim, 2);
    expect(ev.some((e) => e.t === "penalty" && e.p === "a")).toBe(true);
    expect(hunter.hp).toBe(hp0 - PROP_HUNT.innocentPenalty);
  });

  it("finding a prop: it is out, its object disappears, the hunter scores and heals", () => {
    const { sim, ctl, hunter, prop } = huntWithProp();
    hunter.hp = 50;
    const oid = ctl.objectOf(prop)!.id;
    eliminate(sim, prop, hunter, WEAPONS.shotgun.index);
    expect(ctl.objects.has(oid)).toBe(false);
    expect(ctl.pointsOf("a")).toBe(PROP_HUNT.points.find);
    expect(hunter.hp).toBe(50 + PROP_HUNT.findHeal);
    ticks(sim, 1);
    expect(ctl.lastWinner).toBe(ROLE.SEEKER);
  });

  it("lock freezes the object; taunt scores and makes a sound; a decoy is an innocent object that expires", () => {
    const { sim, ctl, prop } = huntWithProp();
    ctl.ability(prop, { a: "lock" });
    const x0 = prop.sim.x;
    input(sim, "b", { mx: 1 }, 20);
    ticks(sim, 5);
    expect(prop.sim.x).toBe(x0);
    expect(ctl.frozen(prop)).toBe(true);
    const pts = ctl.pointsOf("b");
    ctl.ability(prop, { a: "taunt" });
    const ev = ticks(sim, 1);
    expect(ev.some((e) => e.t === "taunt")).toBe(true);
    expect(ctl.pointsOf("b")).toBeGreaterThanOrEqual(pts + PROP_HUNT.points.taunt);
    const n = ctl.objects.size;
    ctl.ability(prop, { a: "decoy" });
    expect(ctl.objects.size).toBe(n + 1);
    const decoy = [...ctl.objects.values()].find((o) => o.decoyUntil > 0)!;
    expect(decoy.owner).toBeNull();
    expect(decoy.k).toBe(ctl.kindOf(prop)!.index);
    ticks(sim, sec(PROP_HUNT.decoySec) + 1);
    expect(ctl.objects.has(decoy.id)).toBe(false);
  });

  it("quick transform during the hunt has a cooldown", () => {
    const { sim, ctl, prop } = huntWithProp();
    ctl.ability(prop, { a: "transform", k: disguiseByName("box")!.index });
    expect(ctl.kindOf(prop)?.kind).toBe("box");
    ctl.ability(prop, { a: "transform", k: disguiseByName("bin")!.index });
    expect(ctl.kindOf(prop)?.kind).toBe("box");
    ticks(sim, sec(PROP_HUNT.quickTransformCooldownSec) + 1);
    ctl.ability(prop, { a: "transform", k: disguiseByName("bin")!.index });
    expect(ctl.kindOf(prop)?.kind).toBe("bin");
  });

  it("hints: approximate areas that contain the prop and are not centred on it; standing still earns a ping", () => {
    const { sim, state, ctl, prop } = huntWithProp();
    for (let i = 0; i < PROP_HUNT.stillSec + 5 && state.pings.size === 0; i++) {
      ticks(sim, sec(1));
      ctl.sync(state);
    }
    expect(state.pings.size).toBeGreaterThanOrEqual(1);
    for (const ping of state.pings.values()) {
      const d = Math.hypot(ping.x - prop.sim.x, ping.y - prop.sim.y);
      expect(d).toBeLessThan(ping.r);
      expect(d).toBeGreaterThan(10);
    }
  });

  it("a hit on a prop is told only to the shooter and the props' side", () => {
    const { ctl } = ph(["a", "b", "c"]);
    const ev: NetEvent = { t: "hit", p: "a", v: "b", dmg: 10, x: 1, y: 1, k: false };
    const hunter = ctl.sideOf("a") === ROLE.SEEKER ? "a" : "b";
    expect(ctl.eventVisible(hunter, { ...ev, p: hunter, v: "c" })).toBe(true);
  });
});

describe("hidden information on the wire", () => {
  /** Encodes the state for two clients with their own StateViews and decodes it, like the rooms. */
  /** The Encoder exists before any view is filled, as in both rooms. */
  function wire(state: MatchState, views: [string, StateView][]) {
    const enc = new Encoder(state);
    for (const [id, v] of views) v.add(state.players.get(id)!);
    const decoders = new Map(views.map(([id]) => [id, new Decoder(new MatchState())]));
    const full = () => {
      const shared = enc.encodeAll({ offset: 0 }).slice();
      for (const [id, v] of views)
        decoders.get(id)!.decode(enc.encodeAllView(v, shared.byteLength, { offset: shared.byteLength }));
    };
    const patch = () => {
      const it = { offset: 0 };
      enc.encode(it);
      const off = it.offset;
      for (const [id, v] of views) decoders.get(id)!.decode(enc.encodeView(v, off, it).slice());
      enc.discardChanges();
    };
    return { full, patch, state: (id: string) => decoders.get(id)!.state as MatchState };
  }

  function syncAll(sim: GameSimulation, state: MatchState, views: [string, StateView][]) {
    for (const [id, p] of sim.players) syncPlayerState(state.players.get(id)!, p, sim.tick, sim);
    syncModeState(state, sim, views);
  }

  it("Hide & Seek: the seeker's client never receives a hidden hider's position or ghost", () => {
    const { sim, state } = setup("hideseek", "depot", ["a", "b"]);
    const views: [string, StateView][] = ["a", "b"].map((id) => [id, new StateView()]);
    const w = wire(state, views);
    syncAll(sim, state, views);
    w.full();
    ticks(sim, sec(HIDE_SEEK.prepSec) + 1);
    const hider = sim.players.get("b")!;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      put(hider, 150 + i * 2, 330);
      ticks(sim, 1);
      syncAll(sim, state, views);
      w.patch();
      seen.add(Math.round(w.state("a").players.get("b")!.x));
      expect(w.state("a").allies.size).toBe(0);
      // The hider's own client has the real pose (its ghost) for its prediction.
      expect(Math.round(w.state("b").allies.get("b")!.x)).toBe(150 + i * 2);
    }
    // The seeker saw one constant (non-informative) pose the whole time.
    expect(seen.size).toBe(1);
    expect(w.state("a").players.get("b")!.masked).toBe(true);
  });

  it("Prop Hunt: hunters receive no objects during the prep, then all of them at once, and never a ghost", () => {
    const { sim, state } = setup("prophunt", "depot", ["a", "b", "c"]);
    const ctl = sim.ctl as PropHuntMode;
    const hunter = [...sim.players.values()].find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!.id;
    const prop = [...sim.players.values()].find((p) => ctl.sideOf(p.id) === ROLE.HIDER)!.id;
    const views: [string, StateView][] = ["a", "b", "c"].map((id) => [id, new StateView()]);
    const w = wire(state, views);
    syncAll(sim, state, views);
    w.full();
    ticks(sim, 5);
    syncAll(sim, state, views);
    w.patch();
    expect(w.state(hunter).disguises.size).toBe(0);
    expect(w.state(prop).disguises.size).toBe(ctl.objects.size);
    ticks(sim, sec(PROP_HUNT.prepSec));
    syncAll(sim, state, views);
    w.patch();
    expect(ctl.stage).toBe("hunt");
    expect(w.state(hunter).disguises.size).toBe(ctl.objects.size);
    expect(w.state(hunter).allies.size).toBe(0);
    // Nothing on a hunter's copy of an object says whether a player controls it.
    const anyObject = [...w.state(hunter).disguises.values()][0]!;
    expect(Object.keys(anyObject.toJSON()).sort()).toEqual(["k", "r", "x", "y"]);
    expect(w.state(prop).allies.get(prop)!.d).toBe(ctl.objectOf(sim.players.get(prop)!)!.id);
  });
});
