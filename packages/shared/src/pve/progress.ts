/**
 * PvE progression (Outbreak campaign and Survival records), kept apart from competitive stats so
 * PvE never changes a profile's PvP numbers. Rewards are cosmetic (titles) plus XP into the
 * shared level track; nothing here makes a weapon stronger anywhere.
 *
 * Pure functions: the host-mode local profile uses them, and a server profile can store the same
 * shape. A run is recorded once: its id is remembered, a repeated delivery (reconnect, duplicated
 * results message) changes nothing.
 */
import type { PveRecord } from "../protocol/messages.ts";
import { MISSIONS, type MissionDef, missionById } from "./missions.ts";

export interface MissionProgress {
  /** Best completion per difficulty (seconds). */
  best: Record<string, number>;
  completions: number;
  attempts: number;
}

export interface PveProgress {
  missions: Record<string, MissionProgress>;
  /** Survival: most waves cleared, per difficulty. */
  survivalBest: Record<string, number>;
  kills: number;
  revives: number;
  runs: number;
  titles: string[];
  /** Recently recorded run ids (dedupe), newest last. */
  seen: string[];
}

export const MAX_SEEN_RUNS = 64;

export function emptyPveProgress(): PveProgress {
  return { missions: {}, survivalBest: {}, kills: 0, revives: 0, runs: 0, titles: [], seen: [] };
}

const num = (v: unknown, max = 1e9) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0;

/** Stored data is validated on read (it comes from localStorage or a database column). */
export function normalizePveProgress(raw: unknown): PveProgress {
  const out = emptyPveProgress();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.missions && typeof r.missions === "object") {
    for (const [id, v] of Object.entries(r.missions as Record<string, unknown>)) {
      if (!missionById(id) || !v || typeof v !== "object") continue;
      const m = v as Record<string, unknown>;
      const best: Record<string, number> = {};
      if (m.best && typeof m.best === "object") {
        for (const [d, t] of Object.entries(m.best as Record<string, unknown>)) {
          if (/^[a-z]{3,12}$/.test(d) && num(t) > 0) best[d] = num(t);
        }
      }
      out.missions[id] = { best, completions: num(m.completions), attempts: num(m.attempts) };
    }
  }
  if (r.survivalBest && typeof r.survivalBest === "object") {
    for (const [d, w] of Object.entries(r.survivalBest as Record<string, unknown>)) {
      if (/^[a-z]{3,12}$/.test(d)) out.survivalBest[d] = num(w, 10_000);
    }
  }
  out.kills = num(r.kills);
  out.revives = num(r.revives);
  out.runs = num(r.runs);
  if (Array.isArray(r.titles)) {
    const valid = new Set(MISSIONS.map((m) => m.title));
    out.titles = r.titles.filter((t): t is string => typeof t === "string" && valid.has(t)).slice(0, 32);
  }
  if (Array.isArray(r.seen)) {
    out.seen = r.seen
      .filter((s): s is string => typeof s === "string" && s.length <= 80)
      .slice(-MAX_SEEN_RUNS);
  }
  return out;
}

export interface PveApplyResult {
  progress: PveProgress;
  /** False when this run was already recorded (nothing changed). */
  recorded: boolean;
  newTitles: string[];
  /** Missions that became playable with this run. */
  unlocked: string[];
  personalBest: boolean;
}

export function missionUnlocked(p: PveProgress, m: MissionDef): boolean {
  return !m.requires || (p.missions[m.requires]?.completions ?? 0) > 0;
}

export function applyPveRun(prev: PveProgress, rec: PveRecord): PveApplyResult {
  if (prev.seen.includes(rec.runId)) {
    return { progress: prev, recorded: false, newTitles: [], unlocked: [], personalBest: false };
  }
  const p: PveProgress = structuredClone(prev);
  p.seen = [...p.seen, rec.runId].slice(-MAX_SEEN_RUNS);
  p.runs += 1;
  p.kills += Math.max(0, Math.floor(rec.kills));
  p.revives += Math.max(0, Math.floor(rec.revives));
  const newTitles: string[] = [];
  const unlocked: string[] = [];
  let personalBest = false;
  if (rec.mode === "survival") {
    const before = p.survivalBest[rec.difficulty] ?? 0;
    if (rec.progress > before) {
      p.survivalBest[rec.difficulty] = rec.progress;
      personalBest = before > 0 || rec.progress > 0;
    }
  } else {
    const m = missionById(rec.mission);
    if (m) {
      const lockedBefore = MISSIONS.filter((x) => !missionUnlocked(p, x)).map((x) => x.id);
      const mp = p.missions[m.id] ?? { best: {}, completions: 0, attempts: 0 };
      mp.attempts += 1;
      if (rec.completed) {
        mp.completions += 1;
        const prevBest = mp.best[rec.difficulty];
        if (!prevBest || rec.timeSec < prevBest) {
          mp.best[rec.difficulty] = Math.max(1, Math.floor(rec.timeSec));
          personalBest = true;
        }
        if (!p.titles.includes(m.title)) {
          p.titles.push(m.title);
          newTitles.push(m.title);
        }
      }
      p.missions[m.id] = mp;
      for (const id of lockedBefore) {
        const x = missionById(id);
        if (x && missionUnlocked(p, x)) unlocked.push(id);
      }
    }
  }
  return { progress: p, recorded: true, newTitles, unlocked, personalBest };
}
