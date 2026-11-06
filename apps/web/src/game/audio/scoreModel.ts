/**
 * The musical decisions of the co-op dread score (score.ts), kept free of Web Audio so they can be
 * unit-tested in node: how loud each layer is for a given game state, the boss drum patterns, the
 * stinger throttle, the beat clock and the timing of the distant "something moved" one-shots.
 */

export interface ScoreInput {
  /** 0..1, already smoothed by the caller. */
  tension: number;
  boss: boolean;
  /** 0 none, 1..3. */
  bossPhase: number;
  downed: boolean;
  /** HP at or below 30 %. */
  lowHp: boolean;
  waveActive: boolean;
  /** Power off / unlit area. */
  dark: boolean;
}

export const STINGER_KINDS = [
  "spotted",
  "special",
  "wave",
  "boss",
  "downed",
  "revive",
  "objective",
  "blackout",
] as const;
export type StingerKind = (typeof STINGER_KINDS)[number];

/** Target level of every layer; gains are 0..1 and scaled by fixed layer levels in score.ts. */
export interface ScoreMix {
  /** Drone bed (always on). */
  drone: number;
  /** Lowpass cutoff of the drone bed, Hz: darker in the dark and at low tension. */
  droneHz: number;
  /** Filtered noise "wind / air handling". */
  air: number;
  /** Electrical hum of lit areas; 0 in the dark, so a blackout is heard as well as seen. */
  hum: number;
  /** Clustered high partials (minor seconds, tritones) with slow swells. */
  dissonance: number;
  /** Shrill string-like tremolo, only above 0.6 tension (or in the last boss phase). */
  tremolo: number;
  /** Heartbeat tempo. */
  pulseBpm: number;
  /** Heartbeat level; 0 while a boss lives (its drums replace it) unless the player is downed. */
  pulseGain: number;
  /** How close / present the heartbeat sounds (opens its lowpass, adds a chest thud). */
  pulseClose: number;
  /** Boss percussion intensity. */
  boss: number;
  /** 0 without a boss, else 1..3. */
  bossPhase: number;
  /** Boss ostinato tempo; 0 without a boss. */
  bossBpm: number;
  /** 0..1 muffling of everything but the heartbeat and the personal stingers (downed). */
  muffle: number;
  /** Lowpass cutoff of the music bus for `muffle`, Hz. */
  muffleHz: number;
  /** Likelihood weight of the rare distant one-shots (creaks, far screams, door bangs). */
  ambient: number;
}

export const PULSE_BPM = { min: 55, max: 120 } as const;
export const MUFFLE_HZ = { open: 20000, closed: 600 } as const;
/** Boss ostinato tempo per phase 1..3. */
export const BOSS_BPM = [0, 100, 114, 128] as const;

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const k = clamp01((x - edge0) / (edge1 - edge0));
  return k * k * (3 - 2 * k);
}

/**
 * The mix for a game state. Every gain grows (never shrinks) with tension; flags then push
 * individual layers: low HP or downed make the heartbeat strong, fast-ish and close; a boss swaps
 * the heartbeat for its drums; downed muffles the rest; dark makes the bed darker and quieter.
 */
export function scoreMix(s: ScoreInput): ScoreMix {
  const t = clamp01(s.tension);
  const dark = !!s.dark;
  const hurt = !!s.lowHp || !!s.downed;
  const phase = s.boss
    ? Math.min(3, Math.max(1, Math.round(Number.isFinite(s.bossPhase) ? s.bossPhase : 1)))
    : 0;

  const drone = (0.55 + 0.3 * t) * (dark ? 0.7 : 1);
  const droneHz = dark ? 170 + 260 * t : 300 + 520 * t;
  const air = (0.45 + 0.35 * t) * (dark ? 0.55 : 1);
  const hum = dark ? 0 : 1 - 0.6 * t;

  let dissonance = smoothstep(0.12, 0.9, t);
  if (s.waveActive) dissonance = 0.1 + 0.9 * dissonance;
  if (phase > 0) dissonance = Math.max(dissonance, 0.3 + 0.15 * phase);

  let tremolo = smoothstep(0.6, 1, t);
  if (phase === 3) tremolo = Math.max(tremolo, 0.5);

  let pulseBpm = PULSE_BPM.min + (PULSE_BPM.max - PULSE_BPM.min) * t;
  let pulseGain = 0.65 * smoothstep(0.04, 0.75, t);
  if (hurt) {
    pulseBpm = Math.min(PULSE_BPM.max, Math.max(96, pulseBpm + 10));
    pulseGain = Math.max(pulseGain, s.downed ? 1 : 0.9);
  }
  const pulseClose = s.downed ? 1 : s.lowHp ? 0.8 : 0.25 * t;

  let boss = 0;
  if (phase > 0) {
    boss = 0.6 + 0.2 * (phase - 1);
    if (s.downed) boss *= 0.4;
    else pulseGain = 0;
  }

  const muffle = s.downed ? 1 : 0;
  const muffleHz = MUFFLE_HZ.closed * (MUFFLE_HZ.open / MUFFLE_HZ.closed) ** (1 - muffle);
  const ambient = phase > 0 ? 0 : 1 - smoothstep(0.08, 0.35, t);

  return {
    drone,
    droneHz,
    air,
    hum,
    dissonance: clamp01(dissonance),
    tremolo: clamp01(tremolo),
    pulseBpm,
    pulseGain: clamp01(pulseGain),
    pulseClose: clamp01(pulseClose),
    boss: clamp01(boss),
    bossPhase: phase,
    bossBpm: BOSS_BPM[phase] ?? 0,
    muffle,
    muffleHz,
    ambient: clamp01(ambient),
  };
}

