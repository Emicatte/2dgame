import {
  AIRBORNE_ALT,
  airWorldFor,
  BTN,
  CHEST_RESPAWN_SEC,
  type Circle,
  type CollisionWorld,
  canDamage,
  clamp,
  closestOnBody,
  collisionWorldFor,
  createPlayerSim,
  createVehicleSim,
  DROPS,
  damageAtDistance,
  distSq,
  ENTER_REACH,
  findExitSpot,
  fullSlot,
  type GameMode,
  type HitTarget,
  hasLineOfSight,
  type InputFrame,
  inSector,
  isFreeSpot,
  KILL_BY_EXPLOSION,
  KILL_BY_VEHICLE,
  lerpAngle,
  type MapDef,
  modeScoresObjectives,
  NET,
  type NetEvent,
  NO_WEAPON,
  OBJECTIVES,
  objectivesFor,
  type PickupDef,
  PLAYER,
  type PlayerSim,
  PRECISION_DAMAGE_MULT,
  PRECISION_RADIUS_FRACTION,
  RAM_COOLDOWN_SEC,
  RAM_CREDIT_SEC,
  refillAmmo,
  resolveCircle,
  rollChestWeapon,
  type SeatDef,
  SHIELD,
  type ShotIntent,
  type SimEvent,
  SLOT_PICKUP,
  seatWorld,
  shotWorldFor,
  stepPlayer,
  stepVehicle,
  takeWeapon,
  teamSpawns,
  tracePellet,
  VEHICLES,
  type VehicleDef,
  type VehicleSim,
  type VehicleSpawnDef,
  type VehicleStepResult,
  vehicleCircles,
  vehicleSpeed,
  WEAPONS,
  type WeaponId,
  type WeaponSlotState,
  weaponByIndex,
} from "@scrapline/shared";
import { createModeController } from "../modes/index.ts";
import type { ModeController, ObjectHit } from "../modes/ModeController.ts";
import {
  emptyPvePlayer,
  type PveConfig,
  PveController,
  type PvePlayer,
  shotNoise,
} from "../pve/PveController.ts";

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
  /** Objective play: point captures taken part in, flags returned, flags captured. */
  captures: number;
  returns: number;
  flagCaptures: number;
  /** Enemy vehicles wrecked. */
  vehicleKills: number;
}

export interface ServerPlayer {
  id: string;
  playerId: string;
  name: string;
  /** 0 = no team (free for all), 1 = Alpha, 2 = Bravo. Set by the room. */
  team: number;
  skin: string;
  level: number;
  primary: WeaponId;
  seed: number;
  sim: PlayerSim;
  alive: boolean;
  hp: number;
  /** Shield points: absorb damage before health. */
  shield: number;
  /** Shield cells carried, used with BTN.SHIELD. */
  cells: number;
  respawnTick: number;
  protectedUntil: number;
  queue: InputFrame[];
  lastQueuedSeq: number;
  lastProcessedSeq: number;
  credit: number;
  /** Smallest queue length left after a tick in the current standing-queue window. */
  queueFloor: number;
  queueFloorTicks: number;
  interact: boolean;
  /**
   * Input frames (1/60 s each) this tick in which interact was held. Holds (revives, mission props)
   * advance by input time, not by server ticks, so bursty delivery at low frame rates or on a
   * jittery link neither slows nor speeds them up.
   */
  interactFrames: number;
  /** Interact was pressed (not just held) this tick: picks up one item from the ground. */
  interactPress: boolean;
  /** Left the running match but still in the room: out until the next match. */
  away: boolean;
  connected: boolean;
  joinedTick: number;
  /** Buttons of the previous applied frame (edge detection for enter / exit / seat change). */
  prevButtons: number;
  /** Vehicle the player sits in (null on foot) and the seat index. */
  vehicle: string | null;
  seat: number;
  /** Weapon in the pickup slot while a mounted gun occupies it, and the slot that was active. */
  stash: WeaponSlotState | null;
  stashSlot: number;
  /** Input pipeline counters (diagnostics; never affect the simulation). */
  inputStats: InputStats;
  stats: PlayerMatchStats;
  /** PvE: downed / revive state and co-op counters. */
  pve: PvePlayer;
}

/** Per-player input pipeline counters, cumulative since the player joined the room. */
export interface InputStats {
  /** Input messages received. */
  messages: number;
  /** Frames received in input messages. */
  received: number;
  /** Frames accepted into the queue. */
  accepted: number;
  /** Frames rejected because their sequence number was not newer than the last queued one. */
  duplicate: number;
  /** Oldest frames evicted because the queue was full. */
  overflow: number;
  /** Oldest frames dropped because the queue never drained (standing latency after a stall). */
  trimmed: number;
  /** Frames applied to the simulation (their seq is what the client sees as `ack`). */
  processed: number;
  /** Largest queue length left after a tick. */
  queueMax: number;
}

export const emptyInputStats = (): InputStats => ({
  messages: 0,
  received: 0,
  accepted: 0,
  duplicate: 0,
  overflow: 0,
  trimmed: 0,
  processed: 0,
  queueMax: 0,
});

/**
 * Removes the `count` oldest frames. A weapon-slot change is a one-shot command, so the newest one
 * among the removed frames is carried into the new head instead of being lost.
 */
function dropFront(queue: InputFrame[], count: number): void {
  const removed = queue.splice(0, count);
  const head = queue[0];
  if (!head || head.slot >= 0) return;
  for (let i = removed.length - 1; i >= 0; i--) {
    if (removed[i]!.slot >= 0) {
      queue[0] = { ...head, slot: removed[i]!.slot };
      return;
    }
  }
}

export interface NewPlayer {
  id: string;
  playerId: string;
  name: string;
  team?: number;
  skin: string;
  level: number;
  primary: WeaponId;
  seed: number;
}

interface HistoryFrame {
  tick: number;
  pos: Map<string, { x: number; y: number; alive: boolean }>;
  vehicles: Map<string, VehiclePose>;
  /** PvE enemies (lag compensation of shots at them). */
  zombies: Map<string, { x: number; y: number }> | null;
}

export interface VehiclePose {
  x: number;
  y: number;
  angle: number;
  alt: number;
  ready: boolean;
}

export const VEHICLE_READY = 0;
export const VEHICLE_WRECK = 1;
export const VEHICLE_GONE = 2;

export interface ServerVehicle {
  id: string;
  def: VehicleDef;
  spawn: VehicleSpawnDef;
  sim: VehicleSim;
  hp: number;
  /** PvE: out of use (a mission locks it, e.g. while it is being repaired): nobody gets in. */
  locked?: boolean;
  /** VEHICLE_READY, VEHICLE_WRECK or VEHICLE_GONE. */
  status: number;
  /** Tick of the next status change (wreck clears, respawn). */
  statusTick: number;
  /** Occupant ids by seat. */
  seats: (string | null)[];
  /** Real-time step credit while nobody drives (the vehicle coasts / lands on its own). */
  credit: number;
  lastDriver: string | null;
  lastDriverTick: number;
  lastAttacker: string | null;
  lastAttackTick: number;
  /** Contact cooldowns: other party id → first tick a new hit may land. */
  contacts: Map<string, number>;
}

interface PickupRuntime {
  def: PickupDef;
  active: boolean;
  respawnTick: number;
}

/** An item on the ground: chest loot or a swapped-out weapon (with the ammo it had). */
export interface Drop {
  kind: "weapon" | "shield" | "ammo";
  weapon: WeaponId | null;
  mag: number;
  reserve: number;
  x: number;
  y: number;
  expiresTick: number;
}

export type StepMode = "frozen" | "live";

export interface SimOptions {
  tickRate: number;
  rng?: () => number;
}

/** Combat rules the room sets from the match settings. */
export interface CombatRules {
  /** Team mode: spawns per team, team score. */
  teams: boolean;
  /** Team mode: teammates can hurt each other. */
  friendlyFire: boolean;
}

const HEALTH_PICKUP = 50;
/** Wall impacts above this speed (px/s) damage the vehicle. */
const CRASH_MIN_SPEED = 260;
const CRASH_DAMAGE_PER_SPEED = 0.35;
/** Vehicle-vs-vehicle contacts above this closing speed damage both. */
const COLLIDE_MIN_SPEED = 150;
const COLLIDE_DAMAGE_PER_SPEED = 0.4;
/** Wrecks burn for this long before they disappear and the respawn timer starts. */
const WRECK_SEC = 5;
const EXPLOSION_RADIUS = 130;
const EXPLOSION_DAMAGE = 70;
/** Server tolerance on the client's fire-sector check (anti-cheat only; the client strips first). */
const SECTOR_TOLERANCE = 0.3;
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
    captures: 0,
    returns: 0,
    flagCaptures: 0,
    vehicleKills: 0,
  };
}

export interface PointRuntime {
  id: string;
  label: string;
  x: number;
  y: number;
  /** 0 neutral, 1 Alpha, 2 Bravo. */
  owner: number;
  /** -1 (Bravo) … 1 (Alpha). */
  progress: number;
}

