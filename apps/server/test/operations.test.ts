import { BOSS_RUSH, BTN, EXTRACTION, PVE_STATUS } from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { clearEnemies, place, start, tick } from "./pveHelpers.ts";

/** The co-op operations run on the Outbreak runtime from data only: play them through. */
describe("co-op operations", () => {
  it("Boss Rush: the atrium, then the three bosses one after another, then the run is complete", () => {
    const { sim, pve, ps } = start(BOSS_RUSH, ["alpha"]);
    const a = ps[0]!;
    clearEnemies(pve);
    place(a, 2800, 1100);
    for (let i = 0; i < 5; i++) tick(sim);
    expect(pve.stepIndex).toBe(1);
    const bosses: string[] = [];
    for (let i = 0; i < 20 * 60 * 6 && pve.status === PVE_STATUS.RUNNING; i++) {
      place(a, 2800, 1100);
      a.hp = 100;
      for (const z of pve.zw.zombies.values()) {
        if (z.def.boss && !bosses.includes(z.def.kind)) bosses.push(z.def.kind);
        if (z.hp > 0) pve.zw.damage(z, 5000, a.id, false, z.x, z.y, true);
      }
      tick(sim);
    }
    expect(bosses).toEqual(["abomination", "warden", "subject-zero"]);
    expect(pve.status).toBe(PVE_STATUS.COMPLETE);
  });

  it("Extraction: three cargo cases, then the helipad", () => {
    const { sim, pve, ps } = start(EXTRACTION, ["alpha"]);
    const a = ps[0]!;
    for (const [i, prop] of EXTRACTION.props.entries()) {
      expect(pve.stepIndex).toBe(i);
      for (let t = 0; t < 20 * 4 && pve.stepIndex === i; t++) {
        clearEnemies(pve);
        place(a, prop.x, prop.y + 30);
        tick(sim, { alpha: { buttons: BTN.INTERACT } });
      }
    }
    expect(pve.stepIndex).toBe(3);
    const pad = { x: 2910, y: 380 };
    for (let t = 0; t < 20 * 25 && pve.status === PVE_STATUS.RUNNING; t++) {
      clearEnemies(pve);
      place(a, pad.x, pad.y);
      tick(sim);
    }
    expect(pve.status).toBe(PVE_STATUS.COMPLETE);
  });
});
