import { hashString, mulberry32 } from "../sim/rng.ts";
import type { XpLine } from "./progression.ts";

/**
 * Career records beyond the basic totals: per-mode stats, objective and vehicle counters, and the
 * daily challenges. Pure functions shared by every place a match is recorded (dedicated server
 * repositories and the host-mode local profile), so they can never disagree.
 *
 * Challenges reward XP only; levels unlock cosmetics only. Nothing here can be bought.
 */

/** What one finished match contributes to a player's career. */
export interface MatchFacts {
  mode: string;
  completed: boolean;
  won: boolean;
  kills: number;
  deaths: number;
  /** Domination point captures taken part in. */
  captures: number;
  flagCaptures: number;
  flagReturns: number;
  /** Crewed enemy vehicles wrecked. */
  vehicleKills: number;
}

export interface ModeStats {
  played: number;
  wins: number;
  kills: number;
  deaths: number;
}

export interface ChallengeState {
  /** UTC day the progress belongs to (YYYY-MM-DD); a new day starts fresh challenges. */
  day: string;
  progress: Record<string, number>;
  done: string[];
}

export interface CareerStats {
  modes: Record<string, ModeStats>;
  captures: number;
  flagCaptures: number;
  flagReturns: number;
  vehicleKills: number;
  challenges: ChallengeState;
}

export interface ChallengeDef {
  id: string;
  text: string;
  target: number;
  xp: number;
  /** How much a match advances it. */
  count: (f: MatchFacts) => number;
}

const teamMode = (m: string) => m === "tdm" || m === "dom" || m === "ctf" || m === "mayhem";

/** The pool daily challenges are drawn from (stable ids: progress is stored by id). */
export const CHALLENGE_POOL: readonly ChallengeDef[] = [
  { id: "play3", text: "Finish 3 matches", target: 3, xp: 100, count: (f) => (f.completed ? 1 : 0) },
  { id: "win2", text: "Win 2 matches", target: 2, xp: 150, count: (f) => (f.won ? 1 : 0) },
  { id: "elim15", text: "Get 15 eliminations", target: 15, xp: 120, count: (f) => f.kills },
  { id: "elim40", text: "Get 40 eliminations", target: 40, xp: 220, count: (f) => f.kills },
  { id: "cap3", text: "Capture 3 points in Domination", target: 3, xp: 150, count: (f) => f.captures },
  { id: "flag1", text: "Capture a flag", target: 1, xp: 150, count: (f) => f.flagCaptures },
  { id: "return2", text: "Return 2 flags", target: 2, xp: 100, count: (f) => f.flagReturns },
  { id: "wreck2", text: "Wreck 2 enemy vehicles", target: 2, xp: 150, count: (f) => f.vehicleKills },
  {
    id: "mayhem1",
    text: "Finish a Vehicle Mayhem match",
    target: 1,
    xp: 100,
    count: (f) => (f.completed && f.mode === "mayhem" ? 1 : 0),
  },
  {
    id: "teamwin",
    text: "Win a team match",
    target: 1,
    xp: 120,
    count: (f) => (f.won && teamMode(f.mode) ? 1 : 0),
  },
];

export const DAILY_CHALLENGES = 3;

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The day's challenges: the same three for everybody, drawn from the pool by the date. */
export function dailyChallenges(day: string): ChallengeDef[] {
  const rand = mulberry32(hashString(`daily:${day}`));
  const pool = [...CHALLENGE_POOL];
  const out: ChallengeDef[] = [];
  while (out.length < DAILY_CHALLENGES && pool.length > 0) {
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  }
  return out;
}

export function emptyCareer(day = ""): CareerStats {
  return {
    modes: {},
    captures: 0,
    flagCaptures: 0,
    flagReturns: 0,
    vehicleKills: 0,
    challenges: { day, progress: {}, done: [] },
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Tolerant reader for stored data (older profiles, hand-edited storage, unknown keys). */
export function normalizeCareer(raw: unknown): CareerStats {
  const c = emptyCareer();
  if (!raw || typeof raw !== "object") return c;
  const r = raw as Record<string, unknown>;
  if (r.modes && typeof r.modes === "object") {
    for (const [mode, v] of Object.entries(r.modes as Record<string, unknown>)) {
      if (!/^[a-z]{2,16}$/.test(mode) || !v || typeof v !== "object") continue;
      const m = v as Record<string, unknown>;
      c.modes[mode] = {
        played: num(m.played),
        wins: num(m.wins),
        kills: num(m.kills),
        deaths: num(m.deaths),
      };
    }
  }
  c.captures = num(r.captures);
  c.flagCaptures = num(r.flagCaptures);
  c.flagReturns = num(r.flagReturns);
  c.vehicleKills = num(r.vehicleKills);
  const ch = r.challenges as Record<string, unknown> | undefined;
  if (ch && typeof ch === "object" && typeof ch.day === "string") {
    c.challenges.day = ch.day.slice(0, 10);
    if (ch.progress && typeof ch.progress === "object") {
      for (const def of CHALLENGE_POOL) {
        const v = (ch.progress as Record<string, unknown>)[def.id];
        if (v !== undefined) c.challenges.progress[def.id] = Math.min(def.target, num(v));
      }
    }
    if (Array.isArray(ch.done)) {
      c.challenges.done = ch.done.filter((id): id is string => CHALLENGE_POOL.some((d) => d.id === id));
    }
  }
  return c;
}

export interface ChallengeView {
  id: string;
  text: string;
  target: number;
  progress: number;
  done: boolean;
  xp: number;
}

/** Today's challenges with this career's progress (a new day shows them fresh). */
export function challengeViews(c: CareerStats, now: Date): ChallengeView[] {
  const day = utcDay(now);
  const same = c.challenges.day === day;
  return dailyChallenges(day).map((d) => ({
    id: d.id,
    text: d.text,
    target: d.target,
    xp: d.xp,
    progress: same ? Math.min(d.target, c.challenges.progress[d.id] ?? 0) : 0,
    done: same && c.challenges.done.includes(d.id),
  }));
}

/**
 * Adds a match to a career. Returns the new career and the XP lines of the challenges this match
 * completed (the caller adds their XP to the player's total).
 */
export function applyMatchToCareer(
  current: CareerStats,
  f: MatchFacts,
  now: Date,
): { career: CareerStats; rewards: XpLine[] } {
  const c = normalizeCareer(current);
  const day = utcDay(now);
  if (c.challenges.day !== day) c.challenges = { day, progress: {}, done: [] };
  if (f.completed) {
    const m = c.modes[f.mode] ?? { played: 0, wins: 0, kills: 0, deaths: 0 };
    c.modes[f.mode] = {
      played: m.played + 1,
      wins: m.wins + (f.won ? 1 : 0),
      kills: m.kills + f.kills,
      deaths: m.deaths + f.deaths,
    };
  }
  c.captures += f.captures;
  c.flagCaptures += f.flagCaptures;
  c.flagReturns += f.flagReturns;
  c.vehicleKills += f.vehicleKills;
  const rewards: XpLine[] = [];
  for (const d of dailyChallenges(day)) {
    if (c.challenges.done.includes(d.id)) continue;
    const next = Math.min(d.target, (c.challenges.progress[d.id] ?? 0) + Math.max(0, d.count(f)));
    c.challenges.progress[d.id] = next;
    if (next >= d.target) {
      c.challenges.done.push(d.id);
      rewards.push({ reason: `Challenge: ${d.text}`, xp: d.xp });
    }
  }
  return { career: c, rewards };
}
