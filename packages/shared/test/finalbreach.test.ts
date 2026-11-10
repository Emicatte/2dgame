import { describe, expect, it } from "vitest";
import { ZOMBIE_LIST } from "../src/config/zombies.ts";
import { MAPS } from "../src/maps/index.ts";
import { CAMPAIGN_PLAN, FINAL_BREACH, MISSIONS, type Trigger, ventOnline } from "../src/pve/missions.ts";

describe("Final Breach data", () => {
  it("completes the campaign: five chapters, each unlocked by the one before; operations stand alone", () => {
    const campaign = MISSIONS.filter((m) => m.chapter > 0);
    expect(campaign.map((m) => m.chapter)).toEqual(CAMPAIGN_PLAN.map((c) => c.chapter));
    for (const [i, m] of campaign.entries()) {
      if (i === 0) expect(m.requires).toBeUndefined();
      else expect(m.requires).toBe(campaign[i - 1]!.id);
    }
    for (const m of MISSIONS.filter((x) => x.chapter === 0)) expect(m.requires).toBeUndefined();
    expect(ZOMBIE_LIST.at(-1)!.kind).toBe("subject-zero");
    expect(ZOMBIE_LIST.map((z) => z.index)).toEqual(ZOMBIE_LIST.map((_, i) => i));
  });

  it("vents wait for their flag, the others for the power", () => {
    const v = {
      id: "v",
      area: { x: 0, y: 0, w: 1, h: 1 },
      periodSec: 9,
      warnSec: 1,
      activeSec: 2,
      offsetSec: 0,
      dps: 1,
    };
    expect(ventOnline(v, true, new Set())).toBe(true);
    expect(ventOnline(v, false, new Set())).toBe(false);
    expect(ventOnline({ ...v, flag: "f" }, true, new Set())).toBe(false);
    expect(ventOnline({ ...v, flag: "f" }, false, new Set(["f"]))).toBe(true);
  });

  it("the script refers only to things it defines, inside the map", () => {
    const m = FINAL_BREACH;
    const map = MAPS[m.map];
    const doors = new Set(m.doors.map((d) => d.id));
    const groups = new Set(m.groups.map((g) => g.id));
    const zones = new Set(m.spawnZones.map((z) => z.id));
    const flags = new Set<string>();
    const triggers: Trigger[] = m.steps.flatMap((s) => [
      ...(s.onStart ?? []),
      ...(s.onDone ?? []),
      ...(s.kind === "kill" ? (s.onPhase ?? []).flat() : []),
    ]);
    for (const t of triggers) {
      if ("open" in t) expect(doors.has(t.open), t.open).toBe(true);
      if ("spawn" in t) expect(groups.has(t.spawn), t.spawn).toBe(true);
      if ("set" in t) flags.add(t.set);
    }
    for (const v of m.vents ?? []) {
      expect(flags.has(v.flag ?? ""), v.id).toBe(true);
      expect(v.area.x + v.area.w <= map.width && v.area.y + v.area.h <= map.height).toBe(true);
    }
    for (const s of m.steps) {
      if (s.kind === "defend") expect(m.props.some((p) => p.id === s.prop)).toBe(true);
      const waves = s.kind === "waves" ? s.waves : "horde" in s && s.horde ? [s.horde] : [];
      for (const w of waves) for (const z of w.zones ?? []) expect(zones.has(z), z).toBe(true);
    }
    // The order the brief asks for: infiltration, waves, a defence, the arena, the boss, the
    // escape (on a clock), the extraction.
    expect(m.steps.map((s) => s.kind)).toEqual([
      "reach",
      "waves",
      "defend",
      "reach",
      "kill",
      "reach",
      "extract",
    ]);
    expect(m.steps[5]!.limitSec).toBeGreaterThan(0);
    const kill = m.steps[4]!;
    expect(kill.kind === "kill" && kill.onPhase?.length).toBe(3);
  });
});
