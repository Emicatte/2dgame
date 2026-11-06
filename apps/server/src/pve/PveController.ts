import {
  AI,
  buildNavGrid,
  type CollisionWorld,
  closestOnBody,
  DIFFICULTY,
  type Difficulty,
  type DifficultyDef,
  DOWNED,
  formatIdList,
  type HitTarget,
  isFreeSpot,
  type MissionDef,
  type NavGrid,
  NET,
  type NetEvent,
  PLAYER,
  type PropDef,
  PVE_STATUS,
  type PveResult,
  type PveSquadRow,
  pveWorlds,
  type Rect,
  randomWalkableNear,
  type SquadScale,
  type StepDef,
  SURVIVAL,
  squadScale,
  survivalWave,
  type Trigger,
  updateNavRegion,
  type Vec2,
  vehicleCircles,
  type WeaponDef,
  weaponByIndex,
  type XpLine,
} from "@scrapline/shared";
import type { GameSimulation, ServerPlayer, ServerVehicle } from "../simulation/GameSimulation.ts";
import { WaveDirector } from "./WaveDirector.ts";
import { type PveActor, type VehicleBody, type Zombie, type ZombieHost, ZombieWorld } from "./ZombieWorld.ts";

export interface PveConfig {
  mode: "outbreak" | "survival";
  /** Outbreak: the mission; Survival: undefined. */
  mission?: MissionDef;
  difficulty: Difficulty;
}

/** Per-player PvE state kept on ServerPlayer. */
export interface PvePlayer {
  downed: boolean;
  bleedUntil: number;
  reviveProg: number;
  reviver: string;
  lastReviveTick: number;
  selfReviveAt: number;
  revives: number;
  downs: number;
}

export function emptyPvePlayer(): PvePlayer {
  return {
    downed: false,
    bleedUntil: 0,
    reviveProg: 0,
    reviver: "",
    lastReviveTick: 0,
    selfReviveAt: 0,
    revives: 0,
    downs: 0,
  };
}

interface PropRuntime {
  def: PropDef;
  active: boolean;
  used: boolean;
  prog: number;
  by: string;
  lastNoiseTick: number;
}

export interface LootRuntime {
  id: string;
  kind: "ammo" | "health" | "supply";
  x: number;
  y: number;
  until: number;
  /** Supply crates: players who already took from it. */
  takenBy: Set<string>;
  uses: number;
  prog: Map<string, number>;
}

const PROP_REACH = 74;
const LOOT_REACH = PLAYER.radius + 16;
const SUPPLY_HOLD_SEC = 0.6;
const LOOT_SEC = 25;
const DROP_CHANCE = { ammo: 0.07, health: 0.035 };

/** Gunfire noise radius (px): louder weapons wake more of the map. */
export function shotNoise(w: WeaponDef): number {
  return 600 + Math.min(700, w.damage * w.pellets * 6);
}

/**
 * PvE match runtime: owns the enemies (ZombieWorld), waves (WaveDirector) and the mission script,
 * plus the co-op rules (downed, revive, self-revive, wipe = mission failed). GameSimulation calls
 * it from its tick; both room implementations mirror it with syncPve.
 */
export class PveController implements ZombieHost {
  readonly zw: ZombieWorld;
  readonly waves: WaveDirector;
  readonly mission: MissionDef | null;
  readonly mode: "outbreak" | "survival";
  difficultyId: Difficulty;
  diff: DifficultyDef;
  status: number = PVE_STATUS.RUNNING;
  failReason = "";
  stepIndex = 0;
  stepProg = 0;
  count = 0;
  countMax = 0;
  waveNumber = 0;
  waveInStep = 0;
  nextWaveTick = 0;
  readonly doorsOpen = new Set<string>();
  readonly flags = new Set<string>();
  power = false;
  alarm = false;
  readonly props = new Map<string, PropRuntime>();
  readonly loot = new Map<string, LootRuntime>();
  checkpoint: Vec2 | null = null;
  selfRevives = 0;
  kills = 0;
  startTick = 0;
  endTick = 0;
  /** Waves cleared (Survival) / steps completed (Outbreak). */
  progress = 0;
  bossId = "";
  private grid!: NavGrid;
  private worldsCache: { world: CollisionWorld; shotWorld: CollisionWorld } | null = null;
  private actorCache: PveActor[] = [];
  private actorTick = -1;
  private wipeSince = 0;
  private nextAmbientTick = 0;
  private nextLoot = 1;
  /** Events emitted this tick (merged into the simulation's events). */
  private readonly out: NetEvent[] = [];

  constructor(
    private readonly sim: GameSimulation,
    cfg: PveConfig,
  ) {
    this.mode = cfg.mode;
    this.mission = cfg.mode === "outbreak" ? (cfg.mission ?? null) : null;
    this.difficultyId = cfg.difficulty;
    this.diff = DIFFICULTY[cfg.difficulty];
    this.zw = new ZombieWorld(this);
    this.waves = new WaveDirector(this.zw, this);
    this.zw.setDifficulty(cfg.difficulty);
    this.rebuildWorlds(true);
  }

