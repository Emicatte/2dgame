import {
  buildFlowField,
  buildNavGrid,
  FINAL_BREACH,
  type InputFrame,
  MAPS,
  type MissionDef,
  NAV_INF,
  nearestWalkable,
  PLAYER,
  PVE_STATUS,
  pveWorlds,
  refillAmmo,
  VENT_PHASE,
  ventOnline,
  ventPhase,
  ZOMBIES,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import type { ServerPlayer } from "../src/simulation/GameSimulation.ts";
import { addPlayer, clearEnemies, fighter, makeSim, place, start, tick } from "./pveHelpers.ts";

const map = MAPS.breach;
const stepOf = (kind: string) => FINAL_BREACH.steps.findIndex((s) => s.kind === kind);

/** Final Breach with only the steps from `from` on (the rest of the script unchanged). */
function from(index: number, extra: Partial<MissionDef> = {}): MissionDef {
  return { ...FINAL_BREACH, ambient: undefined, steps: FINAL_BREACH.steps.slice(index), ...extra };
}

describe("Final Breach: map and script", () => {
  it("every point is reachable with the doors open, and Subject Zero fits its hall", () => {
    const grid = buildNavGrid(
      pveWorlds(map, FINAL_BREACH.doors, new Set(FINAL_BREACH.doors.map((d) => d.id))).world,
    );
    const field = buildFlowField(grid, 1, [nearestWalkable(grid, map.spawns[0]!.x, map.spawns[0]!.y, 1)]);
    const points = [
      ...FINAL_BREACH.spawnZones,
      ...FINAL_BREACH.props,
      ...FINAL_BREACH.groups.flatMap((g) => g.enemies),
      ...FINAL_BREACH.steps.flatMap((s) => (s.marker ? [s.marker] : [])),
      ...map.pickups,
    ];
    for (const p of points) {
      const c = nearestWalkable(grid, p.x, p.y, 1, 4);
      expect(c, JSON.stringify(p)).toBeGreaterThanOrEqual(0);
      expect(field.dist[c]!, JSON.stringify(p)).toBeLessThan(NAV_INF);
    }
    // Brutes (third wave) reach the atrium from their zones.
    const atrium = buildFlowField(grid, 2, [nearestWalkable(grid, 2800, 1100, 2)]);
    for (const z of ["atrium-nw", "atrium-ne", "atrium-sw", "atrium-se"]) {
      const at = FINAL_BREACH.spawnZones.find((s) => s.id === z)!;
      expect(atrium.dist[nearestWalkable(grid, at.x, at.y, 2, 6)]!, z).toBeLessThan(NAV_INF);
    }
    // Subject Zero (the largest body) moves through its whole hall.
    const sz = buildFlowField(grid, 3, [nearestWalkable(grid, 4250, 2400, 3, 4)]);
    for (const at of [
      { x: 3820, y: 1640 },
      { x: 4680, y: 2700 },
      { x: 4150, y: 1620 },
    ])
      expect(sz.dist[nearestWalkable(grid, at.x, at.y, 3, 4)]!, JSON.stringify(at)).toBeLessThan(NAV_INF);
  });

  it("defend: the infected go for the rig when nobody guards it, and the mission fails when it falls", () => {
    const { sim, pve, ps } = start(from(stepOf("defend")), ["alpha"], "recruit");
    const a = ps[0]!;
    clearEnemies(pve);
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    // Alpha far away in the atrium: the horde ignores them for the rig.
    place(a, 2400, 700);
    let lowest = 100;
    for (let i = 0; i < 20 * 50 && pve.status === PVE_STATUS.RUNNING; i++) {
      a.hp = PLAYER.maxHealth;
      place(a, 2400, 700);
      tick(sim);
      lowest = Math.min(lowest, pve.count);
    }
    expect(lowest).toBeLessThan(100);
    expect(pve.status).toBe(PVE_STATUS.FAILED);
    expect(pve.results(0).result.reason ?? "").toContain("rig");
  });

  it("defend: guarding the rig for the time holds the step and opens the core descent", () => {
    const { sim, pve, ps } = start(from(stepOf("defend")), ["alpha", "bravo"], "recruit");
    const [a, b] = ps as [ServerPlayer, ServerPlayer];
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    place(a, 2760, 2450);
    place(b, 2840, 2450);
    for (let i = 0; i < 20 * 56 && pve.stepIndex === 0; i++) {
      tick(sim);
      // The squad keeps them off it (anything that gets close dies).
      for (const z of pve.zw.zombies.values())
        if (!z.dead && Math.hypot(z.x - 2800, z.y - 2450) < 420)
          pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
    }
    expect(pve.stepIndex).toBe(1);
    expect(pve.doorsOpen.has("core-door")).toBe(true);
    expect(pve.props.get("rig")!.used).toBe(true);
  });

  it("atrium waves never spawn behind a closed door, even with the squad pressed against one", () => {
    const { sim, pve, ps } = start(from(stepOf("waves")), ["alpha", "bravo"], "veteran");
    const [a, b] = ps as [ServerPlayer, ServerPlayer];
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    // Every mission door is still shut during the waves.
    const grid = buildNavGrid(pveWorlds(map, FINAL_BREACH.doors, new Set()).world);
    const squad = buildFlowField(grid, 1, [nearestWalkable(grid, 3330, 1080, 1)]);
    const seen = new Set<string>();
    const stray: string[] = [];
    // At the core-descent door (east wall): the atrium's east zones are in plain view, and the
    // corridor behind the door is the closest out-of-sight floor.
    for (let i = 0; i < 20 * 60; i++) {
      place(a, 3330, 1060);
      place(b, 3330, 1110);
      tick(sim);
      for (const z of pve.zw.zombies.values()) {
        if (z.dead || seen.has(z.id)) continue;
        seen.add(z.id);
        const c = nearestWalkable(grid, z.x, z.y, 1, 3);
        if (c < 0 || squad.dist[c]! >= NAV_INF)
          stray.push(`${z.def.kind}@${Math.round(z.x)},${Math.round(z.y)}`);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(stray).toEqual([]);
  });

  it("a wave enemy shut in behind a closed door is culled instead of holding the wave open", () => {
    const { sim, pve, ps } = start(from(stepOf("waves")), ["alpha"], "veteran");
    const a = ps[0]!;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 20 * 20 && !pve.waves.run; i++) tick(sim);
    // In the core descent, 300 px from the player but on the other side of the shut door.
    const wave = pve.waves.run!.number;
    const z = pve.zw.spawn("walker", 3640, 1080, { state: "hunt", wave });
    for (let i = 0; i < 20 * 26 && !z.dead && pve.zw.zombies.has(z.id); i++) {
      place(a, 3300, 1080);
      tick(sim);
    }
    expect(pve.zw.zombies.has(z.id)).toBe(false);
  });

  it("the escape is on a clock: missing it fails the mission", () => {
    const { sim, pve, ps } = start(from(stepOf("kill") + 1), ["alpha"], "recruit");
    const a = ps[0]!;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    place(a, 4600, 2160);
    tick(sim);
    expect(pve.deadline).toBeGreaterThan(sim.tick);
    const limit = FINAL_BREACH.steps[stepOf("kill") + 1]!.limitSec!;
    expect((pve.deadline - sim.tick) / 20).toBeCloseTo(limit, 0);
    for (let i = 0; i < 20 * (limit + 2) && pve.status === PVE_STATUS.RUNNING; i++) {
      a.hp = PLAYER.maxHealth;
      tick(sim);
    }
    expect(pve.status).toBe(PVE_STATUS.FAILED);
    expect(pve.results(0).result.reason).toBe("Out of time");
  });
});

/** Subject Zero alone in its hall (the kill step and what follows). */
function coreFight(players: string[], seed = 21) {
  const sim = makeSim(map, seed);
  sim.setPve({ mode: "outbreak", mission: from(stepOf("kill")), difficulty: "veteran" });
  sim.resetForMatch();
  const ps = players.map((id) => addPlayer(sim, id));
  sim.resetForMatch();
  const pve = sim.pve!;
  const boss = [...pve.zw.zombies.values()].find((z) => z.def.kind === "subject-zero")!;
  return { sim, pve, ps, boss };
}

describe("Subject Zero", () => {
  it("every attack is telegraphed; three phases; acid lobs leave puddles", () => {
    const def = ZOMBIES["subject-zero"];
    expect(def.index).toBe(8);
    expect(def.boss!.phases.length).toBe(3);
    for (const ph of def.boss!.phases)
      for (const a of ph.attacks) expect(a.windupSec * ph.windupMult, a.id).toBeGreaterThanOrEqual(0.6);
    const { sim, pve, ps, boss } = coreFight(["alpha"]);
    const a = ps[0]!;
    a.protectedUntil = 0;
    // Far enough for the acid (and the charge), seen from across the hall.
    place(a, 4250, 1700);
    boss.cooldowns.set("charge", sim.tick + 20 * 60);
    boss.cooldowns.set("vent", sim.tick + 20 * 60);
    let puddles = 0;
    for (let i = 0; i < 20 * 12 && puddles === 0; i++) {
      a.hp = PLAYER.maxHealth;
      a.pve.downed = false;
      place(a, 4250, 1700);
      tick(sim);
      puddles = pve.zw.hazards.size;
    }
    expect(puddles).toBeGreaterThan(0);
  });

  it("the hall changes with each phase: corner vents, then the cross, a blackout and the alarm", () => {
    const { sim, pve, ps, boss } = coreFight(["alpha"]);
    const a = ps[0]!;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    place(a, 3800, 1650);
    tick(sim);
    const vents = FINAL_BREACH.vents!;
    const online = () => vents.filter((v) => ventOnline(v, pve.power, pve.flags)).map((v) => v.id);
    expect(online()).toEqual([]);
    expect(pve.ventStart).toBe(0);
    // Into phase 2.
    pve.zw.damage(
      boss,
      (boss.maxHp * 0.4) / ZOMBIES["subject-zero"].plating!.side,
      a.id,
      false,
      boss.x,
      boss.y,
      true,
    );
    for (let i = 0; i < 5; i++) tick(sim);
    expect(boss.phase).toBe(1);
    expect(pve.flags.has("core-vents")).toBe(true);
    expect(pve.ventStart).toBeGreaterThan(0);
    expect(online().sort()).toEqual(["core-ne", "core-nw", "core-se", "core-sw"]);
    expect(pve.flags.has("blackout")).toBe(false);
    // Into phase 3 (after the phase-2 roar).
    for (let i = 0; i < 20 * 2.5; i++) tick(sim);
    pve.zw.damage(
      boss,
      (boss.maxHp * 0.35) / ZOMBIES["subject-zero"].plating!.side,
      a.id,
      false,
      boss.x,
      boss.y,
      true,
    );
    for (let i = 0; i < 5; i++) tick(sim);
    expect(boss.phase).toBe(2);
    expect(online().length).toBe(6);
    expect(pve.flags.has("blackout")).toBe(true);
    expect(pve.alarm).toBe(true);
    // The gas works in the hall like in the lab: a vent goes active within a cycle.
    const v = vents[0]!;
    let gas = false;
    for (let i = 0; i < 20 * v.periodSec && !gas; i++) {
      tick(sim);
      gas = ventPhase(v, (sim.tick - pve.ventStart) / 20) === VENT_PHASE.ACTIVE;
    }
    expect(gas).toBe(true);
  });

  it("two players beat it working together (one holds its gaze, one at its back), and the escape opens", () => {
    const { sim, pve, ps, boss } = coreFight(["tank", "gunner"], 31);
    const [tank, gunner] = ps as [ServerPlayer, ServerPlayer];
    place(tank, 4250, 1800);
    place(gunner, 4100, 1700);
    tank.protectedUntil = 0;
    gunner.protectedUntil = 0;
    const kinds = new Set<string>();
    let t = 0;
    for (; t < 20 * 300 && !boss.dead; t++) {
      const ev = tick(sim, {
        tank: fighter(boss, tank, "tank", tank),
        gunner: fighter(boss, gunner, "flank", tank),
      });
      for (const e of ev) if (e.t === "zatk" && e.z === boss.id) kinds.add(e.k);
      for (const p of ps) {
        p.hp = PLAYER.maxHealth;
        p.pve.downed = false;
        p.alive = true;
        if (t % 20 === 0) refillAmmo(p.sim);
      }
      for (const z of pve.zw.zombies.values()) if (!z.dead && z !== boss) pve.zw.remove(z);
    }
    console.log(`[subject zero] down in ${(t / 20).toFixed(1)} s, attacks ${[...kinds].join(",")}`);
    expect(boss.dead).toBe(true);
    for (const k of ["slam", "sweep", "vent", "roar", "summon"]) expect(kinds.has(k), k).toBe(true);
    tick(sim);
    expect(pve.doorsOpen.has("exit-door")).toBe(true);
    expect(pve.flags.has("self-destruct")).toBe(true);
    expect(pve.deadline).toBeGreaterThan(sim.tick);
  }, 60_000);
});

describe("Final Breach mission script", () => {
  it("runs end to end: tunnels, atrium waves, the rig, the core, Subject Zero (fought for real), the escape, the evac", () => {
    const sim = makeSim(map, 29);
    sim.setPve({ mode: "outbreak", mission: FINAL_BREACH, difficulty: "recruit" });
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
          if (e.t === "pve" && e.k !== "auto") log.push(`${e.k}${e.n !== undefined ? ` ${e.n}` : ""}`);
        for (const z of pve.zw.zombies.values()) {
          if (z.dead || (spareBoss && z.def.boss)) continue;
          if (
            Math.min(Math.hypot(z.x - a.sim.x, z.y - a.sim.y), Math.hypot(z.x - b.sim.x, z.y - b.sim.y)) < 700
          )
            pve.damageZombie(z.id, 99999, a, false, z.x, z.y);
        }
      }
    };
    // The complex has power from the start (the first step's trigger).
    expect(pve.power).toBe(true);
    // 1. Through the tunnels into the atrium.
    place(a, 2300, 740);
    place(b, 2340, 760);
    run(1, {}, () => pve.stepIndex === 1);
    expect(pve.stepIndex).toBe(1);
    // 2. Three waves in the atrium.
    place(a, 2800, 1100);
    place(b, 2840, 1120);
    run(300, {}, () => pve.stepIndex === 2);
    expect(pve.stepIndex).toBe(2);
    expect(pve.doorsOpen.has("cryo-door")).toBe(true);
    // 3. The rig.
    place(a, 2760, 2450);
    place(b, 2840, 2450);
    run(60, {}, () => pve.stepIndex === 3);
    expect(pve.stepIndex).toBe(3);
    // 4. Down to the antechamber.
    place(a, 4100, 1080);
    place(b, 4140, 1080);
    run(1, {}, () => pve.stepIndex === 4);
    expect(pve.stepIndex).toBe(4);
    expect(pve.doorsOpen.has("arena-door")).toBe(true);
    // 5. Subject Zero: a real fight.
    tick(sim);
    const boss = [...pve.zw.zombies.values()].find((z) => z.def.kind === "subject-zero")!;
    expect(pve.bossId).toBe(boss.id);
    place(a, 4250, 1800);
    place(b, 4100, 1700);
    a.protectedUntil = 0;
    b.protectedUntil = 0;
    let t = 0;
    for (; t < 20 * 300 && !boss.dead; t++) {
      run(1 / 20, { alpha: fighter(boss, a, "tank", a), bravo: fighter(boss, b, "flank", a) });
      for (const p of [a, b]) {
        p.hp = PLAYER.maxHealth;
        p.pve.downed = false;
        p.alive = true;
        if (t % 20 === 0) refillAmmo(p.sim);
      }
    }
    expect(boss.dead).toBe(true);
    run(1, {}, () => pve.stepIndex === 5);
    expect(pve.stepIndex).toBe(5);
    // 6. The escape: up the shaft before the clock runs out.
    spareBoss = false;
    a.protectedUntil = Number.MAX_SAFE_INTEGER;
    b.protectedUntil = Number.MAX_SAFE_INTEGER;
    expect(pve.deadline).toBeGreaterThan(sim.tick);
    place(a, 5150, 230);
    place(b, 5200, 230);
    run(2, {}, () => pve.stepIndex === 6);
    expect(pve.stepIndex).toBe(6);
    expect(pve.deadline).toBe(0);
    // 7. The evac.
    run(40, {}, () => pve.status !== PVE_STATUS.RUNNING);
    expect(pve.status).toBe(PVE_STATUS.COMPLETE);
    console.log(`[mission] Final Breach: Subject Zero down in ${(t / 20).toFixed(1)} s | ${log.join(" | ")}`);
    const { result, xp } = pve.results(0);
    expect(result.completed).toBe(true);
    expect(result.progress).toBe(FINAL_BREACH.steps.length);
    expect(xp.get("alpha")!.lines[0]!.reason).toContain("Final Breach");
  });
});
