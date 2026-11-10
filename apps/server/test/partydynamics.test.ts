import {
  DISGUISES,
  disguiseByName,
  HIDE_SEEK,
  MAPS,
  MatchState,
  NET,
  type NetEvent,
  PARTY_ABILITIES,
  PlayerState,
  PROP_HUNT,
  ROLE,
  SERVER_TICK_MS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { HideSeekMode } from "../src/modes/HideSeek.ts";
import type { PropHuntMode } from "../src/modes/PropHunt.ts";
import { syncModeState } from "../src/modes/sync.ts";
import { MatchRules } from "../src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

/** 0.8.1 party mechanics: sonar, noise decoy, swap, lights out, the new objects. */
const sec = (s: number) => Math.round(s * NET.serverTickRate);

function setup(mode: "hideseek" | "prophunt", map: keyof typeof MAPS, ids: string[], variant?: string) {
  let r = 0.29;
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
  return { sim, state };
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

describe("Hide & Seek: sonar, noise decoy, lights out", () => {
  function hunt(variant?: string) {
    const { sim, state } = setup("hideseek", "depot", ["a", "b", "c"], variant);
    const ctl = sim.ctl as HideSeekMode;
    ticks(sim, sec(HIDE_SEEK.prepSec) + 2);
    const all = [...sim.players.values()];
    const seeker = all.find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!;
    const hiders = all.filter((p) => ctl.sideOf(p.id) === ROLE.HIDER);
    return { sim, state, ctl, seeker, hiders };
  }

  it("the seekers' sonar pings the hiders in range only, then recharges", () => {
    const { sim, state, ctl, seeker, hiders } = hunt();
    const [near, far] = hiders;
    put(seeker, 700, 700);
    put(near!, 900, 700);
    put(far!, 1900, 1200);
    const ev: NetEvent[] = [];
    sim.ctl!.ability(seeker, { a: "sonar" });
    ev.push(...ticks(sim, 1));
    expect(ev.some((e) => e.t === "sonar")).toBe(true);
    expect(ctl.pings.size).toBe(1);
    const ping = [...ctl.pings.values()][0]!;
    expect(Math.hypot(ping.x - near!.sim.x, ping.y - near!.sim.y)).toBeLessThan(
      PARTY_ABILITIES.sonar.pingRadius,
    );
    // Not centred on the hider.
    expect(Math.hypot(ping.x - near!.sim.x, ping.y - near!.sim.y)).toBeGreaterThan(0);
    syncModeState(state, sim, []);
    expect(state.pings.size).toBe(1);
    expect(state.players.get(seeker.id)!.abl).toBeGreaterThan(sim.tick);
    // Recharging: refused with a message, no new ping.
    sim.ctl!.ability(seeker, { a: "sonar" });
    const again = ticks(sim, 1);
    expect(again.some((e) => e.t === "msg" && e.p === seeker.id)).toBe(true);
    expect(ctl.pings.size).toBe(1);
    // Hiders cannot use the sonar.
    sim.ctl!.ability(near!, { a: "sonar" });
    expect(ticks(sim, 1).some((e) => e.t === "sonar")).toBe(false);
  });

  it("a hider's noise decoy is a ping where they aim, never farther than the range", () => {
    const { sim, ctl, seeker, hiders } = hunt();
    const h = hiders[0]!;
    put(h, 700, 700);
    sim.ctl!.ability(h, { a: "noise", x: 5000, y: 700 });
    ticks(sim, 1);
    expect(ctl.pings.size).toBe(1);
    const ping = [...ctl.pings.values()][0]!;
    expect(Math.hypot(ping.x - 700, ping.y - 700)).toBeLessThanOrEqual(PARTY_ABILITIES.noise.rangePx + 1);
    // Seekers have no noise decoy.
    sim.ctl!.ability(seeker, { a: "noise", x: 800, y: 800 });
    ticks(sim, 1);
    expect(ctl.pings.size).toBe(1);
    // The ping fades after its few seconds.
    ticks(sim, sec(PARTY_ABILITIES.noise.pingSec) + 1);
    expect(ctl.pings.size).toBe(0);
  });

  it("the lights go out mid-hunt for a while, announced, and come back", () => {
    const { sim, state, ctl } = hunt();
    const ev = ticks(sim, sec(PARTY_ABILITIES.lightsOut.atSec) + 1);
    expect(ctl.dark).toBe(true);
    expect(ev.some((e) => e.t === "announce" && e.s === "Lights out")).toBe(true);
    syncModeState(state, sim, []);
    expect(state.round.dark).toBe(true);
    const ev2 = ticks(sim, sec(PARTY_ABILITIES.lightsOut.durationSec) + 1);
    expect(ctl.dark).toBe(false);
    expect(ev2.some((e) => e.t === "announce" && e.s === "Lights back on")).toBe(true);
  });

  it("Blackout keeps its own cycle, without the announcements", () => {
    const { sim, ctl } = hunt("blackout");
    const ev = ticks(sim, sec(HIDE_SEEK.blackout.onSec) + 2);
    expect(ctl.dark).toBe(true);
    expect(ev.some((e) => e.t === "announce")).toBe(false);
  });
});

describe("Prop Hunt: swap, hunters' sonar, more objects", () => {
  function huntWithProp(map: keyof typeof MAPS = "depot") {
    const { sim, state } = setup("prophunt", map, ["a", "b", "c"]);
    const ctl = sim.ctl as PropHuntMode;
    const all = [...sim.players.values()];
    const hunter = all.find((p) => ctl.sideOf(p.id) === ROLE.SEEKER)!;
    const prop = all.find((p) => ctl.sideOf(p.id) === ROLE.HIDER)!;
    ticks(sim, sec(PROP_HUNT.prepSec) + 2);
    return { sim, state, ctl, hunter, prop };
  }

  it("every party map offers all 18 objects", () => {
    expect(DISGUISES.length).toBe(18);
    for (const id of ["depot", "motel", "market"] as const) {
      const kinds = new Set(MAPS[id].party!.props.map((p) => p.kind));
      expect(kinds.size, id).toBe(DISGUISES.length);
    }
  });

  it("swap: the prop takes the nearest real object's place and kind, its own object stays as a real one", () => {
    const { sim, ctl, prop } = huntWithProp();
    const mine = ctl.objectOf(prop)!;
    // The nearest real object to the prop.
    const target = [...ctl.objects.values()]
      .filter((o) => !o.owner && o.decoyUntil === 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - prop.sim.x, a.y - prop.sim.y) - Math.hypot(b.x - prop.sim.x, b.y - prop.sim.y),
      )[0]!;
    // Bring the prop within range of it, on a free spot.
    put(prop, mine.x, mine.y);
    const dx = target.x - prop.sim.x;
    const dy = target.y - prop.sim.y;
    const d = Math.hypot(dx, dy);
    if (d > PARTY_ABILITIES.swap.rangePx) {
      // Move the object close instead (still a real object of the map).
      target.x = prop.sim.x + (dx / d) * 120;
      target.y = prop.sim.y + (dy / d) * 120;
    }
    const before = { mine: { ...mine }, target: { ...target } };
    sim.ctl!.ability(prop, { a: "swap" });
    const ev = ticks(sim, 1);
    expect(ev.filter((e) => e.t === "poof")).toHaveLength(2);
    // Same ids, same places, same kinds: only who controls them changed.
    expect(ctl.objects.get(before.mine.id)!.owner).toBeNull();
    expect(ctl.objects.get(before.target.id)!.owner).toBe(prop.id);
    expect(ctl.objects.get(before.mine.id)!.k).toBe(before.mine.k);
    expect(ctl.objectOf(prop)!.id).toBe(before.target.id);
    expect(ctl.kindOf(prop)!.index).toBe(before.target.k);
    expect(Math.hypot(prop.sim.x - before.target.x, prop.sim.y - before.target.y)).toBeLessThan(2);
    // Recharging.
    sim.ctl!.ability(prop, { a: "swap" });
    expect(ticks(sim, 1).some((e) => e.t === "msg" && e.p === prop.id)).toBe(true);
  });

  it("swap is refused with nothing in range, and the hunters' sonar pings props", () => {
    const { sim, ctl, hunter, prop } = huntWithProp();
    for (const o of ctl.objects.values()) if (!o.owner) ctl.objects.delete(o.id);
    sim.ctl!.ability(prop, { a: "swap" });
    expect(ticks(sim, 1).some((e) => e.t === "msg" && e.s.includes("No object"))).toBe(true);
    put(hunter, prop.sim.x + 200, prop.sim.y);
    sim.ctl!.ability(hunter, { a: "sonar" });
    const ev = ticks(sim, 1);
    expect(ev.some((e) => e.t === "sonar")).toBe(true);
    expect(ctl.pings.size).toBeGreaterThanOrEqual(1);
  });

  it("props can turn into the new objects (a sofa is slow and tough, an extinguisher small and fragile)", () => {
    const { sim, ctl, prop } = huntWithProp("motel");
    const sofa = disguiseByName("sofa")!;
    const ext = disguiseByName("extinguisher")!;
    expect(sofa.speed).toBeLessThan(1);
    expect(ext.radius).toBeLessThan(sofa.radius);
    // Where the prop already stands as a bigger object: a smaller one always fits there.
    const at = ctl.objectOf(prop)!;
    put(prop, at.x, at.y);
    sim.ctl!.ability(prop, { a: "transform", k: ext.index });
    ticks(sim, sec(PROP_HUNT.quickTransformCooldownSec) + 1);
    expect(ctl.kindOf(prop)?.kind).toBe("extinguisher");
    expect(sim.ctl!.body(prop)?.radius).toBe(ext.radius);
  });
});