  // ------------------------------------------------------------------ ZombieHost

  get tick(): number {
    return this.sim.tick;
  }
  get tickRate(): number {
    return this.sim.tickRateHz;
  }
  rng(): number {
    return this.sim.rng();
  }
  world(): CollisionWorld {
    return this.sim.world;
  }
  shotWorld(): CollisionWorld {
    return this.sim.shotWorld;
  }
  nav(): NavGrid {
    return this.grid;
  }

  actors(): readonly PveActor[] {
    if (this.actorTick === this.sim.tick) return this.actorCache;
    this.actorTick = this.sim.tick;
    const out: PveActor[] = [];
    for (const p of this.sim.players.values()) {
      const v = p.vehicle ? this.sim.vehicles.get(p.vehicle) : undefined;
      out.push({
        id: p.id,
        x: p.sim.x,
        y: p.sim.y,
        vx: p.sim.vx,
        vy: p.sim.vy,
        aim: p.sim.aim,
        alive: p.alive && p.connected,
        downed: p.pve.downed,
        vehicle: p.vehicle,
        airborne: !!v && v.sim.alt >= 0.35,
      });
    }
    this.actorCache = out;
    return out;
  }

  vehicles(): readonly VehicleBody[] {
    const out: VehicleBody[] = [];
    for (const v of this.sim.vehicles.values()) {
      if (v.status !== 0 || v.sim.alt >= 0.35) continue;
      out.push({ id: v.id, circles: vehicleCircles(v.sim, v.def) });
    }
    return out;
  }

  emit(ev: NetEvent): void {
    this.out.push(ev);
  }

  /** Events produced since the last call (the simulation appends them to its tick events). */
  drainEvents(): NetEvent[] {
    return this.out.splice(0, this.out.length);
  }

  hurtPlayer(id: string, dmg: number, from: Zombie | null, x: number, y: number, knock?: Vec2): void {
    const p = this.sim.players.get(id);
    if (!p?.alive) return;
    if (p.pve.downed) {
      // Hits on a downed player shorten the bleed-out instead.
      p.pve.bleedUntil -= Math.round(dmg * DOWNED.bleedPerDamage * this.tickRate);
      this.emit({
        t: "hit",
        p: from?.id ?? "",
        v: p.id,
        dmg: Math.max(1, Math.round(dmg)),
        x: Math.round(x),
        y: Math.round(y),
        k: false,
      });
      return;
    }
    if (knock && p.protectedUntil <= this.sim.tick && !p.vehicle) {
      p.sim.vx += knock.x;
      p.sim.vy += knock.y;
    }
    // Pure shove (a boss roar): no damage, no hit event.
    if (dmg <= 0) return;
    this.sim.damagePlayerFrom(p, dmg, from ? `z:${from.id}` : "", from ? from.def.name : "Acid", x, y);
  }

  hurtVehicle(id: string, dmg: number, x: number, y: number): void {
    const v = this.sim.vehicles.get(id);
    if (v) this.sim.damageVehicle(v, dmg, null, x, y);
  }

  onKilled(z: Zombie, killer: string): void {
    this.kills++;
    const p = killer ? this.sim.players.get(killer) : undefined;
    if (p) {
      p.stats.kills += 1;
      p.stats.streak += 1;
      p.stats.bestStreak = Math.max(p.stats.bestStreak, p.stats.streak);
      p.stats.lastKillTick = this.sim.tick;
    }
    if (z.def.kind === "brute" || z.def.kind === "exploder") return;
    const roll = this.rng();
    const sup = this.diff.supply;
    if (roll < DROP_CHANCE.ammo * sup) this.dropLoot("ammo", z.x, z.y);
    else if (roll < (DROP_CHANCE.ammo + DROP_CHANCE.health) * sup) this.dropLoot("health", z.x, z.y);
  }

  // ------------------------------------------------------------------ worlds and doors

  get squadSize(): number {
    let n = 0;
    for (const p of this.sim.players.values()) if (p.connected) n++;
    return Math.max(1, n);
  }

  get squad(): SquadScale {
    return squadScale(this.squadSize);
  }

  /** World with the current doors, applied to the simulation; the nav grid follows. */
  private rebuildWorlds(full: boolean, changed?: readonly Rect[]): void {
    const doors = this.mission?.doors ?? [];
    // Survival on a mission map: every door open.
    const open = this.mode === "survival" ? new Set(doors.map((d) => d.id)) : this.doorsOpen;
    const w = pveWorlds(this.sim.map, doors, open);
    this.worldsCache = w;
    this.sim.world = w.world;
    this.sim.shotWorld = w.shotWorld;
    if (full || !this.grid) this.grid = buildNavGrid(w.world);
    else for (const r of changed ?? []) updateNavRegion(this.grid, w.world, r);
    this.zw.invalidateNav();
    this.waves.resetCandidates();
  }

