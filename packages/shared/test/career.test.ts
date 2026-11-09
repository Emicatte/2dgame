import { describe, expect, it } from "vitest";
import {
  applyMatchToCareer,
  CHALLENGE_POOL,
  challengeViews,
  dailyChallenges,
  emptyCareer,
  levelFromXp,
  MAX_LEVEL,
  type MatchFacts,
  normalizeCareer,
  SKINS,
  titleForLevel,
  totalXpForLevel,
  unlocksForLevel,
  xpToNextLevel,
} from "../src/index.ts";

const facts = (f: Partial<MatchFacts> = {}): MatchFacts => ({
  mode: "tdm",
  completed: true,
  won: false,
  kills: 0,
  deaths: 0,
  captures: 0,
  flagCaptures: 0,
  flagReturns: 0,
  vehicleKills: 0,
  ...f,
});

describe("progression to level 50", () => {
  it("keeps the original curve up to level 20 and stays continuous after it", () => {
    // Values of the v0.1 curve: existing profiles keep their level.
    expect(xpToNextLevel(1)).toBe(300);
    expect(xpToNextLevel(10)).toBe(300 + 120 * 9 + 8 * 81);
    expect(xpToNextLevel(19)).toBe(5052);
    expect(totalXpForLevel(20)).toBe(43_092);
    expect(xpToNextLevel(20)).toBe(5352);
    expect(xpToNextLevel(49)).toBe(14_052);
    for (let l = 1; l < MAX_LEVEL; l++) expect(xpToNextLevel(l + 1)).toBeGreaterThan(xpToNextLevel(l));
    expect(MAX_LEVEL).toBe(50);
    expect(levelFromXp(totalXpForLevel(50)).level).toBe(50);
    expect(levelFromXp(totalXpForLevel(50) + 1e9).isMax).toBe(true);
  });

  it("only cosmetic rewards: a skin or a rank title at regular levels up to 50", () => {
    expect(SKINS.at(-1)!.unlockLevel).toBe(50);
    expect(unlocksForLevel(50)).toEqual(["Aurum skin", "Rank: Legend"]);
    expect(titleForLevel(1)).toBe("Recruit");
    expect(titleForLevel(34)).toBe("Major");
    // Never more than three levels in a row without something new.
    let run = 0;
    for (let l = 21; l <= 50; l++) {
      run = unlocksForLevel(l).length === 0 ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(3);
    }
  });
});

describe("career and daily challenges", () => {
  it("draws the same three distinct challenges for everybody on a given day", () => {
    const a = dailyChallenges("2026-11-05").map((c) => c.id);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(dailyChallenges("2026-11-05").map((c) => c.id)).toEqual(a);
    const days = new Set(
      Array.from({ length: 10 }, (_, i) =>
        dailyChallenges(`2026-12-${10 + i}`)
          .map((c) => c.id)
          .join(),
      ),
    );
    expect(days.size).toBeGreaterThan(1);
  });

  it("counts per-mode stats for completed matches and pays a challenge exactly once", () => {
    const day = new Date("2026-11-05T10:00:00Z");
    const active = dailyChallenges("2026-11-05");
    const big = facts({
      mode: "mayhem",
      won: true,
      kills: 60,
      captures: 9,
      flagCaptures: 3,
      flagReturns: 3,
      vehicleKills: 3,
    });
    const one = applyMatchToCareer(emptyCareer(), big, day);
    const expected = active.filter((c) => c.count(big) >= c.target).map((c) => c.id);
    expect(one.career.challenges.done).toEqual(expected);
    expect(one.rewards.map((r) => r.xp)).toEqual(
      active.filter((c) => expected.includes(c.id)).map((c) => c.xp),
    );
    expect(one.career.modes.mayhem).toEqual({ played: 1, wins: 1, kills: 60, deaths: 0 });
    const two = applyMatchToCareer(one.career, big, day);
    expect(
      two.rewards.filter((r) =>
        expected.some((id) => r.reason.includes(CHALLENGE_POOL.find((c) => c.id === id)!.text)),
      ),
    ).toEqual([]);
    // Abandoned matches add counters but not a played match.
    const quit = applyMatchToCareer(two.career, facts({ completed: false, kills: 3 }), day);
    expect(quit.career.modes.tdm).toBeUndefined();
  });

  it("starts fresh the next day", () => {
    const d1 = new Date("2026-11-05T23:59:00Z");
    const d2 = new Date("2026-11-06T00:01:00Z");
    const c1 = applyMatchToCareer(emptyCareer(), facts({ won: true, kills: 20 }), d1).career;
    expect(c1.challenges.day).toBe("2026-11-05");
    expect(challengeViews(c1, d2).every((v) => v.progress === 0 && !v.done)).toBe(true);
    const c2 = applyMatchToCareer(c1, facts(), d2).career;
    expect(c2.challenges.day).toBe("2026-11-06");
  });

  it("reads damaged or foreign stored data safely", () => {
    expect(normalizeCareer(null)).toEqual(emptyCareer());
    const n = normalizeCareer({
      modes: { tdm: { played: 3, wins: -1, kills: "x" }, "<script>": { played: 9 } },
      captures: 2.7,
      challenges: { day: "2026-11-05", progress: { win2: 99, bogus: 4 }, done: ["win2", "nope"] },
    });
    expect(n.modes).toEqual({ tdm: { played: 3, wins: 0, kills: 0, deaths: 0 } });
    expect(n.captures).toBe(2);
    expect(n.challenges.progress).toEqual({ win2: 2 });
    expect(n.challenges.done).toEqual(["win2"]);
  });
});

describe("mode career counters", () => {
  const day = new Date("2026-11-09T12:00:00Z");

  it("adds mode counters from completed matches only, drops unknown keys and bad values", () => {
    const one = applyMatchToCareer(
      emptyCareer(),
      facts({ mode: "prophunt", extra: { propsFound: 3, propRounds: 2, bogus: 9, hidersFound: -4 } }),
      day,
    );
    expect(one.career.extra).toEqual({ propsFound: 3, propRounds: 2 });
    const two = applyMatchToCareer(
      one.career,
      facts({ mode: "prophunt", completed: false, extra: { propsFound: 5 } }),
      day,
    );
    expect(two.career.extra.propsFound).toBe(3);
    const stored = normalizeCareer(JSON.parse(JSON.stringify(two.career)));
    expect(stored.extra).toEqual({ propsFound: 3, propRounds: 2 });
    expect(normalizeCareer({ extra: { gungameLevels: "x", hideSeconds: 12.7 } }).extra).toEqual({
      hideSeconds: 12,
    });
  });
});
