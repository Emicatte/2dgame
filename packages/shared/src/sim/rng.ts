/**
 * Deterministic pseudo-random numbers. Client and server derive the same spread for a given
 * (shooter seed, input sequence, pellet) triple, so predicted tracers match authoritative ones.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer mixing (from MurmurHash3's finalizer). */
export function mix32(a: number, b: number, c = 0): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1) ^ Math.imul(c, 0x85ebca77)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform float in [0, 1) derived deterministically from the inputs. */
export function rand01(a: number, b: number, c = 0): number {
  return mix32(a, b, c) / 4294967296;
}

/** Small seeded generator for non-gameplay uses (map decoration, particles). */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
