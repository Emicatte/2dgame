/**
 * Minimal in-memory token bucket keyed by client address. Sufficient for a single game-server
 * instance; with several instances this would move to Redis (see docs/ARCHITECTURE.md).
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.updated) / 1000) * this.refillPerSec);
    b.updated = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  get size(): number {
    return this.buckets.size;
  }

  /**
   * Forgets idle keys; if the map is still too large (many distinct addresses, e.g. an IPv6 range)
   * drops the oldest entries so memory stays bounded. A dropped key starts again with a full bucket,
   * which is only an advantage for an address that has been idle the longest.
   */
  private prune(now: number) {
    for (const [k, b] of this.buckets) if (now - b.updated > 10 * 60_000) this.buckets.delete(k);
    if (this.buckets.size <= 10_000) return;
    const oldest = [...this.buckets.entries()].sort((x, y) => x[1].updated - y[1].updated);
    for (const [k] of oldest.slice(0, this.buckets.size - 5_000)) this.buckets.delete(k);
  }
}
