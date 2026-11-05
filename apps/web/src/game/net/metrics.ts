/**
 * Client-side netcode diagnostics. Nothing here influences the simulation: the scene feeds events
 * in, the debug overlay and automated tests read `snapshot()` out.
 */

/** Fixed-size ring of recent samples with percentile/max queries. */
export class RollingStats {
  private readonly buf: Float64Array;
  private next = 0;
  private count = 0;

  constructor(readonly size: number) {
    this.buf = new Float64Array(size);
  }

  push(v: number): void {
    this.buf[this.next] = v;
    this.next = (this.next + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** Nearest-rank percentile (p in 0..100) of the samples in the window; 0 when empty. */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    const sorted = Array.from(this.buf.subarray(0, this.count)).sort((a, b) => a - b);
    const rank = Math.min(this.count - 1, Math.max(0, Math.ceil((p / 100) * this.count) - 1));
    return sorted[rank]!;
  }

  max(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.buf[i]!);
    return m;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }
}

export interface NetMetricsSnapshot {
  /** Input frames produced by the fixed step (one per 1/60 s of game time). */
  generated: number;
  /** Input frames handed to the socket, and the number of messages that carried them. */
  sent: number;
  messages: number;
  /** Frames confirmed by the server (removed from the pending list by an ack). */
  acked: number;
  /** Unacknowledged frames right now, and over the last ~10 s of snapshots. */
  pending: number;
  pendingP50: number;
  pendingP95: number;
  pendingMax: number;
  /** Highest pending count since the room was joined. */
  pendingMaxEver: number;
  /** Time since the ack last advanced (ms), and the worst value seen while in a match. */
  ackAgeMs: number;
  ackAgeMaxMs: number;
  /** Snapshots received and the worst gap between two of them (ms, last ~10 s). */
  patches: number;
  patchGapP95Ms: number;
  patchGapMaxMs: number;
  /** Rendered frames where the interpolation buffer had no snapshot at or after render time. */
  starvedFrames: number;
  /** Game time discarded by the per-frame step cap after very long frames (ms). */
  lostStepMs: number;
  /** Times the stall guard engaged, and game time during which no input was produced (ms). */
  stallEvents: number;
  stallMs: number;
  /** Predictor counters. */
  corrections: number;
  snaps: number;
  correctionP95: number;
  correctionMax: number;
  staleAcks: number;
  resyncs: number;
}

export class NetMetrics {
  generated = 0;
  sent = 0;
  messages = 0;
  patches = 0;
  starvedFrames = 0;
  lostStepMs = 0;
  stallEvents = 0;
  stallMs = 0;
  private stalled = false;
  pendingMaxEver = 0;
  ackAgeMaxMs = 0;
  private lastPatchAt = 0;
  private lastAck = -1;
  private lastAckAt = 0;
  private readonly pending = new RollingStats(200);
  private readonly patchGaps = new RollingStats(200);

  /** Called after each authoritative snapshot has been reconciled. */
  onPatch(ack: number, pendingCount: number, now: number): void {
    this.patches++;
    if (this.lastPatchAt > 0) this.patchGaps.push(now - this.lastPatchAt);
    this.lastPatchAt = now;
    if (ack !== this.lastAck) {
      this.lastAck = ack;
      this.lastAckAt = now;
    }
    this.pending.push(pendingCount);
    if (pendingCount > this.pendingMaxEver) this.pendingMaxEver = pendingCount;
  }

  /** Called once per rendered frame while a match is running. */
  onFrame(now: number): void {
    if (this.lastAckAt > 0) this.ackAgeMaxMs = Math.max(this.ackAgeMaxMs, now - this.lastAckAt);
  }

  ackAgeMs(now: number): number {
    return this.lastAckAt > 0 ? now - this.lastAckAt : 0;
  }

  /**
   * Stall guard: true when inputs are outstanding but the ack has not moved for `limitMs`. The
   * server is then not receiving (or not confirming) inputs, so predicting further ahead only
   * grows the eventual correction and the burst of buffered messages.
   */
  updateStall(now: number, pendingCount: number, limitMs: number, frameMs: number): boolean {
    const stalled = pendingCount > 0 && this.ackAgeMs(now) > limitMs;
    if (stalled && !this.stalled) this.stallEvents++;
    if (stalled) this.stallMs += frameMs;
    this.stalled = stalled;
    return stalled;
  }

  get isStalled(): boolean {
    return this.stalled;
  }

  /** Stream restarted (reconnect): sequence numbers and acks start over. */
  resetStream(): void {
    this.lastAck = -1;
    this.lastAckAt = 0;
    this.lastPatchAt = 0;
    this.stalled = false;
  }

  snapshot(
    now: number,
    predictor: {
      pendingCount: number;
      stats: {
        acked: number;
        corrections: number;
        snaps: number;
        staleAcks: number;
        resyncs: number;
        correctionP95: number;
        correctionMax: number;
      };
    },
  ): NetMetricsSnapshot {
    const ps = predictor.stats;
    return {
      generated: this.generated,
      sent: this.sent,
      messages: this.messages,
      acked: ps.acked,
      pending: predictor.pendingCount,
      pendingP50: this.pending.percentile(50),
      pendingP95: this.pending.percentile(95),
      pendingMax: this.pending.max(),
      pendingMaxEver: this.pendingMaxEver,
      ackAgeMs: Math.round(this.ackAgeMs(now)),
      ackAgeMaxMs: Math.round(this.ackAgeMaxMs),
      patches: this.patches,
      patchGapP95Ms: Math.round(this.patchGaps.percentile(95)),
      patchGapMaxMs: Math.round(this.patchGaps.max()),
      starvedFrames: this.starvedFrames,
      lostStepMs: Math.round(this.lostStepMs),
      stallEvents: this.stallEvents,
      stallMs: Math.round(this.stallMs),
      corrections: ps.corrections,
      snaps: ps.snaps,
      correctionP95: Math.round(ps.correctionP95 * 100) / 100,
      correctionMax: Math.round(ps.correctionMax * 100) / 100,
      staleAcks: ps.staleAcks,
      resyncs: ps.resyncs,
    };
  }
}
