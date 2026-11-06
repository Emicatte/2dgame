import {
  type AmbientKind,
  BeatClock,
  bossPattern,
  nextAmbientDelay,
  pickAmbient,
  type ScoreInput,
  type ScoreMix,
  type StingerKind,
  StingerThrottle,
  scoreMix,
} from "./scoreModel.ts";
import { sfx } from "./sfx.ts";

export type { ScoreInput, ScoreMix, StingerKind } from "./scoreModel.ts";
export { scoreMix } from "./scoreModel.ts";

/**
 * Adaptive dread score of the co-op modes (Outbreak / Survival), synthesized like the sound
 * effects (sfx.ts) and sharing their AudioContext; it plays on the music bus, so the "Music volume"
 * setting controls it live. Nothing here runs until the scene calls start() in a PvE match: PvP
 * never builds the graph. Layers are persistent oscillators/filters crossfaded with AudioParam
 * ramps; only the heartbeat, the boss drums, the distant one-shots and the stingers create
 * short-lived nodes. What each layer does for a game state is decided in scoreModel.ts (tested).
 */

const FADE_SEC = 1.5;
const STAGE_LEVEL = 0.8;
/** Fixed level of each layer at mix 1 (the mix values from scoreModel.ts scale these). */
const LEVEL = {
  drone: 0.22,
  air: 0.1,
  hum: 0.02,
  diss: 0.045,
  trem: 0.028,
  heart: 0.45,
  boss: 0.5,
  ambient: 0.32,
  stinger: 0.4,
} as const;
const MIX_EVERY_SEC = 0.1;
const LOOKAHEAD_SEC = 0.15;

interface Graph {
  ctx: AudioContext;
  noise: AudioBuffer;
  /** Fade in / out of the whole score. */
  stage: GainNode;
  /** Lowpass of everything but the heartbeat and the personal stingers (downed). */
  muffle: BiquadFilterNode;
  /** Input of the shared echo ("distance") send. */
  space: GainNode;
  droneGain: GainNode;
  droneFilter: BiquadFilterNode;
  droneDrift: OscillatorNode;
  airGain: GainNode;
  airFilter: BiquadFilterNode;
  humGain: GainNode;
  dissGain: GainNode;
  tremGain: GainNode;
  heartGain: GainNode;
  heartFilter: BiquadFilterNode;
  bossGain: GainNode;
  bossMetal: GainNode;
  ambientGain: GainNode;
  stingerGain: GainNode;
  stingerDry: GainNode;
  sources: AudioScheduledSourceNode[];
}

const IDLE: ScoreInput = {
  tension: 0,
  boss: false,
  bossPhase: 0,
  downed: false,
  lowHp: false,
  waveActive: false,
  dark: false,
};

class DreadScore {
  private g: Graph | null = null;
  private wanted = false;
  private teardown: ReturnType<typeof setTimeout> | null = null;
  private wind: AudioBuffer | null = null;
  private input: ScoreInput = IDLE;
  private readonly throttle = new StingerThrottle();
  private readonly heartClock = new BeatClock();
  private readonly bossClock = new BeatClock();
  private readonly lastSet = new Map<string, number>();
  private mixTimer = 0;
  private motionTimer = 0;
  private gust = 1;
  private ambientIn = nextAmbientDelay();
  private lastAmbient: AmbientKind | undefined;

  /** Fades the score in (~1.5 s). Idempotent; before the audio unlock it waits for a context. */
  start(): void {
    if (this.wanted && this.g && this.teardown === null) return;
    this.wanted = true;
    this.bringUp();
  }

  /** Fades the score out (~1.5 s), then frees its nodes. Idempotent. */
  stop(): void {
    if (!this.wanted) return;
    this.wanted = false;
    const g = this.g;
    if (!g) return;
    this.fadeTo(g, 0);
    if (this.teardown !== null) clearTimeout(this.teardown);
    this.teardown = setTimeout(
      () => {
        this.teardown = null;
        if (this.g === g && !this.wanted) this.destroy();
      },
      (FADE_SEC + 0.25) * 1000,
    );
  }

