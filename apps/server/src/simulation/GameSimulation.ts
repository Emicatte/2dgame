import {
  BTN,
  type CollisionWorld,
  clamp,
  collisionWorldFor,
  createPlayerSim,
  damageAtDistance,
  distSq,
  giveWeapon,
  type HitTarget,
  hasLineOfSight,
  type InputFrame,
  type MapDef,
  NET,
  type NetEvent,
  type PickupDef,
  PLAYER,
  type PlayerSim,
  refillAmmo,
  type ShotIntent,
  type SimEvent,
  stepPlayer,
  tracePellet,
  WEAPONS,
  type WeaponId,
  weaponByIndex,
} from "@scrapline/shared";

export interface PlayerMatchStats {
  kills: number;
  deaths: number;
  streak: number;
  bestStreak: number;
  shotsFired: number;
  shotsHit: number;
  damageDealt: number;
  firstBlood: boolean;
  /** Ticks spent in a live match (participation, for completion XP). */
  activeTicks: number;
  /** Order in which the player reached their current kill count (tie-breaker). */
  lastKillTick: number;
}

export interface ServerPlayer {
  id: string;
  playerId: string;
  name: string;
  skin: string;
  level: number;
  primary: WeaponId;
  seed: number;
  sim: PlayerSim;
  alive: boolean;
  hp: number;
  respawnTick: number;
  protectedUntil: number;
  queue: InputFrame[];
  lastQueuedSeq: number;
  lastProcessedSeq: number;
  credit: number;
  interact: boolean;
  connected: boolean;
  joinedTick: number;
  droppedInputs: number;
  stats: PlayerMatchStats;
}

export interface NewPlayer {
  id: string;
  playerId: string;
  name: string;
  skin: string;
  level: number;
  primary: WeaponId;
  seed: number;
}

interface HistoryFrame {
  tick: number;
  pos: Map<string, { x: number; y: number; alive: boolean }>;
}

interface PickupRuntime {
  def: PickupDef;
  active: boolean;
  respawnTick: number;
}

export type StepMode = "frozen" | "live";

export interface SimOptions {
  tickRate: number;
  rng?: () => number;
}

const HEALTH_PICKUP = 50;
const PICKUP_RADIUS = PLAYER.radius + 16;

export function emptyStats(): PlayerMatchStats {
  return {
    kills: 0,
    deaths: 0,
    streak: 0,
    bestStreak: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    firstBlood: false,
    activeTicks: 0,
    lastKillTick: 0,
  };
}

/**
 * Authoritative game simulation, independent of Colyseus so it can be unit tested directly.
 * The room feeds it validated inputs and real elapsed time; it returns gameplay events.
 */
export class GameSimulation {
  map: MapDef;
  world: CollisionWorld;
  tick = 0;
  readonly players = new Map<string, ServerPlayer>();
  readonly pickups = new Map<string, PickupRuntime>();
  firstBloodDone = false;
  /** Test-only fixed spawn list (enabled exclusively with ENABLE_DEBUG_ROUTES). */
  spawnOverride: { x: number; y: number }[] | null = null;
  private events: NetEvent[] = [];
  private readonly history: HistoryFrame[] = [];
  private readonly tickRate: number;
  private readonly rng: () => number;

  constructor(map: MapDef, opts: SimOptions) {
    this.map = map;
    this.world = collisionWorldFor(map);
    this.tickRate = opts.tickRate;
    this.rng = opts.rng ?? Math.random;
    this.resetPickups();
  }

  get maxRewindTicks(): number {
    return Math.ceil((NET.maxRewindMs / 1000) * this.tickRate);
  }

  secToTicks(sec: number): number {
    return Math.round(sec * this.tickRate);
  }

  setMap(map: MapDef): void {
    this.map = map;
    this.world = collisionWorldFor(map);
    this.history.length = 0;
    this.resetPickups();
  }

  private resetPickups(): void {
    this.pickups.clear();
    for (const def of this.map.pickups) this.pickups.set(def.id, { def, active: true, respawnTick: 0 });
  }