  get worlds() {
    return this.worldsCache!;
  }

  private setDoor(id: string, open: boolean): void {
    const d = this.mission?.doors.find((x) => x.id === id);
    if (!d || this.doorsOpen.has(id) === open) return;
    if (open) this.doorsOpen.add(id);
    else this.doorsOpen.delete(id);
    // A door closing on somebody must not trap them inside the solid: push them out.
    this.rebuildWorlds(false, [d]);
    if (!open) {
      for (const p of this.sim.players.values()) {
        if (!p.alive || p.vehicle) continue;
        if (!isFreeSpot(this.sim.world, p.sim, PLAYER.radius)) this.placeFree(p, p.sim);
      }
    }
    this.emit({ t: "pve", k: open ? "door" : "doorClose", s: id });
  }

  get doorList(): string {
    return formatIdList(
      this.mode === "survival" ? (this.mission?.doors.map((d) => d.id) ?? []) : this.doorsOpen,
    );
  }

  // ------------------------------------------------------------------ lifecycle

  /** New run: called by the simulation at match reset, before the players spawn. */
  reset(): void {
    this.out.length = 0;
    this.zw.clear();
    this.waves.stop();
    this.loot.clear();
    this.props.clear();
    this.doorsOpen.clear();
    this.flags.clear();
    this.status = PVE_STATUS.RUNNING;
    this.failReason = "";
    this.power = false;
    this.alarm = false;
    this.kills = 0;
    this.progress = 0;
    this.waveNumber = 0;
    this.waveInStep = 0;
    this.stepIndex = 0;
    this.stepProg = 0;
    this.count = 0;
    this.countMax = 0;
    this.checkpoint = null;
    this.wipeSince = 0;
    this.startTick = this.sim.tick;
    this.endTick = 0;
    this.bossId = "";
    this.selfRevives = this.diff.selfRevives;
    for (const d of this.mission?.doors ?? []) if (d.startOpen) this.doorsOpen.add(d.id);
    this.rebuildWorlds(true);
    this.zw.hpMult = this.squad.enemyHp;
    for (const def of this.mission?.props ?? []) {
      this.props.set(def.id, { def, active: false, used: false, prog: 0, by: "", lastNoiseTick: 0 });
    }
    for (const p of this.sim.players.values()) p.pve = emptyPvePlayer();
    if (this.mission) this.startStep(0, false);
    else this.nextWaveTick = this.sim.tick + this.secTicks(4);
    this.nextAmbientTick = this.sim.tick + this.secTicks(this.mission?.ambient?.everySec ?? 999);
  }

  private secTicks(sec: number): number {
    return Math.max(1, Math.round(sec * this.tickRate));
  }

  /** One live tick (called by the simulation after the players' inputs). */
  step(): void {
    if (this.status !== PVE_STATUS.RUNNING) return;
    this.zw.hpMult = this.squad.enemyHp;
    this.updatePlayers();
    if (this.mission) this.updateMission();
    else this.updateSurvival();
    this.waves.step(this.squad, this.diff, this.squadSize);
    this.zw.step();
    let boss = "";
    for (const z of this.zw.zombies.values()) if (!z.dead && z.def.boss) boss = z.id;
    this.bossId = boss;
    this.updateLoot();
    this.checkWipe();
  }

  private finish(status: number, reason = ""): void {
    if (this.status !== PVE_STATUS.RUNNING) return;
    this.status = status;
    this.failReason = reason;
    this.endTick = this.sim.tick;
    this.emit({ t: "pve", k: status === PVE_STATUS.COMPLETE ? "complete" : "failed", s: reason });
  }

  /** Room-level failure (host left, everybody disconnected). */
  abort(reason: string): void {
    this.finish(PVE_STATUS.FAILED, reason);
  }

  // ------------------------------------------------------------------ players: downed, revive

  /** Lethal damage in PvE downs the player instead (returns true when handled). */
  onLethal(p: ServerPlayer, by: string): boolean {
    if (p.pve.downed) return true;
    this.sim.leaveVehicle(p, true);
    p.pve.downed = true;
    p.hp = 0;
    p.pve.downs += 1;
    p.stats.deaths += 1;
    p.stats.streak = 0;
    p.pve.bleedUntil = this.sim.tick + this.secTicks(this.diff.bleedoutSec);
    p.pve.reviveProg = 0;
    p.pve.reviver = "";
    p.pve.selfReviveAt =
      this.squadSize === 1 && this.selfRevives > 0 ? this.sim.tick + this.secTicks(DOWNED.selfReviveSec) : 0;
    p.sim.vx = 0;
    p.sim.vy = 0;
    this.emit({ t: "down", p: p.id, by });
    return true;
  }

