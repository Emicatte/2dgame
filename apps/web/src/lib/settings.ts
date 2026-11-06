import { createStore } from "./store.ts";

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "reload"
  | "dash"
  | "slot1"
  | "slot2"
  | "slot3"
  | "interact"
  | "seat"
  | "scoreboard";

export const ACTION_LABELS: Record<Action, string> = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  reload: "Reload",
  dash: "Dash / handbrake / take off-land",
  slot1: "Primary weapon",
  slot2: "Sidearm",
  slot3: "Picked-up weapon",
  interact: "Interact / pick up / enter-exit vehicle",
  seat: "Change vehicle seat",
  scoreboard: "Scoreboard",
};

/** KeyboardEvent.code values, so bindings follow physical keys on AZERTY/QWERTZ too. */
export const DEFAULT_BINDINGS: Record<Action, string> = {
  up: "KeyW",
  down: "KeyS",
  left: "KeyA",
  right: "KeyD",
  reload: "KeyR",
  dash: "ShiftLeft",
  slot1: "Digit1",
  slot2: "Digit2",
  slot3: "Digit3",
  interact: "KeyE",
  seat: "KeyF",
  scoreboard: "Tab",
};

export const GRAPHICS_QUALITIES = ["low", "medium", "high"] as const;
export type GraphicsQuality = (typeof GRAPHICS_QUALITIES)[number];

export const CROSSHAIR_STYLES = ["cross", "dot", "circle", "tactical", "minimal"] as const;
export type CrosshairStyle = (typeof CROSSHAIR_STYLES)[number];

/** Allowed ranges of the numeric crosshair settings (UI sliders and migration clamp to them). */
export const CROSSHAIR_LIMITS = {
  size: { min: 0.5, max: 2, step: 0.05 },
  opacity: { min: 0.2, max: 1, step: 0.05 },
  thickness: { min: 1, max: 4, step: 0.5 },
} as const;

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  uiVolume: number;
  screenShake: number;
  quality: GraphicsQuality;
  showDebug: boolean;
  crosshairColor: string;
  crosshairStyle: CrosshairStyle;
  /** Scale of the crosshair arms, dot and markers (1 = default). */
  crosshairSize: number;
  crosshairOpacity: number;
  /** Line width in screen pixels. */
  crosshairThickness: number;
  /** Dark outline under every stroke: readable on light and dark maps alike. */
  crosshairOutline: boolean;
  /** Gap follows the weapon's true spread cone (plus a short kick per shot); off = fixed gap. */
  crosshairDynamic: boolean;
  bindings: Record<Action, string>;
}

const KEY = "scrapline.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.8,
  uiVolume: 0.6,
  screenShake: 1,
  quality: "high",
  showDebug: false,
  crosshairColor: "#7dffb0",
  crosshairStyle: "cross",
  crosshairSize: 1,
  crosshairOpacity: 1,
  crosshairThickness: 2,
  crosshairOutline: true,
  crosshairDynamic: true,
  bindings: { ...DEFAULT_BINDINGS },
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Turns whatever is stored (older versions, hand-edited or corrupt values) into valid settings:
 * unknown keys are dropped, missing or invalid ones take their default, numbers are clamped.
 * Stored "low"/"high" quality keep their meaning; "medium" is new and never guessed.
 */
export function migrateSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  if (p.bindings && typeof p.bindings === "object") {
    for (const [k, v] of Object.entries(p.bindings as Record<string, unknown>)) {
      if (k in DEFAULT_BINDINGS && typeof v === "string" && v) bindings[k as Action] = v;
    }
  }
  const L = CROSSHAIR_LIMITS;
  // Fields this function does not validate (added later) load as stored, like before; keys that
  // are not settings at all are dropped.
  const carried: Record<string, unknown> = { ...d };
  for (const k of Object.keys(d)) if (k in p) carried[k] = p[k];
  return {
    ...(carried as unknown as Settings),
    masterVolume: num(p.masterVolume, d.masterVolume, 0, 1),
    sfxVolume: num(p.sfxVolume, d.sfxVolume, 0, 1),
    uiVolume: num(p.uiVolume, d.uiVolume, 0, 1),
    screenShake: num(p.screenShake, d.screenShake, 0, 1.5),
    quality: oneOf(p.quality, GRAPHICS_QUALITIES, d.quality),
    showDebug: bool(p.showDebug, d.showDebug),
    crosshairColor:
      typeof p.crosshairColor === "string" && /^#[0-9a-f]{6}$/i.test(p.crosshairColor)
        ? p.crosshairColor
        : d.crosshairColor,
    crosshairStyle: oneOf(p.crosshairStyle, CROSSHAIR_STYLES, d.crosshairStyle),
    crosshairSize: num(p.crosshairSize, d.crosshairSize, L.size.min, L.size.max),
    crosshairOpacity: num(p.crosshairOpacity, d.crosshairOpacity, L.opacity.min, L.opacity.max),
    crosshairThickness: num(p.crosshairThickness, d.crosshairThickness, L.thickness.min, L.thickness.max),
    crosshairOutline: bool(p.crosshairOutline, d.crosshairOutline),
    crosshairDynamic: bool(p.crosshairDynamic, d.crosshairDynamic),
    bindings,
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return migrateSettings(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export const settingsStore = createStore<Settings>(load());

settingsStore.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.get()));
  } catch {
    // Storage may be unavailable (private mode); settings then last for the session only.
  }
});

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    ShiftLeft: "L-Shift",
    ShiftRight: "R-Shift",
    ControlLeft: "L-Ctrl",
    ControlRight: "R-Ctrl",
    AltLeft: "L-Alt",
    Space: "Space",
    Tab: "Tab",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  return map[code] ?? code;
}
