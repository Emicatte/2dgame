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

export interface VehicleSample {
  x: number;
  y: number;
  angle: number;
  alt: number;
  rotor: number;
  hp: number;
  status: number;
  /** Speed (px/s) for the HUD and effects. */
  speed: number;
}

/** Same timeline as remote players: vehicles are rendered as two blended server states. */
export class VehicleBuffer {
  private readonly snaps: { tick: number; vehicles: Map<string, VehicleSample> }[] = [];
  private readonly maxSnaps = 40;

  push(tick: number, vehicles: Map<string, VehicleSample>): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && tick <= last.tick) {
      if (tick === last.tick) last.vehicles = vehicles;
      return;
    }
    this.snaps.push({ tick, vehicles });
    if (this.snaps.length > this.maxSnaps) this.snaps.shift();
  }

  clear(): void {
    this.snaps.length = 0;
  }

  sample(id: string, renderTick: number): VehicleSample | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    let i = n - 1;
    while (i >= 0 && this.snaps[i]!.tick > renderTick) i--;
    if (i < 0) return this.snaps[0]!.vehicles.get(id) ?? null;
    const older = this.snaps[i]!;
    const newer = this.snaps[i + 1];
    const a = older.vehicles.get(id);
    if (!a) return newer?.vehicles.get(id) ?? null;
    if (!newer) return a;
    const b = newer.vehicles.get(id);
    if (!b) return a;
    const t = (renderTick - older.tick) / (newer.tick - older.tick);
    if (a.status !== b.status || Math.hypot(b.x - a.x, b.y - a.y) > 200) return t < 0.5 ? a : b;
    return {
      ...b,
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      angle: lerpAngle(a.angle, b.angle, t),
      alt: lerp(a.alt, b.alt, t),
      rotor: lerp(a.rotor, b.rotor, t),
      speed: lerp(a.speed, b.speed, t),
    };
  }
}
