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
  | "scoreboard";

export const ACTION_LABELS: Record<Action, string> = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  reload: "Reload",
  dash: "Dash",
  slot1: "Primary weapon",
  slot2: "Sidearm",
  slot3: "Picked-up weapon",
  interact: "Interact / pick up",
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
  scoreboard: "Tab",
};

export type GraphicsQuality = "low" | "high";

export interface Settings {
  masterVolume: number;
  sfxVolume: number;
  uiVolume: number;
  screenShake: number;
  quality: GraphicsQuality;
  showDebug: boolean;
  crosshairColor: string;
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
  bindings: { ...DEFAULT_BINDINGS },
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      bindings: { ...DEFAULT_BINDINGS, ...(parsed.bindings ?? {}) },
    };
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
