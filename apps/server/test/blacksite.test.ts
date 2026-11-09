import {
  ACT,
  AI,
  BLACK_SITE,
  BTN,
  buildFlowField,
  buildNavGrid,
  findPath,
  type InputFrame,
  MAPS,
  type MissionDef,
  mulberry32,
  NAV_INF,
  NET,
  nearestWalkable,
  PLAYER,
  PVE_STATUS,
  pveWorlds,
  quantizeInput,
  refillAmmo,
  VENT_PHASE,
  ventPhase,
  ZOMBIES,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { PveController } from "../src/pve/PveController.ts";
import type { Zombie } from "../src/pve/ZombieWorld.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

const TICK_MS = 1000 / NET.serverTickRate;
const map = MAPS.blacksite;

function makeSim(seed = 21) {
  return new GameSimulation(map, { tickRate: NET.serverTickRate, rng: mulberry32(seed) });
}

function addPlayer(sim: GameSimulation, id: string): ServerPlayer {
  const p = sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    team: 1,
    skin: "foundry",
    level: 1,
    primary: "rifle",
    seed: id.length * 97,
  });
  sim.rules = { teams: true, friendlyFire: false };
  return p;
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
  p.pve.downed = false;
}

const seqs = new Map<string, number>();
function frames(id: string, n: number, f: Partial<InputFrame>, viewTick = 0): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

function tick(sim: GameSimulation, input: Record<string, Partial<InputFrame>> = {}) {
  for (const p of sim.players.values()) sim.enqueue(p.id, frames(p.id, 3, input[p.id] ?? {}, sim.tick));
  return sim.step(TICK_MS, "live");
}

/** Test access to the controller's script hooks (the mission normally drives these). */
type Script = { setPower(on: boolean): void; applyTriggers(t: unknown[]): void };
const script = (pve: PveController) => pve as unknown as Script;

function start(mission: MissionDef = BLACK_SITE, players = ["alpha"], difficulty = "veteran" as const) {
  const sim = makeSim();
  sim.setPve({ mode: "outbreak", mission, difficulty });
  sim.resetForMatch();
  const ps = players.map((id) => addPlayer(sim, id));
  sim.resetForMatch();
  return { sim, pve: sim.pve!, ps };
}

/** Removes every enemy (placed groups, ambient) so a test sees only what it sets up. */
function clearEnemies(pve: PveController) {
  for (const z of pve.zw.zombies.values()) pve.zw.remove(z);
}

const door = (id: string) => BLACK_SITE.doors.find((d) => d.id === id)!;