  private revive(p: ServerPlayer, by: ServerPlayer | null): void {
    p.pve.downed = false;
    p.pve.reviveProg = 0;
    p.pve.reviver = "";
    p.pve.selfReviveAt = 0;
    p.hp = this.diff.reviveHp;
    p.protectedUntil = this.sim.tick + this.secTicks(1.5);
    if (by) by.pve.revives += 1;
    else this.selfRevives = Math.max(0, this.selfRevives - 1);
    this.emit({ t: "revive", p: p.id, by: by?.id ?? "" });
  }

  private bleedOut(p: ServerPlayer): void {
    p.pve.downed = false;
    p.pve.reviveProg = 0;
    p.alive = false;
    p.hp = 0;
    p.respawnTick = 0;
    this.emit({ t: "bleed", p: p.id });
  }

  private standing(p: ServerPlayer): boolean {
    return p.alive && p.connected && !p.pve.downed;
  }

  private updatePlayers(): void {
    const tick = this.sim.tick;
    const players = [...this.sim.players.values()];
    // Revives: a standing player holding E next to a downed teammate.
    const busy = new Set<string>();
    for (const r of players) {
      if (!this.standing(r) || !r.interact || r.vehicle) continue;
      let best: ServerPlayer | null = null;
      let bestD: number = DOWNED.reviveReach;
      for (const d of players) {
        if (d === r || !d.alive || !d.pve.downed) continue;
        const dist = Math.hypot(d.sim.x - r.sim.x, d.sim.y - r.sim.y);
        if (dist <= bestD) {
          bestD = dist;
          best = d;
        }
      }
      if (!best) continue;
      busy.add(r.id);
      const grace = this.secTicks(DOWNED.reviveGraceSec);
      if (best.pve.reviver !== r.id || tick - best.pve.lastReviveTick > grace) best.pve.reviveProg = 0;
      best.pve.reviver = r.id;
      best.pve.lastReviveTick = tick;
      best.pve.reviveProg += holdTime(r) / DOWNED.reviveSec;
      if (best.pve.reviveProg >= 1) this.revive(best, r);
    }
    for (const p of players) {
      if (!p.pve.downed) continue;
      if (p.pve.reviver && tick - p.pve.lastReviveTick > this.secTicks(DOWNED.reviveGraceSec)) {
        p.pve.reviver = "";
        p.pve.reviveProg = 0;
      }
      if (p.pve.selfReviveAt > 0 && tick >= p.pve.selfReviveAt && this.selfRevives > 0) {
        this.revive(p, null);
        continue;
      }
      if (tick >= p.pve.bleedUntil) this.bleedOut(p);
    }
    this.updateProps(players, busy);
  }

  private checkWipe(): void {
    const players = [...this.sim.players.values()];
    if (players.length === 0) return;
    const anyStanding = players.some((p) => this.standing(p));
    // A pending self-revive keeps the run alive.
    const pendingSelf = this.selfRevives > 0 && players.some((p) => p.pve.downed && p.pve.selfReviveAt > 0);
    if (anyStanding || pendingSelf) {
      this.wipeSince = 0;
      return;
    }
    if (this.wipeSince === 0) this.wipeSince = this.sim.tick;
    if (this.sim.tick - this.wipeSince >= this.secTicks(DOWNED.wipeGraceSec))
      this.finish(PVE_STATUS.FAILED, "The squad was overwhelmed");
  }

  /** Bled-out players come back (mission checkpoint, wave cleared). */
  private respawnDead(): void {
    for (const p of this.sim.players.values()) {
      if (!p.alive && p.respawnTick === 0 && p.connected) p.respawnTick = this.sim.tick + 1;
    }
  }

  /** Where a (re)spawning player appears: next to a standing teammate, the checkpoint, or the start. */
  spawnPoint(p: ServerPlayer): Vec2 {
    const mates = [...this.sim.players.values()].filter((o) => o !== p && this.standing(o) && !o.vehicle);
    const anchor = mates[0]?.sim ?? this.checkpoint;
    if (anchor) {
      const spot = this.freeSpotNear(anchor, p);
      if (spot) return spot;
    }
    const taken = [...this.sim.players.values()].filter((o) => o !== p && o.alive);
    // Test-only fixed spawns (dev / E2E builds and debug routes) take precedence, like in PvP.
    // Survival on a competitive map starts the squad near the middle, not in a corner.
    const cx = this.sim.map.width / 2;
    const cy = this.sim.map.height / 2;
    const list = this.sim.spawnOverride
      ? [...this.sim.spawnOverride]
      : this.mission
        ? [...this.sim.map.spawns]
        : [...this.sim.map.spawns].sort(
            (p1, p2) => Math.hypot(p1.x - cx, p1.y - cy) - Math.hypot(p2.x - cx, p2.y - cy),
          );
    for (const s of list) {
      if (!taken.some((o) => Math.hypot(o.sim.x - s.x, o.sim.y - s.y) < PLAYER.radius * 3))
        return { x: s.x, y: s.y };
    }
    return this.sim.map.spawns[0]!;
  }

