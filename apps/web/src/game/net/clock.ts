import { NET } from "@scrapline/shared";

/**
 * Estimates the server's tick timeline from snapshot arrivals. Each snapshot carries its tick;
 * the lowest observed (arrival - tick * period) offset is the least-delayed packet, so it is the
 * best estimate of the true offset. It is tracked over a sliding window and adjusted gradually,
 * which keeps the render timeline smooth under jitter while still following clock drift.
 */
export class ServerClock {
  private offset: number | null = null;
  private window: { t: number; v: number }[] = [];
  tickMs: number;

  constructor(tickRate = NET.serverTickRate) {
    this.tickMs = 1000 / tickRate;
  }

  setTickRate(rate: number) {
    this.tickMs = 1000 / rate;
  }

  onSnapshot(tick: number, now = performance.now()): void {
    const sample = now - tick * this.tickMs;
    this.window.push({ t: now, v: sample });
    while (this.window.length && now - this.window[0]!.t > 2000) this.window.shift();
    const target = Math.min(...this.window.map((w) => w.v));
    if (this.offset === null || Math.abs(target - this.offset) > 250) {
      this.offset = target;
    } else {
      // Move at most 1ms per snapshot towards the target: imperceptible time-warp.
      this.offset += Math.max(-1, Math.min(1, target - this.offset));
    }
  }

  /** Estimated current server tick (fractional). */
  serverTick(now = performance.now()): number {
    if (this.offset === null) return 0;
    return (now - this.offset) / this.tickMs;
  }

  /** Server tick being rendered for remote entities. */
  renderTick(now = performance.now()): number {
    return this.serverTick(now) - NET.interpolationDelayMs / this.tickMs;
  }

  /** Jitter estimate in ms (spread of recent arrival offsets). */
  jitterMs(): number {
    if (this.window.length < 2) return 0;
    const vals = this.window.map((w) => w.v);
    return Math.max(...vals) - Math.min(...vals);
  }

  get ready(): boolean {
    return this.offset !== null;
  }

  reset(): void {
    this.offset = null;
    this.window = [];
  }
}