describe("Black Site: map and doors", () => {
  it("every point is reachable with the doors open; at the start only the hub and its three wings are", () => {
    const all = new Set(BLACK_SITE.doors.map((d) => d.id));
    const grid = buildNavGrid(pveWorlds(map, BLACK_SITE.doors, all).world);
    const from = nearestWalkable(grid, map.spawns[0]!.x, map.spawns[0]!.y, 1);
    const field = buildFlowField(grid, 1, [from]);
    const points = [
      ...BLACK_SITE.spawnZones,
      ...BLACK_SITE.props,
      ...BLACK_SITE.groups.flatMap((g) => g.enemies),
      ...BLACK_SITE.steps.flatMap((s) => (s.marker ? [s.marker] : [])),
      ...map.pickups,
    ];
    for (const p of points) {
      const c = nearestWalkable(grid, p.x, p.y, 1, 4);
      expect(c, `${JSON.stringify(p)} on the grid`).toBeGreaterThanOrEqual(0);
      expect(field.dist[c]!, `${JSON.stringify(p)} reachable`).toBeLessThan(NAV_INF);
    }
    // Brutes (third wave) reach the containment hall from every wave zone.
    const hall = buildFlowField(grid, 2, [nearestWalkable(grid, 2900, 1420, 2)]);
    for (const z of ["cells-n1", "cells-n2", "cells-s1", "cells-s2", "srv-ne", "archive-e"]) {
      const at = BLACK_SITE.spawnZones.find((s) => s.id === z)!;
      expect(hall.dist[nearestWalkable(grid, at.x, at.y, 2, 6)]!, `brute from ${z}`).toBeLessThan(NAV_INF);
    }
    // The Warden's body fits its hall and gets to the vault door.
    const cls = 3;
    const warden = nearestWalkable(grid, 4010, 1100, cls, 4);
    expect(warden).toBeGreaterThanOrEqual(0);
    const wf = buildFlowField(grid, cls, [warden]);
    expect(wf.dist[nearestWalkable(grid, 3790, 1420, cls, 6)]!).toBeLessThan(NAV_INF);

    // Start of the run: every mission door shut. The terminals are reachable, nothing past the
    // containment door, the archive door, the vault or the lift is.
    const shut = buildNavGrid(pveWorlds(map, BLACK_SITE.doors, new Set()).world);
    const f0 = buildFlowField(shut, 1, [nearestWalkable(shut, map.spawns[0]!.x, map.spawns[0]!.y, 1)]);
    for (const id of ["term-sec", "term-reactor", "term-server", "override", "intel-backup"]) {
      const pr = BLACK_SITE.props.find((p) => p.id === id)!;
      expect(f0.dist[nearestWalkable(shut, pr.x, pr.y, 1, 4)]!, id).toBeLessThan(NAV_INF);
    }
    for (const at of [
      { x: 2900, y: 1420 },
      { x: 2700, y: 2300 },
      { x: 4010, y: 1300 },
      { x: 4010, y: 2380 },
    ])
      expect(f0.dist[nearestWalkable(shut, at.x, at.y, 1, 4)]!, JSON.stringify(at)).toBe(NAV_INF);
  });

  it("automatic doors: shut without power; with power they open for a player and close behind once clear", () => {
    const { sim, pve, ps } = start();
    const a = ps[0]!;
    clearEnemies(pve);
    const d = door("archive-door");
    const solids = () => sim.world.solids.length;
    // Without power: standing right at it does nothing.
    place(a, d.x - 60, d.y + 80);
    for (let i = 0; i < 20; i++) tick(sim);
    expect(pve.doorsOpen.has(d.id)).toBe(false);
    const closed = solids();
    script(pve).setPower(true);
    tick(sim);
    expect(pve.doorsOpen.has(d.id)).toBe(true);
    expect(solids()).toBe(closed - 1);
    // Walk through (real movement) and on: it closes behind, not before the player is clear.
    let closedAt = -1;
    let crossedAt = -1;
    for (let i = 0; i < 20 * 4; i++) {
      const ev = tick(sim, { alpha: { mx: 1, my: 0 } });
      if (crossedAt < 0 && a.sim.x > d.x + d.w + PLAYER.radius) crossedAt = sim.tick;
      if (ev.some((e) => e.t === "pve" && e.k === "auto" && e.n === 0)) closedAt = sim.tick;
      if (closedAt > 0) break;
    }
    expect(crossedAt).toBeGreaterThan(0);
    expect(a.sim.x).toBeGreaterThan(d.x + d.w);
    expect(closedAt).toBeGreaterThan(crossedAt);
    expect(pve.doorsOpen.has(d.id)).toBe(false);
    // Somebody standing in the doorway keeps it open indefinitely.
    place(a, d.x + d.w / 2, d.y + d.h / 2);
    for (let i = 0; i < 20 * 4; i++) tick(sim);
    expect(pve.doorsOpen.has(d.id)).toBe(true);
    // An infected walking up to it opens it too.
    place(a, 1500, 1500);
    for (let i = 0; i < 20 * 3; i++) tick(sim);
    expect(pve.doorsOpen.has(d.id)).toBe(false);
    const z = pve.zw.spawn("walker", d.x + 60, d.y + 80, { state: "idle" });
    tick(sim);
    expect(pve.doorsOpen.has(d.id)).toBe(true);
    pve.zw.remove(z);
  });

  it("the infected path through working automatic doors even while they are shut; sealed doors stay shut", () => {
    const { sim, pve, ps } = start();
    const a = ps[0]!;
    clearEnemies(pve);
    place(a, 1500, 1500);
    script(pve).setPower(true);
    for (let i = 0; i < 20 * 3; i++) tick(sim);
    const d = door("archive-door");
    expect(pve.doorsOpen.has(d.id)).toBe(false);
    // The collision world has the door, the navigation does not: a path from the reactor wing
    // into the archive goes straight through it.
    const nav = pve.nav();
    const route = (x0: number, y0: number, x1: number, y1: number) =>
      findPath(nav, pve.worlds.world, 1, { x: x0, y: y0 }, { x: x1, y: y1 }, 20000);
    const path = route(2100, 2300, 2700, 2300);
    expect(path).not.toBeNull();
    expect(path!.points.some((p) => p.x > d.x - 40 && p.x < d.x + d.w + 40)).toBe(true);
    expect(sim.world.solids.length).toBe(map.solids.length + BLACK_SITE.doors.length);
    // Sealed doors (containment): no path through, and a player next to one cannot open it.
    const srv = door("srv-door");
    expect(pve.sealed.has(srv.id)).toBe(true);
    expect(pve.flags.has(`sealed-${srv.id}`)).toBe(true);
    expect(route(2980, 880, 2980, 1100)).toBeNull();
    place(a, srv.x + 80, srv.y - 60);
    for (let i = 0; i < 20 * 2; i++) tick(sim);
    expect(pve.doorsOpen.has(srv.id)).toBe(false);
    // The override lifts the seal: open at once, then automatic like the others.
    script(pve).applyTriggers([{ open: "srv-door" }]);
    expect(pve.sealed.has(srv.id)).toBe(false);
    expect(pve.flags.has(`sealed-${srv.id}`)).toBe(false);
    expect(pve.doorsOpen.has(srv.id)).toBe(true);
    expect(
      findPath(pve.nav(), pve.worlds.world, 1, { x: 2980, y: 880 }, { x: 2980, y: 1100 }, 20000),
    ).not.toBeNull();
  });

  it("decontamination vents: offline without power; with it, gas only after the warning, twice as hard on the infected", () => {
    const { sim, pve, ps } = start();
    const a = ps[0]!;
    clearEnemies(pve);
    a.protectedUntil = 0;
    const v = BLACK_SITE.vents!.find((x) => x.id === "vent-cont")!;
    const cx = v.area.x + v.area.w / 2;
    const cy = v.area.y + v.area.h / 2;
    place(a, cx, cy);
    const gas = (ev: ReturnType<typeof tick>) => ev.filter((e) => e.t === "hit" && e.v === a.id).length;
    let hits = 0;
    for (let i = 0; i < 20 * 12; i++) {
      a.hp = PLAYER.maxHealth;
      hits += gas(tick(sim));
    }
    expect(hits).toBe(0);
    expect(pve.ventStart).toBe(0);
    script(pve).setPower(true);
    expect(pve.ventStart).toBe(sim.tick);
    const z = pve.zw.spawn("brute", cx, cy - 120, { state: "idle" });
    z.hp = z.maxHp;
    let warnHit = 0;
    let activeHit = 0;
    let idleHit = 0;
    let zLost = 0;
    let pLost = 0;
    for (let i = 0; i < 20 * v.periodSec * 2; i++) {
      a.hp = PLAYER.maxHealth;
      const zBefore = z.hp;
      const ev = tick(sim);
      const phase = ventPhase(v, (sim.tick - pve.ventStart) / NET.serverTickRate);
      const n = gas(ev);
      if (phase === VENT_PHASE.WARN) warnHit += n;
      else if (phase === VENT_PHASE.ACTIVE) activeHit += n;
      else idleHit += n;
      pLost += PLAYER.maxHealth - a.hp;
      zLost += zBefore - z.hp;
      // Keep the brute where it was (it would walk out of the gas).
      z.x = cx;
      z.y = cy - 120;
      z.state = AI.IDLE;
    }
    expect(idleHit + warnHit).toBe(0);
    expect(activeHit).toBeGreaterThan(0);
    // Two cycles of gas: dps × active time each, the brute (×2) and the player alike.
    expect(pLost).toBeGreaterThan(v.dps * v.activeSec * 2 * 0.7);
    expect(zLost).toBeGreaterThan(pLost * 1.5);
    // Power off: offline again.
    script(pve).setPower(false);
    expect(pve.ventStart).toBe(0);
  });
});