  addPlayer(init: NewPlayer): ServerPlayer {
    const spawn = this.map.spawns[0]!;
    const p: ServerPlayer = {
      ...init,
      sim: createPlayerSim(spawn.x, spawn.y, init.primary),
      alive: false,
      hp: 0,
      respawnTick: 0,
      protectedUntil: 0,
      queue: [],
      lastQueuedSeq: 0,
      lastProcessedSeq: 0,
      credit: 0,
      interact: false,
      connected: true,
      joinedTick: this.tick,
      droppedInputs: 0,
      stats: emptyStats(),
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id: string): ServerPlayer | undefined {
    const p = this.players.get(id);
    this.players.delete(id);
    return p;
  }

  /**
   * Queues validated inputs. Duplicates and out-of-order frames are dropped, the queue is bounded,
   * so a misbehaving client can neither replay inputs nor exhaust memory.
   */
  enqueue(id: string, frames: readonly InputFrame[]): { accepted: number; dropped: number } {
    const p = this.players.get(id);
    if (!p) return { accepted: 0, dropped: frames.length };
    let accepted = 0;
    let dropped = 0;
    for (const f of frames) {
      if (f.seq <= p.lastQueuedSeq) {
        dropped++;
        continue;
      }
      if (p.queue.length >= NET.maxQueuedInputs) {
        dropped++;
        p.droppedInputs++;
        continue;
      }
      // Never trust the view tick beyond what the server has actually sent.
      const viewTick = clamp(f.viewTick, Math.max(0, this.tick - this.maxRewindTicks), this.tick);
      p.queue.push({ ...f, viewTick });
      p.lastQueuedSeq = f.seq;
      accepted++;
    }
    return { accepted, dropped };
  }

  /** After a reconnect from a fresh page the client restarts its sequence numbers. */
  resetInputStream(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.queue.length = 0;
    p.lastQueuedSeq = 0;
    p.lastProcessedSeq = 0;
    p.credit = 0;
  }

  /** Clears match stats and spawns everybody at distinct spawn points. */
  resetForMatch(): void {
    this.firstBloodDone = false;
    this.resetPickups();
    this.history.length = 0;
    for (const p of this.players.values()) {
      p.stats = emptyStats();
      p.joinedTick = this.tick;
      p.alive = false;
      this.spawn(p, true);
    }
  }

  spawnLater(p: ServerPlayer, delaySec: number): void {
    p.alive = false;
    p.respawnTick = this.tick + Math.max(1, this.secToTicks(delaySec));
  }

  /** Advances one server tick. `elapsedMs` is real time since the previous tick. */
  step(elapsedMs: number, mode: StepMode): NetEvent[] {
    this.tick += 1;
    this.events = [];
    const elapsedSec = clamp(elapsedMs, 0, 1000) / 1000;
    const creditCap = NET.maxInputCreditSeconds * NET.inputRate;

    for (const p of this.players.values()) {
      p.interact = false;
      // Inputs may be consumed at most at real-time rate. Credit accrues with real elapsed time
      // (so a stalled server catches up), but idle time is banked only up to a small cap, which is
      // what stops a modified client from "saving up" time and then moving faster than allowed.
      p.credit += elapsedSec * NET.inputRate;
      while (p.queue.length > 0 && p.credit >= 1) {
        const frame = p.queue.shift()!;
        p.credit -= 1;
        this.applyInput(p, frame, mode === "live");
      }
      if (p.queue.length === 0) p.credit = Math.min(p.credit, creditCap);
      if (mode === "live" && p.connected) p.stats.activeTicks += 1;
    }

    if (mode === "live") {
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnTick > 0 && this.tick >= p.respawnTick) this.spawn(p, false);
      }
      this.updatePickups();
    }
    this.recordHistory();
    return this.events;
  }

  private applyInput(p: ServerPlayer, frame: InputFrame, live: boolean): void {
    const canAct = live && p.alive;
    const shots: { shot: ShotIntent; view: number }[] = [];
    stepPlayer(p.sim, frame, {
      world: this.world,
      seed: p.seed,
      alive: canAct,
      emit: (e: SimEvent) => {
        if (e.kind === "shot") shots.push({ shot: e.shot, view: frame.viewTick });
        else if (e.kind === "reloadStart") this.events.push({ t: "reload", p: p.id, w: e.weapon });
        else if (e.kind === "dash") this.events.push({ t: "dash", p: p.id });
      },
    });
    if (canAct && (frame.buttons & BTN.INTERACT) !== 0) p.interact = true;
    p.lastProcessedSeq = frame.seq;
    for (const s of shots) this.resolveShot(p, s.shot, s.view);
  }

  /** Positions of all players as the shooter saw them (interpolated server history). */
  private rewind(viewTick: number): Map<string, { x: number; y: number; alive: boolean }> {
    const out = new Map<string, { x: number; y: number; alive: boolean }>();
    if (this.history.length === 0) return out;
    const newest = this.history[this.history.length - 1]!.tick;
    const v = clamp(viewTick, newest - this.maxRewindTicks, newest);
    const t0 = Math.floor(v);
    const frac = v - t0;
    const h0 = this.historyAt(t0) ?? this.history[0]!;
    const h1 = this.historyAt(t0 + 1) ?? h0;
    for (const [id, a] of h0.pos) {
      const b = h1.pos.get(id) ?? a;
      out.set(id, { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, alive: a.alive && b.alive });
    }
    return out;
  }

  private historyAt(tick: number): HistoryFrame | undefined {
    const newest = this.history[this.history.length - 1];
    if (!newest) return undefined;
    const idx = this.history.length - 1 - (newest.tick - tick);
    const f = this.history[idx];
    return f && f.tick === tick ? f : undefined;
  }

  private recordHistory(): void {
    const pos = new Map<string, { x: number; y: number; alive: boolean }>();
    for (const p of this.players.values()) pos.set(p.id, { x: p.sim.x, y: p.sim.y, alive: p.alive });
    this.history.push({ tick: this.tick, pos });
    const keep = this.maxRewindTicks + 4;
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
  }

  private resolveShot(shooter: ServerPlayer, shot: ShotIntent, viewTick: number): void {
    const weapon = weaponByIndex(shot.weapon);
    if (!weapon) return;
    shooter.protectedUntil = 0;
    shooter.stats.shotsFired += 1;

    const seen = this.rewind(viewTick);
    const targets: HitTarget[] = [];
    for (const t of this.players.values()) {
      if (t.id === shooter.id || !t.alive) continue;
      const past = seen.get(t.id);
      if (past && !past.alive) continue;
      targets.push({ id: t.id, x: past?.x ?? t.sim.x, y: past?.y ?? t.sim.y, r: PLAYER.radius });
    }

    const damageByTarget = new Map<string, { dmg: number; x: number; y: number }>();
    const angles: number[] = [];
    const dists: number[] = [];
    for (const angle of shot.angles) {
      const r = tracePellet(this.world, shot.ox, shot.oy, angle, weapon.rangePx, targets, shooter.id);
      angles.push(Math.round(angle * 1000));
      dists.push(Math.round(r.dist));
      if (r.targetId) {
        const prev = damageByTarget.get(r.targetId);
        const dmg = damageAtDistance(weapon, r.dist);
        const hx = shot.ox + Math.cos(angle) * r.dist;
        const hy = shot.oy + Math.sin(angle) * r.dist;
        damageByTarget.set(r.targetId, { dmg: (prev?.dmg ?? 0) + dmg, x: hx, y: hy });
      }
    }
    this.events.push({
      t: "shot",
      p: shooter.id,
      w: weapon.index,
      x: Math.round(shot.ox),
      y: Math.round(shot.oy),
      a: angles,
      d: dists,
      s: shot.seq,
    });

    if (damageByTarget.size > 0) shooter.stats.shotsHit += 1;
    for (const [targetId, hit] of damageByTarget) {
      const target = this.players.get(targetId);
      if (!target || !target.alive) continue;
      const shielded = target.protectedUntil > this.tick;
      const dmg = shielded ? 0 : Math.max(1, Math.round(hit.dmg));
      target.hp = Math.max(0, target.hp - dmg);
      shooter.stats.damageDealt += dmg;
      const lethal = target.hp === 0;
      this.events.push({
        t: "hit",
        p: shooter.id,
        v: target.id,
        dmg,
        x: Math.round(hit.x),
        y: Math.round(hit.y),
        k: lethal,
      });
      if (lethal) this.kill(target, shooter, weapon.index);
    }
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer, weapon: number): void {
    victim.alive = false;
    victim.hp = 0;
    victim.sim.vx = 0;
    victim.sim.vy = 0;
    victim.stats.deaths += 1;
    victim.stats.streak = 0;
    victim.respawnTick = this.tick + this.secToTicks(PLAYER.respawnSeconds);
    killer.stats.kills += 1;
    killer.stats.streak += 1;
    killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
    killer.stats.lastKillTick = this.tick;
    const fb = !this.firstBloodDone;
    if (fb) {
      this.firstBloodDone = true;
      killer.stats.firstBlood = true;
    }
    this.events.push({ t: "kill", k: killer.id, v: victim.id, w: weapon, fb, st: killer.stats.streak });
  }

  /**
   * Picks the spawn point farthest from living enemies, preferring spots they cannot see.
   * Never spawns on top of another player.
   */
  chooseSpawn(forId: string): { x: number; y: number } {
    const enemies = [...this.players.values()].filter((p) => p.alive && p.id !== forId);
    const minGap = PLAYER.radius * 3;
    let best: { x: number; y: number; score: number }[] = [];
    const spawns = this.spawnOverride ?? this.map.spawns;
    for (const s of spawns) {
      if (enemies.some((e) => distSq(e.sim.x, e.sim.y, s.x, s.y) < minGap * minGap)) continue;
      let score: number;
      if (enemies.length === 0) {
        score = this.rng() * 1000;
      } else {
        let nearest = Number.POSITIVE_INFINITY;
        let visible = 0;
        for (const e of enemies) {
          nearest = Math.min(nearest, Math.sqrt(distSq(e.sim.x, e.sim.y, s.x, s.y)));
          if (hasLineOfSight(this.world, e.sim.x, e.sim.y, s.x, s.y)) visible++;
        }
        score = nearest * (visible > 0 ? 0.45 : 1) + this.rng() * 60;
      }
      best.push({ x: s.x, y: s.y, score });
    }
    if (best.length === 0) best = spawns.map((s) => ({ x: s.x, y: s.y, score: this.rng() }));
    best.sort((a, b) => b.score - a.score);
    const pick = best[0]!;
    return { x: pick.x, y: pick.y };
  }

  spawn(p: ServerPlayer, freshMatch: boolean): void {
    const pos = this.chooseSpawn(p.id);
    const keepAim = p.sim.aim;
    p.sim = createPlayerSim(pos.x, pos.y, p.primary);
    p.sim.aim = keepAim;
    p.alive = true;
    p.hp = PLAYER.maxHealth;
    p.respawnTick = 0;
    p.protectedUntil = this.tick + this.secToTicks(PLAYER.spawnProtectionSeconds);
    if (!freshMatch) p.stats.streak = 0;
    this.events.push({ t: "spawn", p: p.id, x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  private updatePickups(): void {
    for (const pk of this.pickups.values()) {
      if (!pk.active) {
        if (this.tick >= pk.respawnTick) pk.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const reach = pk.def.kind === "weapon" ? PLAYER.interactRadius : PICKUP_RADIUS;
        if (distSq(p.sim.x, p.sim.y, pk.def.x, pk.def.y) > reach * reach) continue;
        let taken = false;
        if (pk.def.kind === "health" && p.hp < PLAYER.maxHealth) {
          p.hp = Math.min(PLAYER.maxHealth, p.hp + HEALTH_PICKUP);
          taken = true;
        } else if (pk.def.kind === "ammo") {
          taken = refillAmmo(p.sim);
        } else if (pk.def.kind === "weapon" && pk.def.weapon && p.interact) {
          giveWeapon(p.sim, pk.def.weapon);
          taken = true;
        }
        if (taken) {
          pk.active = false;
          pk.respawnTick = this.tick + this.secToTicks(pk.def.respawnSec);
          const ev: NetEvent = { t: "pickup", p: p.id, id: pk.def.id, kind: pk.def.kind };
          if (pk.def.weapon) ev.w = WEAPONS[pk.def.weapon].index;
          this.events.push(ev);
          break;
        }
      }
    }
  }

  /** Ranking: kills desc, deaths asc, earliest to reach the score first. */
  standings(): ServerPlayer[] {
    return [...this.players.values()].sort(
      (a, b) =>
        b.stats.kills - a.stats.kills ||
        a.stats.deaths - b.stats.deaths ||
        a.stats.lastKillTick - b.stats.lastKillTick ||
        a.joinedTick - b.joinedTick,
    );
  }

  leaderKills(): number {
    let max = 0;
    for (const p of this.players.values()) max = Math.max(max, p.stats.kills);
    return max;
  }
}
