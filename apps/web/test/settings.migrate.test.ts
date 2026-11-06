import { describe, expect, it } from "vitest";
import {
  CROSSHAIR_LIMITS,
  DEFAULT_BINDINGS,
  DEFAULT_SETTINGS,
  migrateSettings,
} from "../src/lib/settings.ts";

describe("settings migration", () => {
  it("nothing stored: defaults", () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("v1 settings from before the overhaul keep their values and gain the new defaults", () => {
    const old = {
      masterVolume: 0.4,
      sfxVolume: 0.5,
      uiVolume: 0.2,
      screenShake: 0,
      quality: "low",
      showDebug: true,
      crosshairColor: "#ff00aa",
      bindings: { reload: "KeyT" },
    };
    const s = migrateSettings(old);
    expect(s.quality).toBe("low");
    expect(s.crosshairColor).toBe("#ff00aa");
    expect(s.masterVolume).toBe(0.4);
    expect(s.showDebug).toBe(true);
    expect(s.bindings).toEqual({ ...DEFAULT_BINDINGS, reload: "KeyT" });
    expect(s.crosshairStyle).toBe("cross");
    expect(s.crosshairSize).toBe(1);
    expect(s.crosshairOpacity).toBe(1);
    expect(s.crosshairThickness).toBe(2);
    expect(s.crosshairOutline).toBe(true);
    expect(s.crosshairDynamic).toBe(true);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.musicVolume).toBe(0.7);
    expect(s.pveBrightness).toBe(DEFAULT_SETTINGS.pveBrightness);
    expect(s.pveBrightness).toBe(0.5);
    expect(migrateSettings({ quality: "high" }).quality).toBe("high");
    expect(migrateSettings({ quality: "medium" }).quality).toBe("medium");
  });

  it("invalid values fall back to defaults, numbers are clamped, unknown keys dropped", () => {
    const s = migrateSettings({
      quality: "ultra",
      crosshairStyle: "spiral",
      crosshairSize: 99,
      crosshairOpacity: -1,
      crosshairThickness: Number.NaN,
      crosshairOutline: "yes",
      crosshairColor: "red",
      masterVolume: 3,
      bindings: { reload: 5, nonsense: "KeyQ" },
      legacyField: 1,
    });
    expect(s.quality).toBe("high");
    expect(s.crosshairStyle).toBe("cross");
    expect(s.crosshairSize).toBe(CROSSHAIR_LIMITS.size.max);
    expect(s.crosshairOpacity).toBe(CROSSHAIR_LIMITS.opacity.min);
    expect(s.crosshairThickness).toBe(DEFAULT_SETTINGS.crosshairThickness);
    expect(s.crosshairOutline).toBe(true);
    expect(s.crosshairColor).toBe(DEFAULT_SETTINGS.crosshairColor);
    expect(s.masterVolume).toBe(1);
    expect(s.bindings).toEqual(DEFAULT_BINDINGS);
    expect("legacyField" in s).toBe(false);
  });

  it("music volume and co-op brightness: kept when valid, clamped to 0..1, invalid to default", () => {
    const kept = migrateSettings({ musicVolume: 0.25, pveBrightness: 0.9 });
    expect(kept.musicVolume).toBe(0.25);
    expect(kept.pveBrightness).toBe(0.9);
    const high = migrateSettings({ musicVolume: 4, pveBrightness: 1.7 });
    expect(high.musicVolume).toBe(1);
    expect(high.pveBrightness).toBe(1);
    const low = migrateSettings({ musicVolume: -0.5, pveBrightness: -3 });
    expect(low.musicVolume).toBe(0);
    expect(low.pveBrightness).toBe(0);
    const bad = migrateSettings({ musicVolume: "loud", pveBrightness: Number.NaN });
    expect(bad.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(bad.pveBrightness).toBe(DEFAULT_SETTINGS.pveBrightness);
    expect(migrateSettings({ pveBrightness: Number.POSITIVE_INFINITY }).pveBrightness).toBe(0.5);
  });

  it("is idempotent", () => {
    const once = migrateSettings({ quality: "medium", crosshairStyle: "tactical", crosshairSize: 1.4 });
    expect(migrateSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