export interface FlagRuntime {
  team: 1 | 2;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  carrier: string | null;
  home: boolean;
  returnTick: number;
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
  readonly drops = new Map<string, Drop>();
  private dropSeq = 0;
  readonly vehicles = new Map<string, ServerVehicle>();
  airWorld: CollisionWorld;
  /** What bullets meet at ground level (water and fences only stop movement). */
  shotWorld: CollisionWorld;
  firstBloodDone = false;
  rules: CombatRules = { teams: false, friendlyFire: false };
  mode: GameMode = "deathmatch";
  points: PointRuntime[] = [];
  flags: FlagRuntime[] = [];
  private domTicks = 0;
  /** Team scores indexed by team id (index 0 unused). */
  readonly teamScores: [number, number, number] = [0, 0, 0];
  /** Test-only fixed spawn list (enabled exclusively with ENABLE_DEBUG_ROUTES). */
  spawnOverride: { x: number; y: number }[] | null = null;
  /** Test-only vehicle placement replacing the map's (same gate). */
  private vehicleOverride: VehicleSpawnDef[] | null = null;
  /** PvE runtime (Outbreak, Survival); null in competitive modes. */
  pve: PveController | null = null;
  /**
   * Mode controller (Gun Game, Hide & Seek, Prop Hunt): every rule of those modes lives there.
   * null for the modes built into this class (Deathmatch, TDM, Domination, CTF, Mayhem) and PvE.
   */
  ctl: ModeController | null = null;
  private events: NetEvent[] = [];
  private readonly history: HistoryFrame[] = [];
  private readonly tickRate: number;
  readonly rng: () => number;

  constructor(map: MapDef, opts: SimOptions) {
    this.map = map;
    this.world = collisionWorldFor(map);
    this.airWorld = airWorldFor(map);
    this.shotWorld = shotWorldFor(map);
    this.tickRate = opts.tickRate;
    this.rng = opts.rng ?? Math.random;
    this.resetPickups();
    this.resetVehicles();
  }

  get tickRateHz(): number {
    return this.tickRate;
  }

  /**
   * Turns the PvE runtime on (mission or Survival) or off. The room calls it when the match
   * starts; the next resetForMatch() prepares the run.
   */
  setPve(cfg: PveConfig | null): void {
    this.pve = cfg ? new PveController(this, cfg) : null;
    if (!cfg) {
      this.world = collisionWorldFor(this.map);
      this.shotWorld = shotWorldFor(this.map);
    }
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
    this.airWorld = airWorldFor(map);
    this.shotWorld = shotWorldFor(map);
    this.history.length = 0;
    this.resetPickups();
    this.resetVehicles();
    this.resetObjectives();
  }

  /** Mode objectives (Domination points, CTF flags) and the mode controller for the current map. */
  setMode(mode: GameMode): void {
    this.mode = mode;
    this.ctl = createModeController(mode, this);
    this.resetObjectives();
    this.resetPickups();
    for (const p of this.players.values()) this.leaveVehicle(p, true);
    this.resetVehicles();
  }

  /** Adds a gameplay event to this tick's batch (mode controllers). */
  pushEvent(ev: NetEvent): void {
    this.events.push(ev);
  }

  /** Events of this tick a given viewer may receive (hidden-information modes filter them). */
  eventsFor(viewerId: string, events: readonly NetEvent[]): NetEvent[] {
    const ctl = this.ctl;
    if (!ctl?.hiddenInfo) return events as NetEvent[];
    return events.filter((e) => ctl.eventVisible(viewerId, e));
  }

  /** Why the mode ends the match now, or null. */
  modeOver(): string | null {
    return this.ctl?.over() ?? null;
  }

  /** Real position of a player as a client rendering `viewTick` saw it (lag compensation). */
  playerPoseAt(id: string, viewTick: number): { x: number; y: number; alive: boolean } | null {
    return this.rewind(viewTick).get(id) ?? null;
  }

