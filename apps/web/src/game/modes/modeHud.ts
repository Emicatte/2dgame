import { createStore } from "../../lib/store.ts";

/** A short centred message (round flow, level up) with its start time (performance.now). */
export interface ModeBanner {
  id: number;
  title: string;
  sub: string;
  tone: "info" | "good" | "warn";
  at: number;
}

/** Mode-specific HUD (Gun Game ladder, round modes), filled by the ModeLayer. */
export interface ModeHudState {
  mode: string;
  /** Gun Game */
  ggLevel: number;
  ggLeader: { name: string; level: number; you: boolean } | null;
  overtime: boolean;
  /** Round modes */
  role: number;
  stage: string;
  stageLeftSec: number;
  round: number;
  rounds: number;
  variant: string;
  dark: boolean;
  seekers: number;
  hiders: number;
  points: number;
  spectating: string | null;
  /** Hider: seen by the seeking side right now (warning). */
  spottedAt: number;
  /** Hunter: last innocent-object penalty (flash). */
  penaltyAt: number;
  /** Prop Hunt */
  disguise: string | null;
  locked: boolean;
  transformInSec: number;
  tauntInSec: number;
  decoyInSec: number;
  kinds: { index: number; name: string; kind: string }[];
  pickerOpen: boolean;
  banner: ModeBanner | null;
  toast: { id: number; text: string; at: number } | null;
}

export const modeHudStore = createStore<ModeHudState>({
  mode: "",
  ggLevel: 0,
  ggLeader: null,
  overtime: false,
  role: 0,
  stage: "",
  stageLeftSec: 0,
  round: 0,
  rounds: 0,
  variant: "",
  dark: false,
  seekers: 0,
  hiders: 0,
  points: 0,
  spectating: null,
  spottedAt: 0,
  penaltyAt: 0,
  disguise: null,
  locked: false,
  transformInSec: 0,
  tauntInSec: 0,
  decoyInSec: 0,
  kinds: [],
  pickerOpen: false,
  banner: null,
  toast: null,
});

let seq = 0;

export function showBanner(title: string, sub = "", tone: ModeBanner["tone"] = "info"): void {
  modeHudStore.patch({ banner: { id: ++seq, title, sub, tone, at: performance.now() } });
}

export function showToast(text: string): void {
  modeHudStore.patch({ toast: { id: ++seq, text, at: performance.now() } });
}
