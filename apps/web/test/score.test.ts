import { describe, expect, it } from "vitest";
import {
  AMBIENT_GAP_SEC,
  AMBIENT_KINDS,
  BeatClock,
  bossPattern,
  MUFFLE_HZ,
  nextAmbientDelay,
  PULSE_BPM,
  pickAmbient,
  type ScoreInput,
  type ScoreMix,
  STINGER_GAP_SEC,
  STINGER_KINDS,
  StingerThrottle,
  scoreMix,
} from "../src/game/audio/scoreModel.ts";

const calm: ScoreInput = {
  tension: 0,
  boss: false,
  bossPhase: 0,
  downed: false,
  lowHp: false,
  waveActive: false,
  dark: false,
};
const at = (tension: number, extra: Partial<ScoreInput> = {}) => scoreMix({ ...calm, tension, ...extra });
const steps = Array.from({ length: 41 }, (_, i) => i / 40);

describe("dread score mix", () => {
  it("every value stays in range, for every flag combination and odd inputs", () => {
    const tensions = [-1, 0, 0.3, 0.6, 0.61, 1, 7, Number.NaN];
    for (const tension of tensions) {
      for (let flags = 0; flags < 32; flags++) {
        for (const bossPhase of [0, 1, 2, 3, 9, Number.NaN]) {
          const m = scoreMix({
            tension,
            boss: !!(flags & 1),
            bossPhase,
            downed: !!(flags & 2),
            lowHp: !!(flags & 4),
            waveActive: !!(flags & 8),
            dark: !!(flags & 16),
          });
          for (const k of [
            "drone",
            "air",
            "hum",
            "dissonance",
            "tremolo",
            "pulseGain",
            "pulseClose",
            "boss",
            "muffle",
            "ambient",
          ] as const) {
            expect(m[k], k).toBeGreaterThanOrEqual(0);
            expect(m[k], k).toBeLessThanOrEqual(1);
          }
          expect(m.pulseBpm).toBeGreaterThanOrEqual(PULSE_BPM.min);
          expect(m.pulseBpm).toBeLessThanOrEqual(PULSE_BPM.max);
          expect(m.muffleHz).toBeGreaterThanOrEqual(MUFFLE_HZ.closed - 1e-6);
          expect(m.muffleHz).toBeLessThanOrEqual(MUFFLE_HZ.open + 1e-6);
          expect(m.droneHz).toBeGreaterThan(100);
          expect(m.droneHz).toBeLessThan(1000);
          expect([0, 1, 2, 3]).toContain(m.bossPhase);
          for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  it("grows monotonically with tension (drone, dissonance, tremolo, pulse tempo and level)", () => {
    for (const extra of [{}, { dark: true }, { waveActive: true }, { lowHp: true }]) {
      let prev: ScoreMix | null = null;
      for (const t of steps) {
        const m = at(t, extra);
        if (prev) {
          expect(m.drone).toBeGreaterThanOrEqual(prev.drone);
          expect(m.air).toBeGreaterThanOrEqual(prev.air);
          expect(m.dissonance).toBeGreaterThanOrEqual(prev.dissonance);
          expect(m.tremolo).toBeGreaterThanOrEqual(prev.tremolo);
          expect(m.pulseBpm).toBeGreaterThanOrEqual(prev.pulseBpm);
          expect(m.pulseGain).toBeGreaterThanOrEqual(prev.pulseGain);
          expect(m.ambient).toBeLessThanOrEqual(prev.ambient);
        }
        prev = m;
      }
    }
    expect(at(0).pulseBpm).toBeCloseTo(55);
    expect(at(1).pulseBpm).toBeCloseTo(120);
    expect(at(1).dissonance).toBeGreaterThan(at(0.3).dissonance);
  });

  it("calm is mostly drone: no heartbeat, no dissonance, room for distant one-shots", () => {
    const m = at(0);
    expect(m.drone).toBeGreaterThan(0.4);
    expect(m.pulseGain).toBe(0);
    expect(m.dissonance).toBe(0);
    expect(m.tremolo).toBe(0);
    expect(m.boss).toBe(0);
    expect(m.ambient).toBe(1);
    expect(at(0.8).ambient).toBe(0);
  });

  it("the shrill tremolo only comes in above 0.6 tension", () => {
    for (const t of steps.filter((t) => t <= 0.6)) expect(at(t).tremolo).toBe(0);
    expect(at(0.7).tremolo).toBeGreaterThan(0);
    expect(at(1).tremolo).toBe(1);
  });

  it("low HP and downed make the heartbeat strong, faster and close", () => {
    for (const t of [0, 0.2, 0.5, 0.9]) {
      const base = at(t);
      const low = at(t, { lowHp: true });
      const down = at(t, { downed: true });
      expect(low.pulseGain).toBeGreaterThan(Math.min(0.99, base.pulseGain));
      expect(low.pulseGain).toBeGreaterThanOrEqual(0.9);
      expect(down.pulseGain).toBe(1);
      expect(low.pulseBpm).toBeGreaterThanOrEqual(base.pulseBpm);
      expect(low.pulseBpm).toBeGreaterThanOrEqual(96);
      expect(low.pulseClose).toBeGreaterThan(base.pulseClose);
      expect(down.pulseClose).toBe(1);
    }
  });

  it("downed muffles the rest of the score; nothing else does", () => {
    expect(at(0.5, { downed: true }).muffle).toBe(1);
    expect(at(0.5, { downed: true }).muffleHz).toBeCloseTo(MUFFLE_HZ.closed);
    for (const extra of [{}, { lowHp: true }, { boss: true, bossPhase: 3 }, { dark: true }]) {
      expect(at(0.9, extra).muffle).toBe(0);
      expect(at(0.9, extra).muffleHz).toBeCloseTo(MUFFLE_HZ.open);
    }
  });

  it("a living boss replaces the heartbeat with drums that intensify by phase", () => {
    for (const t of [0, 0.5, 1]) {
      for (const lowHp of [false, true]) {
        const m = at(t, { boss: true, bossPhase: 1, lowHp });
        expect(m.pulseGain).toBe(0);
        expect(m.boss).toBeGreaterThan(0);
      }
    }
    const p1 = at(0.5, { boss: true, bossPhase: 1 });
    const p2 = at(0.5, { boss: true, bossPhase: 2 });
    const p3 = at(0.5, { boss: true, bossPhase: 3 });
    expect(p2.boss).toBeGreaterThan(p1.boss);
    expect(p3.boss).toBeGreaterThan(p2.boss);
    expect(p2.bossBpm).toBeGreaterThan(p1.bossBpm);
    expect(p3.bossBpm).toBeGreaterThan(p2.bossBpm);
    expect(p3.tremolo).toBeGreaterThan(0);
    expect(p1.ambient).toBe(0);
    // No boss, no drums (a stale phase number alone does not start them).
    expect(at(0.5, { bossPhase: 3 }).boss).toBe(0);
    expect(at(0.5, { bossPhase: 3 }).bossBpm).toBe(0);
    // A boss flagged before its phase is known plays phase 1.
    expect(at(0.5, { boss: true, bossPhase: 0 }).bossPhase).toBe(1);
  });

  it("downed during a boss: the heartbeat comes back and the drums duck", () => {
    const up = at(0.8, { boss: true, bossPhase: 2 });
    const down = at(0.8, { boss: true, bossPhase: 2, downed: true });
    expect(down.pulseGain).toBe(1);
    expect(down.boss).toBeLessThan(up.boss);
    expect(down.boss).toBeGreaterThan(0);
    expect(down.muffle).toBe(1);
  });

  it("dark makes the bed darker and quieter and cuts the hum", () => {
    for (const t of [0, 0.5, 1]) {
      const lit = at(t);
      const dark = at(t, { dark: true });
      expect(dark.drone).toBeLessThan(lit.drone);
      expect(dark.droneHz).toBeLessThan(lit.droneHz);
      expect(dark.air).toBeLessThan(lit.air);
      expect(dark.hum).toBe(0);
      expect(lit.hum).toBeGreaterThan(0);
    }
  });

  it("an active wave lifts the dissonance a little", () => {
    expect(at(0, { waveActive: true }).dissonance).toBeGreaterThan(at(0).dissonance);
    expect(at(0.5, { waveActive: true }).dissonance).toBeGreaterThan(at(0.5).dissonance);
  });
});

describe("boss ostinato", () => {
  const hits = (p: number) => {
    const pat = bossPattern(p);
    return [...pat.low, ...pat.mid, ...pat.hit].filter((v) => v > 0).length;
  };

  it("one bar of 16 steps per voice, downbeat accented", () => {
    for (const p of [1, 2, 3]) {
      const pat = bossPattern(p);
      expect(pat.low).toHaveLength(16);
      expect(pat.mid).toHaveLength(16);
      expect(pat.hit).toHaveLength(16);
      expect(pat.low[0]).toBe(1);
      for (const v of [...pat.low, ...pat.mid, ...pat.hit]) expect([0, 0.7, 1]).toContain(v);
    }
  });

  it("gets busier phase after phase; out-of-range phases clamp", () => {
    expect(hits(2)).toBeGreaterThan(hits(1));
    expect(hits(3)).toBeGreaterThan(hits(2));
    expect(bossPattern(0)).toEqual(bossPattern(1));
    expect(bossPattern(7)).toEqual(bossPattern(3));
    expect(bossPattern(Number.NaN)).toEqual(bossPattern(1));
  });
});

describe("stinger throttle", () => {
  it("plays the first, blocks repeats inside the gap, allows them after", () => {
    const th = new StingerThrottle();
    expect(th.tryFire("spotted", 10)).toBe(true);
    expect(th.tryFire("spotted", 10.5)).toBe(false);
    expect(th.tryFire("spotted", 12.4)).toBe(false);
    expect(th.tryFire("spotted", 12.5)).toBe(true);
    expect(th.tryFire("spotted", 13)).toBe(false);
  });

  it("throttles each kind independently, every kind at least 2.5 s", () => {
    const th = new StingerThrottle();
    for (const k of STINGER_KINDS) expect(th.tryFire(k, 100)).toBe(true);
    for (const k of STINGER_KINDS) {
      expect(STINGER_GAP_SEC[k]).toBeGreaterThanOrEqual(2.5);
      expect(th.tryFire(k, 102.4)).toBe(false);
      expect(th.tryFire(k, 100 + STINGER_GAP_SEC[k])).toBe(true);
    }
  });

  it("a blocked attempt does not extend the gap; reset clears it", () => {
    const th = new StingerThrottle();
    th.tryFire("wave", 0);
    expect(th.tryFire("wave", 3)).toBe(false);
    expect(th.tryFire("wave", 4)).toBe(true);
    th.reset();
    expect(th.tryFire("wave", 4.1)).toBe(true);
  });
});

describe("beat clock", () => {
  it("emits each beat once, at the tempo, as the look-ahead window slides", () => {
    const c = new BeatClock();
    const times: number[] = [];
    for (let now = 0; now < 3; now += 1 / 60) {
      for (const b of c.due(now, 0.15, 0.5)) times.push(b.time);
    }
    expect(times.length).toBeGreaterThanOrEqual(6);
    expect(times.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeCloseTo(0.5);
  });

  it("resyncs after a stall instead of firing a burst of missed beats", () => {
    const c = new BeatClock();
    c.due(0, 0.15, 0.5);
    const after = c.due(30, 0.15, 0.5);
    expect(after.length).toBe(1);
    expect(after[0]!.time).toBeGreaterThanOrEqual(30);
  });

  it("indexes beats for patterns and ignores a broken tempo", () => {
    const c = new BeatClock();
    const a = c.due(0, 1, 0.25);
    expect(a.map((b) => b.index)).toEqual([0, 1, 2, 3]);
    expect(c.due(1, 0.15, 0).length).toBe(0);
    expect(c.due(1, 0.15, Number.NaN).length).toBe(0);
    c.reset();
    expect(c.due(5, 0.1, 0.25)[0]!.index).toBe(0);
  });
});

describe("distant one-shots", () => {
  it("come every 20 to 45 seconds", () => {
    expect(nextAmbientDelay(() => 0)).toBe(AMBIENT_GAP_SEC.min);
    expect(nextAmbientDelay(() => 0.999999)).toBeLessThanOrEqual(AMBIENT_GAP_SEC.max);
    expect(AMBIENT_GAP_SEC).toEqual({ min: 20, max: 45 });
    for (let i = 0; i < 200; i++) {
      const d = nextAmbientDelay();
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(45);
    }
  });

  it("never repeat the same kind twice in a row", () => {
    for (const prev of AMBIENT_KINDS) {
      for (const r of [0, 0.34, 0.67, 0.999]) {
        const k = pickAmbient(() => r, prev);
        expect(AMBIENT_KINDS).toContain(k);
        expect(k).not.toBe(prev);
      }
    }
  });
});

describe("score module without Web Audio", () => {
  it("imports and runs its whole API as no-ops in node (no AudioContext touched)", async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
    const { score } = await import("../src/game/audio/score.ts");
    const { sfx } = await import("../src/game/audio/sfx.ts");
    expect(sfx.context()).toBeNull();
    expect(() => {
      score.start();
      score.start();
      score.update(1 / 60, { ...calm, tension: 0.8, boss: true, bossPhase: 2 });
      for (const k of STINGER_KINDS) score.stinger(k);
      score.stop();
      score.stop();
      score.update(1 / 60, calm);
    }).not.toThrow();
  });
});