  /** Every frame of a PvE match. */
  update(dtSec: number, s: ScoreInput): void {
    this.input = s;
    if (!this.wanted) return;
    if (!this.g && !this.bringUp()) return;
    const g = this.g!;
    const now = g.ctx.currentTime;
    const dt = Number.isFinite(dtSec) ? Math.min(0.25, Math.max(0, dtSec)) : 0;
    const mix = scoreMix(s);
    this.mixTimer -= dt;
    if (this.mixTimer <= 0) {
      this.mixTimer = MIX_EVERY_SEC;
      this.applyMix(g, mix, now);
    }
    this.motion(g, dt, now);
    this.schedulePulse(g, mix, now);
    this.scheduleBoss(g, mix, now);
    this.ambience(g, mix, dt);
  }

  /** One-shot cue, throttled per kind. Silent unless the score is playing. */
  stinger(kind: StingerKind): void {
    const g = this.g;
    if (!g || !this.wanted) return;
    if (!this.throttle.tryFire(kind, g.ctx.currentTime)) return;
    this.playStinger(g, kind);
  }

  // ------------------------------------------------------------------ graph

  private bringUp(): boolean {
    if (this.teardown !== null) {
      clearTimeout(this.teardown);
      this.teardown = null;
    }
    if (!this.g) {
      this.g = this.build();
      if (!this.g) return false;
      this.lastSet.clear();
      this.heartClock.reset();
      this.bossClock.reset();
      this.mixTimer = 0;
      this.motionTimer = 0;
      this.ambientIn = nextAmbientDelay();
      this.applyMix(this.g, scoreMix(this.input), this.g.ctx.currentTime);
    }
    this.fadeTo(this.g, STAGE_LEVEL);
    return true;
  }

  private fadeTo(g: Graph, v: number) {
    const p = g.stage.gain;
    const now = g.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(v, now + FADE_SEC);
  }

  private destroy() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    for (const s of g.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    g.stage.disconnect();
  }

  /** Looping brown noise for the wind / air handling, its seam crossfaded so it never clicks. */
  private windBuffer(ctx: AudioContext): AudioBuffer {
    if (this.wind && this.wind.sampleRate === ctx.sampleRate) return this.wind;
    const len = Math.floor(ctx.sampleRate * 4);
    const fade = 4096;
    const raw = new Float32Array(len + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const x = raw[i] ?? 0;
      d[i] = i < fade ? x * (i / fade) + (raw[len + i] ?? 0) * (1 - i / fade) : x;
    }
    this.wind = b;
    return b;
  }