/** The Warden alone in its hall (no ambient, no other step). */
function wardenFight(players: string[], seed = 21) {
  const mission: MissionDef = {
    ...BLACK_SITE,
    ambient: undefined,
    vents: [],
    steps: [BLACK_SITE.steps.find((s) => s.kind === "kill")!],
  };
  const sim = new GameSimulation(map, { tickRate: NET.serverTickRate, rng: mulberry32(seed) });
  sim.setPve({ mode: "outbreak", mission, difficulty: "veteran" });
  sim.resetForMatch();
  const ps = players.map((id) => addPlayer(sim, id));
  sim.resetForMatch();
  const pve = sim.pve!;
  const boss = [...pve.zw.zombies.values()].find((z) => z.def.kind === "warden")!;
  return { sim, pve, ps, boss };
}

describe("The Warden", () => {
  it("plating: the front shrugs off bullets, the back is its weak point, venting opens it up", () => {
    const { pve, ps, boss } = wardenFight(["alpha"]);
    const a = ps[0]!;
    boss.angle = 0;
    const r = boss.def.radius;
    const hit = (ang: number, precise = false) => {
      const before = boss.hp;
      boss.hp = boss.maxHp;
      pve.damageZombie(boss.id, 100, a, precise, boss.x + Math.cos(ang) * r, boss.y + Math.sin(ang) * r);
      const dealt = boss.maxHp - boss.hp;
      boss.hp = before;
      return dealt;
    };
    const p = ZOMBIES.warden.plating!;
    expect(hit(0)).toBe(Math.round(100 * p.front));
    expect(hit(Math.PI / 2)).toBe(Math.round(100 * p.side));
    expect(hit(Math.PI)).toBe(Math.round(100 * p.back));
    // The centre-mass bonus does not apply: where it lands is what counts.
    expect(hit(0, true)).toBeLessThanOrEqual(Math.round((100 / 1.5) * p.front) + 1);
    // Blasts (no hit point on the body) count as the flank.
    boss.hp = boss.maxHp;
    pve.zw.damage(boss, 100, "", false, boss.x, boss.y, true);
    expect(boss.maxHp - boss.hp).toBe(Math.round(100 * p.side));
    boss.hp = boss.maxHp;
    // Venting: front and flanks open, the back even more.
    boss.state = AI.ATTACK;
    boss.act = ACT.WINDUP;
    boss.cur = ZOMBIES.warden.boss!.phases[0]!.attacks.find((x) => x.kind === "vent")!;
    expect(hit(0)).toBe(Math.round(100 * p.open));
    expect(hit(Math.PI)).toBe(Math.round(100 * p.back * p.open));
  });

  it("sweeps are telegraphed, committed and hit only inside the cone; the tail lashes whoever stands behind", () => {
    const { sim, pve, ps, boss } = wardenFight(["alpha", "bravo"]);
    const [a, b] = ps as [ServerPlayer, ServerPlayer];
    a.protectedUntil = 0;
    b.protectedUntil = 0;
    // Skip the opening delay of the vent so the first close attack is a sweep.
    boss.cooldowns.set("vent", sim.tick + 20 * 60);
    boss.cooldowns.set("call", sim.tick + 20 * 60);
    place(a, boss.x + 120, boss.y);
    place(b, boss.x, boss.y + 400);
    boss.angle = 0;
    let windup = -1;
    let struck = -1;
    let dir = 0;
    for (let i = 0; i < 20 * 6 && struck < 0; i++) {
      a.hp = PLAYER.maxHealth;
      b.hp = PLAYER.maxHealth;
      const ev = tick(sim, { alpha: { aim: Math.PI } });
      if (windup < 0 && boss.act === ACT.WINDUP && boss.cur?.kind === "sweep" && !boss.cur.rear) {
        windup = sim.tick;
        dir = Math.atan2(boss.actY - boss.y, boss.actX - boss.x);
      }
      if (ev.some((e) => e.t === "zatk" && e.k === "sweep")) struck = sim.tick;
    }
    expect(windup).toBeGreaterThan(0);
    expect(struck - windup).toBeGreaterThanOrEqual(Math.round(0.95 * 20) - 1);
    // Committed towards where alpha stood, bravo (well to the side, out of reach) untouched.
    expect(Math.abs(dir)).toBeLessThan(0.3);

    // The tail: bravo right behind it gets lashed, and the Warden does not turn round to do it.
    clearEnemies(pve);
    const wy = 1180;
    // Same group as the first one: the kill step (and the run) goes on.
    const w = pve.zw.spawn("warden", 4010, wy, { state: "hunt", group: "warden" });
    w.cooldowns.set("vent", sim.tick + 20 * 60);
    w.cooldowns.set("bash", sim.tick + 20 * 60);
    w.cooldowns.set("call", sim.tick + 20 * 60);
    w.cooldowns.set("lash", 0);
    w.angle = 0;
    let lash = false;
    let facing = 0;
    let bHit = false;
    for (let i = 0; i < 20 * 4 && !bHit; i++) {
      a.hp = PLAYER.maxHealth;
      b.hp = PLAYER.maxHealth;
      // Alpha in front (its quarry, the nearer one), bravo close behind it.
      place(a, w.x + 130, wy);
      place(b, w.x - 150, wy);
      const ev = tick(sim);
      if (w.act === ACT.WINDUP && w.cur?.kind === "sweep" && w.cur.rear) {
        lash = true;
        facing = w.angle;
      }
      if (ev.some((e) => e.t === "hit" && e.v === b.id && e.p === `z:${w.id}`)) bHit = true;
    }
    expect(lash).toBe(true);
    expect(Math.abs(facing)).toBeLessThan(0.8);
    expect(bHit).toBe(true);
  });

  it("vents on a timer (not at once), stands still while venting, and the window ends with a burst", () => {
    const { sim, pve, ps, boss } = wardenFight(["alpha"]);
    const a = ps[0]!;
    a.protectedUntil = 0;
    place(a, boss.x + 200, boss.y + 400);
    const ph = ZOMBIES.warden.boss!.phases[0]!;
    const vent = ph.attacks.find((x) => x.kind === "vent")!;
    let ventAt = -1;
    let x0 = 0;
    let moved = 0;
    let burst = false;
    for (let i = 0; i < 20 * 20 && !burst; i++) {
      a.hp = PLAYER.maxHealth;
      a.pve.downed = false;
      const ev = tick(sim);
      if (ventAt < 0 && ZombieWorldVenting(boss)) {
        ventAt = sim.tick;
        x0 = boss.x;
      }
      if (ventAt > 0 && ZombieWorldVenting(boss)) moved = Math.max(moved, Math.abs(boss.x - x0));
      if (ev.some((e) => e.t === "zatk" && e.k === "vent")) burst = true;
    }
    expect(ventAt).toBeGreaterThan(0);
    // Not before its opening delay.
    expect((ventAt - pve.startTick) / 20).toBeGreaterThanOrEqual((vent.firstSec ?? 0) - 0.2);
    expect(burst).toBe(true);
    expect(moved).toBeLessThan(2);
  });

  it("a charge into a pillar stuns it (a second window); in phase 2 it calls stalkers", () => {
    const { sim, pve, ps, boss } = wardenFight(["alpha"]);
    const a = ps[0]!;
    a.protectedUntil = 0;
    boss.cooldowns.set("vent", sim.tick + 20 * 60);
    boss.cooldowns.set("call", sim.tick + 20 * 60);
    boss.cooldowns.set("bash", 0);
    // Alpha in front of a pillar draws the bash, then steps aside: the Warden runs into the pillar.
    pve.zw.relocate(boss, 3886, 1150);
    boss.angle = Math.PI / 2;
    place(a, 3886, 1590);
    let stunned = false;
    let charging = false;
    for (let i = 0; i < 20 * 8 && !stunned; i++) {
      a.hp = PLAYER.maxHealth;
      if (!charging) place(a, 3886, 1590);
      if (boss.act === ACT.WINDUP && boss.cur?.kind === "charge" && !charging) {
        charging = true;
        place(a, 4060, 1590);
      }
      tick(sim);
      if (boss.state === AI.STUNNED) stunned = true;
    }
    expect(charging).toBe(true);
    expect(stunned).toBe(true);
    // Stunned: hits land harder (on top of the plating).
    const before = boss.hp;
    pve.zw.damage(boss, 100, a.id, false, boss.x, boss.y, true);
    expect(before - boss.hp).toBe(
      Math.round(100 * ZOMBIES.warden.plating!.side * ZOMBIES.warden.stunnedDamageMult),
    );
    // Phase 2: stalkers join.
    pve.damageZombie(boss.id, (boss.maxHp * 0.55) / ZOMBIES.warden.plating!.side, a, false, boss.x, boss.y);
    expect(boss.phase).toBe(1);
    let stalkers = 0;
    for (let i = 0; i < 20 * 12 && stalkers === 0; i++) {
      a.hp = PLAYER.maxHealth;
      a.pve.downed = false;
      tick(sim);
      stalkers = [...pve.zw.zombies.values()].filter(
        (z) => !z.dead && z.group === boss.id && z.def.kind === "stalker",
      ).length;
    }
    expect(stalkers).toBeGreaterThan(0);
  });

  it("two players beat it far faster by working together (one holds its gaze, one shoots its back)", () => {
    const results: Record<string, { sec: number; taken: number; kinds: Set<string>; done: boolean }> = {};
    for (const plan of ["flank", "front"] as const) {
      const { sim, pve, ps, boss } = wardenFight(["tank", "gunner"], 31);
      const [tank, gunner] = ps as [ServerPlayer, ServerPlayer];
      place(tank, 4010, 1560);
      place(gunner, 3900, 1700);
      tank.protectedUntil = 0;
      gunner.protectedUntil = 0;
      const kinds = new Set<string>();
      let taken = 0;
      let t = 0;
      const maxSec = 240;
      for (; t < 20 * maxSec && !boss.dead; t++) {
        const input: Record<string, Partial<InputFrame>> = {
          tank: fighter(boss, tank, "tank", tank),
          gunner: fighter(boss, gunner, plan === "flank" ? "flank" : "beside", tank),
        };
        const ev = tick(sim, input);
        for (const e of ev) if (e.t === "zatk" && e.z === boss.id) kinds.add(e.k);
        for (const p of ps) {
          taken += PLAYER.maxHealth - p.hp;
          // Keep them standing: the test measures the fight, not the squad's survival.
          p.hp = PLAYER.maxHealth;
          p.pve.downed = false;
          p.alive = true;
          if (t % 20 === 0) refillAmmo(p.sim);
        }
        // Summoned adds are cleaned up by an imaginary third teammate.
        for (const z of pve.zw.zombies.values()) if (!z.dead && z !== boss) pve.zw.remove(z);
      }
      results[plan] = { sec: t / 20, taken: Math.round(taken), kinds, done: boss.dead };
      if (plan === "flank") expect(pve.status).toBe(PVE_STATUS.COMPLETE);
    }
    console.log(
      `[warden] flank: ${results.flank!.sec}s, damage taken ${results.flank!.taken}, attacks ${[...results.flank!.kinds].join(",")} | front only: ${results.front!.done ? `${results.front!.sec}s` : `not down after ${results.front!.sec}s`}, taken ${results.front!.taken}`,
    );
    expect(results.flank!.done).toBe(true);
    expect(results.flank!.sec).toBeLessThan(150);
    // Working together pays: well under two thirds of the time it takes standing in front.
    expect(results.flank!.sec).toBeLessThan(results.front!.sec * 0.66);
    for (const k of ["sweep", "vent"]) expect(results.flank!.kinds.has(k), k).toBe(true);
    // Over both fights it used its kit (the charge needs room these fights never give it: see the
    // pillar test).
    const all = new Set([...results.flank!.kinds, ...results.front!.kinds]);
    for (const k of ["sweep", "vent", "summon", "roar"]) expect(all.has(k), k).toBe(true);
  }, 60_000);
});

