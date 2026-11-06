import { describe, expect, it } from "vitest";
import { FIRST_CONTACT } from "../src/pve/missions.ts";
import { applyPveRun, emptyPveProgress, normalizePveProgress } from "../src/pve/progress.ts";

const run = (id: string, completed = true, timeSec = 900) => ({
  runId: id,
  mode: "outbreak" as const,
  mission: FIRST_CONTACT.id,
  difficulty: "veteran",
  completed,
  kills: 120,
  revives: 2,
  downs: 1,
  progress: completed ? FIRST_CONTACT.steps.length : 3,
  timeSec,
});

describe("PvE progression", () => {
  it("records a run once: a repeated delivery changes nothing", () => {
    const first = applyPveRun(emptyPveProgress(), run("r1"));
    expect(first.recorded).toBe(true);
    expect(first.newTitles).toEqual([FIRST_CONTACT.title]);
    expect(first.progress.missions[FIRST_CONTACT.id]!.completions).toBe(1);
    const again = applyPveRun(first.progress, run("r1"));
    expect(again.recorded).toBe(false);
    expect(again.progress).toEqual(first.progress);
    expect(again.progress.kills).toBe(120);
  });

  it("keeps the best time per difficulty and counts failed attempts", () => {
    let p = applyPveRun(emptyPveProgress(), run("a", true, 900)).progress;
    p = applyPveRun(p, run("b", true, 1200)).progress;
    p = applyPveRun(p, run("c", false)).progress;
    const best = applyPveRun(p, run("d", true, 700));
    expect(best.personalBest).toBe(true);
    expect(best.progress.missions[FIRST_CONTACT.id]).toEqual({
      best: { veteran: 700 },
      completions: 3,
      attempts: 4,
    });
    expect(best.newTitles).toEqual([]);
  });

  it("survival records the most waves per difficulty; stored data is validated", () => {
    const p = applyPveRun(emptyPveProgress(), {
      ...run("s1"),
      mode: "survival",
      mission: "",
      progress: 7,
    }).progress;
    expect(p.survivalBest.veteran).toBe(7);
    const junk = normalizePveProgress({
      missions: {
        "not-a-mission": { completions: 9 },
        [FIRST_CONTACT.id]: { completions: -3, best: { veteran: "x" } },
      },
      titles: ["Hacker", FIRST_CONTACT.title],
      kills: 1e12,
      seen: [42, "ok"],
    });
    expect(Object.keys(junk.missions)).toEqual([FIRST_CONTACT.id]);
    expect(junk.missions[FIRST_CONTACT.id]!.completions).toBe(0);
    expect(junk.titles).toEqual([FIRST_CONTACT.title]);
    expect(junk.kills).toBe(1e9);
    expect(junk.seen).toEqual(["ok"]);
  });
});