  private build(): Graph | null {
    const c = sfx.context();
    if (!c) return null;
    const { ctx, musicBus, noise } = c;
    const sources: AudioScheduledSourceNode[] = [];
    const gain = (v: number, to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(to);
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number, q: number, to: AudioNode) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      f.connect(to);
      return f;
    };
    const osc = (type: OscillatorType, freq: number, to?: AudioNode) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      if (to) o.connect(to);
      o.start();
      sources.push(o);
      return o;
    };
    /** `src` modulates `param` by +-depth. */
    const mod = (src: AudioNode, param: AudioParam, depth: number) => {
      const d = ctx.createGain();
      d.gain.value = depth;
      src.connect(d);
      d.connect(param);
    };

    const stage = gain(0, musicBus);
    const muffle = filter("lowpass", 20000, 0.7, stage);

    // Shared echo: gives one-shots and the dissonance haze a sense of a large, empty building.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.29;
    const feedback = gain(0.38, delay);
    const damp = filter("lowpass", 1700, 0.5, feedback);
    delay.connect(damp);
    delay.connect(gain(0.45, muffle));
    const space = gain(1, delay);

    // a. Drone bed: A1 and E2, each doubled and detuned a fraction of a hertz (slow beating).
    const droneGain = gain(0, muffle);
    const droneFilter = filter("lowpass", 300, 0.9, droneGain);
    osc("sawtooth", 55, gain(0.33, droneFilter));
    const droneDrift = osc("sawtooth", 55.37, gain(0.3, droneFilter));
    osc("triangle", 82.41, gain(0.45, droneFilter));
    osc("triangle", 82.18, gain(0.4, droneFilter));

    // Wind / air handling: brown noise, its band wandering at random (see motion()).
    const airGain = gain(0, muffle);
    const airFilter = filter("bandpass", 420, 0.9, airGain);
    const air = ctx.createBufferSource();
    air.buffer = this.windBuffer(ctx);
    air.loop = true;
    air.connect(airFilter);
    air.start();
    sources.push(air);

    // Mains hum of lit areas; cut in the dark.
    const humGain = gain(0, muffle);
    osc("triangle", 100, filter("lowpass", 420, 0.7, humGain));

    // b. Dissonance: A5 / A#5 (minor second) and D#6 / E6 (tritone of A, minor second), each
    // swelling on one of two slow LFOs in opposite phase, so the clash keeps shifting.
    const dissGain = gain(0, muffle);
    dissGain.connect(gain(0.5, space));
    const lfos = [osc("sine", 0.05 + Math.random() * 0.03), osc("sine", 0.08 + Math.random() * 0.04)];
    [880, 932.33, 1244.51, 1318.51].forEach((f, i) => {
      const pg = gain(0.5, dissGain);
      mod(lfos[i % 2]!, pg.gain, i < 2 ? 0.5 : -0.5);
      osc(i < 2 ? "sine" : "triangle", f, pg);
    });

    // Shrill string tremolo (A6 / A#6 saws, bowed tremolo at ~10 Hz, light vibrato).
    const tremGain = gain(0, muffle);
    const tremAmp = gain(0.5, filter("bandpass", 2400, 0.8, tremGain));
    mod(osc("sine", 10.5), tremAmp.gain, 0.5);
    const s1 = osc("sawtooth", 1760, tremAmp);
    const s2 = osc("sawtooth", 1864.66, tremAmp);
    const vib = osc("sine", 5.3);
    mod(vib, s1.frequency, 9);
    mod(vib, s2.frequency, 9);

    // c. Heartbeat: bypasses the muffle (it is inside your head when you are downed).
    const heartGain = gain(0, stage);
    const heartFilter = filter("lowpass", 180, 0.8, heartGain);

    // d. Boss drums; the metal hits also feed the echo.
    const bossGain = gain(0, muffle);
    const bossMetal = gain(1, bossGain);
    bossMetal.connect(gain(0.35, space));

    const ambientGain = gain(LEVEL.ambient, muffle);
    const stingerGain = gain(LEVEL.stinger, muffle);
    const stingerDry = gain(LEVEL.stinger, stage);

    return {
      ctx,
      noise,
      stage,
      muffle,
      space,
      droneGain,
      droneFilter,
      droneDrift,
      airGain,
      airFilter,
      humGain,
      dissGain,
      tremGain,
      heartGain,
      heartFilter,
      bossGain,
      bossMetal,
      ambientGain,
      stingerGain,
      stingerDry,
      sources,
    };
  }

  // ------------------------------------------------------------------ continuous layers

  private applyMix(g: Graph, m: ScoreMix, now: number) {
    const set = (key: string, p: AudioParam, v: number, tau: number) => {
      const last = this.lastSet.get(key);
      if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * 0.01 + 1e-5) return;
      this.lastSet.set(key, v);
      p.setTargetAtTime(v, now, tau);
    };
    set("drone", g.droneGain.gain, LEVEL.drone * m.drone, 0.8);
    set("droneHz", g.droneFilter.frequency, m.droneHz, 0.8);
    set("air", g.airGain.gain, LEVEL.air * m.air * this.gust, 1.5);
    set("hum", g.humGain.gain, LEVEL.hum * m.hum, m.hum < 0.01 ? 0.08 : 0.5);
    set("diss", g.dissGain.gain, LEVEL.diss * m.dissonance, 1.2);
    set("trem", g.tremGain.gain, LEVEL.trem * m.tremolo, 0.6);
    set("heart", g.heartGain.gain, LEVEL.heart * m.pulseGain, 0.35);
    set("heartHz", g.heartFilter.frequency, 160 + 300 * m.pulseClose, 0.3);
    set("boss", g.bossGain.gain, LEVEL.boss * m.boss, 0.5);
    set("muffle", g.muffle.frequency, m.muffleHz, 0.25);
  }

  /** Slow random motion: the wind's band and gusts, the drone's beating rate. */
  private motion(g: Graph, dt: number, now: number) {
    this.motionTimer -= dt;
    if (this.motionTimer > 0) return;
    this.motionTimer = 2 + Math.random() * 3;
    const lo = this.input.dark ? 160 : 240;
    const hi = this.input.dark ? 520 : 950;
    g.airFilter.frequency.setTargetAtTime(lo + (hi - lo) * Math.random(), now, 1.2 + Math.random() * 1.5);
    g.airFilter.Q.setTargetAtTime(0.6 + Math.random() * 0.9, now, 2);
    // New gust level; applyMix() picks it up on its next tick.
    this.gust = 0.65 + Math.random() * 0.55;
    this.lastSet.delete("air");
    g.droneDrift.frequency.setTargetAtTime(55.2 + Math.random() * 0.4, now, 3);
  }

  private schedulePulse(g: Graph, m: ScoreMix, now: number) {
    const period = 60 / m.pulseBpm;
    const beats = this.heartClock.due(now, LOOKAHEAD_SEC, period);
    if (m.pulseGain < 0.02) return;
    for (const b of beats) {
      // Lub-dub: the second sound comes sooner as the heart races.
      this.thump(g, b.time, 1, 120, 44);
      this.thump(g, b.time + Math.min(0.3, period * 0.35), 0.62, 135, 52);
      if (m.pulseClose > 0.4)
        this.noise(g, g.heartFilter, b.time, 0.09, "lowpass", 260, 200, 0.7, 0.5 * m.pulseClose);
    }
  }

  private thump(g: Graph, t: number, peak: number, f0: number, f1: number) {
    this.tone(g, g.heartFilter, t, "sine", f0, f1, 0.006, 0.22, peak);
    // Octave partial so the beat still reads on small speakers.
    this.tone(g, g.heartFilter, t, "sine", f0 * 2, f1 * 2, 0.006, 0.12, peak * 0.3);
  }

  private scheduleBoss(g: Graph, m: ScoreMix, now: number) {
    if (m.boss < 0.02 || m.bossBpm <= 0) {
      this.bossClock.reset();
      return;
    }
    const pat = bossPattern(m.bossPhase);
    for (const b of this.bossClock.due(now, LOOKAHEAD_SEC, 60 / m.bossBpm / 4)) {
      const i = b.index % 16;
      const low = pat.low[i] ?? 0;
      const mid = pat.mid[i] ?? 0;
      const hit = pat.hit[i] ?? 0;
      if (low > 0) this.tom(g, b.time, low, 104, 44, 0.34);
      if (mid > 0) this.tom(g, b.time, mid * 0.8, 175, 88, 0.22);
      if (hit > 0) {
        this.noise(g, g.bossMetal, b.time, 0.3, "bandpass", 2600, 1800, 1.4, hit * 0.45);
        this.tone(g, g.bossMetal, b.time, "square", 330, 160, 0.003, 0.14, hit * 0.12);
      }
    }
  }

  /** Synth tom: pitched-down sine, an upper partial, a noise stick attack. */
  private tom(g: Graph, t: number, vel: number, f0: number, f1: number, dur: number) {
    this.tone(g, g.bossGain, t, "sine", f0, f1, 0.004, dur, vel);
    this.tone(g, g.bossGain, t, "triangle", f0 * 2, f1 * 2, 0.003, dur * 0.5, vel * 0.25);
    this.noise(g, g.bossGain, t, 0.05, "lowpass", 900, 500, 0.7, vel * 0.35);
  }

  // ------------------------------------------------------------------ silence and its noises

  private ambience(g: Graph, m: ScoreMix, dt: number) {
    this.ambientIn -= dt;
    if (this.ambientIn > 0) return;
    if (m.ambient < 0.5) {
      // Too busy for "was that something?": try again a little after things calm down.
      this.ambientIn = 6 + Math.random() * 8;
      return;
    }
    this.ambientIn = nextAmbientDelay();
    const kind = pickAmbient(Math.random, this.lastAmbient);
    this.lastAmbient = kind;
    const pan = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
    const t = g.ctx.currentTime + 0.02;
    if (kind === "creak") this.creak(g, t, pan);
    else if (kind === "scream") this.farScream(g, t, pan);
    else this.farDoor(g, t, pan);
  }

  /** Metal under load: a sawtooth through a narrow band, chopped by a stick-slip square LFO. */
  private creak(g: Graph, t: number, pan: number) {
    const { ctx } = g;
    const out = this.panned(g, g.ambientGain, pan, 0.8, 0.6);
    const dur = 1.3 + Math.random() * 1.1;
    const f = 70 + Math.random() * 60;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (0.75 + Math.random() * 0.5), t + dur);
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.setValueAtTime(8 + Math.random() * 6, t);
    lfo.frequency.linearRampToValueAtTime(14 + Math.random() * 10, t + dur);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(amp.gain);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 9;
    bp.frequency.setValueAtTime(700 + Math.random() * 500, t);
    bp.frequency.exponentialRampToValueAtTime(500 + Math.random() * 300, t + dur);
    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1800;
    o.connect(amp);
    amp.connect(bp);
    bp.connect(far);
    far.connect(this.env(g, out, t, 0.3, dur, 0.9));
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  /** A human-ish scream far away: rising then sagging, vibrato, one formant, mostly echo. */
  private farScream(g: Graph, t: number, pan: number) {
    const { ctx } = g;
    const out = this.panned(g, g.ambientGain, pan, 0.55, 0.9);
    const f0 = 480 + Math.random() * 160;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 0.3);
    o.frequency.linearRampToValueAtTime(f0 * 1.15, t + 1);
    o.frequency.linearRampToValueAtTime(f0 * 0.8, t + 1.5);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5;
    const depth = ctx.createGain();
    depth.gain.value = f0 * 0.03;
    vib.connect(depth);
    depth.connect(o.frequency);
    const formant = ctx.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.value = 1150;
    formant.Q.value = 3;
    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1500;
    o.connect(formant);
    formant.connect(far);
    far.connect(this.env(g, out, t, 0.12, 1.6, 0.5));
    o.start(t);
    vib.start(t);
    o.stop(t + 1.7);
    vib.stop(t + 1.7);
  }

  /** A heavy door slamming somewhere in the building, its latch rattling after. */
  private farDoor(g: Graph, t: number, pan: number) {
    const out = this.panned(g, g.ambientGain, pan, 0.9, 1);
    this.noise(g, out, t, 0.5, "lowpass", 420, 260, 0.8, 0.8);
    this.tone(g, out, t, "sine", 85, 38, 0.005, 0.45, 0.8);
    this.noise(g, out, t + 0.13, 0.06, "bandpass", 1500, 1500, 3, 0.25);
    this.noise(g, out, t + 0.21, 0.05, "bandpass", 1700, 1700, 3, 0.15);
  }

  // ------------------------------------------------------------------ stingers

  private playStinger(g: Graph, kind: StingerKind) {
    const { ctx } = g;
    const t = ctx.currentTime + 0.01;
    switch (kind) {
      case "spotted": {
        // Dissonant string stab (D#6 + E6 over D#5) on a low hit.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.5);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1700;
        bp.Q.value = 0.7;
        bp.connect(out);
        this.tone(g, bp, t, "sawtooth", 1244.51, 1226, 0.008, 0.9, 0.35);
        this.tone(g, bp, t, "sawtooth", 1318.51, 1299, 0.008, 0.9, 0.35);
        this.tone(g, bp, t, "sawtooth", 622.25, 615, 0.01, 0.7, 0.3);
        this.tone(g, out, t, "sine", 95, 40, 0.004, 0.45, 0.6);
        break;
      }
      case "special": {
        // Two voices a tritone apart sliding down together, over a rumble.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.6);
        this.tone(g, out, t, "triangle", 466.16, 311.13, 0.35, 1.6, 0.4);
        this.tone(g, out, t, "triangle", 659.26, 440, 0.35, 1.6, 0.32);
        this.noise(g, out, t, 1.3, "lowpass", 220, 140, 0.8, 0.5, 0.3);
        break;
      }
      case "wave": {
        // Rising noise swell that cuts into a deep boom: here they come.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.4);
        this.noise(g, out, t, 1.25, "bandpass", 300, 3200, 1.6, 0.45, 1.1);
        this.tone(g, out, t + 1.05, "sine", 72, 30, 0.004, 0.9, 0.85);
        this.noise(g, out, t + 1.05, 0.6, "lowpass", 500, 200, 0.7, 0.6);
        break;
      }
      case "boss": {
        // Low brass-like cluster (A1, A#1, E2, A2) through a lowpass that blares open and closes.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.5);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(160, t);
        lp.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
        lp.frequency.exponentialRampToValueAtTime(180, t + 2.4);
        lp.connect(out);
        for (const f of [55, 58.27, 82.41, 110]) this.tone(g, lp, t, "sawtooth", f, f * 0.97, 0.02, 2.6, 0.3);
        this.tone(g, out, t, "sine", 62, 27, 0.004, 1.3, 0.9);
        this.noise(g, out, t, 0.7, "bandpass", 2400, 1600, 1.2, 0.35);
        break;
      }
      case "downed": {
        // Unmuffled: the world drops away, a thud, a tinnitus ring.
        const out = this.panned(g, g.stingerDry, 0, 1, 0.3);
        this.tone(g, out, t, "sine", 330, 55, 0.02, 1.7, 0.45);
        this.noise(g, out, t, 0.45, "lowpass", 320, 160, 0.7, 0.6);
        this.tone(g, out, t + 0.05, "sine", 3520, 3480, 0.4, 2.8, 0.05);
        break;
      }
      case "revive": {
        // Relief without comfort: an open fifth (A3, E4) and the octave above.
        const out = this.panned(g, g.stingerDry, 0, 1, 0.6);
        this.tone(g, out, t, "triangle", 220, 220, 0.45, 1.8, 0.3);
        this.tone(g, out, t, "triangle", 329.63, 329.63, 0.45, 1.8, 0.24);
        this.tone(g, out, t + 0.35, "sine", 440, 440, 0.4, 1.6, 0.2);
        break;
      }
      case "objective": {
        // Cold two-note motif (E5, B5) with echo.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.7);
        this.tone(g, out, t, "triangle", 659.26, 659.26, 0.01, 0.55, 0.32);
        this.tone(g, out, t + 0.16, "triangle", 987.77, 987.77, 0.01, 0.7, 0.3);
        break;
      }
      case "blackout": {
        // Power dying: a whine falling through a closing filter, then a relay clunk.
        const out = this.panned(g, g.stingerGain, 0, 1, 0.4);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(180, t + 1.1);
        lp.connect(out);
        this.tone(g, lp, t, "sawtooth", 1200, 50, 0.01, 1.15, 0.3);
        this.noise(g, out, t + 1.1, 0.09, "bandpass", 900, 700, 1.2, 0.6);
        this.tone(g, out, t + 1.1, "square", 95, 55, 0.003, 0.14, 0.22);
        this.tone(g, out, t + 1.1, "sine", 70, 32, 0.004, 0.5, 0.6);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ short-lived voices

  /** Gain -> panner -> dest, plus an echo send from after the panner. Returns the input. */
  private panned(g: Graph, dest: AudioNode, pan: number, level: number, send: number): GainNode {
    const { ctx } = g;
    const input = ctx.createGain();
    input.gain.value = level;
    let tail: AudioNode = input;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      input.connect(p);
      tail = p;
    }
    tail.connect(dest);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      tail.connect(s);
      s.connect(g.space);
    }
    return input;
  }

  /** Exponential attack to `peak`, exponential decay to silence at t + dur. */
  private env(g: Graph, dest: AudioNode, t: number, attack: number, dur: number, peak: number): GainNode {
    const e = g.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    e.connect(dest);
    return e;
  }

  private tone(
    g: Graph,
    dest: AudioNode,
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    attack: number,
    dur: number,
    peak: number,
  ) {
    const o = g.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(this.env(g, dest, t, attack, dur, peak));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    g: Graph,
    dest: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    peak: number,
    attack = 0.004,
  ) {
    const { ctx } = g;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f);
    f.connect(this.env(g, dest, t, attack, dur, peak));
    src.start(t, Math.random() * 0.9);
    src.stop(t + dur + 0.05);
  }
}

export const score = new DreadScore();