  private freeSpotNear(at: Vec2, self: ServerPlayer): Vec2 | null {
    for (let r = 50; r <= 260; r += 30) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + r;
        const q = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
        if (!isFreeSpot(this.sim.world, q, PLAYER.radius + 2)) continue;
        if (
          [...this.sim.players.values()].some(
            (o) => o !== self && o.alive && Math.hypot(o.sim.x - q.x, o.sim.y - q.y) < PLAYER.radius * 2.5,
          )
        )
          continue;
        if ([...this.zw.zombies.values()].some((z) => !z.dead && Math.hypot(z.x - q.x, z.y - q.y) < 220))
          continue;
        return q;
      }
    }
    return null;
  }

  private placeFree(p: ServerPlayer, from: Vec2): void {
    const spot = this.freeSpotNear(from, p) ?? this.spawnPoint(p);
    p.sim.x = spot.x;
    p.sim.y = spot.y;
  }

  // ------------------------------------------------------------------ props

  private propUsable(pr: PropRuntime): boolean {
    return pr.active && !pr.used && (!pr.def.requires || this.flags.has(pr.def.requires));
  }

  private updateProps(players: ServerPlayer[], busy: Set<string>): void {
    const held = new Set<string>();
    for (const p of players) {
      if (!this.standing(p) || !p.interact || p.vehicle || busy.has(p.id)) continue;
      let best: PropRuntime | null = null;
      let bestD: number = PROP_REACH;
      for (const pr of this.props.values()) {
        if (!this.propUsable(pr)) continue;
        const d = Math.hypot(pr.def.x - p.sim.x, pr.def.y - p.sim.y);
        if (d <= bestD) {
          bestD = d;
          best = pr;
        }
      }
      if (!best) continue;
      // One holder at a time: the first one keeps it.
      if (best.by && best.by !== p.id && held.has(best.def.id)) continue;
      held.add(best.def.id);
      best.by = p.id;
      best.prog = Math.min(1, best.prog + holdTime(p) / Math.max(0.05, best.def.holdSec));
      if (best.def.noise && this.sim.tick - best.lastNoiseTick >= this.secTicks(1)) {
        best.lastNoiseTick = this.sim.tick;
        this.zw.noise(best.def.x, best.def.y, best.def.noise);
      }
      if (best.prog >= 1) {
        best.used = true;
        best.by = "";
        if (best.def.sets) this.flags.add(best.def.sets);
        this.emit({ t: "pve", k: "prop", s: best.def.id });
      }
    }
    for (const pr of this.props.values()) if (!held.has(pr.def.id)) pr.by = "";
  }

  // ------------------------------------------------------------------ loot and supplies

  private dropLoot(kind: LootRuntime["kind"], x: number, y: number): void {
    const id = `l${this.nextLoot++}`;
    this.loot.set(id, {
      id,
      kind,
      x,
      y,
      until: kind === "supply" ? 0 : this.sim.tick + this.secTicks(LOOT_SEC),
      takenBy: new Set(),
      uses: kind === "supply" ? this.squadSize : 1,
      prog: new Map(),
    });
  }

  /** A supply crate near the squad (at a walkable spot, away from enemies when possible). */
  private dropSupply(near?: Vec2): void {
    const standing = [...this.sim.players.values()].filter((p) => this.standing(p));
    const c = near ?? (standing[0] ? { x: standing[0].sim.x, y: standing[0].sim.y } : this.checkpoint);
    if (!c) return;
    const p = randomWalkableNear(this.grid, 2, c.x, c.y, 160, () => this.rng(), 20) ?? c;
    this.dropLoot("supply", p.x, p.y);
    this.emit({ t: "pve", k: "supply" });
  }

  private updateLoot(): void {
    for (const [id, l] of this.loot) {
      if (l.until > 0 && this.sim.tick >= l.until) {
        this.loot.delete(id);
        continue;
      }
      for (const p of this.sim.players.values()) {
        if (!this.standing(p) || p.vehicle) continue;
        const d = Math.hypot(l.x - p.sim.x, l.y - p.sim.y);
        if (l.kind === "supply") {
          if (d > PROP_REACH || !p.interact || l.takenBy.has(p.id)) continue;
          const prog = (l.prog.get(p.id) ?? 0) + holdTime(p) / SUPPLY_HOLD_SEC;
          l.prog.set(p.id, prog);
          if (prog < 1) continue;
          l.takenBy.add(p.id);
          p.hp = PLAYER.maxHealth;
          for (const sl of p.sim.slots) {
            const w = weaponByIndex(sl.id);
            if (w && w.reserveAmmo >= 0) {
              sl.reserve = w.reserveAmmo;
              sl.mag = w.magSize;
            }
          }
          this.emit({ t: "pickup", p: p.id, id, kind: "supply" });
          if (l.takenBy.size >= l.uses) this.loot.delete(id);
          break;
        }
        if (d > LOOT_REACH) continue;
        if (l.kind === "health" && p.hp >= PLAYER.maxHealth) continue;
        if (l.kind === "health") p.hp = Math.min(PLAYER.maxHealth, p.hp + 25);
        else if (!addAmmo(p, 0.5)) continue;
        this.emit({ t: "pickup", p: p.id, id, kind: l.kind });
        this.loot.delete(id);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ mission script

  get step_(): StepDef | null {
    return this.mission?.steps[this.stepIndex] ?? null;
  }

  private zonePoints(ids?: readonly string[]): Vec2[] {
    const zones = this.mission?.spawnZones ?? [];
    const list = ids ? zones.filter((z) => ids.includes(z.id)) : zones;
    return list.map((z) => ({ x: z.x, y: z.y }));
  }

  private applyTriggers(list: readonly Trigger[] | undefined): void {
    for (const t of list ?? []) {
      if ("open" in t) this.setDoor(t.open, true);
      else if ("close" in t) this.setDoor(t.close, false);
      else if ("power" in t) this.power = t.power;
      else if ("alarm" in t) this.alarm = t.alarm;
      else if ("spawn" in t) this.spawnGroup(t.spawn);
      else if ("hint" in t) this.emit({ t: "pve", k: "hint", s: t.hint });
      else if ("supply" in t) this.dropSupply(t.supply);
      else if ("checkpoint" in t) this.checkpoint = { ...t.checkpoint };
    }
  }

  private spawnGroup(id: string): void {
    const g = this.mission?.groups.find((x) => x.id === id);
    if (!g) return;
    for (const e of g.enemies) this.zw.spawn(e.kind, e.x, e.y, { state: e.state ?? "idle", group: id });
  }

  private startStep(i: number, announce = true): void {
    const m = this.mission!;
    this.stepIndex = i;
    this.stepProg = 0;
    this.count = 0;
    this.countMax = 0;
    this.waveInStep = 0;
    const s = m.steps[i]!;
    for (const pr of this.props.values()) pr.active = false;
    if (s.kind === "interact") {
      const pr = this.props.get(s.prop);
      if (pr) pr.active = true;
    } else if (s.kind === "collect") {
      for (const id of s.props) {
        const pr = this.props.get(id);
        if (pr) pr.active = true;
      }
      this.countMax = s.props.length;
    } else if (s.kind === "waves") {
      this.countMax = s.waves.length;
      this.nextWaveTick = this.sim.tick + this.secTicks(2.5);
    } else if (s.kind === "extract" && s.horde) {
      this.waveNumber++;
      const run = this.waves.start(
        s.horde,
        this.waveNumber,
        this.zonePoints(s.horde.zones),
        this.squadSize,
        this.squad,
        this.diff,
      );
      this.emit({ t: "pve", k: "wave", n: run.number, s: run.label });
    }
    this.applyTriggers(s.onStart);
    if (announce) this.emit({ t: "pve", k: "step", n: i });
    if (s.hint) this.emit({ t: "pve", k: "hint", s: s.hint });
  }

  private completeStep(): void {
    const m = this.mission!;
    const s = m.steps[this.stepIndex]!;
    this.applyTriggers(s.onDone);
    this.progress = this.stepIndex + 1;
    this.respawnDead();
    if (this.stepIndex + 1 >= m.steps.length) {
      this.waves.stop();
      this.finish(PVE_STATUS.COMPLETE);
      return;
    }
    this.startStep(this.stepIndex + 1);
  }

  private inArea(p: ServerPlayer, r: Rect): boolean {
    return p.sim.x >= r.x && p.sim.x <= r.x + r.w && p.sim.y >= r.y && p.sim.y <= r.y + r.h;
  }

  private updateMission(): void {
    const s = this.step_;
    if (!s) return;
    const players = [...this.sim.players.values()];
    switch (s.kind) {
      case "reach":
        if (players.some((p) => this.standing(p) && this.inArea(p, s.area))) this.completeStep();
        break;
      case "interact": {
        const pr = this.props.get(s.prop);
        this.stepProg = pr?.prog ?? 0;
        if (pr?.used) this.completeStep();
        break;
      }
      case "collect": {
        this.count = s.props.filter((id) => this.props.get(id)?.used).length;
        const holding = s.props.map((id) => this.props.get(id)).find((pr) => pr?.by);
        this.stepProg = holding?.prog ?? 0;
        if (this.count >= s.props.length) this.completeStep();
        break;
      }
      case "kill": {
        const left = [...this.zw.zombies.values()].filter((z) => !z.dead && z.group === s.group).length;
        this.count = left;
        if (left === 0) this.completeStep();
        break;
      }
      case "waves":
        this.updateWaveStep(s);
        break;
      case "extract": {
        const alive = players.filter((p) => p.alive && p.connected);
        const standing = alive.filter((p) => !p.pve.downed);
        const allIn = standing.length > 0 && alive.every((p) => this.inArea(p, s.area));
        const dt = 1 / this.tickRate;
        this.stepProg = allIn
          ? Math.min(1, this.stepProg + dt / s.holdSec)
          : Math.max(0, this.stepProg - dt / (s.holdSec * 4));
        if (this.stepProg >= 1) this.completeStep();
        break;
      }
    }
    // Ambient trickle outside scripted waves.
    const amb = this.mission?.ambient;
    if (amb && s.kind !== "waves" && this.sim.tick >= this.nextAmbientTick) {
      this.nextAmbientTick =
        this.sim.tick + this.secTicks(amb.everySec * this.diff.spawnInterval * this.squad.spawnInterval);
      const ambientAlive = [...this.zw.zombies.values()].filter(
        (z) => !z.dead && z.group === "ambient",
      ).length;
      if (ambientAlive < amb.maxAlive * Math.min(2, this.squad.density)) {
        const kind = amb.kinds[Math.floor(this.rng() * amb.kinds.length)]!;
        const at = this.waves.findSpawn(kind, this.zonePoints(amb.zones));
        const standing = players.filter((p) => this.standing(p));
        const target = standing[Math.floor(this.rng() * standing.length)];
        if (at && target) {
          const z = this.zw.spawn(kind, at.x, at.y, { state: "wander", group: "ambient" });
          // They heard something: they come to look, they do not know exactly where you are.
          z.lastKnownX = target.sim.x;
          z.lastKnownY = target.sim.y;
          z.state = AI.INVESTIGATE;
        }
      }
    }
  }

  private updateWaveStep(s: Extract<StepDef, { kind: "waves" }>): void {
    const run = this.waves.run;
    if (!run || this.waves.done) {
      if (run && this.waves.done) {
        // Wave cleared.
        this.emit({ t: "pve", k: "clear", n: run.number });
        if (run.supply) this.dropSupply();
        this.respawnDead();
        this.waves.stop();
        this.waveInStep++;
        this.count = this.waveInStep;
        if (this.waveInStep >= s.waves.length) {
          this.completeStep();
          return;
        }
        this.nextWaveTick = this.sim.tick + this.secTicks(s.intermissionSec ?? 8);
        return;
      }
      if (this.sim.tick >= this.nextWaveTick && this.nextWaveTick > 0) {
        const def = s.waves[this.waveInStep]!;
        this.waveNumber++;
        const started = this.waves.start(
          def,
          this.waveNumber,
          this.zonePoints(def.zones),
          this.squadSize,
          this.squad,
          this.diff,
        );
        this.nextWaveTick = 0;
        this.emit({ t: "pve", k: "wave", n: started.number, s: started.label });
      }
    }
  }

  // ------------------------------------------------------------------ survival

  private updateSurvival(): void {
    const run = this.waves.run;
    if (run && this.waves.done) {
      this.emit({ t: "pve", k: "clear", n: run.number });
      this.progress = run.number;
      if (run.supply) this.dropSupply();
      this.respawnDead();
      this.waves.stop();
      this.nextWaveTick = this.sim.tick + this.secTicks(SURVIVAL.intermissionSec);
      return;
    }
    if (!run && this.nextWaveTick > 0 && this.sim.tick >= this.nextWaveTick) {
      this.waveNumber++;
      const def = survivalWave(this.waveNumber);
      const zones = this.mission ? this.zonePoints(def.zones) : [];
      const started = this.waves.start(def, this.waveNumber, zones, this.squadSize, this.squad, this.diff);
      this.nextWaveTick = 0;
      this.emit({ t: "pve", k: "wave", n: started.number, s: started.label });
    }
  }

  // ------------------------------------------------------------------ combat hooks

  /** Enemies as hit targets for a shot (positions as the shooter saw them). */
  shotTargets(pos: (z: Zombie) => Vec2): HitTarget[] {
    const out: HitTarget[] = [];
    for (const z of this.zw.zombies.values()) {
      if (z.dead) continue;
      const at = pos(z);
      out.push({ id: `z:${z.id}`, x: at.x, y: at.y, r: z.def.radius });
    }
    return out;
  }

  damageZombie(id: string, raw: number, by: ServerPlayer, precise: boolean, x: number, y: number): void {
    const z = this.zw.zombies.get(id);
    if (!z || z.dead) return;
    const dealt = this.zw.damage(z, raw, by.id, precise, x, y, true);
    by.stats.damageDealt += dealt;
  }

  /** Vehicles plough through enemies (credited to the driver). */
  vehicleContacts(v: ServerVehicle, credit: ServerPlayer | null): void {
    const speed = Math.hypot(v.sim.vx, v.sim.vy);
    for (const z of this.zw.zombies.values()) {
      if (z.dead) continue;
      const c = closestOnBody(v.sim, v.def, z.x, z.y);
      if (!c.inside && c.dist >= z.def.radius) continue;
      const nx = c.dist > 1e-3 ? (z.x - c.x) / c.dist : Math.cos(v.sim.angle + Math.PI / 2);
      const ny = c.dist > 1e-3 ? (z.y - c.y) / c.dist : Math.sin(v.sim.angle + Math.PI / 2);
      z.x = c.x + nx * (z.def.radius + 1);
      z.y = c.y + ny * (z.def.radius + 1);
      const closing = v.sim.vx * nx + v.sim.vy * ny;
      if (closing < v.def.ramMinSpeed || speed < v.def.ramMinSpeed) continue;
      const dmg = ((closing - v.def.ramMinSpeed) * v.def.ramFactor * 3) / Math.sqrt(z.def.mass);
      z.vx += nx * closing * 0.6;
      z.vy += ny * closing * 0.6;
      this.zw.damage(z, dmg, credit?.id ?? "", false, z.x, z.y, true);
      // Ploughing through a crowd costs speed (and a brute hurts the hull).
      v.sim.vx *= 1 - 0.04 * z.def.mass;
      v.sim.vy *= 1 - 0.04 * z.def.mass;
      if (z.def.mass >= 3) this.sim.damageVehicle(v, closing * 0.08, null, z.x, z.y);
    }
  }

  /** A vehicle explosion hurts enemies around it. */
  blast(x: number, y: number, radius: number, damage: number, credit: ServerPlayer | null): void {
    for (const z of this.zw.zombies.values()) {
      if (z.dead) continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d > radius + z.def.radius) continue;
      this.zw.damage(
        z,
        damage * (1 - Math.min(1, d / radius) * 0.6),
        credit?.id ?? "",
        false,
        z.x,
        z.y,
        true,
      );
    }
  }

  // ------------------------------------------------------------------ results

  /** Squad summary and per-player XP lines (authoritative counters only). */
  results(minParticipationTicks: number): {
    result: PveResult;
    xp: Map<string, { total: number; lines: XpLine[] }>;
  } {
    const completed = this.status === PVE_STATUS.COMPLETE;
    const timeSec = Math.round(((this.endTick || this.sim.tick) - this.startTick) / this.tickRate);
    const squad: PveSquadRow[] = [];
    const xp = new Map<string, { total: number; lines: XpLine[] }>();
    const mult = this.diff.xp;
    for (const p of this.sim.players.values()) {
      squad.push({
        id: p.id,
        name: p.name,
        kills: p.stats.kills,
        damage: p.stats.damageDealt,
        revives: p.pve.revives,
        downs: p.pve.downs,
        accuracy: p.stats.shotsFired > 0 ? p.stats.shotsHit / p.stats.shotsFired : null,
      });
      const lines: XpLine[] = [];
      if (p.stats.activeTicks >= minParticipationTicks) {
        if (this.mission) {
          if (completed)
            lines.push({ reason: `${this.mission.name} completed`, xp: Math.round(this.mission.xp * mult) });
          else if (this.progress > 0)
            lines.push({
              reason: `Objectives completed (${this.progress})`,
              xp: Math.round(this.progress * 60 * mult),
            });
        } else if (this.progress > 0) {
          lines.push({
            reason: `Waves survived (${this.progress})`,
            xp: Math.round(this.progress * 35 * mult),
          });
        }
        const k = Math.min(p.stats.kills, 200);
        if (k > 0)
          lines.push({ reason: `Infected eliminated (${p.stats.kills})`, xp: Math.round(k * 2 * mult) });
        const rv = Math.min(p.pve.revives, 6);
        if (rv > 0) lines.push({ reason: `Teammates revived (${p.pve.revives})`, xp: rv * 25 });
      }
      xp.set(p.id, {
        total: Math.min(
          4000,
          lines.reduce((s, l) => s + l.xp, 0),
        ),
        lines,
      });
    }
    squad.sort((a, b) => b.kills - a.kills || b.revives - a.revives);
    const result: PveResult = {
      mode: this.mode,
      mission: this.mission?.id ?? "",
      difficulty: this.difficultyId,
      completed,
      ...(this.failReason ? { reason: this.failReason } : {}),
      timeSec,
      progress: this.progress,
      steps: this.mission?.steps.length ?? 0,
      kills: this.kills,
      squad,
    };
    return { result, xp };
  }
}

/** Seconds of interact held this tick, measured in input frames (60 per second). */
function holdTime(p: ServerPlayer): number {
  return p.interactFrames / NET.inputRate;
}

/** Adds a fraction of every carried weapon's full reserve (loot drops). */
function addAmmo(p: ServerPlayer, fraction: number): boolean {
  let changed = false;
  for (const sl of p.sim.slots) {
    const w = weaponByIndex(sl.id);
    if (!w || w.reserveAmmo < 0 || sl.reserve >= w.reserveAmmo) continue;
    sl.reserve = Math.min(w.reserveAmmo, sl.reserve + Math.ceil(w.reserveAmmo * fraction));
    changed = true;
  }
  return changed;
}