// ----- boss ostinato

/** One bar of 16 sixteenth notes per voice; values are velocities (0 = rest). */
export interface BossPattern {
  low: number[];
  mid: number[];
  hit: number[];
}

/** X accent, x normal, . rest. Phase 1 menaces, phase 2 syncopates, phase 3 drives. */
const BOSS_BARS: Record<1 | 2 | 3, { low: string; mid: string; hit: string }> = {
  1: { low: "X.......x..x....", mid: "................", hit: "X..............." },
  2: { low: "X.....x.X..x....", mid: "....x.......x.x.", hit: "X.......x......." },
  3: { low: "X..x..x.X..x..x.", mid: "..x...x...x.x.xX", hit: "X...x...X...x..." },
};

const parseBar = (bar: string): number[] => [...bar].map((c) => (c === "X" ? 1 : c === "x" ? 0.7 : 0));

const BOSS_PATTERNS: Record<1 | 2 | 3, BossPattern> = {
  1: { low: parseBar(BOSS_BARS[1].low), mid: parseBar(BOSS_BARS[1].mid), hit: parseBar(BOSS_BARS[1].hit) },
  2: { low: parseBar(BOSS_BARS[2].low), mid: parseBar(BOSS_BARS[2].mid), hit: parseBar(BOSS_BARS[2].hit) },
  3: { low: parseBar(BOSS_BARS[3].low), mid: parseBar(BOSS_BARS[3].mid), hit: parseBar(BOSS_BARS[3].hit) },
};

export function bossPattern(phase: number): BossPattern {
  const p = Math.min(3, Math.max(1, Math.round(Number.isFinite(phase) ? phase : 1))) as 1 | 2 | 3;
  return BOSS_PATTERNS[p];
}

// ----- timing

/**
 * Look-ahead clock for the heartbeat and the boss drums: returns the beats that fall in
 * [now, now + horizon). Tempo can change between calls (it applies from the next beat); after a
 * stall (hidden tab, paused loop) it resyncs instead of firing the missed beats in a burst.
 */
export class BeatClock {
  private next = -1;
  private index = 0;

  due(now: number, horizon: number, period: number): { time: number; index: number }[] {
    const out: { time: number; index: number }[] = [];
    if (!(period > 0) || !Number.isFinite(now)) return out;
    if (this.next < 0 || this.next < now - 0.25) this.next = now + 0.02;
    while (this.next < now + horizon && out.length < 16) {
      out.push({ time: this.next, index: this.index++ });
      this.next += period;
    }
    return out;
  }

  reset(): void {
    this.next = -1;
    this.index = 0;
  }
}

/** Minimum seconds between two stingers of the same kind. */
export const STINGER_GAP_SEC: Record<StingerKind, number> = {
  spotted: 2.5,
  special: 3,
  wave: 4,
  boss: 6,
  downed: 2.5,
  revive: 2.5,
  objective: 2.5,
  blackout: 4,
};

export class StingerThrottle {
  private readonly last = new Map<StingerKind, number>();
  private readonly gaps: Record<StingerKind, number>;

  constructor(gaps: Record<StingerKind, number> = STINGER_GAP_SEC) {
    this.gaps = gaps;
  }

  /** True (and records it) if `kind` may play at `nowSec`. */
  tryFire(kind: StingerKind, nowSec: number): boolean {
    const prev = this.last.get(kind);
    if (prev !== undefined && nowSec - prev < (this.gaps[kind] ?? 2.5)) return false;
    this.last.set(kind, nowSec);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

// ----- distant one-shots in the quiet

export const AMBIENT_GAP_SEC = { min: 20, max: 45 } as const;
export const AMBIENT_KINDS = ["creak", "scream", "door"] as const;
export type AmbientKind = (typeof AMBIENT_KINDS)[number];

/** Seconds until the next distant one-shot. */
export function nextAmbientDelay(rand: () => number = Math.random): number {
  return AMBIENT_GAP_SEC.min + (AMBIENT_GAP_SEC.max - AMBIENT_GAP_SEC.min) * clamp01(rand());
}

/** A random kind, never the same one twice in a row. */
export function pickAmbient(rand: () => number = Math.random, previous?: AmbientKind): AmbientKind {
  const n = AMBIENT_KINDS.length;
  let i = Math.min(n - 1, Math.floor(clamp01(rand()) * n));
  if (AMBIENT_KINDS[i] === previous) i = (i + 1) % n;
  return AMBIENT_KINDS[i]!;
}
