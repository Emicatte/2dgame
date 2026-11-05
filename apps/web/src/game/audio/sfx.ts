import type { WeaponDef } from "@scrapline/shared";
import { settingsStore } from "../../lib/settings.ts";

/**
 * Procedural sound effects synthesized with the Web Audio API. Every weapon gets its own
 * character from its config (body frequency, crack, decay), so new weapons sound distinct
 * without new audio files, and there is no third-party audio to license.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private noise!: AudioBuffer;
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.uiBus = this.ctx.createGain();
    this.uiBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    settingsStore.subscribe(() => this.applyVolumes());
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const s = settingsStore.get();
    this.master.gain.value = s.masterVolume;
    this.sfxBus.gain.value = s.sfxVolume;
    this.uiBus.gain.value = s.uiVolume;
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.lastPlayed.get(key) ?? 0;
    if (now - last < ms) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  private out(bus: GainNode, pan: number, gain: number): GainNode | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(bus);
    } else {
      g.connect(bus);
    }
    return g;
  }

  private noiseBurst(
    dest: AudioNode,
    t: number,
    dur: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    peak: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(
    dest: AudioNode,
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    peak: number,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env);
    env.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** `distance` in world px from the listener, `pan` in -1..1. */
  shot(w: WeaponDef, distance = 0, pan = 0, local = false): void {
    if (!this.ctx) return;
    const att = local ? 1 : Math.max(0.08, 1 - distance / 1800);
    const out = this.out(this.sfxBus, pan * 0.8, w.sound.gain * att);
    if (!out) return;
    const t = this.ctx.currentTime;
    const s = w.sound;
    this.tone(out, t, "sine", s.body * 2.2, s.body * 0.6, s.decay * 0.9, 0.9);
    this.noiseBurst(out, t, s.decay, "bandpass", 900 * s.pitch, 0.7, s.noise);
    this.noiseBurst(out, t, Math.min(0.06, s.decay * 0.4), "highpass", 3500 * s.pitch, 0.5, s.crack * 0.7);
    if (!local && distance > 900) this.noiseBurst(out, t + 0.04, s.decay * 1.5, "lowpass", 400, 0.5, 0.25);
  }

  reload(local: boolean, distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, local ? 0.5 : Math.max(0, 0.35 - distance / 2500));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(out, t, 0.05, "bandpass", 2500, 4, 0.8);
    this.tone(out, t + 0.02, "square", 1400, 900, 0.04, 0.12);
    this.noiseBurst(out, t + 0.22, 0.06, "bandpass", 1800, 5, 0.9);
  }

  reloadDone(): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, 0, 0.45);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(out, t, 0.05, "bandpass", 3000, 6, 0.9);
    this.tone(out, t, "triangle", 2200, 1600, 0.05, 0.15);
  }

  dry(): void {
    if (!this.ctx || !this.throttle("dry", 120)) return;
    const out = this.out(this.sfxBus, 0, 0.4);
    if (!out) return;
    this.noiseBurst(out, this.ctx.currentTime, 0.03, "highpass", 4000, 2, 0.6);
  }

  swap(): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, 0, 0.3);
    if (!out) return;
    this.noiseBurst(out, this.ctx.currentTime, 0.08, "bandpass", 1200, 3, 0.6);
  }

  dash(local: boolean, distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, local ? 0.35 : Math.max(0, 0.25 - distance / 2000));
    if (!out) return;
    const t = this.ctx.currentTime;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.5;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.8, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(f);
    f.connect(env);
    env.connect(out);
    src.start(t);
    src.stop(t + 0.25);
  }

  hitMarker(lethal: boolean): void {
    if (!this.ctx || !this.throttle("hit", 40)) return;
    const out = this.out(this.uiBus, 0, 0.35);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "square", lethal ? 1400 : 1900, lethal ? 1300 : 1800, 0.05, 0.25);
    if (lethal) this.tone(out, t + 0.07, "square", 2100, 2000, 0.09, 0.25);
  }

  hurt(): void {
    if (!this.ctx || !this.throttle("hurt", 90)) return;
    const out = this.out(this.sfxBus, 0, 0.6);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sine", 160, 60, 0.18, 0.9);
    this.noiseBurst(out, t, 0.08, "lowpass", 800, 1, 0.5);
  }

  death(local: boolean, distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, local ? 0.8 : Math.max(0.05, 0.6 - distance / 2200));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sawtooth", 420, 50, 0.45, 0.35);
    this.noiseBurst(out, t, 0.35, "lowpass", 1200, 0.8, 0.7);
  }

  pickup(): void {
    if (!this.ctx) return;
    const out = this.out(this.uiBus, 0, 0.35);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "triangle", 660, 660, 0.08, 0.5);
    this.tone(out, t + 0.07, "triangle", 990, 990, 0.12, 0.5);
  }

  spawn(): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, 0, 0.35);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sine", 220, 880, 0.35, 0.5);
  }

  countdown(final: boolean): void {
    if (!this.ctx) return;
    const out = this.out(this.uiBus, 0, 0.4);
    if (!out) return;
    this.tone(
      out,
      this.ctx.currentTime,
      "square",
      final ? 1046 : 523,
      final ? 1046 : 523,
      final ? 0.4 : 0.12,
      0.3,
    );
  }

  ui(kind: "click" | "hover" | "error" = "click"): void {
    if (!this.ctx) return;
    if (kind === "hover" && !this.throttle("hover", 60)) return;
    const out = this.out(this.uiBus, 0, kind === "hover" ? 0.08 : 0.25);
    if (!out) return;
    const t = this.ctx.currentTime;
    if (kind === "error") this.tone(out, t, "square", 220, 180, 0.15, 0.3);
    else
      this.tone(out, t, "triangle", kind === "hover" ? 1500 : 900, kind === "hover" ? 1500 : 700, 0.05, 0.4);
  }

  stinger(win: boolean): void {
    if (!this.ctx) return;
    const out = this.out(this.uiBus, 0, 0.4);
    if (!out) return;
    const t = this.ctx.currentTime;
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((n, i) => this.tone(out, t + i * 0.12, "triangle", n, n, 0.3, 0.45));
  }
}

export const sfx = new Sfx();
