import { describe, expect, it } from "vitest";
import {
  computeMatchXp,
  isSkinUnlocked,
  levelFromXp,
  MAX_LEVEL,
  SKINS,
  totalXpForLevel,
  XP_RULES,
} from "../src/config/progression.ts";
import { damageAtDistance, WEAPONS } from "../src/config/weapons.ts";
import { isValidRoomCode, nicknameSchema, normalizeRoomCode } from "../src/protocol/messages.ts";

describe("progression", () => {
  it("starts at level 1 and reaches the max level", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(totalXpForLevel(2)).level).toBe(2);
    expect(levelFromXp(totalXpForLevel(2) - 1).level).toBe(1);
    expect(levelFromXp(totalXpForLevel(MAX_LEVEL)).level).toBe(MAX_LEVEL);
    expect(levelFromXp(10_000_000)).toMatchObject({ level: MAX_LEVEL, isMax: true });
  });

  it("curve is strictly increasing", () => {
    for (let l = 2; l <= MAX_LEVEL; l++) expect(totalXpForLevel(l)).toBeGreaterThan(totalXpForLevel(l - 1));
  });

  it("awards XP for completion, kills, victory and objectives", () => {
    const xp = computeMatchXp({
      completed: true,
      kills: 10,
      placement: 1,
      playerCount: 4,
      firstBlood: true,
      bestStreak: 5,
      shotsFired: 100,
      shotsHit: 50,
    });
    expect(xp.total).toBe(
      XP_RULES.matchCompleted +
        10 * XP_RULES.perKill +
        XP_RULES.win +
        XP_RULES.firstBlood +
        XP_RULES.streak5 +
        XP_RULES.sharpshooter,
    );
  });

  it("caps kill XP and the per-match total", () => {
    const xp = computeMatchXp({
      completed: true,
      kills: 500,
      placement: 1,
      playerCount: 2,
      firstBlood: true,
      bestStreak: 99,
      shotsFired: 1000,
      shotsHit: 900,
    });
    expect(xp.total).toBeLessThanOrEqual(XP_RULES.maxPerMatch);
    expect(xp.lines.find((l) => l.reason.includes("eliminations"))?.xp).toBe(
      XP_RULES.maxRewardedKills * XP_RULES.perKill,
    );
  });

  it("gives no completion XP to players who left early", () => {
    const xp = computeMatchXp({
      completed: false,
      kills: 0,
      placement: 3,
      playerCount: 3,
      firstBlood: false,
      bestStreak: 0,
      shotsFired: 0,
      shotsHit: 0,
    });
    expect(xp.total).toBe(0);
  });

  it("unlocks skins by level only (cosmetic)", () => {
    const locked = SKINS.find((s) => s.unlockLevel > 1)!;
    expect(isSkinUnlocked(locked.id, 1)).toBe(false);
    expect(isSkinUnlocked(locked.id, locked.unlockLevel)).toBe(true);
    expect(isSkinUnlocked("does-not-exist", 99)).toBe(false);
  });
});

describe("weapon damage falloff", () => {
  it("is full inside falloff start and reaches the minimum at max range", () => {
    const w = WEAPONS.rifle;
    expect(damageAtDistance(w, 10)).toBe(w.damage);
    expect(damageAtDistance(w, w.rangePx)).toBeCloseTo(w.damage * w.minDamageMult, 6);
  });

  it("every weapon kills within a sane number of hits at close range", () => {
    for (const w of Object.values(WEAPONS)) {
      const perShot = w.damage * w.pellets;
      const shotsToKill = Math.ceil(100 / perShot);
      expect(shotsToKill).toBeGreaterThanOrEqual(1);
      expect(shotsToKill).toBeLessThanOrEqual(8);
    }
  });
});

describe("validation helpers", () => {
  it("normalises room codes", () => {
    expect(normalizeRoomCode(" ab-c2d ")).toBe("ABC2D");
    expect(isValidRoomCode("ABC2D")).toBe(true);
    expect(isValidRoomCode("ABC0D")).toBe(false);
  });

  it("accepts sane nicknames and rejects markup", () => {
    expect(nicknameSchema.safeParse("Rook_7").success).toBe(true);
    expect(nicknameSchema.safeParse("<script>").success).toBe(false);
    expect(nicknameSchema.safeParse("x").success).toBe(false);
  });
});
