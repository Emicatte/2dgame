import {
  cellCenter,
  type DifficultyDef,
  hasLineOfSight,
  MAX_ZOMBIES,
  type NavGrid,
  navClassFor,
  type SquadScale,
  type Vec2,
  type WaveDef,
  walkable,
  ZOMBIES,
  type ZombieKind,
} from "@scrapline/shared";
import type { ZombieHost, ZombieWorld } from "./ZombieWorld.ts";

/**
 * Wave Director: turns a wave definition (counts for one Veteran player) into a spawn queue scaled
 * by squad size and difficulty, releases it in batches from valid spawn points, and guarantees that
 * every wave ends: enemies stuck far from everybody are culled, and after the wave timer the
 * survivors are enraged and come straight for the squad.
 */

export interface WaveRun {
  number: number;
  label: string;
  queue: ZombieKind[];
  total: number;
  spawned: number;
  nextBatchTick: number;
  startTick: number;
  timeoutTick: number;
  zones: Vec2[];
  supply: boolean;
  enraged: boolean;
  culled: number;
}

/** Minimum distance (px) between a spawn and any player, and the distance beyond which a spawn in plain view is fine. */
export const SPAWN_MIN_DIST = 480;
export const SPAWN_VISIBLE_OK_DIST = 1050;
const ZONE_JITTER = 130;

const SPECIALS: readonly ZombieKind[] = ["brute", "spitter", "stalker", "exploder"];

/** Scaled enemy counts of a wave for the squad and difficulty. Pure (unit tested). */
export function waveComposition(
  def: WaveDef,
  players: number,
  squad: SquadScale,
  diff: DifficultyDef,
): Partial<Record<ZombieKind, number>> {
  const out: Partial<Record<ZombieKind, number>> = {};
  for (const [kind, base] of Object.entries(def.enemies) as [ZombieKind, number][]) {
    if (!base || base <= 0) continue;
    let n: number;
    if (kind === "walker" || kind === "runner") n = Math.round(base * squad.density * diff.density);
    else if (kind === "brute")
      n = Math.max(1, Math.round(base * (1 + (players - 1) * 0.3) * Math.min(1.2, diff.density)));
    else
      n = Math.max(
        1,
        Math.round(base * (0.2 + 0.8 * squad.density) * (1 + squad.specialBonus + diff.specialBonus)),
      );
    out[kind] = Math.max(0, n);
  }
  return out;
}

/** Spawn order: specials spread through the wave (never all at the start). */
export function spawnQueue(counts: Partial<Record<ZombieKind, number>>, rng: () => number): ZombieKind[] {
  const common: ZombieKind[] = [];
  const special: ZombieKind[] = [];
  for (const [kind, n] of Object.entries(counts) as [ZombieKind, number][]) {
    for (let i = 0; i < n; i++) (SPECIALS.includes(kind) ? special : common).push(kind);
  }
  for (let i = common.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [common[i], common[j]] = [common[j]!, common[i]!];
  }
  const out = [...common];
  // Insert specials at evenly spaced positions after the first fifth.
  special.forEach((k, i) => {
    const at = Math.min(
      out.length,
      Math.floor(out.length * 0.2 + ((i + 1) * out.length * 0.8) / (special.length + 1)),
    );
    out.splice(at + i, 0, k);
  });
  return out;
}

export class WaveDirector {
  run: WaveRun | null = null;
  private fallback: Vec2[] | null = null;

  constructor(
    private readonly zw: ZombieWorld,
    private readonly host: ZombieHost,
  ) {}

  private secTicks(sec: number): number {
    return Math.max(1, Math.round(sec * this.host.tickRate));
  }

  /** Map changed (or doors opened): recompute the generic spawn candidates lazily. */
  resetCandidates(): void {
    this.fallback = null;
  }

  start(
    def: WaveDef,
    number: number,
    zones: Vec2[],
    players: number,
    squad: SquadScale,
    diff: DifficultyDef,
  ): WaveRun {
    const counts = waveComposition(def, players, squad, diff);
    const queue = spawnQueue(counts, () => this.host.rng());
    // A boss leads its wave.
    if (def.boss) queue.unshift(def.boss);
    const tick = this.host.tick;
    this.run = {
      number,
      label: def.label ?? `Wave ${number}`,
      queue,
      total: queue.length,
      spawned: 0,
      nextBatchTick: tick + this.secTicks(1),
      startTick: tick,
      timeoutTick: tick + this.secTicks(45 + queue.length * 2.5),
      zones,
      supply: !!def.supply,
      enraged: false,
      culled: 0,
    };
    return this.run;
  }

  /** Enemies of the running wave not yet defeated (queued + alive). */
  get remaining(): number {
    const r = this.run;
    if (!r) return 0;
    let alive = 0;
    for (const z of this.zw.zombies.values()) if (!z.dead && z.wave === r.number) alive++;
    return r.queue.length + alive;
  }

