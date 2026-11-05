import { lerp, lerpAngle } from "@scrapline/shared";

export interface RemoteSample {
  x: number;
  y: number;
  aim: number;
  alive: boolean;
  weapon: number;
  hp: number;
  protected: boolean;
  reloading: boolean;
}

interface Snapshot {
  tick: number;
  players: Map<string, RemoteSample>;
}

/**
 * Buffer of authoritative snapshots for interpolating remote players at a time slightly in the
 * past. Remote motion is always a blend of two real server states, never a guess.
 */
export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = [];
  private readonly maxSnaps = 40;

  push(tick: number, players: Map<string, RemoteSample>): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && tick <= last.tick) {
      if (tick === last.tick) last.players = players;
      return;
    }
    this.snaps.push({ tick, players });
    if (this.snaps.length > this.maxSnaps) this.snaps.shift();
  }

  clear(): void {
    this.snaps.length = 0;
  }

  get newestTick(): number {
    return this.snaps[this.snaps.length - 1]?.tick ?? 0;
  }

  /** Interpolated sample for `id` at fractional `renderTick`, or null if unknown. */
  sample(id: string, renderTick: number): RemoteSample | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    let older: Snapshot | undefined;
    let newer: Snapshot | undefined;
    for (let i = n - 1; i >= 0; i--) {
      const s = this.snaps[i]!;
      if (s.tick <= renderTick) {
        older = s;
        newer = this.snaps[i + 1];
        break;
      }
    }
    if (!older) return this.snaps[0]!.players.get(id) ?? null;
    const a = older.players.get(id);
    if (!a) return newer?.players.get(id) ?? null;
    if (!newer) return a;
    const b = newer.players.get(id);
    if (!b) return a;
    // Do not slide across a respawn or a death: show the newer state as soon as it begins.
    if (a.alive !== b.alive) return renderTick - older.tick > 0.5 ? b : a;
    const t = (renderTick - older.tick) / (newer.tick - older.tick);
    if (Math.hypot(b.x - a.x, b.y - a.y) > 200) return t < 0.5 ? a : b;
    return {
      ...b,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      aim: lerpAngle(a.aim, b.aim, t),
    };
  }
}