  resetObjectives(): void {
    const o = objectivesFor(this.map);
    this.domTicks = 0;
    this.points =
      this.mode === "dom"
        ? o.points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, owner: 0, progress: 0 }))
        : [];
    this.flags =
      this.mode === "ctf"
        ? ([1, 2] as const).map((team) => ({
            team,
            homeX: o.flags[team].x,
            homeY: o.flags[team].y,
            x: o.flags[team].x,
            y: o.flags[team].y,
            carrier: null,
            home: true,
            returnTick: 0,
          }))
        : [];
  }

  private resetPickups(): void {
    this.pickups.clear();
    this.drops.clear();
    for (const def of this.map.pickups) {
      // A mode may switch pickup kinds off (Gun Game: no weapon pickups); they never come back.
      const allowed = this.ctl?.pickupAllowed(def.kind) ?? true;
      this.pickups.set(def.id, { def, active: allowed, respawnTick: allowed ? 0 : Number.MAX_SAFE_INTEGER });
    }
  }

  addPlayer(init: NewPlayer): ServerPlayer {
    const spawn = this.map.spawns[0]!;
    const p: ServerPlayer = {
      ...init,
      team: init.team ?? 0,
      sim: createPlayerSim(spawn.x, spawn.y, init.primary),
      alive: false,
      hp: 0,
      shield: 0,
      cells: 0,
      respawnTick: 0,
      protectedUntil: 0,
      queue: [],
      lastQueuedSeq: 0,
      lastProcessedSeq: 0,
      credit: 0,
      queueFloor: Number.POSITIVE_INFINITY,
      queueFloorTicks: 0,
      interact: false,
      interactFrames: 0,
      interactPress: false,
      away: false,
      connected: true,
      joinedTick: this.tick,
      prevButtons: 0,
      vehicle: null,
      seat: -1,
      stash: null,
      stashSlot: 0,
      inputStats: emptyInputStats(),
      stats: emptyStats(),
      pve: emptyPvePlayer(),
    };
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id: string): ServerPlayer | undefined {
    const p = this.players.get(id);
    if (p) this.leaveVehicle(p, true);
    if (p) this.dropFlag(p);
    this.players.delete(id);
    if (p) this.ctl?.onLeave(p);
    return p;
  }

  /**
   * Queues validated inputs. Frames whose sequence number is not newer than the last queued one
   * (duplicates, replays) are dropped; the queue is bounded and evicts its oldest frames, so a
   * misbehaving client can neither replay inputs nor exhaust memory, and the newest intent wins.
   */
  enqueue(id: string, frames: readonly InputFrame[]): { accepted: number; dropped: number } {
    const p = this.players.get(id);
    if (!p) return { accepted: 0, dropped: frames.length };
    let accepted = 0;
    let dropped = 0;
    p.inputStats.messages++;
    p.inputStats.received += frames.length;
    for (const f of frames) {
      if (f.seq <= p.lastQueuedSeq) {
        dropped++;
        p.inputStats.duplicate++;
        continue;
      }
      if (p.queue.length >= NET.maxQueuedInputs) {
        dropFront(p.queue, 1);
        dropped++;
        p.inputStats.overflow++;
      }
      // Never trust the view tick beyond what the server has actually sent.
      const viewTick = clamp(f.viewTick, Math.max(0, this.tick - this.maxRewindTicks), this.tick);
      p.queue.push({ ...f, viewTick });
      p.lastQueuedSeq = f.seq;
      accepted++;
    }
    p.inputStats.accepted += accepted;
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
    p.queueFloor = Number.POSITIVE_INFINITY;
    p.queueFloorTicks = 0;
  }

  /** Clears match stats and spawns everybody at distinct spawn points. */
  resetForMatch(): void {
    this.firstBloodDone = false;
    this.teamScores[1] = 0;
    this.teamScores[2] = 0;
    this.resetPickups();
    for (const p of this.players.values()) this.leaveVehicle(p, true);
    this.resetVehicles();
    this.resetObjectives();
    this.history.length = 0;
    this.pve?.reset();
    for (const p of this.players.values()) {
      p.stats = emptyStats();
      p.joinedTick = this.tick;
      p.alive = false;
      p.away = false;
    }
    // PREPARING: the mode assigns sides and rounds before anybody spawns.
    this.ctl?.reset();
    for (const p of this.players.values()) this.spawn(p, true);
  }

  spawnLater(p: ServerPlayer, delaySec: number): void {
    this.leaveVehicle(p, true);
    p.alive = false;
    // Round modes: a newcomer watches until the next round.
    if (this.ctl && !this.ctl.allowJoinSpawn(p)) {
      p.respawnTick = 0;
      return;
    }
    p.respawnTick = this.tick + Math.max(1, this.secToTicks(delaySec));
  }

  /** Advances one server tick. `elapsedMs` is real time since the previous tick. */
  step(elapsedMs: number, mode: StepMode): NetEvent[] {
    this.tick += 1;
    // Events raised between ticks (mode abilities handled as messages) go out with this tick.
    const elapsedSec = clamp(elapsedMs, 0, 1000) / 1000;
    const creditCap = NET.maxInputCreditSeconds * NET.inputRate;
    const tickInputs = elapsedSec * NET.inputRate;
    const perTickMax = Math.max(1, Math.ceil(tickInputs * NET.inputCatchUpRate));
    const floorWindowTicks = Math.max(1, Math.round(NET.standingQueueWindowSec * this.tickRate));

    // A disconnected occupant leaves the vehicle at once: a frozen driver must not hold the car.
    for (const p of this.players.values()) if (!p.connected && p.vehicle) this.leaveVehicle(p, true);

    for (const p of this.players.values()) {
      p.interact = false;
      p.interactFrames = 0;
      p.interactPress = false;
      // Inputs are consumed at real-time rate. Credit accrues with real elapsed time (so a stalled
      // server catches up); idle time is banked only while the queue is empty and only up to
      // maxInputCreditSeconds, which is what stops a modified client from moving faster than real
      // time. A backlog is consumed at most inputCatchUpRate times faster than real time.
      p.credit += tickInputs;
      let n = 0;
      while (p.queue.length > 0 && p.credit >= 1 && n < perTickMax) {
        const frame = p.queue.shift()!;
        p.credit -= 1;
        n++;
        this.applyInput(p, frame, mode === "live");
      }
      if (p.queue.length === 0) p.credit = Math.min(p.credit, creditCap);
      if (p.queue.length > p.inputStats.queueMax) p.inputStats.queueMax = p.queue.length;
      // Standing queue: inputs that arrived after a stall beyond what the bank covers would add
      // latency forever (arrivals equal consumption). If the queue never drains below the target
      // for a whole window, drop the oldest excess frames; the client reconciles the difference.
      p.queueFloor = Math.min(p.queueFloor, p.queue.length);
      if (++p.queueFloorTicks >= floorWindowTicks) {
        const excess = p.queueFloor - NET.standingQueueFrames;
        if (excess > 0) {
          dropFront(p.queue, excess);
          p.inputStats.trimmed += excess;
        }
        p.queueFloor = Number.POSITIVE_INFINITY;
        p.queueFloorTicks = 0;
      }
      if (mode === "live" && p.connected) p.stats.activeTicks += 1;
    }

    this.stepUndrivenVehicles(tickInputs, perTickMax, mode === "live");
    this.pinOccupants();
    if (mode === "live") {
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnTick > 0 && this.tick >= p.respawnTick) this.spawn(p, false);
      }
      this.updatePickups();
      this.updateDrops();
      this.updateVehicleLifecycle();
      this.updateObjectives();
      this.pve?.step();
      this.ctl?.step();
    }
    if (this.pve) for (const e of this.pve.drainEvents()) this.events.push(e);
    this.recordHistory();
    const out = this.events;
    this.events = [];
    return out;
  }

  private applyInput(p: ServerPlayer, frame: InputFrame, live: boolean): void {
    const canAct = live && p.alive && !(this.ctl?.frozen(p) ?? false);
    const downed = p.pve.downed;
    const pressed = frame.buttons & ~p.prevButtons;
    p.prevButtons = frame.buttons;
    const shots: { shot: ShotIntent; view: number }[] = [];
    const emit = (e: SimEvent) => {
      if (e.kind === "shot") shots.push({ shot: e.shot, view: frame.viewTick });
      else if (e.kind === "reloadStart") this.events.push({ t: "reload", p: p.id, w: e.weapon });
      else if (e.kind === "dash") this.events.push({ t: "dash", p: p.id });
    };
    const veh = p.vehicle ? this.vehicles.get(p.vehicle) : undefined;
    if (veh && p.seat >= 0) {
      const seat = veh.def.seats[p.seat]!;
      if (p.seat === 0 && canAct && veh.status === VEHICLE_READY) this.driveVehicle(veh, frame, p);
      // Shots leave from the seat as the shooter saw the vehicle (lag compensation of the shooter's
      // own position), and only inside the seat's fire sector.
      const seen = this.vehiclePoseAt(veh, frame.viewTick);
      const at = seatWorld(seen, seat);
      p.sim.x = at.x;
      p.sim.y = at.y;
      const fireOk = seat.arc > 0 && inSector(seat, seen.angle, frame.aim, SECTOR_TOLERANCE);
      const keep = (fireOk ? BTN.FIRE : 0) | BTN.RELOAD;
      const mounted: InputFrame = {
        ...frame,
        mx: 0,
        my: 0,
        buttons: frame.buttons & keep,
        slot: seat.mounted ? -1 : frame.slot,
      };
      stepPlayer(p.sim, mounted, { world: this.world, seed: p.seed, alive: canAct, emit, mounted: true });
      const now = seatWorld(veh.sim, seat);
      p.sim.x = now.x;
      p.sim.y = now.y;
      p.lastProcessedSeq = frame.seq;
      p.inputStats.processed++;
      for (const s of shots) this.resolveShot(p, s.shot, s.view, seen.alt >= AIRBORNE_ALT);
      if (canAct && p.vehicle) {
        if (pressed & BTN.INTERACT) this.leaveVehicle(p, false);
        else if (pressed & BTN.SEAT) this.switchSeat(p, veh);
      }
      return;
    }
    const modeBodies = this.ctl?.obstacles(p);
    stepPlayer(p.sim, frame, {
      world: this.world,
      seed: p.seed,
      alive: canAct,
      emit,
      obstacles: modeBodies?.length
        ? [...this.groundObstacles(null), ...modeBodies]
        : this.groundObstacles(null),
      downed,
      body: this.ctl?.body(p) ?? null,
    });
    let entered = false;
    if (canAct && !downed && (pressed & BTN.INTERACT) !== 0) entered = this.tryEnter(p);
    if (canAct && !downed && !entered && (frame.buttons & BTN.INTERACT) !== 0) {
      p.interact = true;
      p.interactFrames++;
      if ((pressed & BTN.INTERACT) !== 0) p.interactPress = true;
    }
    if (canAct && !downed && (pressed & BTN.SHIELD) !== 0) this.useShieldCell(p);
    p.lastProcessedSeq = frame.seq;
    p.inputStats.processed++;
    for (const s of shots) this.resolveShot(p, s.shot, s.view, false);
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
    const vehicles = new Map<string, VehiclePose>();
    for (const v of this.vehicles.values()) {
      vehicles.set(v.id, {
        x: v.sim.x,
        y: v.sim.y,
        angle: v.sim.angle,
        alt: v.sim.alt,
        ready: v.status === VEHICLE_READY,
      });
    }
    let zombies: Map<string, { x: number; y: number }> | null = null;
    if (this.pve) {
      zombies = new Map();
      for (const z of this.pve.zw.zombies.values()) if (!z.dead) zombies.set(z.id, { x: z.x, y: z.y });
    }
    this.history.push({ tick: this.tick, pos, vehicles, zombies });
    const keep = this.maxRewindTicks + 4;
    if (this.history.length > keep) this.history.splice(0, this.history.length - keep);
  }

  private resolveShot(shooter: ServerPlayer, shot: ShotIntent, viewTick: number, shooterAir: boolean): void {
    const weapon = weaponByIndex(shot.weapon);
    if (!weapon) return;
    shooter.protectedUntil = 0;
    shooter.stats.shotsFired += 1;

    const seen = this.rewind(viewTick);
    const targets: HitTarget[] = [];
    const occupantSeat = new Map<string, SeatDef>();
    for (const t of this.players.values()) {
      if (t.id === shooter.id || !t.alive) continue;
      // Without friendly fire, shots pass through teammates (they never block or absorb them).
      if (!canDamage(shooter, t, this.rules)) continue;
      // Prop Hunt: a disguised player is hit through their object (mode targets below).
      if (this.ctl && !this.ctl.playerTargetable(t)) continue;
      if (t.vehicle) {
        // Occupants are hit only where they are exposed (window, turret, door), and never by
        // somebody riding in the same vehicle.
        const v = this.vehicles.get(t.vehicle);
        const seat = v?.def.seats[t.seat];
        if (!v || !seat || seat.exposure <= 0 || t.vehicle === shooter.vehicle) continue;
        const pose = this.vehiclePoseAt(v, viewTick);
        const at = seatWorld(pose, seat);
        occupantSeat.set(t.id, seat);
        targets.push({
          id: t.id,
          x: at.x,
          y: at.y,
          r: 13,
          air: pose.alt >= AIRBORNE_ALT,
          group: v.id,
          occupant: true,
        });
        continue;
      }
      const past = seen.get(t.id);
      if (past && !past.alive) continue;
      targets.push({ id: t.id, x: past?.x ?? t.sim.x, y: past?.y ?? t.sim.y, r: PLAYER.radius });
    }
    for (const v of this.vehicles.values()) {
      if (v.status !== VEHICLE_READY || v.id === shooter.vehicle) continue;
      if (!canDamage(shooter, { id: `veh:${v.id}`, team: this.vehicleTeam(v) }, this.rules)) continue;
      const pose = this.vehiclePoseAt(v, viewTick);
      if (!pose.ready) continue;
      targets.push({
        id: `veh:${v.id}`,
        x: pose.x,
        y: pose.y,
        r: 0,
        air: pose.alt >= AIRBORNE_ALT,
        body: { angle: pose.angle, def: v.def },
        group: v.id,
      });
    }

    // PvE enemies, where the shooter saw them (same rewind as players).
    if (this.pve) targets.push(...this.pve.shotTargets((z) => this.zombiePoseAt(z.id, viewTick) ?? z));
    // Mode objects (Prop Hunt): real objects and disguised players alike.
    if (this.ctl) targets.push(...this.ctl.shotTargets(shooter, viewTick));

    const damageByTarget = new Map<string, { dmg: number; x: number; y: number; precise: boolean }>();
    const angles: number[] = [];
    const dists: number[] = [];
    const opts = { airWorld: this.airWorld, shooterAir };
    for (const angle of shot.angles) {
      const r = tracePellet(
        this.shotWorld,
        shot.ox,
        shot.oy,
        angle,
        weapon.rangePx,
        targets,
        shooter.id,
        opts,
      );
      angles.push(Math.round(angle * 1000));
      dists.push(Math.round(r.dist));
      if (r.targetId) {
        const prev = damageByTarget.get(r.targetId);
        let dmg = damageAtDistance(weapon, r.dist);
        const hx = shot.ox + Math.cos(angle) * r.dist;
        const hy = shot.oy + Math.sin(angle) * r.dist;
        let precise = false;
        if (r.targetId.startsWith("z:")) {
          // Precision: the pellet passes close to the enemy's centre.
          const t = targets.find((x) => x.id === r.targetId);
          if (t) {
            const off = Math.abs((t.x - shot.ox) * Math.sin(angle) - (t.y - shot.oy) * Math.cos(angle));
            if (off <= t.r * PRECISION_RADIUS_FRACTION) {
              precise = true;
              dmg *= PRECISION_DAMAGE_MULT;
            }
          }
        }
        damageByTarget.set(r.targetId, {
          dmg: (prev?.dmg ?? 0) + dmg,
          x: hx,
          y: hy,
          precise: precise || !!prev?.precise,
        });
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

    if (weapon.splash) {
      // Rockets: no direct hit damage, the explosion at the end of the flight does it all.
      const a = shot.angles[0] ?? 0;
      const d = Math.max(0, (dists[0] ?? 0) - 4);
      const before = shooter.stats.damageDealt;
      this.explode(
        shooter,
        shot.ox + Math.cos(a) * d,
        shot.oy + Math.sin(a) * d,
        weapon.index,
        weapon.splash,
      );
      if (shooter.stats.damageDealt > before) shooter.stats.shotsHit += 1;
      return;
    }
    if (damageByTarget.size > 0) shooter.stats.shotsHit += 1;
    if (this.pve) this.pve.zw.noise(shot.ox, shot.oy, shotNoise(weapon));
    const objectHits: ObjectHit[] = [];
    for (const [targetId, hit] of damageByTarget) {
      if (targetId.startsWith("d:")) {
        objectHits.push({ id: targetId.slice(2), dmg: hit.dmg, x: hit.x, y: hit.y });
        continue;
      }
      if (targetId.startsWith("z:")) {
        this.pve?.damageZombie(targetId.slice(2), hit.dmg, shooter, hit.precise, hit.x, hit.y);
        continue;
      }
      if (targetId.startsWith("veh:")) {
        const v = this.vehicles.get(targetId.slice(4));
        if (v) this.damageVehicle(v, hit.dmg * v.def.bulletArmor, shooter, hit.x, hit.y);
        continue;
      }
      const target = this.players.get(targetId);
      if (!target?.alive) continue;
      const exposure = occupantSeat.get(targetId)?.exposure ?? 1;
      this.damagePlayer(target, hit.dmg * exposure, shooter, weapon.index, hit.x, hit.y);
    }
    if (objectHits.length > 0) this.ctl?.onObjectHits(shooter, objectHits);
  }

  /**
   * Damage from a mode rule (Prop Hunt: a hit on a disguised player's object, a hunter's penalty
   * for shooting an innocent object). `attacker` null = nobody is credited.
   */
  damageFromMode(
    target: ServerPlayer,
    raw: number,
    attacker: ServerPlayer | null,
    weapon: number,
    x: number,
    y: number,
  ): void {
    this.damagePlayer(target, raw, attacker, weapon, x, y);
  }

  /**
   * Applies damage to a player (spawn protection absorbs it) and reports it. `attacker` null =
   * nobody is credited (a crash, a driverless vehicle).
   */
  private damagePlayer(
    target: ServerPlayer,
    raw: number,
    attacker: ServerPlayer | null,
    weapon: number,
    x: number,
    y: number,
  ): void {
    if (!target.alive) return;
    const shielded = target.protectedUntil > this.tick;
    const scale = this.ctl ? this.ctl.damageScale(attacker, target) : 1;
    const dmg = shielded || scale <= 0 ? 0 : Math.max(1, Math.round(raw * scale));
    this.applyDamage(target, dmg);
    if (attacker && attacker !== target) attacker.stats.damageDealt += dmg;
    if (dmg > 0) this.ctl?.onDamage(target, attacker, dmg);
    const lethal = target.hp === 0;
    this.events.push({
      t: "hit",
      p: attacker?.id ?? "",
      v: target.id,
      dmg,
      x: Math.round(x),
      y: Math.round(y),
      k: lethal,
    });
    if (lethal && this.pve) {
      this.pve.onLethal(target, attacker?.name ?? (weapon === KILL_BY_EXPLOSION ? "Explosion" : ""));
      return;
    }
    if (lethal) this.kill(target, attacker && attacker !== target ? attacker : null, weapon);
  }

  /** The shield takes the damage first, health the rest. */
  private applyDamage(target: ServerPlayer, dmg: number): void {
    const absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    target.hp = Math.max(0, target.hp - (dmg - absorbed));
  }

  /** Rocket impact: damage falls off from the centre; the shooter and teammates are spared. */
  private explode(
    shooter: ServerPlayer,
    x: number,
    y: number,
    weapon: number,
    splash: { radius: number; damage: number },
  ): void {
    this.events.push({ t: "boom", x: Math.round(x), y: Math.round(y), r: splash.radius });
    for (const t of this.players.values()) {
      if (!t.alive || t.vehicle || !canDamage(shooter, t, this.rules)) continue;
      if (this.ctl && !this.ctl.playerTargetable(t)) continue;
      const d = Math.hypot(t.sim.x - x, t.sim.y - y);
      if (d > splash.radius + PLAYER.radius) continue;
      if (!hasLineOfSight(this.shotWorld, x, y, t.sim.x, t.sim.y)) continue;
      const k = 1 - Math.max(0, d - PLAYER.radius) / splash.radius;
      this.damagePlayer(t, splash.damage * Math.max(0.25, k), shooter, weapon, t.sim.x, t.sim.y);
    }
    for (const v of this.vehicles.values()) {
      if (v.status !== VEHICLE_READY || v.sim.alt >= AIRBORNE_ALT) continue;
      if (!canDamage(shooter, { id: `veh:${v.id}`, team: this.vehicleTeam(v) }, this.rules)) continue;
      if (Math.hypot(v.sim.x - x, v.sim.y - y) > splash.radius + 40) continue;
      this.damageVehicle(v, splash.damage, shooter, x, y);
    }
  }

  /** PvE: damage from an enemy or a hazard (`attackerId` "z:<id>" or ""). */
  damagePlayerFrom(
    target: ServerPlayer,
    raw: number,
    attackerId: string,
    cause: string,
    x: number,
    y: number,
  ): void {
    if (!target.alive) return;
    const shielded = target.protectedUntil > this.tick;
    const dmg = shielded ? 0 : Math.max(1, Math.round(raw));
    this.applyDamage(target, dmg);
    const lethal = target.hp === 0;
    this.events.push({
      t: "hit",
      p: attackerId,
      v: target.id,
      dmg,
      x: Math.round(x),
      y: Math.round(y),
      k: lethal,
    });
    if (lethal) this.pve?.onLethal(target, cause);
  }

  /** PvE enemy position as a client rendering `viewTick` saw it (interpolated history). */
  zombiePoseAt(id: string, viewTick: number): { x: number; y: number } | null {
    if (this.history.length === 0) return null;
    const newest = this.history[this.history.length - 1]!.tick;
    const t = clamp(viewTick, newest - this.maxRewindTicks, newest);
    const t0 = Math.floor(t);
    const frac = t - t0;
    const a = this.historyAt(t0)?.zombies?.get(id);
    if (!a) return null;
    const b = this.historyAt(t0 + 1)?.zombies?.get(id) ?? a;
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    this.leaveVehicle(victim, true, true);
    this.dropFlag(victim);
    victim.alive = false;
    victim.hp = 0;
    victim.sim.vx = 0;
    victim.sim.vy = 0;
    victim.stats.deaths += 1;
    victim.stats.streak = 0;
    const delay = this.ctl ? this.ctl.respawnDelay(victim, killer) : PLAYER.respawnSeconds;
    // null: out until the next round (the mode respawns them).
    victim.respawnTick = delay === null ? 0 : this.tick + Math.max(1, this.secToTicks(delay));
    if (!killer) {
      this.events.push({ t: "kill", k: "", v: victim.id, w: weapon, fb: false, st: 0 });
      this.ctl?.onKill(victim, null, weapon);
      return;
    }
    killer.stats.kills += 1;
    killer.stats.streak += 1;
    killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
    killer.stats.lastKillTick = this.tick;
    // Team score: only eliminations of the other team count (a friendly-fire kill scores nothing).
    // Objective modes (Domination, CTF) score objectives only; every other team mode scores kills.
    if (
      this.rules.teams &&
      !modeScoresObjectives(this.mode) &&
      (killer.team === 1 || killer.team === 2) &&
      killer.team !== victim.team
    ) {
      this.teamScores[killer.team] += 1;
    }
    const fb = !this.firstBloodDone;
    if (fb) {
      this.firstBloodDone = true;
      killer.stats.firstBlood = true;
    }
    this.events.push({ t: "kill", k: killer.id, v: victim.id, w: weapon, fb, st: killer.stats.streak });
    this.ctl?.onKill(victim, killer, weapon);
  }

  /**
   * Picks the spawn point farthest from living enemies, preferring spots they cannot see.
   * Never spawns on top of another player.
   */
  chooseSpawn(forId: string): { x: number; y: number } {
    const self = this.players.get(forId);
    const team = this.rules.teams ? (self?.team ?? 0) : 0;
    const others = [...this.players.values()].filter((p) => p.alive && p.id !== forId);
    // In team modes only the other team counts as a threat; teammates are just obstacles.
    const enemies = team > 0 ? others.filter((p) => p.team !== team) : others;
    const minGap = PLAYER.radius * 3;
    let best: { x: number; y: number; score: number }[] = [];
    const all = this.spawnOverride ?? this.map.spawns;
    const spawns =
      team > 0
        ? teamSpawns({ spawns: all, teamSpawns: this.spawnOverride ? undefined : this.map.teamSpawns }, team)
        : all;
    for (const s of spawns) {
      if (others.some((e) => distSq(e.sim.x, e.sim.y, s.x, s.y) < minGap * minGap)) continue;
      let score: number;
      if (enemies.length === 0) {
        score = this.rng() * 1000;
      } else {
        let nearest = Number.POSITIVE_INFINITY;
        let visible = 0;
        for (const e of enemies) {
          nearest = Math.min(nearest, Math.sqrt(distSq(e.sim.x, e.sim.y, s.x, s.y)));
          if (hasLineOfSight(this.shotWorld, e.sim.x, e.sim.y, s.x, s.y)) visible++;
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

  /** Leaves the running match (stays in the room): out, no death counted, no respawn. */
  leaveMatch(p: ServerPlayer): void {
    this.leaveVehicle(p, true);
    this.dropFlag(p);
    p.alive = false;
    p.respawnTick = 0;
    p.away = true;
  }

  spawn(p: ServerPlayer, freshMatch: boolean): void {
    if (p.away) return;
    const pos = this.pve ? this.pve.spawnPoint(p) : (this.ctl?.spawnPoint(p) ?? this.chooseSpawn(p.id));
    p.pve.downed = false;
    const keepAim = p.sim.aim;
    p.sim = createPlayerSim(pos.x, pos.y, p.primary);
    p.sim.aim = keepAim;
    p.alive = true;
    p.hp = PLAYER.maxHealth;
    p.shield = 0;
    p.cells = 0;
    p.respawnTick = 0;
    p.protectedUntil = this.tick + this.secToTicks(PLAYER.spawnProtectionSeconds);
    if (!freshMatch) p.stats.streak = 0;
    this.ctl?.onSpawn(p);
    this.events.push({ t: "spawn", p: p.id, x: Math.round(pos.x), y: Math.round(pos.y) });
  }

  private updatePickups(): void {
    for (const pk of this.pickups.values()) {
      if (!pk.active) {
        if (this.tick >= pk.respawnTick) pk.active = true;
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.vehicle || p.pve.downed || p.sim.alt > 0) continue;
        const reach =
          pk.def.kind === "weapon" || pk.def.kind === "chest" ? PLAYER.interactRadius : PICKUP_RADIUS;
        if (distSq(p.sim.x, p.sim.y, pk.def.x, pk.def.y) > reach * reach) continue;
        let taken = false;
        if (pk.def.kind === "health" && p.hp < PLAYER.maxHealth) {
          p.hp = Math.min(PLAYER.maxHealth, p.hp + HEALTH_PICKUP);
          taken = true;
        } else if (pk.def.kind === "ammo") {
          taken = refillAmmo(p.sim);
        } else if (pk.def.kind === "weapon" && pk.def.weapon && p.interact) {
          this.dropSlot(takeWeapon(p.sim, pk.def.weapon), p.sim.x, p.sim.y);
          p.interactPress = false;
          taken = true;
        } else if (pk.def.kind === "chest" && p.interact) {
          // The loot falls on the ground around the chest: a random weapon, a shield cell, ammo.
          const w = rollChestWeapon(this.rng());
          const { x, y } = pk.def;
          this.addDrop({ kind: "weapon", weapon: w, mag: -1, reserve: -1, ...this.dropSpot(x, y, -0.6) });
          this.addDrop({ kind: "shield", weapon: null, mag: 0, reserve: 0, ...this.dropSpot(x, y, 0.9) });
          this.addDrop({ kind: "ammo", weapon: null, mag: 0, reserve: 0, ...this.dropSpot(x, y, 2.4) });
          this.events.push({ t: "pickup", p: p.id, id: pk.def.id, kind: "chest", w: WEAPONS[w].index });
          p.interactPress = false; // the press that opened the chest does not also pick the weapon
          pk.active = false;
          pk.respawnTick = this.tick + this.secToTicks(CHEST_RESPAWN_SEC);
          break;
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

  /** A point next to (x, y) in direction `angle`, or (x, y) itself when a wall is in the way. */
  private dropSpot(x: number, y: number, angle: number): { x: number; y: number } {
    const tx = x + Math.cos(angle) * 44;
    const ty = y + Math.sin(angle) * 44;
    const ex = x + Math.cos(angle) * 60;
    const ey = y + Math.sin(angle) * 60;
    return hasLineOfSight(this.world, x, y, ex, ey) ? { x: tx, y: ty } : { x, y };
  }

  private addDrop(d: Omit<Drop, "expiresTick">): void {
    if (this.drops.size >= DROPS.max) this.drops.delete(this.drops.keys().next().value!);
    this.drops.set(`d${++this.dropSeq}`, { ...d, expiresTick: this.tick + this.secToTicks(DROPS.ttlSec) });
  }

  /** Leaves a swapped-out weapon on the ground with the ammo it had. */
  private dropSlot(slot: WeaponSlotState | null, x: number, y: number): void {
    const def = slot ? weaponByIndex(slot.id) : undefined;
    if (!slot || !def) return;
    this.addDrop({ kind: "weapon", weapon: def.id, mag: slot.mag, reserve: slot.reserve, x, y });
  }

  private useShieldCell(p: ServerPlayer): void {
    if (p.cells <= 0 || p.shield >= SHIELD.max) return;
    p.cells--;
    p.shield = Math.min(SHIELD.max, p.shield + SHIELD.perCell);
  }

  /**
   * Ammo and shield cells are taken by walking over them (when useful); a weapon needs an interact
   * press, one item per press (the nearest), so the weapon just dropped is not picked up again.
   */
  private updateDrops(): void {
    for (const [id, d] of this.drops) if (this.tick >= d.expiresTick) this.drops.delete(id);
    if (this.drops.size === 0) return;
    for (const p of this.players.values()) {
      if (!p.alive || p.vehicle || p.pve.downed || p.sim.alt > 0) continue;
      let nearest: string | null = null;
      let nearestD = PLAYER.interactRadius * PLAYER.interactRadius;
      for (const [id, d] of this.drops) {
        const dd = distSq(p.sim.x, p.sim.y, d.x, d.y);
        if (d.kind === "weapon") {
          if (p.interactPress && dd <= nearestD) {
            nearest = id;
            nearestD = dd;
          }
          continue;
        }
        if (dd > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        const take = d.kind === "ammo" ? refillAmmo(p.sim) : p.cells < SHIELD.maxCells;
        if (take) {
          if (d.kind === "shield") p.cells++;
          this.drops.delete(id);
          this.events.push({ t: "pickup", p: p.id, id, kind: d.kind === "ammo" ? "ammo" : "shield" });
        }
      }
      const d = nearest ? this.drops.get(nearest) : undefined;
      if (!nearest || !d?.weapon) continue;
      this.drops.delete(nearest);
      const ammo = d.mag >= 0 ? { mag: d.mag, reserve: d.reserve } : undefined;
      this.dropSlot(takeWeapon(p.sim, d.weapon, ammo), p.sim.x, p.sim.y);
      p.interactPress = false;
      this.events.push({ t: "pickup", p: p.id, id: nearest, kind: "weapon", w: WEAPONS[d.weapon].index });
    }
  }

  // ---------------------------------------------------------------- vehicles

  setVehicleOverride(list: VehicleSpawnDef[] | null): void {
    this.vehicleOverride = list;
    this.resetVehicles();
  }

  /** Parks every vehicle again (match start, a new round of a vehicle mode). */
  resetVehicles(): void {
    this.vehicles.clear();
    // Modes without vehicles (Gun Game, the round modes) leave the parked vehicles out.
    if (this.ctl && !this.ctl.vehicles) return;
    for (const spawn of this.vehicleOverride ?? this.ctl?.vehicleSpawns() ?? this.map.vehicleSpawns ?? []) {
      const def = VEHICLES[spawn.kind];
      this.vehicles.set(spawn.id, {
        id: spawn.id,
        def,
        spawn,
        sim: createVehicleSim(spawn.x, spawn.y, spawn.angle),
        hp: def.maxHp,
        status: VEHICLE_READY,
        statusTick: 0,
        seats: def.seats.map(() => null),
        credit: 0,
        lastDriver: null,
        lastDriverTick: 0,
        lastAttacker: null,
        lastAttackTick: 0,
        contacts: new Map(),
      });
    }
  }

  /** Team of a vehicle for damage rules: its first occupant's, 0 when empty. */
  vehicleTeam(v: ServerVehicle): number {
    for (const id of v.seats) {
      const p = id ? this.players.get(id) : undefined;
      if (p) return p.team;
    }
    return 0;
  }

  /** Vehicle pose as a client rendering `viewTick` saw it (interpolated history). */
  vehiclePoseAt(v: ServerVehicle, viewTick: number): VehiclePose {
    const current: VehiclePose = {
      x: v.sim.x,
      y: v.sim.y,
      angle: v.sim.angle,
      alt: v.sim.alt,
      ready: v.status === VEHICLE_READY,
    };
    if (this.history.length === 0) return current;
    const newest = this.history[this.history.length - 1]!.tick;
    const t = clamp(viewTick, newest - this.maxRewindTicks, newest);
    const t0 = Math.floor(t);
    const frac = t - t0;
    const a = this.historyAt(t0)?.vehicles.get(v.id);
    if (!a) return current;
    const b = this.historyAt(t0 + 1)?.vehicles.get(v.id) ?? a;
    // A respawn in between is a teleport, not motion.
    if (Math.hypot(b.x - a.x, b.y - a.y) > 200) return frac < 0.5 ? a : b;
    return {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      angle: lerpAngle(a.angle, b.angle, frac),
      alt: a.alt + (b.alt - a.alt) * frac,
      ready: a.ready && b.ready,
    };
  }

  /** Collision circles of every vehicle standing on the ground (wrecks included). */
  groundObstacles(except: ServerVehicle | null): Circle[] {
    const out: Circle[] = [];
    for (const v of this.vehicles.values()) {
      if (v === except || v.status === VEHICLE_GONE || v.sim.alt >= AIRBORNE_ALT) continue;
      for (const c of vehicleCircles(v.sim, v.def)) out.push(c);
    }
    return out;
  }

  private stepContext(v: ServerVehicle) {
    return { world: this.world, airWorld: this.airWorld, obstacles: this.groundObstacles(v) };
  }

  private driveVehicle(v: ServerVehicle, frame: InputFrame, driver: ServerPlayer): void {
    v.credit = 0;
    v.lastDriver = driver.id;
    v.lastDriverTick = this.tick;
    const res = stepVehicle(v.sim, v.def, frame, this.stepContext(v));
    this.afterVehicleStep(v, res);
  }

  /** Vehicles nobody drives coast to a stop (helicopters land) at real-time rate. */
  private stepUndrivenVehicles(tickInputs: number, perTickMax: number, live: boolean): void {
    for (const v of this.vehicles.values()) {
      if (v.status === VEHICLE_GONE) continue;
      const driver = v.seats[0] ? this.players.get(v.seats[0]) : undefined;
      if (driver && v.status === VEHICLE_READY) continue;
      const moving =
        Math.abs(v.sim.vx) > 0.01 ||
        Math.abs(v.sim.vy) > 0.01 ||
        v.sim.alt > 0 ||
        v.sim.rotor > 0 ||
        v.sim.lift;
      if (!moving) {
        v.credit = 0;
        continue;
      }
      v.credit += tickInputs;
      let n = 0;
      while (v.credit >= 1 && n < perTickMax) {
        v.credit -= 1;
        n++;
        const res = stepVehicle(v.sim, v.def, null, this.stepContext(v));
        if (live) this.afterVehicleStep(v, res);
      }
    }
  }

  /** Who gets the credit for what a vehicle does: its driver, or the last one for a few seconds. */
  private vehicleCredit(v: ServerVehicle): ServerPlayer | null {
    const driver = v.seats[0] ? this.players.get(v.seats[0]) : undefined;
    if (driver?.alive) return driver;
    if (v.lastDriver && this.tick - v.lastDriverTick <= this.secToTicks(RAM_CREDIT_SEC)) {
      return this.players.get(v.lastDriver) ?? null;
    }
    return null;
  }

  private contactReady(v: ServerVehicle, otherId: string): boolean {
    const until = v.contacts.get(otherId) ?? 0;
    if (this.tick < until) return false;
    v.contacts.set(otherId, this.tick + Math.max(1, this.secToTicks(RAM_COOLDOWN_SEC)));
    return true;
  }

  /** Crashes, vehicle-vs-vehicle hits and run-overs after one vehicle step. */
  private afterVehicleStep(v: ServerVehicle, res: VehicleStepResult): void {
    if (v.status !== VEHICLE_READY) return;
    const credit = this.vehicleCredit(v);
    // Vehicle against vehicle: both take damage scaled by the other's mass.
    if (res.obstacleImpact > COLLIDE_MIN_SPEED) {
      const other = this.vehicleInContact(v);
      if (other && this.contactReady(v, `veh:${other.id}`)) {
        const over = res.obstacleImpact - COLLIDE_MIN_SPEED;
        const total = v.def.mass + other.def.mass;
        const otherCredit = this.vehicleCredit(other);
        this.events.push({
          t: "crash",
          v: v.id,
          o: other.id,
          x: Math.round((v.sim.x + other.sim.x) / 2),
          y: Math.round((v.sim.y + other.sim.y) / 2),
          f: Math.round(res.obstacleImpact),
        });
        // Push the other body along the contact normal (momentum transfer).
        const nx = other.sim.x - v.sim.x;
        const ny = other.sim.y - v.sim.y;
        const len = Math.hypot(nx, ny) || 1;
        const push = res.obstacleImpact * (v.def.mass / total);
        other.sim.vx += (nx / len) * push;
        other.sim.vy += (ny / len) * push;
        this.damageVehicle(
          other,
          // The lighter body takes more: damage scales with the square root of the mass ratio.
          over * COLLIDE_DAMAGE_PER_SPEED * Math.sqrt(v.def.mass / other.def.mass),
          credit,
          other.sim.x,
          other.sim.y,
        );
        this.damageVehicle(
          v,
          over * COLLIDE_DAMAGE_PER_SPEED * Math.sqrt(other.def.mass / v.def.mass),
          otherCredit,
          v.sim.x,
          v.sim.y,
        );
      }
    } else if (res.impact > CRASH_MIN_SPEED && this.contactReady(v, "wall")) {
      this.events.push({
        t: "crash",
        v: v.id,
        o: "",
        x: Math.round(v.sim.x),
        y: Math.round(v.sim.y),
        f: Math.round(res.impact),
      });
      this.damageVehicle(v, (res.impact - CRASH_MIN_SPEED) * CRASH_DAMAGE_PER_SPEED, null, v.sim.x, v.sim.y);
    }
    if (v.status !== VEHICLE_READY || v.sim.alt > 0.1) return;
    this.runOver(v, credit);
    this.pve?.vehicleContacts(v, credit);
  }

  private vehicleInContact(v: ServerVehicle): ServerVehicle | null {
    const mine = vehicleCircles(v.sim, v.def);
    let best: ServerVehicle | null = null;
    let bestGap = 3;
    for (const o of this.vehicles.values()) {
      if (o === v || o.status === VEHICLE_GONE || o.sim.alt >= AIRBORNE_ALT) continue;
      for (const a of mine) {
        for (const b of vehicleCircles(o.sim, o.def)) {
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
          if (gap < bestGap) {
            bestGap = gap;
            best = o;
          }
        }
      }
    }
    return best;
  }

  /**
   * Players on foot touching the body are pushed aside; above the vehicle's minimum ramming speed
   * they are hit: damage grows with the closing speed (relative velocity along the contact normal,
   * so a glancing contact hurts less than a head-on one) and the vehicle's ramming factor.
   */
  private runOver(v: ServerVehicle, credit: ServerPlayer | null): void {
    const cos = Math.cos(v.sim.angle);
    const sin = Math.sin(v.sim.angle);
    for (const p of this.players.values()) {
      if (!p.alive || p.vehicle) continue;
      const c = closestOnBody(v.sim, v.def, p.sim.x, p.sim.y);
      if (!c.inside && c.dist >= PLAYER.radius) continue;
      let nx: number;
      let ny: number;
      if (c.inside || c.dist < 1e-6) {
        // Centre inside the hull: push out sideways from the vehicle's axis.
        const lx = (p.sim.x - v.sim.x) * cos + (p.sim.y - v.sim.y) * sin;
        const ly = -(p.sim.x - v.sim.x) * sin + (p.sim.y - v.sim.y) * cos;
        const side = ly >= 0 ? 1 : -1;
        nx = -sin * side;
        ny = cos * side;
        const edge = seatWorld(v.sim, { ox: lx, oy: side * v.def.halfWidth });
        c.x = edge.x;
        c.y = edge.y;
      } else {
        nx = (p.sim.x - c.x) / c.dist;
        ny = (p.sim.y - c.y) / c.dist;
      }
      // Velocity of the hull at the contact point (translation + rotation).
      const rx = c.x - v.sim.x;
      const ry = c.y - v.sim.y;
      const pvx = v.sim.vx - v.sim.av * ry;
      const pvy = v.sim.vy + v.sim.av * rx;
      const closing = (pvx - p.sim.vx) * nx + (pvy - p.sim.vy) * ny;
      const out = resolveCircle(
        this.world,
        c.x + nx * (PLAYER.radius + 1),
        c.y + ny * (PLAYER.radius + 1),
        PLAYER.radius,
      );
      p.sim.x = out.x;
      p.sim.y = out.y;
      if (closing <= 0) continue;
      p.sim.vx += nx * closing * 0.8;
      p.sim.vy += ny * closing * 0.8;
      if (closing < v.def.ramMinSpeed || !this.contactReady(v, p.id)) continue;
      const dmg = (closing - v.def.ramMinSpeed) * v.def.ramFactor;
      v.sim.vx *= 0.94;
      v.sim.vy *= 0.94;
      this.events.push({
        t: "crash",
        v: v.id,
        o: p.id,
        x: Math.round(c.x),
        y: Math.round(c.y),
        f: Math.round(closing),
      });
      // Teammates are bumped, not hurt, without friendly fire.
      if (credit && !canDamage(credit, p, this.rules)) continue;
      this.damagePlayer(p, dmg, credit, KILL_BY_VEHICLE, c.x, c.y);
    }
  }

  damageVehicle(v: ServerVehicle, raw: number, attacker: ServerPlayer | null, x: number, y: number): void {
    if (v.status !== VEHICLE_READY || raw <= 0) return;
    const dmg = Math.max(1, Math.round(raw));
    v.hp = Math.max(0, v.hp - dmg);
    if (attacker) {
      v.lastAttacker = attacker.id;
      v.lastAttackTick = this.tick;
      attacker.stats.damageDealt += dmg;
    }
    this.events.push({ t: "vhit", p: attacker?.id ?? "", v: v.id, dmg, x: Math.round(x), y: Math.round(y) });
    if (v.hp === 0) this.destroyVehicle(v);
  }

  /** The hull explodes: occupants and bystanders take blast damage credited to the last attacker. */
  private destroyVehicle(v: ServerVehicle): void {
    v.status = VEHICLE_WRECK;
    v.statusTick = this.tick + this.secToTicks(WRECK_SEC);
    v.sim.vx *= 0.3;
    v.sim.vy *= 0.3;
    v.sim.av = 0;
    v.sim.lift = false;
    v.sim.alt = 0;
    v.sim.rotor = 0;
    const recent = v.lastAttacker && this.tick - v.lastAttackTick <= this.secToTicks(10);
    const attacker = recent ? (this.players.get(v.lastAttacker!) ?? null) : null;
    this.events.push({
      t: "wreck",
      v: v.id,
      p: attacker?.id ?? "",
      x: Math.round(v.sim.x),
      y: Math.round(v.sim.y),
    });
    const crewTeam = this.vehicleTeam(v);
    const crewed = v.seats.some((id) => id !== null);
    if (attacker && crewed && (!this.rules.teams || crewTeam !== attacker.team)) {
      attacker.stats.vehicleKills += 1;
      if (this.mode === "mayhem" && (attacker.team === 1 || attacker.team === 2)) {
        this.teamScores[attacker.team] += OBJECTIVES.wreckPoints;
      }
    }
    const occupants = v.seats
      .map((id) => (id ? this.players.get(id) : undefined))
      .filter((p): p is ServerPlayer => !!p);
    for (const p of occupants) this.leaveVehicle(p, true);
    this.pve?.blast(v.sim.x, v.sim.y, EXPLOSION_RADIUS, EXPLOSION_DAMAGE * 2, attacker);
    for (const p of occupants) {
      this.damagePlayer(
        p,
        v.def.wreckDamage,
        attacker && attacker !== p ? attacker : null,
        KILL_BY_EXPLOSION,
        p.sim.x,
        p.sim.y,
      );
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.vehicle || occupants.includes(p)) continue;
      const d = Math.hypot(p.sim.x - v.sim.x, p.sim.y - v.sim.y);
      if (d > EXPLOSION_RADIUS) continue;
      if (attacker && !canDamage(attacker, p, this.rules) && attacker !== p) continue;
      const dmg = EXPLOSION_DAMAGE * (1 - d / EXPLOSION_RADIUS);
      if (dmg >= 1)
        this.damagePlayer(
          p,
          dmg,
          attacker && attacker !== p ? attacker : null,
          KILL_BY_EXPLOSION,
          p.sim.x,
          p.sim.y,
        );
    }
  }

  private updateVehicleLifecycle(): void {
    for (const v of this.vehicles.values()) {
      if (v.status === VEHICLE_WRECK && this.tick >= v.statusTick) {
        v.status = VEHICLE_GONE;
        const factor = this.mode === "mayhem" ? OBJECTIVES.mayhemRespawnFactor : 1;
        v.statusTick = this.tick + this.secToTicks(v.def.respawnSec * factor);
      } else if (v.status === VEHICLE_GONE && this.tick >= v.statusTick) {
        // Respawn only onto a clear spot: never inside a player or another vehicle.
        const probe = createVehicleSim(v.spawn.x, v.spawn.y, v.spawn.angle);
        const blocked =
          [...this.players.values()].some(
            (p) =>
              p.alive && !p.vehicle && closestOnBody(probe, v.def, p.sim.x, p.sim.y).dist < PLAYER.radius + 8,
          ) ||
          this.groundObstacles(v).some((o) =>
            vehicleCircles(probe, v.def).some((c) => Math.hypot(c.x - o.x, c.y - o.y) < c.r + o.r + 4),
          );
        if (blocked) {
          v.statusTick = this.tick + this.secToTicks(1);
          continue;
        }
        v.sim = probe;
        v.hp = v.def.maxHp;
        v.status = VEHICLE_READY;
        v.credit = 0;
        v.contacts.clear();
        v.lastDriver = null;
        v.lastAttacker = null;
        this.events.push({ t: "vspawn", v: v.id });
      }
    }
    // Contact cooldowns of parties that are long gone are forgotten (bounded maps).
    if (this.tick % 200 === 0) {
      for (const v of this.vehicles.values()) {
        for (const [k, until] of v.contacts) if (until < this.tick) v.contacts.delete(k);
      }
    }
  }

  /** Keeps every occupant on their seat. */
  private pinOccupants(): void {
    for (const v of this.vehicles.values()) {
      v.seats.forEach((id, i) => {
        const p = id ? this.players.get(id) : undefined;
        if (!p) return;
        const at = seatWorld(v.sim, v.def.seats[i]!);
        p.sim.x = at.x;
        p.sim.y = at.y;
        p.sim.vx = 0;
        p.sim.vy = 0;
      });
    }
  }

  /** Vehicle a player on foot can enter right now (nearest body within reach), with the seat. */
  enterableVehicle(p: ServerPlayer): { v: ServerVehicle; seat: number } | null {
    let best: { v: ServerVehicle; seat: number; d: number } | null = null;
    for (const v of this.vehicles.values()) {
      if (v.status !== VEHICLE_READY) continue;
      if (vehicleSpeed(v.sim) > v.def.enterMaxSpeed || v.sim.alt > 0.05) continue;
      const d = closestOnBody(v.sim, v.def, p.sim.x, p.sim.y).dist;
      if (d > ENTER_REACH) continue;
      // Never into a vehicle held by the other team.
      if (this.rules.teams) {
        const team = this.vehicleTeam(v);
        if (team !== 0 && team !== p.team) continue;
      }
      const seat = v.seats[0] === null ? 0 : v.seats.indexOf(null);
      if (seat < 0) continue;
      if (!best || d < best.d) best = { v, seat, d };
    }
    return best ? { v: best.v, seat: best.seat } : null;
  }

  /** CTF: the flag carrier (if any) is this player. */
  carriesFlag(p: ServerPlayer): boolean {
    return this.flags.some((f) => f.carrier === p.id);
  }

  private tryEnter(p: ServerPlayer): boolean {
    // Flag carriers travel on foot: a flag must be chased down, not driven away at 100 km/h.
    if (this.carriesFlag(p)) return false;
    const target = this.enterableVehicle(p);
    if (!target || target.v.locked) return false;
    p.protectedUntil = 0;
    p.sim.vx = 0;
    p.sim.vy = 0;
    p.sim.dash = 0;
    this.takeSeat(p, target.v, target.seat);
    return true;
  }

  /** Seats are claimed one input at a time, so two players can never hold the same seat. */
  private takeSeat(p: ServerPlayer, v: ServerVehicle, seat: number): void {
    v.seats[seat] = p.id;
    p.vehicle = v.id;
    p.seat = seat;
    if (seat === 0) {
      v.lastDriver = p.id;
      v.lastDriverTick = this.tick;
      v.credit = 0;
    }
    const def = v.def.seats[seat]!;
    if (def.mounted) {
      p.stash = { ...p.sim.slots[SLOT_PICKUP]! };
      p.stashSlot = p.sim.slot;
      p.sim.slots[SLOT_PICKUP] = fullSlot(def.mounted);
      p.sim.slot = SLOT_PICKUP;
      p.sim.reload = 0;
      p.sim.swap = 0;
      p.sim.bloom = 0;
    }
    const at = seatWorld(v.sim, def);
    p.sim.x = at.x;
    p.sim.y = at.y;
    this.events.push({ t: "seat", p: p.id, v: v.id, s: seat });
  }

  private releaseSeat(p: ServerPlayer, v: ServerVehicle): void {
    const def = v.def.seats[p.seat];
    if (p.seat >= 0 && v.seats[p.seat] === p.id) v.seats[p.seat] = null;
    if (p.seat === 0) {
      v.lastDriver = p.id;
      v.lastDriverTick = this.tick;
    }
    if (def?.mounted && p.stash) {
      p.sim.slots[SLOT_PICKUP] = p.stash;
      p.sim.slot = p.stashSlot;
      const active = p.sim.slots[p.sim.slot];
      if (!active || active.id === NO_WEAPON) p.sim.slot = 0;
      p.sim.reload = 0;
      p.sim.swap = 0;
    }
    p.stash = null;
    p.vehicle = null;
    p.seat = -1;
  }

  private switchSeat(p: ServerPlayer, v: ServerVehicle): void {
    const n = v.seats.length;
    for (let k = 1; k < n; k++) {
      const next = (p.seat + k) % n;
      if (v.seats[next] !== null) continue;
      this.releaseSeat(p, v);
      this.takeSeat(p, v, next);
      return;
    }
  }

  /**
   * Leaves the vehicle. A voluntary exit needs a slow vehicle (a landed helicopter) and a free spot
   * beside it; a forced one (death, disconnect, destruction, match reset) always succeeds.
   */
  leaveVehicle(p: ServerPlayer, forced: boolean, dying = false): boolean {
    const v = p.vehicle ? this.vehicles.get(p.vehicle) : undefined;
    if (!v) {
      p.vehicle = null;
      p.seat = -1;
      return true;
    }
    const seat = v.def.seats[p.seat] ?? v.def.seats[0]!;
    if (!forced && (vehicleSpeed(v.sim) > v.def.exitMaxSpeed || v.sim.alt > 0.2)) return false;
    const blockers: Circle[] = [...this.groundObstacles(v)];
    for (const o of this.players.values()) {
      if (o !== p && o.alive && !o.vehicle) blockers.push({ x: o.sim.x, y: o.sim.y, r: PLAYER.radius });
    }
    let spot = findExitSpot(v.sim, v.def, seat, this.world, blockers);
    if (!spot) {
      if (!forced) return false;
      spot = this.freeSpotNear(seatWorld(v.sim, seat));
    }
    this.releaseSeat(p, v);
    if (!dying) {
      p.sim.x = spot.x;
      p.sim.y = spot.y;
    }
    p.sim.vx = 0;
    p.sim.vy = 0;
    this.events.push({ t: "seat", p: p.id, v: v.id, s: -1 });
    return true;
  }

  private freeSpotNear(from: { x: number; y: number }): { x: number; y: number } {
    for (let r = 0; r <= 240; r += 24) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const q = { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
        if (
          isFreeSpot(this.world, q) &&
          !this.groundObstacles(null).some((o) => Math.hypot(o.x - q.x, o.y - q.y) < o.r + PLAYER.radius)
        ) {
          return q;
        }
        if (r === 0) break;
      }
    }
    return this.chooseSpawn("");
  }

  // ---------------------------------------------------------------- objectives

  private dropFlag(p: ServerPlayer): void {
    for (const f of this.flags) {
      if (f.carrier !== p.id) continue;
      f.carrier = null;
      f.home = false;
      f.x = p.sim.x;
      f.y = p.sim.y;
      f.returnTick = this.tick + this.secToTicks(OBJECTIVES.flagReturnSec);
      this.events.push({ t: "obj", k: "drop", o: String(f.team), team: f.team, p: p.id });
    }
  }

  private updateObjectives(): void {
    if (this.points.length > 0) this.updatePoints();
    if (this.flags.length > 0) this.updateFlags();
  }

  /**
   * Domination: a point is turned by the only team standing in it (contested = frozen), faster
   * with more players (up to 3). It changes owner when fully captured and becomes neutral when
   * the progress crosses the middle. Owned points score at a fixed rate.
   */
  private updatePoints(): void {
    const dt = 1 / this.tickRate;
    const r2 = OBJECTIVES.pointRadius ** 2;
    for (const pt of this.points) {
      const inside: [ServerPlayer[], ServerPlayer[], ServerPlayer[]] = [[], [], []];
      for (const p of this.players.values()) {
        if (!p.alive || (p.team !== 1 && p.team !== 2)) continue;
        const v = p.vehicle ? this.vehicles.get(p.vehicle) : undefined;
        // A helicopter in the air does not hold ground.
        if (v && v.sim.alt >= AIRBORNE_ALT) continue;
        if ((p.sim.x - pt.x) ** 2 + (p.sim.y - pt.y) ** 2 <= r2) inside[p.team].push(p);
      }
      const a = inside[1].length;
      const b = inside[2].length;
      if (a > 0 === b > 0) continue;
      const team = a > 0 ? 1 : 2;
      const n = Math.min(3, a + b);
      const rate = (1 + 0.5 * (n - 1)) / OBJECTIVES.captureSec;
      const before = pt.progress;
      pt.progress = clamp(pt.progress + (team === 1 ? rate : -rate) * dt, -1, 1);
      if (
        pt.owner !== 0 &&
        pt.owner !== team &&
        Math.sign(pt.progress) !== Math.sign(before) &&
        before !== 0
      ) {
        pt.owner = 0;
        this.events.push({ t: "obj", k: "neutral", o: pt.id, team: 0, p: "" });
      }
      if (pt.owner !== team && Math.abs(pt.progress) >= 1) {
        pt.owner = team;
        for (const p of inside[team]) p.stats.captures += 1;
        this.events.push({ t: "obj", k: "capture", o: pt.id, team, p: inside[team][0]?.id ?? "" });
      }
    }
    this.domTicks += 1;
    if (this.domTicks >= this.secToTicks(OBJECTIVES.scoreEverySec)) {
      this.domTicks = 0;
      for (const pt of this.points) if (pt.owner === 1 || pt.owner === 2) this.teamScores[pt.owner] += 1;
    }
  }

  /**
   * Capture the Flag: touch the enemy flag to carry it; touch your own dropped flag to send it
   * home; bring the enemy flag to your stand while your own flag is home to score. A dropped flag
   * goes home on its own after a while.
   */
  private updateFlags(): void {
    const reach2 = OBJECTIVES.flagReach ** 2;
    for (const f of this.flags) {
      if (f.carrier) {
        const c = this.players.get(f.carrier);
        if (!c?.alive) {
          if (c) this.dropFlag(c);
          else {
            f.carrier = null;
            f.home = true;
            f.x = f.homeX;
            f.y = f.homeY;
          }
          continue;
        }
        f.x = c.sim.x;
        f.y = c.sim.y;
        const own = this.flags.find((g) => g.team === c.team);
        if (own?.home && (c.sim.x - own.homeX) ** 2 + (c.sim.y - own.homeY) ** 2 <= reach2) {
          // Capture.
          f.carrier = null;
          f.home = true;
          f.x = f.homeX;
          f.y = f.homeY;
          c.stats.flagCaptures += 1;
          if (c.team === 1 || c.team === 2) this.teamScores[c.team] += 1;
          this.events.push({ t: "obj", k: "score", o: String(f.team), team: c.team, p: c.id });
        }
        continue;
      }
      if (!f.home && this.tick >= f.returnTick) {
        f.home = true;
        f.x = f.homeX;
        f.y = f.homeY;
        this.events.push({ t: "obj", k: "return", o: String(f.team), team: f.team, p: "" });
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.vehicle) continue;
        if ((p.sim.x - f.x) ** 2 + (p.sim.y - f.y) ** 2 > reach2) continue;
        if (p.team === f.team) {
          if (!f.home) {
            f.home = true;
            f.x = f.homeX;
            f.y = f.homeY;
            p.stats.returns += 1;
            this.events.push({ t: "obj", k: "return", o: String(f.team), team: f.team, p: p.id });
          }
        } else if ((p.team === 1 || p.team === 2) && !this.carriesFlag(p)) {
          f.carrier = p.id;
          f.home = false;
          p.protectedUntil = 0;
          this.events.push({ t: "obj", k: "take", o: String(f.team), team: f.team, p: p.id });
          break;
        }
      }
    }
  }

  /** Ranking: kills desc, deaths asc, earliest to reach the score first (modes may rank otherwise). */
  standings(): ServerPlayer[] {
    const byMode = this.ctl?.standings();
    if (byMode) return byMode;
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

  /** What the score limit is compared with: best team score in team modes, top kills otherwise. */
  leaderScore(): number {
    if (this.ctl) return this.ctl.leaderScore();
    return this.rules.teams ? Math.max(this.teamScores[1], this.teamScores[2]) : this.leaderKills();
  }

  /** Team modes: 1 or 2 for the team ahead, 0 for a draw (or outside team modes). */
  winningTeam(): number {
    if (this.ctl) return this.ctl.winningTeam();
    if (!this.rules.teams) return 0;
    const [, a, b] = this.teamScores;
    return a > b ? 1 : b > a ? 2 : 0;
  }
}
