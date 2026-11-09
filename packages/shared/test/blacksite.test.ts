import { describe, expect, it } from "vitest";
import { ATTACK_KINDS, hitSide, platingMult, ZOMBIE_LIST, ZOMBIES } from "../src/config/zombies.ts";
import { MAPS } from "../src/maps/index.ts";
import {
  BLACK_SITE,
  MISSIONS,
  type Trigger,
  VENT_PHASE,
  type VentDef,
  ventPhase,
} from "../src/pve/missions.ts";

describe("Black Site data", () => {
  it("keeps the wire indices of attacks and enemies stable (new ones appended)", () => {
    expect(ATTACK_KINDS.slice(0, 9)).toEqual([
      "melee",
      "spit",
      "explode",
      "pounce",
      "charge",
      "slam",
      "throw",
      "summon",
      "roar",
    ]);
    expect(ATTACK_KINDS.indexOf("sweep")).toBe(9);
    expect(ATTACK_KINDS.indexOf("vent")).toBe(10);
    expect(ZOMBIE_LIST.map((z) => z.kind)).toEqual([
      "walker",
      "runner",
      "brute",
      "spitter",
      "stalker",
      "exploder",
      "abomination",
      "warden",
      "subject-zero",
    ]);
  });

  it("The Warden: plated front, flanks in between, a weak back; venting opens everything", () => {
    const p = ZOMBIES.warden.plating!;
    expect(hitSide(p, 0)).toBe("front");
    expect(hitSide(p, 0.9)).toBe("front");
    expect(hitSide(p, -0.9)).toBe("front");
    expect(hitSide(p, Math.PI / 2)).toBe("side");
    expect(hitSide(p, -Math.PI / 2)).toBe("side");
    expect(hitSide(p, Math.PI)).toBe("back");
    expect(hitSide(p, -Math.PI + 0.5)).toBe("back");
    // Angles outside ±π wrap.
    expect(hitSide(p, Math.PI * 3)).toBe("back");
    expect(platingMult(p, "front", false)).toBeLessThan(platingMult(p, "side", false));
    expect(platingMult(p, "side", false)).toBeLessThan(1);
    expect(platingMult(p, "back", false)).toBeGreaterThan(1);
    // Venting: the front is no longer the worst place to shoot, and the back is the best of all.
    expect(platingMult(p, "front", true)).toBeGreaterThan(1);
    expect(platingMult(p, "back", true)).toBeGreaterThan(platingMult(p, "back", false));
  });

  it("every Warden attack is telegraphed and the vent window lasts long enough to use", () => {
    const boss = ZOMBIES.warden.boss!;
    expect(boss.phases.length).toBe(2);
    for (const [i, ph] of boss.phases.entries()) {
      for (const a of ph.attacks) {
        expect(a.windupSec * ph.windupMult, `${a.id} phase ${i + 1}`).toBeGreaterThanOrEqual(0.6);
        if (a.kind === "sweep") expect(a.radius ?? 0).toBeLessThanOrEqual(255);
        if (a.combo) expect(ph.attacks.some((b) => b.id === a.combo)).toBe(true);
      }
      const vent = ph.attacks.find((a) => a.kind === "vent")!;
      expect(vent.windupSec * ph.windupMult).toBeGreaterThanOrEqual(2.2);
      expect(ph.attacks.some((a) => a.kind === "sweep" && a.rear)).toBe(true);
      expect(ph.attacks.some((a) => a.kind === "summon")).toBe(true);
    }
  });

  it("a vent cycles idle → warning → gas, and the warning always comes first", () => {
    const v: VentDef = {
      id: "v",
      area: { x: 0, y: 0, w: 10, h: 10 },
      periodSec: 9,
      warnSec: 1.6,
      activeSec: 2.6,
      offsetSec: 0,
      dps: 20,
    };
    expect(ventPhase(v, -1)).toBe(VENT_PHASE.IDLE);
    expect(ventPhase(v, 0)).toBe(VENT_PHASE.IDLE);
    expect(ventPhase(v, 4.7)).toBe(VENT_PHASE.IDLE);
    expect(ventPhase(v, 4.9)).toBe(VENT_PHASE.WARN);
    expect(ventPhase(v, 6.5)).toBe(VENT_PHASE.ACTIVE);
    expect(ventPhase(v, 8.99)).toBe(VENT_PHASE.ACTIVE);
    expect(ventPhase(v, 9.01)).toBe(VENT_PHASE.IDLE);
    let warn = 0;
    let active = 0;
    let prev: number = VENT_PHASE.IDLE;
    for (let t = 0; t < 90; t += 0.05) {
      const ph = ventPhase({ ...v, offsetSec: 3 }, t);
      if (ph === VENT_PHASE.WARN) warn += 0.05;
      if (ph === VENT_PHASE.ACTIVE) {
        active += 0.05;
        expect(prev === VENT_PHASE.WARN || prev === VENT_PHASE.ACTIVE).toBe(true);
      }
      prev = ph;
    }
    expect(warn).toBeCloseTo(16, 0);
    expect(active).toBeCloseTo(26, 0);
  });

  it("the mission refers only to things it defines, inside the map", () => {
    const m = BLACK_SITE;
    expect(MISSIONS.map((x) => x.id)).toContain("black-site");
    expect(m.requires).toBe("the-convoy");
    const map = MAPS[m.map];
    const doors = new Set(m.doors.map((d) => d.id));
    const props = new Set(m.props.map((p) => p.id));
    const groups = new Set(m.groups.map((g) => g.id));
    const zones = new Set(m.spawnZones.map((z) => z.id));
    const triggers: Trigger[] = m.steps.flatMap((s) => [...(s.onStart ?? []), ...(s.onDone ?? [])]);
    for (const t of triggers) {
      if ("open" in t) expect(doors.has(t.open), t.open).toBe(true);
      if ("close" in t) expect(doors.has(t.close), t.close).toBe(true);
      if ("spawn" in t) expect(groups.has(t.spawn), t.spawn).toBe(true);
    }
    for (const s of m.steps) {
      if (s.kind === "interact") expect(props.has(s.prop)).toBe(true);
      if (s.kind === "collect") for (const id of s.props) expect(props.has(id), id).toBe(true);
      if (s.kind === "kill") expect(groups.has(s.group)).toBe(true);
      const waves = s.kind === "waves" ? s.waves : "horde" in s && s.horde ? [s.horde] : [];
      for (const w of waves) for (const z of w.zones ?? []) expect(zones.has(z), z).toBe(true);
    }
    for (const z of m.ambient?.zones ?? []) expect(zones.has(z), z).toBe(true);
    for (const v of m.vents ?? []) {
      expect(v.area.x >= 0 && v.area.y >= 0).toBe(true);
      expect(v.area.x + v.area.w <= map.width && v.area.y + v.area.h <= map.height).toBe(true);
      expect(v.warnSec + v.activeSec).toBeLessThanOrEqual(v.periodSec / 2);
    }
    // The Warden is the kill step's only target, and the run starts sealed and unpowered.
    const kill = m.steps.find((s) => s.kind === "kill")!;
    expect(m.groups.find((g) => kill.kind === "kill" && g.id === kill.group)!.enemies).toEqual([
      expect.objectContaining({ kind: "warden" }),
    ]);
    expect(m.doors.filter((d) => d.sealed).every((d) => d.auto)).toBe(true);
  });
});
