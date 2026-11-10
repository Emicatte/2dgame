import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_CATEGORIES,
  EXPERIENCES,
  experienceById,
  experienceForRoom,
  FEATURED_EXPERIENCES,
  GAME_MODES,
  MAPS,
  mapSupportsMode,
  modeFlags,
  playableExperience,
} from "../src/index.ts";

describe("experience catalog", () => {
  it("has unique ids and only known categories", () => {
    const ids = EXPERIENCES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(EXPERIENCE_CATEGORIES.map((c) => c.id));
    for (const e of EXPERIENCES) expect(cats.has(e.category)).toBe(true);
  });

  it("gives every room mode a card", () => {
    for (const m of GAME_MODES) expect(experienceById(m)?.launch?.mode).toBe(m);
  });

  it("only offers maps the mode supports and draws the card from one of them", () => {
    for (const e of EXPERIENCES) {
      if (!e.launch) continue;
      expect(e.maps.length).toBeGreaterThan(0);
      expect(e.thumbnail && e.maps.includes(e.thumbnail)).toBe(true);
      const pve = e.launch.mode === "outbreak" || e.launch.mode === "survival";
      if (!pve) for (const m of e.maps) expect(mapSupportsMode(MAPS[m], e.launch.mode)).toBe(true);
    }
  });

  it("never lets a planned experience start", () => {
    const all = modeFlags("*");
    for (const e of EXPERIENCES.filter((x) => x.status !== "available")) {
      expect(e.launch).toBeNull();
      expect(e.needs).toBeTruthy();
      expect(playableExperience(e, all)).toBe(false);
    }
  });

  it("respects feature flags", () => {
    const flags = modeFlags("-prophunt");
    expect(playableExperience(experienceById("prophunt")!, flags)).toBe(false);
    expect(playableExperience(experienceById("deathmatch")!, flags)).toBe(true);
  });

  it("maps an Outbreak room on an operation's mission back to that operation", () => {
    expect(experienceForRoom("outbreak", "extraction")?.id).toBe("extraction");
    expect(experienceForRoom("outbreak", "first-contact")?.id).toBe("outbreak");
    expect(experienceForRoom("tdm")?.id).toBe("tdm");
    expect(experienceForRoom("maze", "", "horror")?.id).toBe("horrormaze");
    expect(experienceForRoom("maze", "", "classic")?.id).toBe("maze");
  });

  it("features only playable experiences", () => {
    const on = modeFlags(undefined);
    for (const id of FEATURED_EXPERIENCES) expect(playableExperience(experienceById(id)!, on)).toBe(true);
  });

  it("includes experiences without combat", () => {
    expect(EXPERIENCES.some((e) => e.gameplay === "noncombat")).toBe(true);
  });
});
