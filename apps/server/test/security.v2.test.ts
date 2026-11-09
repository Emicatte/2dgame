import {
  BTN,
  inputBatchSchema,
  joinOptionsSchema,
  MAX_LEVEL,
  normalizeCareer,
  settingsSchema,
  teamSchema,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";

/** Negative paths for everything SCRAPLINE 2.0 added to the protocol. */
describe("2.0 protocol validation", () => {
  const frame = (b: number) => ({ s: 1, x: 0, y: 0, a: 0, b, w: -1, v: 0 });

  it("accepts the seat-change and shield buttons and rejects unknown button bits", () => {
    expect(inputBatchSchema.safeParse({ i: [frame(BTN.SEAT | BTN.INTERACT | BTN.FIRE)] }).success).toBe(true);
    expect(inputBatchSchema.safeParse({ i: [frame(BTN.SHIELD)] }).success).toBe(true);
    expect(inputBatchSchema.safeParse({ i: [frame(64)] }).success).toBe(false);
    expect(inputBatchSchema.safeParse({ i: [frame(-1)] }).success).toBe(false);
  });

  it("accepts only known modes and bounded score limits in settings and join options", () => {
    for (const mode of ["deathmatch", "tdm", "dom", "ctf", "mayhem"]) {
      expect(settingsSchema.safeParse({ mode }).success).toBe(true);
    }
    expect(settingsSchema.safeParse({ mode: "nuke" }).success).toBe(false);
    expect(settingsSchema.safeParse({ killLimit: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ killLimit: 201 }).success).toBe(false);
    expect(settingsSchema.safeParse({ killLimit: 3 }).success).toBe(true);
    expect(settingsSchema.safeParse({ map: "../../etc" }).success).toBe(false);
    expect(settingsSchema.safeParse({ map: "harbor" }).success).toBe(true);
    expect(joinOptionsSchema.safeParse({ token: "t".repeat(20), mode: "mayhem" }).success).toBe(true);
    expect(joinOptionsSchema.safeParse({ token: "t".repeat(20), mode: "god" }).success).toBe(false);
    expect(teamSchema.safeParse({ team: 3 }).success).toBe(false);
  });

  it("never trusts stored career data (bounded, known keys only)", () => {
    const evil = normalizeCareer({
      modes: { ["__proto__"]: { played: 1 }, tdm: { played: 1e12, wins: Number.NaN } },
      captures: -5,
      challenges: { day: "x".repeat(10_000), progress: { win2: 1e9 }, done: Array(10_000).fill("win2") },
    });
    expect(Object.keys(evil.modes)).toEqual(["tdm"]);
    expect(evil.modes.tdm!.wins).toBe(0);
    expect(evil.captures).toBe(0);
    expect(evil.challenges.day.length).toBe(10);
    expect(evil.challenges.progress.win2).toBe(2);
    expect(evil.challenges.done).toEqual(["win2"]);
    expect(MAX_LEVEL).toBe(50);
  });
});
