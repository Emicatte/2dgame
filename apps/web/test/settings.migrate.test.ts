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

  it("is idempotent", () => {
    const once = migrateSettings({ quality: "medium", crosshairStyle: "tactical", crosshairSize: 1.4 });
    expect(migrateSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});