function ZombieWorldVenting(z: Zombie): boolean {
  return z.cur?.kind === "vent" && z.act === ACT.WINDUP && z.state === AI.ATTACK;
}

/**
 * Test fighter: aims at the Warden and fires. "tank" circles in front of it at the edge of sweep
 * reach and steps out of telegraphed cones and charge lanes; "flank" keeps to its back, out of the
 * tail's reach; "beside" stays next to the tank (both in front, nobody flanking).
 */
function fighter(
  boss: Zombie,
  p: ServerPlayer,
  role: "tank" | "beside" | "flank",
  buddy: ServerPlayer,
): Partial<InputFrame> {
  const dx = p.sim.x - boss.x;
  const dy = p.sim.y - boss.y;
  const d = Math.hypot(dx, dy) || 1;
  const aim = Math.atan2(-dy, -dx);
  let mx = 0;
  let my = 0;
  const winding = boss.state === AI.ATTACK && boss.act === ACT.WINDUP ? boss.cur : null;
  if (role === "flank") {
    const back = boss.angle + Math.PI;
    const gx = boss.x + Math.cos(back) * 300;
    const gy = boss.y + Math.sin(back) * 300;
    mx = gx - p.sim.x;
    my = gy - p.sim.y;
  } else if (role === "beside") {
    const ang = Math.atan2(buddy.sim.y - boss.y, buddy.sim.x - boss.x) + 0.4;
    mx = boss.x + Math.cos(ang) * 260 - p.sim.x;
    my = boss.y + Math.sin(ang) * 260 - p.sim.y;
  } else {
    // Holds its ground at ~200 px (close enough to draw sweeps, far enough to step out of them),
    // backing off and drifting a little sideways.
    const radial = (200 - d) / 60;
    mx = (dx / d) * radial - (dy / d) * 0.35;
    my = (dy / d) * radial + (dx / d) * 0.35;
  }
  if (winding?.kind === "sweep" || winding?.kind === "vent") {
    // Out of the circle / cone: straight away from it.
    const reach = (winding.radius ?? 180) + PLAYER.radius + 30;
    if (d < reach) {
      mx = dx / d;
      my = dy / d;
    }
  } else if (winding?.kind === "charge") {
    // Sideways out of the lane.
    const ang = Math.atan2(boss.actY - boss.y, boss.actX - boss.x);
    const side = Math.sin(Math.atan2(dy, dx) - ang) >= 0 ? 1 : -1;
    mx = -Math.sin(ang) * side;
    my = Math.cos(ang) * side;
  }
  // Stay inside the hall.
  if (p.sim.x < 3780) mx = Math.max(mx, 0.6);
  if (p.sim.x > 4240) mx = Math.min(mx, -0.6);
  if (p.sim.y < 800) my = Math.max(my, 0.6);
  if (p.sim.y > 1880) my = Math.min(my, -0.6);
  const l = Math.hypot(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  return { mx, my, aim, buttons: BTN.FIRE };
}

describe("Black Site mission script", () => {
  it("runs end to end: terminals, override, specimens, research, The Warden (fought for real), the lift", () => {
    const sim = makeSim(23);
    sim.setPve({ mode: "outbreak", mission: BLACK_SITE, difficulty: "recruit" });
    sim.resetForMatch();
    const a = addPlayer(sim, "alpha");
    const b = addPlayer(sim, "bravo");
    sim.resetForMatch();
    const pve = sim.pve!;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    const log: string[] = [];
    let spareBoss = true;
    const run = (sec: number, input: Record<string, Partial<InputFrame>> = {}, until?: () => boolean) => {
      for (let i = 0; i < sec * 20 && !until?.(); i++) {
        const ev = tick(sim, input);
        for (const e of ev)
          if (e.t === "pve" && e.k !== "auto")
            log.push(`${e.k}${e.n !== undefined ? ` ${e.n}` : ""}${e.s ? ` ${e.s}` : ""}`);
        for (const z of pve.zw.zombies.values()) {
          if (z.dead || (spareBoss && z.def.boss)) continue;
          if (
            Math.min(Math.hypot(z.x - a.sim.x, z.y - a.sim.y), Math.hypot(z.x - b.sim.x, z.y - b.sim.y)) < 700
          )
            pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
        }
      }
    };
    const hold = (id: string, p: ServerPlayer = a) => {
      const pr = BLACK_SITE.props.find((x) => x.id === id)!;
      place(p, pr.x, pr.y + 40);
      run(pr.holdSec + 3, { [p.id]: { buttons: BTN.INTERACT } }, () => pve.props.get(id)!.used);
      expect(pve.props.get(id)!.used, id).toBe(true);
    };
    // Start: dark, sealed, every mission door shut.
    expect(pve.power).toBe(false);
    expect(sim.world.solids.length).toBe(map.solids.length + BLACK_SITE.doors.length);
    expect(pve.flags.has("sealed-srv-door") && pve.flags.has("sealed-lab-door")).toBe(true);
    // 1. Into the atrium.
    place(a, 1720, 1400);
    place(b, 1760, 1400);
    run(1, {}, () => pve.stepIndex === 1);
    expect(pve.stepIndex).toBe(1);
    // 2. Three terminals; the archive door does nothing yet.
    place(b, 2400, 2300);
    run(1);
    expect(pve.doorsOpen.has("archive-door")).toBe(false);
    for (const id of ["term-sec", "term-reactor", "term-server"]) hold(id);
    run(1, {}, () => pve.stepIndex === 2);
    expect(pve.stepIndex).toBe(2);
    expect(pve.power).toBe(true);
    expect(pve.ventStart).toBeGreaterThan(0);
    place(b, 2400, 2300);
    run(0.5);
    expect(pve.doorsOpen.has("archive-door")).toBe(true);
    // 3. The override: breach, alarm, blackout, the containment doors unsealed.
    place(b, 1760, 1400);
    hold("override");
    run(1, {}, () => pve.stepIndex === 3);
    expect(pve.stepIndex).toBe(3);
    expect(pve.doorsOpen.has("cont-door")).toBe(true);
    expect(pve.sealed.size).toBe(0);
    expect(pve.alarm).toBe(true);
    expect(pve.flags.has("blackout")).toBe(true);
    // 4. Three waves of specimens in the containment hall.
    place(a, 2800, 1420);
    place(b, 2840, 1460);
    run(300, {}, () => pve.stepIndex === 4);
    expect(pve.stepIndex).toBe(4);
    expect(log.filter((l) => l.startsWith("clear")).length).toBe(3);
    expect(pve.alarm).toBe(false);
    expect(pve.flags.has("blackout")).toBe(false);
    // 5. The research.
    for (const id of ["intel-varga", "intel-backup", "intel-archive"]) hold(id);
    run(1, {}, () => pve.stepIndex === 5);
    expect(pve.stepIndex).toBe(5);
    expect(pve.doorsOpen.has("vault-door")).toBe(true);
    // 6. The Warden: a real fight (aim, fire, dodge), alpha holding its gaze, bravo at its back.
    const boss = [...pve.zw.zombies.values()].find((z) => z.def.kind === "warden")!;
    expect(boss).toBeDefined();
    expect(pve.bossId).toBe(boss.id);
    place(a, 4010, 1560);
    place(b, 3900, 1700);
    a.protectedUntil = 0;
    b.protectedUntil = 0;
    let fightTicks = 0;
    let taken = 0;
    for (; fightTicks < 20 * 150 && !boss.dead; fightTicks++) {
      run(1 / 20, { alpha: fighter(boss, a, "tank", a), bravo: fighter(boss, b, "flank", a) });
      for (const p of [a, b]) {
        taken += Math.max(0, PLAYER.maxHealth - p.hp);
        p.hp = PLAYER.maxHealth;
        p.pve.downed = false;
        p.alive = true;
        if (fightTicks % 20 === 0) refillAmmo(p.sim);
      }
    }
    expect(boss.dead).toBe(true);
    run(1, {}, () => pve.stepIndex === 6);
    expect(pve.stepIndex).toBe(6);
    expect(pve.doorsOpen.has("lift-door")).toBe(true);
    // 7. The lift.
    spareBoss = false;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    place(a, 4010, 2380);
    place(b, 4060, 2400);
    run(40, {}, () => pve.status !== PVE_STATUS.RUNNING);
    expect(pve.status).toBe(PVE_STATUS.COMPLETE);
    console.log(
      `[mission] Black Site: Warden down in ${(fightTicks / 20).toFixed(1)} s (${Math.round(taken)} damage taken) | ${log.join(" | ")}`,
    );
    const { result, xp } = pve.results(0);
    expect(result.completed).toBe(true);
    expect(result.progress).toBe(BLACK_SITE.steps.length);
    expect(xp.get("alpha")!.lines[0]!.reason).toContain("Black Site");
  });
});