  get done(): boolean {
    return !!this.run && this.remaining === 0;
  }

  /** One tick: release batches, enrage on timeout, cull stragglers. */
  step(squad: SquadScale, diff: DifficultyDef, players: number): void {
    const r = this.run;
    if (!r) return;
    const tick = this.host.tick;
    const cap = Math.min(MAX_ZOMBIES, Math.round(squad.maxAlive * diff.density));
    if (r.queue.length > 0 && tick >= r.nextBatchTick) {
      const batch = Math.min(
        r.queue.length,
        1 + squad.fronts + Math.floor(players / 2),
        Math.max(0, cap - this.zw.alive),
      );
      // Each front is a different zone: four players get pressure from several directions.
      const order = [...r.zones].sort(() => this.host.rng() - 0.5);
      for (let i = 0; i < batch; i++) {
        const kind = r.queue[0]!;
        const zone = order.length > 0 ? order[i % Math.min(order.length, squad.fronts)]! : null;
        const at = this.findSpawn(kind, zone ? [zone, ...order] : order);
        if (!at) break;
        r.queue.shift();
        r.spawned++;
        const z = this.zw.spawn(kind, at.x, at.y, { state: "hunt", wave: r.number });
        if (r.enraged) z.enraged = true;
      }
      r.nextBatchTick = tick + this.secTicks(1.8 * squad.spawnInterval * diff.spawnInterval);
    }
    if (!r.enraged && tick >= r.timeoutTick) {
      r.enraged = true;
      for (const z of this.zw.zombies.values()) {
        if (z.wave === r.number) {
          z.enraged = true;
          z.horde = true;
        }
      }
    }
    for (const z of this.zw.stragglers()) {
      if (z.wave !== r.number) continue;
      this.zw.remove(z);
      r.culled++;
    }
  }

  /** Abandons the wave (mission step ended another way). */
  stop(): void {
    this.run = null;
  }

  /**
   * A valid spawn: on a cell the body fits, at least SPAWN_MIN_DIST from every player and out of
   * their sight unless far away, not on another enemy. Zones first, then generic candidates.
   */
  findSpawn(kind: ZombieKind, zones: readonly Vec2[]): Vec2 | null {
    const def = ZOMBIES[kind];
    const nav = this.host.nav();
    const cls = navClassFor(def.radius);
    const ok = (x: number, y: number, strict: boolean): boolean => {
      const c = Math.floor(x / nav.cell) + Math.floor(y / nav.cell) * nav.cols;
      if (x < 0 || y < 0 || x >= nav.width || y >= nav.height || !walkable(nav, c, cls)) return false;
      for (const a of this.host.actors()) {
        if (!a.alive) continue;
        const d = Math.hypot(a.x - x, a.y - y);
        if (d < (strict ? SPAWN_MIN_DIST : SPAWN_MIN_DIST * 0.8)) return false;
        if (strict && d < SPAWN_VISIBLE_OK_DIST && hasLineOfSight(this.host.shotWorld(), a.x, a.y, x, y))
          return false;
      }
      for (const z of this.zw.zombies.values()) {
        if (!z.dead && Math.hypot(z.x - x, z.y - y) < z.def.radius + def.radius + 4) return false;
      }
      return true;
    };
    for (const strict of [true, false]) {
      for (const zone of zones) {
        for (let k = 0; k < 6; k++) {
          const a = this.host.rng() * Math.PI * 2;
          const d = k === 0 ? 0 : ZONE_JITTER * this.host.rng();
          const x = zone.x + Math.cos(a) * d;
          const y = zone.y + Math.sin(a) * d;
          if (ok(x, y, strict)) return { x, y };
        }
      }
      const cands = this.candidates(nav);
      // Prefer the closest valid candidates beyond the minimum distance (they arrive soon).
      const scored: { p: Vec2; d: number }[] = [];
      for (const p of cands) {
        let nearest = Number.POSITIVE_INFINITY;
        for (const a of this.host.actors())
          if (a.alive) nearest = Math.min(nearest, Math.hypot(a.x - p.x, a.y - p.y));
        scored.push({ p, d: nearest });
      }
      scored.sort((a, b) => a.d - b.d);
      for (const s of scored) if (s.d >= SPAWN_MIN_DIST && ok(s.p.x, s.p.y, strict)) return s.p;
    }
    return null;
  }

  private candidates(nav: NavGrid): Vec2[] {
    if (this.fallback) return this.fallback;
    const out: Vec2[] = [];
    for (let r = 2; r < nav.rows - 2; r += 5) {
      for (let c = 2; c < nav.cols - 2; c += 5) {
        const idx = r * nav.cols + c;
        if (walkable(nav, idx, 2)) out.push(cellCenter(nav, idx));
        else if (walkable(nav, idx, 1) && (r + c) % 2 === 0) out.push(cellCenter(nav, idx));
      }
    }
    this.fallback = out;
    return out;
  }
}
