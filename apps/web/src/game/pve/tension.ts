/**
 * Dread: how tense the moment is for the local player (0 calm … 1 overwhelmed). It drives the
 * score, the heartbeat and the flashlight flicker. Pure and client-side: purely presentation,
 * computed from the synchronized state the client already has.
 */

export interface TensionEnemy {
  /** Distance to the local player (px). */
  d: number;
  /** AI state as synced (`AI` enum): chasing / attacking enemies count more. */
  hunting: boolean;
  special: boolean;
  boss: boolean;
}

export interface TensionInput {
  enemies: readonly TensionEnemy[];
  hpFrac: number;
  downed: boolean;
  waveActive: boolean;
  /** Seconds since the local player last took damage. */
  sinceHurt: number;
}

/** Instant target in 0..1. */
export function tensionTarget(s: TensionInput): number {
  let pressure = 0;
  for (const e of s.enemies) {
    if (e.d > 900) continue;
    // Close and hunting enemies weigh most; distance falls off smoothly.
    const near = 1 - e.d / 900;
    let w = near * near * (e.hunting ? 1 : 0.35);
    if (e.special) w *= 1.6;
    if (e.boss) w = Math.max(w, 0.6);
    pressure += w;
  }
  let t = 1 - Math.exp(-pressure / 2.2);
  if (s.waveActive) t = Math.max(t, 0.25);
  if (s.hpFrac <= 0.3) t = Math.max(t, 0.55 + (0.3 - s.hpFrac));
  if (s.sinceHurt < 2) t = Math.max(t, 0.5 * (1 - s.sinceHurt / 2) + t * 0.5);
  if (s.downed) t = Math.max(t, 0.85);
  return Math.max(0, Math.min(1, t));
}

/** Smoothing: rises fast (a threat appears), falls slowly (dread lingers). */
export function smoothTension(current: number, target: number, dtSec: number): number {
  const rate = target > current ? 3 : 0.35;
  const k = 1 - Math.exp(-rate * dtSec);
  return current + (target - current) * k;
}

/**
 * Flashlight flicker: a stalker hunting nearby makes the light stutter (a fairness cue, like
 * its hiss), and so does very high tension. Returns an intensity multiplier in 0..1.
 */
export function flashlightFlicker(nowSec: number, stalkerNear: boolean, tension: number, seed = 0): number {
  const n = (k: number) => {
    const x = Math.sin((nowSec * k + seed) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  if (stalkerNear) {
    // Bursts of fast stutter, a few times per second.
    const burst = n(3.1) > 0.55;
    return burst ? 0.25 + 0.75 * n(31.7) : 0.92;
  }
  if (tension > 0.8 && n(0.9) > 0.93) return 0.55 + 0.4 * n(23.3);
  return 1;
}
