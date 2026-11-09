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
  /** The co-op adaptive score (score.ts) plays here; nothing is connected in PvP. */
  private musicBus!: GainNode;
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
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
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
    // Short glide: the score is continuous, a jump while dragging the slider would click.
    this.musicBus.gain.setTargetAtTime(s.musicVolume, this.ctx.currentTime, 0.05);
  }

  /** The shared context and buses for the adaptive score (score.ts); null until unlock(). */
  context(): { ctx: AudioContext; master: GainNode; musicBus: GainNode; noise: AudioBuffer } | null {
    if (!this.ctx) return null;
    return { ctx: this.ctx, master: this.master, musicBus: this.musicBus, noise: this.noise };
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

  /** A vehicle exploding: deep boom plus a long debris rumble. */
  explosion(distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.08, 1 - distance / 2600));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sine", 110, 30, 0.9, 0.9);
    this.noiseBurst(out, t, 0.9, "lowpass", 700, 0.7, 0.9);
    this.noiseBurst(out, t + 0.05, 0.4, "bandpass", 2400, 1.2, 0.35);
  }

  /** Metal impact (crash, ramming), louder with force. */
  crash(force: number, distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("crash", 90)) return;
    const k = Math.min(1, force / 500);
    const out = this.out(this.sfxBus, pan, Math.max(0.05, (0.3 + k * 0.5) * (1 - distance / 2400)));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(out, t, 0.18 + k * 0.2, "bandpass", 900 + k * 900, 1.5, 0.8);
    this.tone(out, t, "square", 180 + k * 120, 60, 0.2, 0.25);
  }

  /** Door / seat change. */
  door(local: boolean, distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, local ? 0.45 : Math.max(0.04, 0.3 - distance / 2400));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(out, t, 0.06, "highpass", 1800, 0.9, 0.6);
    this.tone(out, t + 0.03, "square", 140, 90, 0.08, 0.35);
  }

  // ----- PvE (Outbreak / Survival)

  /** Low rasping groan of a nearby infected. */
  zombieGroan(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("groan", 600)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.02, 0.32 - distance / 3000));
    if (!out) return;
    const t = this.ctx.currentTime;
    const f = 70 + Math.random() * 40;
    this.tone(out, t, "sawtooth", f * 1.3, f, 0.7, 0.25);
    this.noiseBurst(out, t, 0.6, "bandpass", 500 + Math.random() * 300, 3, 0.25);
  }

  /** An infected attack landing (melee swipe, spit, pounce, charge, wall slam). */
  zombieAttack(kind: string, distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle(`zatk-${kind}`, 60)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.04, 0.6 - distance / 2400));
    if (!out) return;
    const t = this.ctx.currentTime;
    if (kind === "spit") {
      this.noiseBurst(out, t, 0.18, "bandpass", 1600, 2, 0.6);
      this.tone(out, t, "sine", 300, 120, 0.15, 0.3);
    } else if (kind === "roar" || kind === "summon") {
      this.tone(out, t, "sawtooth", 140, 55, 1.1, 0.7);
      this.tone(out, t + 0.05, "square", 90, 45, 0.9, 0.3);
      this.noiseBurst(out, t, 0.9, "bandpass", 420, 1.5, 0.5);
    } else if (kind === "charge" || kind === "slam" || kind === "impact") {
      this.tone(out, t, "sawtooth", 90, 40, 0.5, 0.6);
      this.noiseBurst(out, t, 0.4, "lowpass", 600, 0.8, 0.7);
    } else if (kind === "sweep") {
      // A heavy arm cutting the air, then the thud of the plate.
      this.sweep(out, t, 0.04, 0.32, "bandpass", 380, 1700, 1.2, 0.8);
      this.tone(out, t + 0.22, "sawtooth", 110, 50, 0.25, 0.5);
    } else if (kind === "vent") {
      // The plates slam shut: a metal clank and a last gasp of steam.
      this.tone(out, t, "square", 160, 70, 0.18, 0.55);
      this.noiseBurst(out, t, 0.5, "highpass", 2400, 0.7, 0.55);
      this.tone(out, t, "sawtooth", 70, 38, 0.4, 0.5);
    } else {
      this.noiseBurst(out, t, 0.12, "highpass", 1200, 0.9, 0.5);
      this.tone(out, t, "sawtooth", 220, 90, 0.18, 0.35);
    }
  }

  /**
   * The Warden opens its plates: a long rising steam release over a low strained groan (the
   * vulnerability window has started: everybody fire).
   */
  wardenVent(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("wardenVent", 800)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.2, 0.75 - distance / 2600));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.sweep(out, t, 0.08, 1.4, "highpass", 1800, 4200, 0.8, 0.6);
    this.tone(out, t, "sawtooth", 82, 64, 1.2, 0.35);
  }

  /** A mission door moving: a pneumatic sliding door, or a heavy blast door grinding. */
  slidingDoor(open: boolean, heavy: boolean, distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle(`door-${heavy}-${Math.round(pan * 4)}`, 120)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.03, (heavy ? 0.6 : 0.4) - distance / 2200));
    if (!out) return;
    const t = this.ctx.currentTime;
    if (heavy) {
      this.noiseBurst(out, t, 1.1, "lowpass", 380, 1.4, 0.7);
      this.tone(out, t, "sawtooth", 55, 42, 1, 0.35);
      this.tone(out, t + 1, "square", 120, 60, 0.12, 0.5);
      return;
    }
    this.sweep(out, t, 0.02, 0.3, "bandpass", open ? 2600 : 1400, open ? 1200 : 2600, 1.6, 0.45);
    this.tone(out, t + 0.28, "square", open ? 180 : 140, 90, 0.06, 0.3);
  }

  /** Security vent: warning beeps, then the gas hissing out. */
  ventCue(active: boolean, distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.05, 0.55 - distance / 2000));
    if (!out) return;
    const t = this.ctx.currentTime;
    if (!active) {
      for (let i = 0; i < 3; i++)
        this.tone(out, t + i * 0.42, "square", i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.16, 0.22);
      return;
    }
    this.sweep(out, t, 0.06, 2.2, "bandpass", 3400, 2200, 0.9, 0.55);
    this.noiseBurst(out, t, 0.4, "highpass", 3000, 0.7, 0.4);
  }

  zombieDeath(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("zdie", 50)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.03, 0.45 - distance / 2600));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sawtooth", 160, 45, 0.35, 0.3);
    this.noiseBurst(out, t, 0.25, "lowpass", 900, 0.8, 0.45);
  }

  // Positional dread cues. `distance` in world px from the listener, `pan` in -1..1, like the
  // sounds above; each is throttled and gets duller (lowpass) as well as quieter with distance.

  /** Panned output behind a lowpass that closes from ~12 kHz (close) to `floorHz` at `range`. */
  private outFar(bus: GainNode, pan: number, gain: number, distance: number, range: number, floorHz: number) {
    const out = this.out(bus, pan, gain);
    if (!out || !this.ctx) return null;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.5;
    const k = Math.min(1, Math.max(0, distance / range));
    f.frequency.value = floorHz * (12000 / floorHz) ** (1 - k);
    f.connect(out);
    return f;
  }

  /** Noise through a filter whose frequency glides f0 -> f1, with a shaped attack (looped source). */
  private sweep(
    dest: AudioNode,
    t: number,
    attack: number,
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    peak: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(dest);
    src.start(t, Math.random() * 0.9);
    src.stop(t + dur + 0.05);
  }

  /** Dragging footsteps and wet breath of an unseen walker nearby (silent beyond ~1500 px). */
  zombieShuffle(distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const near = 1 - distance / 1500;
    if (near <= 0 || !this.throttle("shuffle", 520)) return;
    const out = this.outFar(this.sfxBus, pan, 0.06 + 0.45 * near * near, distance, 1500, 700);
    if (!out) return;
    const t = this.ctx.currentTime;
    const r = Math.random();
    this.sweep(out, t, 0.06, 0.34, "bandpass", 900 + r * 300, 380, 1.3, 0.55);
    this.sweep(out, t + 0.42 + r * 0.12, 0.04, 0.26, "bandpass", 1100, 450, 1.3, 0.32);
    this.sweep(out, t + 0.1, 0.22, 0.6, "bandpass", 1500, 900, 2.2, 0.2);
    this.tone(out, t + 0.12, "sawtooth", 72 + r * 18, 58, 0.5, 0.07);
  }

  /** A runner's shriek as it starts to chase: piercing, rough, readable from far away. */
  runnerScreech(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("screech", 800)) return;
    const k = Math.max(0, 1 - distance / 2400);
    const out = this.outFar(this.sfxBus, pan, Math.max(0.1, 0.5 * k), distance, 2400, 1400);
    if (!out) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f0 = 680 + Math.random() * 160;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 2.1, t + 0.09);
    o.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.65);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const depth = ctx.createGain();
    depth.gain.value = 70;
    lfo.connect(depth);
    depth.connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2100;
    bp.Q.value = 2.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    env.gain.setValueAtTime(0.7, t + 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(bp);
    bp.connect(env);
    env.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.75);
    lfo.stop(t + 0.75);
    this.sweep(out, t, 0.04, 0.5, "highpass", 3000, 5000, 0.8, 0.25);
  }

  /** Heavy brute footfall: felt more than heard, carries far (kept under the compressor's knee). */
  bruteStomp(distance = 0, pan = 0): void {
    if (!this.ctx) return;
    const k = Math.max(0, 1 - distance / 2800);
    if (k <= 0 || !this.throttle("stomp", 260)) return;
    const out = this.outFar(this.sfxBus, pan * 0.7, 0.05 + 0.32 * k, distance, 2800, 500);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "sine", 70, 26, 0.45, 0.95);
    // Second partial so it still reads on laptop speakers that cannot reproduce 30-70 Hz.
    this.tone(out, t, "triangle", 125, 42, 0.18, 0.35);
    this.noiseBurst(out, t, 0.3, "lowpass", 260, 0.7, 0.6);
    if (k > 0.5) this.noiseBurst(out, t + 0.03, 0.09, "highpass", 2600, 0.8, 0.12 * k);
  }

  /**
   * A stalker close and hunting. Fairness cue: a rising sibilant hiss and a rattle of glottal
   * clicks that no other infected makes, fully panned, never quieter than a clear floor, and not
   * dulled with distance. Kept in 1.5-4.5 kHz, where hearing is most sensitive and which survives
   * mild high-frequency hearing loss and small speakers.
   */
  stalkerHiss(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("stalker", 1100)) return;
    const out = this.out(this.sfxBus, pan, Math.max(0.32, 0.8 - distance / 2400));
    if (!out) return;
    const t = this.ctx.currentTime;
    this.sweep(out, t, 0.28, 0.55, "bandpass", 2200, 4500, 1.4, 0.7);
    let ct = t + 0.32;
    for (let i = 0; i < 7; i++) {
      this.noiseBurst(out, ct, 0.02, "bandpass", 1800, 5, 0.8);
      this.tone(out, ct, "square", 1150, 900, 0.02, 0.14);
      ct += 0.055 - i * 0.004;
    }
  }

  /** Many voices at once, from the direction a wave is coming from. */
  hordeRoar(distance = 0, pan = 0): void {
    if (!this.ctx || !this.throttle("horde", 1500)) return;
    const ctx = this.ctx;
    const k = Math.max(0, 1 - distance / 3600);
    const gain = Math.max(0.3, 1.2 * k) / 2;
    const t = ctx.currentTime;
    const lanes: AudioNode[] = [];
    for (const offset of [-0.25, 0, 0.25]) {
      const lane = this.outFar(this.sfxBus, pan + offset, gain, distance, 3600, 600);
      if (!lane) return;
      const formant = ctx.createBiquadFilter();
      formant.type = "bandpass";
      formant.frequency.value = 480 + Math.random() * 220;
      formant.Q.value = 1.1;
      formant.connect(lane);
      lanes.push(formant);
    }
    for (let i = 0; i < 8; i++) {
      const f = 75 + Math.random() * 110;
      const start = t + Math.random() * 0.35;
      this.tone(
        lanes[i % 3]!,
        start,
        i % 2 ? "sawtooth" : "square",
        f * 1.25,
        f * 0.7,
        0.9 + Math.random() * 0.7,
        0.3,
      );
    }
    this.sweep(lanes[1]!, t, 0.2, 1.6, "bandpass", 520, 340, 1.2, 0.6);
    this.sweep(lanes[0]!, t + 0.1, 0.25, 1.3, "bandpass", 1300, 900, 2, 0.25);
    this.sweep(lanes[2]!, t + 0.15, 0.25, 1.3, "bandpass", 1200, 850, 2, 0.25);
  }

  /** Bullet on armor plate. */
  armorHit(): void {
    if (!this.ctx || !this.throttle("armor", 50)) return;
    const out = this.out(this.uiBus, 0, 0.3);
    if (!out) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, "triangle", 1700, 1200, 0.06, 0.4);
  }

  private engine: {
    osc: OscillatorNode;
    osc2: OscillatorNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;

  /**
   * Continuous engine / rotor sound of the vehicle the local player is in: pitch follows speed (or
   * rotor speed), volume fades out when they leave. `level` 0 stops it.
   */
  engineSound(level: number, pitch: number, rotor: boolean): void {
    if (!this.ctx) return;
    if (!this.engine && level <= 0) return;
    const ctx = this.ctx;
    if (!this.engine) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc2.type = "square";
      filter.type = "lowpass";
      filter.frequency.value = 600;
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxBus);
      osc.start();
      osc2.start();
      this.engine = { osc, osc2, gain, filter };
    }
    const t = ctx.currentTime;
    const e = this.engine;
    const base = rotor ? 18 + pitch * 14 : 38 + pitch * 70;
    e.osc.frequency.setTargetAtTime(base, t, 0.08);
    e.osc2.frequency.setTargetAtTime(rotor ? base * 0.5 : base * 1.5, t, 0.08);
    e.filter.frequency.setTargetAtTime(rotor ? 380 : 420 + pitch * 900, t, 0.1);
    e.gain.gain.setTargetAtTime(Math.max(0, level) * 0.12, t, 0.12);
    if (level <= 0) {
      const old = e;
      this.engine = null;
      setTimeout(() => {
        try {
          old.osc.stop();
          old.osc2.stop();
        } catch {
          // already stopped
        }
      }, 800);
    }
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
    notes.forEach((n, i) => {
      this.tone(out, t + i * 0.12, "triangle", n, n, 0.3, 0.45);
    });
  }
}

export const sfx = new Sfx();
