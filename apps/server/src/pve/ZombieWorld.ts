import {
  ACT,
  AI,
  type AiState,
  type AttackDef,
  type BossAttackDef,
  bossPhase,
  buildFlowField,
  type Circle,
  type CollisionWorld,
  cellIndex,
  clamp,
  clearPath,
  DIFFICULTY,
  type Difficulty,
  type DifficultyDef,
  EXPLODER_ZOMBIE_DAMAGE_MULT,
  type FlowField,
  fieldDistancePx,
  findPath,
  flowSteer,
  hasLineOfSight,
  hitSide,
  MAX_ZOMBIES,
  NAV_CLASS_RADIUS,
  NAV_INF,
  type NavClass,
  type NavGrid,
  type NetEvent,
  navClassFor,
  nearestWalkable,
  PLAYER,
  PRECISION_DAMAGE_MULT,
  PRECISION_RADIUS_FRACTION,
  platingMult,
  pushOutOfCircles,
  randomWalkableNear,
  raycastSolids,
  resolveCircle,
  type Vec2,
  walkable,
  wrapAngle,
  ZOMBIES,
  type ZombieDef,
  type ZombieKind,
} from "@scrapline/shared";

/**
 * Authoritative PvE enemies: perception, decisions, steering, attacks, projectiles and hazards.
 * Runs inside the room's GameSimulation tick (dedicated server or the host's tab); clients only
 * render the synchronized result.
 *
 * Cost control:
 * - decisions ("think") run at 10 Hz near players, 4 Hz at mid range and 2 Hz far away, staggered
 *   by id; movement runs every tick but is a few vector operations plus one resolveCircle;
 * - chasing uses one flow field per target player and nav class, rebuilt only when that player
 *   changes cell (at most FIELD_BUILDS_PER_TICK per tick); A* is used for individual goals with a
 *   per-tick budget;
 * - crowd separation uses a spatial hash.
 */

export interface PveActor {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  alive: boolean;
  downed: boolean;
  /** Vehicle id when seated. */
  vehicle: string | null;
  /** Seated in a flying helicopter: out of reach. */
  airborne: boolean;
}

export interface VehicleBody {
  id: string;
  /** Hull circles (for melee reach and as obstacles). */
  circles: Circle[];
}

/** What the enemies need from the simulation around them. */
export interface ZombieHost {
  readonly tick: number;
  readonly tickRate: number;
  rng(): number;
  world(): CollisionWorld;
  shotWorld(): CollisionWorld;
  nav(): NavGrid;
  actors(): readonly PveActor[];
  vehicles(): readonly VehicleBody[];
  /** Damage to a player from an enemy (or a hazard: zombie null). */
  hurtPlayer(id: string, dmg: number, from: Zombie | null, x: number, y: number, knock?: Vec2): void;
  hurtVehicle(id: string, dmg: number, x: number, y: number): void;
  emit(ev: NetEvent): void;
  /** An enemy died; `killer` = credited player id or "". */
  onKilled(z: Zombie, killer: string): void;
}

export interface Zombie {
  id: string;
  def: ZombieDef;
  cls: NavClass;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  damageMult: number;
  speedMult: number;
  state: AiState;
  /** Tick when the current state may end (alert, stunned, investigate look-around). */
  stateUntil: number;
  act: number;
  actTick: number;
  actX: number;
  actY: number;
  /** Which attack the current act belongs to. */
  actKind: "attack" | "special" | "boss";
  /** The attack being performed (phase-scaled for bosses). */
  cur: AttackDef | null;
  /** Boss: id of the current attack, cooldowns by attack id, phase index. */
  curId: string;
  cooldowns: Map<string, number>;
  phase: number;
  target: string | null;
  lastKnownX: number;
  lastKnownY: number;
  lastSeenTick: number;
  /** Wave enemies know roughly where the squad is (they follow the flow field to the nearest). */
  horde: boolean;
  path: Vec2[] | null;
  pathGoalX: number;
  pathGoalY: number;
  nextThink: number;
  attackReadyTick: number;
  specialReadyTick: number;
  lungeVx: number;
  lungeVy: number;
  lungeUntil: number;
  /** Tick until which a vehicle cannot ram this enemy again (one hit per contact, as in PvP). */
  ramUntil: number;
  lungeHits: Set<string>;
  homeX: number;
  homeY: number;
  progressX: number;
  progressY: number;
  progressTick: number;
  spawnTick: number;
  lastHurtBy: string;
  lastHurtTick: number;
  /** Last tick a player was within 1200 px (straggler culling). */
  lastNearTick: number;
  jink: number;
  /** Wave number that spawned it (0 = placed / ambient). */
  wave: number;
  group: string;
  dead: boolean;
  /** Survival / wave safety: enraged after the wave timer runs out. */
  enraged: boolean;
}

export interface Projectile {
  /** Lobbed debris: flies over everything to its target and hurts an area when it lands. */
  lob?: { radius: number; edge: number };
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number;
  damage: number;
  puddle: { radius: number; sec: number; dps: number } | undefined;
  from: string;
}

export interface Hazard {
  id: string;
  x: number;
  y: number;
  r: number;
  until: number;
  dps: number;
  acc: Map<string, number>;
}

interface TargetField {
  cell: number;
  builtTick: number;
  fields: [FlowField | null, FlowField | null, FlowField | null, FlowField | null];
  dirty: boolean;
}

export interface SpawnOptions {
  state?: "idle" | "wander" | "hunt";
  wave?: number;
  group?: string;
}

const FIELD_BUILDS_PER_TICK = 2;
/** Minimum ticks between two rebuilds of one player's fields while they move. */
const FIELD_MIN_TICKS = 3;
const ASTAR_PER_TICK = 4;
const SEPARATION_CELL = 64;
const MELEE_GRACE = 14;
const ALERT_SEC = 0.55;
const LOOK_AROUND_SEC = 2;
const STUCK_SEC = 2;
const STRAGGLER_SEC = 22;
/** Phase-transition roar: reach (sent as the telegraph radius) and push. */
const ROAR_RADIUS = 230;
const ROAR_KNOCKBACK = 460;

export class ZombieWorld {
  readonly zombies = new Map<string, Zombie>();
  readonly projectiles = new Map<number, Projectile>();
  readonly hazards = new Map<string, Hazard>();
  difficulty: DifficultyDef = DIFFICULTY.veteran;
  /** Health multiplier from squad size (applied at spawn). */
  hpMult = 1;
  private nextId = 1;
  private nextProj = 1;
  private nextHazard = 1;
  private readonly targetFields = new Map<string, TargetField>();
  private fieldCursor = 0;
  private astarBudget = 0;
  private buckets = new Map<number, Zombie[]>();
  /** Diagnostics: cost of the last ticks and work counters. */
  readonly stats = { thinkMs: 0, moveMs: 0, fieldsBuilt: 0, astarRuns: 0, astarNodes: 0, maxAlive: 0 };

  constructor(private readonly host: ZombieHost) {}

  setDifficulty(d: Difficulty): void {
    this.difficulty = DIFFICULTY[d];
  }

  get alive(): number {
    let n = 0;
    for (const z of this.zombies.values()) if (!z.dead) n++;
    return n;
  }

  clear(): void {
    this.zombies.clear();
    this.projectiles.clear();
    this.hazards.clear();
    this.targetFields.clear();
  }

  /** Doors changed: every cached field and path may be wrong. */
  invalidateNav(): void {
    for (const f of this.targetFields.values()) f.dirty = true;
    for (const z of this.zombies.values()) z.path = null;
  }

  private secTicks(sec: number): number {
    return Math.max(1, Math.round(sec * this.host.tickRate));
  }

  spawn(kind: ZombieKind, x: number, y: number, opts: SpawnOptions = {}): Zombie {
    const def = ZOMBIES[kind];
    const tick = this.host.tick;
    const players = Math.max(1, this.host.actors().length);
    // Bosses scale with the squad more than regular infected (four players must not melt them).
    const squad = def.boss ? 1 + def.boss.perExtraPlayer * (players - 1) : this.hpMult;
    const maxHp = Math.max(1, Math.round(def.maxHp * this.difficulty.enemyHp * squad));
    const z: Zombie = {
      id: `z${this.nextId++}`,
      def,
      cls: navClassFor(def.radius),
      x,
      y,
      vx: 0,
      vy: 0,
      angle: this.host.rng() * Math.PI * 2,
      hp: maxHp,
      maxHp,
      damageMult: this.difficulty.enemyDamage,
      speedMult: 0.94 + this.host.rng() * 0.12,
      state: opts.state === "wander" ? AI.WANDER : opts.state === "hunt" ? AI.CHASE : AI.IDLE,
      stateUntil: tick + this.secTicks(1 + this.host.rng() * 3),
      act: ACT.NONE,
      actTick: 0,
      actX: 0,
      actY: 0,
      actKind: "attack",
      cur: null,
      curId: "",
      cooldowns: new Map(),
      phase: 0,
      target: null,
      lastKnownX: x,
      lastKnownY: y,
      lastSeenTick: 0,
      horde: (opts.state === "hunt" && def.behaviour !== "flank") || !!def.boss,
      path: null,
      pathGoalX: x,
      pathGoalY: y,
      nextThink: tick + (this.nextId % 4),
      attackReadyTick: 0,
      specialReadyTick: tick + this.secTicks(2),
      lungeVx: 0,
      lungeVy: 0,
      lungeUntil: 0,
      ramUntil: 0,
      lungeHits: new Set(),
      homeX: x,
      homeY: y,
      progressX: x,
      progressY: y,
      progressTick: tick,
      spawnTick: tick,
      lastHurtBy: "",
      lastHurtTick: 0,
      lastNearTick: tick,
      jink: this.host.rng() * Math.PI * 2,
      wave: opts.wave ?? 0,
      group: opts.group ?? "",
      dead: false,
      enraged: false,
    };
    // A stalker spawned by a wave still has to find its prey (no free knowledge).
    if (opts.state === "hunt" && def.behaviour === "flank") z.state = AI.WANDER;
    this.armPhase(z);
    this.zombies.set(z.id, z);
    this.stats.maxAlive = Math.max(this.stats.maxAlive, this.alive);
    return z;
  }

  /** Attacks with `firstSec` wait that long into the boss's current phase. */
  private armPhase(z: Zombie): void {
    for (const a of z.def.boss?.phases[z.phase]?.attacks ?? []) {
      if (a.firstSec) z.cooldowns.set(a.id, this.host.tick + this.secTicks(a.firstSec));
    }
  }

  // ------------------------------------------------------------------ tick

  step(): void {
    const t0 = performance.now();
    const tick = this.host.tick;
    const dt = 1 / this.host.tickRate;
    const actors = this.host.actors();
    this.astarBudget = ASTAR_PER_TICK;
    this.updateFields(actors);
    for (const z of this.zombies.values()) {
      if (z.dead) continue;
      let nearest = Number.POSITIVE_INFINITY;
      for (const a of actors) if (a.alive) nearest = Math.min(nearest, Math.hypot(a.x - z.x, a.y - z.y));
      if (nearest < 1200) z.lastNearTick = tick;
      if (tick >= z.nextThink) {
        this.think(z, actors);
        const every = nearest < 900 ? 2 : nearest < 1800 ? 5 : 10;
        z.nextThink = tick + every;
      }
      this.act(z, actors);
    }
    const t1 = performance.now();
    this.move(dt, actors);
    this.stepProjectiles(dt, actors);
    this.stepHazards(dt, actors);
    for (const [id, z] of this.zombies) if (z.dead) this.zombies.delete(id);
    const t2 = performance.now();
    this.stats.thinkMs = this.stats.thinkMs * 0.9 + (t1 - t0) * 0.1;
    this.stats.moveMs = this.stats.moveMs * 0.9 + (t2 - t1) * 0.1;
  }

  // ------------------------------------------------------------------ navigation

  /** Flow fields towards each player, rebuilt round-robin when the player changes cell. */
  private updateFields(actors: readonly PveActor[]): void {
    const nav = this.host.nav();
    const live = new Set<string>();
    for (const a of actors) {
      if (!a.alive || a.airborne) continue;
      live.add(a.id);
      const cell = nearestWalkable(nav, a.x, a.y, 1, 4);
      let f = this.targetFields.get(a.id);
      if (!f) {
        f = { cell: -2, builtTick: -999, fields: [null, null, null, null], dirty: true };
        this.targetFields.set(a.id, f);
      }
      if (cell !== f.cell) f.dirty = true;
    }
    for (const id of [...this.targetFields.keys()]) if (!live.has(id)) this.targetFields.delete(id);
    // Only the clearance classes of living enemies (a boss also uses the class-2 field as a
    // fallback): a wave of walkers needs one field per player, not three.
    const classes = this.classesInUse();
    if (classes.length === 0) return;
    const ids = [...this.targetFields.keys()];
    let builds = 0;
    for (let k = 0; k < ids.length && builds < FIELD_BUILDS_PER_TICK; k++) {
      const id = ids[(this.fieldCursor + k) % ids.length]!;
      const f = this.targetFields.get(id)!;
      const missing = classes.some((c) => !f.fields[c]);
      if (!missing && (!f.dirty || this.host.tick - f.builtTick < FIELD_MIN_TICKS)) continue;
      const a = actors.find((x) => x.id === id)!;
      for (const cls of classes) {
        const src = nearestWalkable(nav, a.x, a.y, cls, 4);
        f.fields[cls] = buildFlowField(nav, cls, src >= 0 ? [src] : [], NAV_INF, f.fields[cls] ?? undefined);
      }
      f.cell = nearestWalkable(nav, a.x, a.y, 1, 4);
      f.builtTick = this.host.tick;
      f.dirty = false;
      builds++;
      this.stats.fieldsBuilt++;
    }
    this.fieldCursor = ids.length > 0 ? (this.fieldCursor + 1) % ids.length : 0;
  }

  private classesInUse(): NavClass[] {
    let mask = 0;
    for (const z of this.zombies.values()) if (!z.dead) mask |= 1 << z.cls;
    if (mask & (1 << 3)) mask |= 1 << 2;
    const out: NavClass[] = [];
    for (const c of [1, 2, 3] as const) if (mask & (1 << c)) out.push(c);
    return out;
  }

  private fieldFor(targetId: string, cls: NavClass): FlowField | null {
    return this.targetFields.get(targetId)?.fields[cls] ?? null;
  }

  /** Path distance (px) from the enemy to a player; Infinity if no path. */
  pathDistance(z: Zombie, targetId: string): number {
    const f = this.fieldFor(targetId, z.cls);
    if (!f) return Number.POSITIVE_INFINITY;
    return fieldDistancePx(this.host.nav(), f, z.x, z.y);
  }

  private planPath(z: Zombie, gx: number, gy: number): boolean {
    if (this.astarBudget <= 0) return false;
    this.astarBudget--;
    const res = findPath(
      this.host.nav(),
      this.host.world(),
      z.cls,
      { x: z.x, y: z.y },
      { x: gx, y: gy },
      2500,
    );
    this.stats.astarRuns++;
    if (!res) {
      z.path = null;
      return false;
    }
    this.stats.astarNodes += res.expanded;
    z.path = res.points;
    z.pathGoalX = gx;
    z.pathGoalY = gy;
    return true;
  }

  // ------------------------------------------------------------------ perception and decisions

  private sees(z: Zombie, a: PveActor, range: number): boolean {
    if (!a.alive || a.airborne) return false;
    const d = Math.hypot(a.x - z.x, a.y - z.y);
    if (d > range) return false;
    return hasLineOfSight(this.host.shotWorld(), z.x, z.y, a.x, a.y);
  }

  private setState(z: Zombie, s: AiState, untilSec = 0): void {
    z.state = s;
    z.stateUntil = untilSec > 0 ? this.host.tick + this.secTicks(untilSec) : 0;
    if (s !== AI.ATTACK) z.act = ACT.NONE;
  }

  /** Sound at (x, y): enemies in earshot come to look (gunfire, generators, explosions). */
  noise(x: number, y: number, radius: number): void {
    for (const z of this.zombies.values()) {
      if (z.dead || z.state === AI.CHASE || z.state === AI.ATTACK || z.state === AI.STUNNED) continue;
      const r = radius * z.def.hearing;
      if ((z.x - x) ** 2 + (z.y - y) ** 2 > r * r) continue;
      z.lastKnownX = x + (this.host.rng() - 0.5) * 120;
      z.lastKnownY = y + (this.host.rng() - 0.5) * 120;
      z.path = null;
      if (z.state !== AI.ALERT) this.setState(z, AI.ALERT, ALERT_SEC * (0.7 + this.host.rng() * 0.6));
    }
  }

  /** Target choice: reachable players, standing ones first, with hysteresis. */
  private chooseTarget(z: Zombie, actors: readonly PveActor[], knownOnly: boolean): PveActor | null {
    let best: PveActor | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let current = Number.POSITIVE_INFINITY;
    for (const a of actors) {
      if (!a.alive || a.airborne) continue;
      if (knownOnly && !this.sees(z, a, z.def.sight)) continue;
      let d = this.pathDistance(z, a.id);
      if (!Number.isFinite(d)) {
        // No path cached yet (or behind a closed door): fall back to the straight distance only
        // when it is in plain view.
        if (!this.sees(z, a, z.def.sight)) continue;
        d = Math.hypot(a.x - z.x, a.y - z.y);
      }
      let score = d * (a.downed ? 1.8 : 1);
      if (z.def.behaviour === "flank") score = this.isolationScore(a, actors, d);
      if (a.id === z.target) current = score;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    if (best && z.target && best.id !== z.target && current < bestScore / 0.7) {
      return actors.find((a) => a.id === z.target) ?? best;
    }
    return best;
  }

  /** Stalkers prefer the player farthest from their teammates (lower is better). */
  private isolationScore(a: PveActor, actors: readonly PveActor[], dist: number): number {
    let nearestMate = 2000;
    for (const o of actors) {
      if (o === a || !o.alive || o.downed) continue;
      nearestMate = Math.min(nearestMate, Math.hypot(o.x - a.x, o.y - a.y));
    }
    return dist - nearestMate * 1.5 + (a.downed ? 400 : 0);
  }

  private think(z: Zombie, actors: readonly PveActor[]): void {
    const tick = this.host.tick;
    if (z.state === AI.STUNNED || z.state === AI.ATTACK) return;
    if (z.state === AI.ALERT) {
      if (tick < z.stateUntil) return;
      const seen = this.chooseTarget(z, actors, true);
      if (seen) this.beginChase(z, seen);
      else this.setState(z, AI.INVESTIGATE);
      return;
    }
    // Horde members always know the squad's position.
    if (z.horde || z.enraged) {
      const t = this.chooseTarget(z, actors, false);
      if (t) {
        this.beginChase(z, t);
        return;
      }
    }
    if (z.state === AI.CHASE && z.target) {
      const t = actors.find((a) => a.id === z.target);
      if (t?.alive && !t.airborne) {
        if (this.sees(z, t, z.def.sight * 1.3)) {
          z.lastKnownX = t.x;
          z.lastKnownY = t.y;
          z.lastSeenTick = tick;
          // A closer/better target may appear (with hysteresis).
          const better = this.chooseTarget(z, actors, true);
          if (better) z.target = better.id;
          return;
        }
        if (tick - z.lastSeenTick < this.secTicks(z.def.memorySec)) return;
      }
      z.target = null;
      z.path = null;
      this.setState(z, AI.INVESTIGATE);
      return;
    }
    // Idle / wander / investigate: look for players (unaware enemies see a bit less far).
    const range = z.state === AI.INVESTIGATE ? z.def.sight : z.def.sight * 0.75;
    for (const a of actors) {
      if (this.sees(z, a, range)) {
        z.lastKnownX = a.x;
        z.lastKnownY = a.y;
        z.target = a.id;
        this.setState(z, AI.ALERT, ALERT_SEC);
        return;
      }
    }
    if (z.state === AI.INVESTIGATE) {
      const d = Math.hypot(z.lastKnownX - z.x, z.lastKnownY - z.y);
      if (d < 40 || (!z.path && z.stateUntil > 0 && tick >= z.stateUntil)) {
        if (z.stateUntil === 0) {
          z.stateUntil = tick + this.secTicks(LOOK_AROUND_SEC);
        } else if (tick >= z.stateUntil) {
          z.homeX = z.x;
          z.homeY = z.y;
          this.setState(z, AI.WANDER, 3 + this.host.rng() * 3);
        }
        return;
      }
      if (!z.path || Math.hypot(z.pathGoalX - z.lastKnownX, z.pathGoalY - z.lastKnownY) > 60) {
        if (!this.planPath(z, z.lastKnownX, z.lastKnownY) && !z.path) {
          // Unreachable: give up and wander.
          this.setState(z, AI.WANDER, 3);
        }
      }
      return;
    }
    if (z.state === AI.IDLE && tick >= z.stateUntil) {
      this.setState(z, AI.WANDER, 3 + this.host.rng() * 4);
      return;
    }
    if (z.state === AI.WANDER) {
      if (tick >= z.stateUntil && !z.path) {
        this.setState(z, AI.IDLE, 1 + this.host.rng() * 3);
        return;
      }
      if (!z.path) {
        const p = randomWalkableNear(this.host.nav(), z.cls, z.homeX, z.homeY, 260, () => this.host.rng());
        if (p) this.planPath(z, p.x, p.y);
      }
    }
    // Stalkers that never find anyone eventually pick up the scent of the most isolated player.
    if (z.def.behaviour === "flank" && tick - z.spawnTick > this.secTicks(15) && !z.target) {
      const t = this.chooseTarget(z, actors, false);
      if (t) {
        z.lastKnownX = t.x;
        z.lastKnownY = t.y;
        this.setState(z, AI.INVESTIGATE);
      }
    }
  }

  private beginChase(z: Zombie, t: PveActor): void {
    z.target = t.id;
    z.lastKnownX = t.x;
    z.lastKnownY = t.y;
    z.lastSeenTick = this.host.tick;
    z.path = null;
    if (z.state !== AI.CHASE) this.setState(z, AI.CHASE);
  }

  // ------------------------------------------------------------------ attacks

  /** Edge-to-edge distance to an actor (or to the hull of their vehicle). */
  private reach(z: Zombie, a: PveActor): { dist: number; vehicle: VehicleBody | null; x: number; y: number } {
    if (a.vehicle) {
      const v = this.host.vehicles().find((b) => b.id === a.vehicle);
      if (v) {
        let best = Number.POSITIVE_INFINITY;
        let bx = a.x;
        let by = a.y;
        for (const c of v.circles) {
          const d = Math.hypot(c.x - z.x, c.y - z.y) - c.r - z.def.radius;
          if (d < best) {
            best = d;
            bx = c.x;
            by = c.y;
          }
        }
        return { dist: best, vehicle: v, x: bx, y: by };
      }
    }
    return {
      dist: Math.hypot(a.x - z.x, a.y - z.y) - PLAYER.radius - z.def.radius,
      vehicle: null,
      x: a.x,
      y: a.y,
    };
  }

  private act(z: Zombie, actors: readonly PveActor[]): void {
    const tick = this.host.tick;
    if (z.state === AI.STUNNED) {
      if (tick >= z.stateUntil) this.setState(z, z.target ? AI.CHASE : AI.INVESTIGATE);
      return;
    }
    const target = z.target ? actors.find((a) => a.id === z.target) : undefined;
    if (z.state === AI.ATTACK) {
      this.runAttack(z, target, actors);
      return;
    }
    if (z.state !== AI.CHASE || !target?.alive || target.airborne) return;
    const r = this.reach(z, target);
    if (z.def.boss && this.bossAct(z, target)) return;
    const atk = z.def.attack;
    const sp = z.def.special;
    if (sp && tick >= z.specialReadyTick && !r.vehicle) {
      const d = Math.hypot(target.x - z.x, target.y - z.y);
      if (
        d >= sp.minRange &&
        d <= sp.maxRange &&
        clearPath(this.host.world(), z.x, z.y, target.x, target.y, z.def.radius)
      ) {
        // Charge: telegraph the line it will run along.
        const ang = Math.atan2(target.y - z.y, target.x - z.x);
        const len = (sp.lungeSpeed ?? 500) * (sp.lungeSec ?? 0.8);
        this.startAct(z, "special", z.x + Math.cos(ang) * len, z.y + Math.sin(ang) * len, sp);
        return;
      }
    }
    if (tick < z.attackReadyTick) return;
    switch (atk.kind) {
      case "melee":
        if (r.dist <= atk.range) this.startAct(z, "attack", r.x, r.y);
        break;
      case "explode":
        if (r.dist <= atk.range) this.startAct(z, "attack", z.x, z.y);
        break;
      case "pounce": {
        const d = Math.hypot(target.x - z.x, target.y - z.y);
        const facing = Math.abs(wrapAngle(target.aim - Math.atan2(z.y - target.y, z.x - target.x)));
        // Pounces when close, from behind or the side (not into the barrel), or when cornered.
        if (
          d <= atk.range &&
          (facing > 1.1 || d < 70 || target.downed) &&
          this.sees(z, target, atk.range + 20)
        ) {
          this.startAct(z, "attack", target.x, target.y);
        }
        break;
      }
      case "spit": {
        const d = Math.hypot(target.x - z.x, target.y - z.y);
        if (d <= atk.range && this.sees(z, target, atk.range)) {
          // Lead the target a little.
          const t = d / (atk.projectileSpeed ?? 400);
          this.startAct(z, "attack", target.x + target.vx * t * 0.5, target.y + target.vy * t * 0.5);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Boss attack choice: the first ready attack of the current phase whose distance band fits
   * (slam when close, debris at range, charge on a clear lane, summon when few adds remain).
   * Returns false to fall back to the basic melee.
   */
  private bossAct(z: Zombie, t: PveActor): boolean {
    const tick = this.host.tick;
    const phase = z.def.boss!.phases[z.phase]!;
    const d = Math.hypot(t.x - z.x, t.y - z.y);
    const order = ["vent", "sweep", "slam", "throw", "charge", "summon"];
    const attacks = [...phase.attacks].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    // Cannot reach the squad (cramped map, cut off): it keeps throwing debris from where it is,
    // so it stays a threat and the fight still ends.
    const stuck = tick - z.progressTick > this.secTicks(1.5) || !Number.isFinite(this.pathDistance(z, t.id));
    if (stuck && !attacks.some((a) => a.kind === "throw")) {
      const fallback = z.def.boss!.phases.flatMap((p) => p.attacks).find((a) => a.kind === "throw");
      if (fallback) attacks.unshift({ ...fallback, minRange: 0 });
    }
    for (const a of attacks) {
      if (tick < (z.cooldowns.get(a.id) ?? 0)) continue;
      if (d < a.minRange || d > a.maxRange) continue;
      if (a.kind === "charge" && !clearPath(this.host.world(), z.x, z.y, t.x, t.y, z.def.radius)) continue;
      if (a.kind === "sweep" && !this.sweepTarget(z, a, t)) continue;
      if (a.kind === "throw" && !this.sees(z, t, a.maxRange)) continue;
      if (a.kind === "summon") {
        let adds = 0;
        for (const o of this.zombies.values()) if (!o.dead && o.group === z.id) adds++;
        if (adds >= 4) continue;
      }
      this.startBossAttack(z, a, t);
      return true;
    }
    return false;
  }

  /**
   * Where a sweep would strike, or null when nobody is there: in front, the target well inside the
   * cone it faces; behind (`rear`), any player inside the cone at its back.
   */
  private sweepTarget(z: Zombie, a: AttackDef, t: PveActor): Vec2 | null {
    const r = (a.radius ?? 180) * 0.9;
    const arc = (a.arc ?? 1) * 0.85;
    if (!a.rear) {
      const d = Math.hypot(t.x - z.x, t.y - z.y);
      if (d > r) return null;
      return { x: t.x, y: t.y };
    }
    const back = z.angle + Math.PI;
    for (const o of this.host.actors()) {
      if (!o.alive || o.vehicle || o.airborne) continue;
      const d = Math.hypot(o.x - z.x, o.y - z.y);
      if (d > r) continue;
      if (Math.abs(wrapAngle(Math.atan2(o.y - z.y, o.x - z.x) - back)) > arc) continue;
      return { x: z.x + Math.cos(back) * r, y: z.y + Math.sin(back) * r };
    }
    return null;
  }

  private startBossAttack(z: Zombie, a: BossAttackDef, t: PveActor | undefined): void {
    const phase = z.def.boss!.phases[z.phase]!;
    const def: BossAttackDef = { ...a, windupSec: a.windupSec * phase.windupMult };
    let tx = z.x;
    let ty = z.y;
    if (a.kind === "sweep") {
      // The cone is committed where it starts: dodge sideways out of it, or get out of range.
      const at = t ? this.sweepTarget(z, a, t) : null;
      const facing = z.angle;
      const dir = a.rear ? facing + Math.PI : at ? Math.atan2(at.y - z.y, at.x - z.x) : facing;
      const reach = a.radius ?? 180;
      z.curId = a.id;
      this.startAct(z, "boss", z.x + Math.cos(dir) * reach, z.y + Math.sin(dir) * reach, def);
      // A tail lash strikes behind without turning around.
      if (a.rear) z.angle = facing;
      return;
    }
    if (t && (a.kind === "charge" || a.kind === "throw")) {
      const ang = Math.atan2(t.y - z.y, t.x - z.x);
      const len =
        a.kind === "charge" ? (a.lungeSpeed ?? 500) * (a.lungeSec ?? 0.8) : Math.hypot(t.x - z.x, t.y - z.y);
      tx = z.x + Math.cos(ang) * len;
      ty = z.y + Math.sin(ang) * len;
    }
    z.curId = a.id;
    this.startAct(z, "boss", tx, ty, def);
  }

  private startAct(
    z: Zombie,
    kind: "attack" | "special" | "boss",
    tx: number,
    ty: number,
    def?: AttackDef,
  ): void {
    z.cur = def ?? z.def.attack;
    z.state = AI.ATTACK;
    z.act = ACT.WINDUP;
    z.actKind = kind;
    z.actTick = this.host.tick;
    z.actX = tx;
    z.actY = ty;
    // Attacks centred on itself (slam, roar, vent) keep the facing it had.
    if (tx !== z.x || ty !== z.y) z.angle = Math.atan2(ty - z.y, tx - z.x);
  }

  private runAttack(z: Zombie, target: PveActor | undefined, actors: readonly PveActor[]): void {
    const tick = this.host.tick;
    const def = z.cur ?? z.def.attack;
    const elapsed = tick - z.actTick;
    if (z.act === ACT.WINDUP) {
      if (
        target &&
        def.kind !== "charge" &&
        def.kind !== "slam" &&
        def.kind !== "roar" &&
        def.kind !== "summon" &&
        def.kind !== "sweep" &&
        def.kind !== "vent"
      ) {
        // Melee and spit keep tracking during the windup; charges and blasts are committed.
        if (def.kind === "melee" || def.kind === "pounce") {
          const r = this.reach(z, target);
          z.actX = r.x;
          z.actY = r.y;
        }
        if (def.kind !== "explode") z.angle = Math.atan2(z.actY - z.y, z.actX - z.x);
      }
      if (elapsed < this.secTicks(def.windupSec)) return;
      z.act = ACT.ACTIVE;
      z.actTick = tick;
      this.strike(z, def, target, actors);
      return;
    }
    if (z.act === ACT.ACTIVE) {
      if ((def.kind === "charge" || def.kind === "pounce") && tick < z.lungeUntil) return;
      z.act = ACT.RECOVER;
      z.actTick = tick;
      return;
    }
    if (z.act === ACT.RECOVER && elapsed >= this.secTicks(def.recoverSec)) {
      z.act = ACT.NONE;
      z.attackReadyTick = tick + this.secTicks(0.2);
      if (z.actKind === "special" && z.def.special)
        z.specialReadyTick = tick + this.secTicks(z.def.special.cooldownSec);
      if (z.actKind === "boss") {
        const b = def as BossAttackDef;
        if (b.id) z.cooldowns.set(b.id, tick + this.secTicks(b.cooldownSec));
        // Combos: the next attack follows at once (still telegraphed).
        const next = b.combo ? z.def.boss!.phases[z.phase]!.attacks.find((x) => x.id === b.combo) : undefined;
        if (next) {
          this.startBossAttack(z, next, target);
          return;
        }
      }
      z.cur = null;
      this.setState(z, z.target ? AI.CHASE : AI.INVESTIGATE);
    }
  }

  private strike(z: Zombie, def: AttackDef, target: PveActor | undefined, actors: readonly PveActor[]): void {
    const dmg = def.damage * z.damageMult;
    switch (def.kind) {
      case "sweep": {
        const radius = def.radius ?? 180;
        const arc = def.arc ?? 1;
        const dir = Math.atan2(z.actY - z.y, z.actX - z.x);
        this.host.emit({ t: "zatk", z: z.id, k: "sweep", x: Math.round(z.actX), y: Math.round(z.actY) });
        for (const a of actors) {
          if (!a.alive || a.vehicle) continue;
          const d = Math.hypot(a.x - z.x, a.y - z.y);
          if (d > radius + PLAYER.radius) continue;
          const ang = Math.atan2(a.y - z.y, a.x - z.x);
          // The cone's edge counts the player's body, not only their centre.
          const slack = d > 1 ? Math.asin(Math.min(1, PLAYER.radius / d)) : Math.PI;
          if (Math.abs(wrapAngle(ang - dir)) > arc + slack) continue;
          const k = def.knockback ?? 0;
          this.host.hurtPlayer(a.id, dmg, z, a.x, a.y, { x: Math.cos(ang) * k, y: Math.sin(ang) * k });
        }
        return;
      }
      case "vent": {
        // The plates slam shut: a short burst around it ends the window.
        const radius = def.radius ?? 140;
        const edge = def.edgeFactor ?? 0.6;
        this.host.emit({ t: "zatk", z: z.id, k: "vent", x: Math.round(z.x), y: Math.round(z.y) });
        for (const a of actors) {
          if (!a.alive || a.vehicle) continue;
          const d = Math.hypot(a.x - z.x, a.y - z.y);
          if (d > radius + PLAYER.radius) continue;
          const ang = Math.atan2(a.y - z.y, a.x - z.x);
          const k = def.knockback ?? 0;
          const amount = dmg * (1 - (1 - edge) * clamp(d / radius, 0, 1));
          this.host.hurtPlayer(a.id, amount, z, a.x, a.y, { x: Math.cos(ang) * k, y: Math.sin(ang) * k });
        }
        return;
      }
      case "slam":
      case "roar": {
        const radius = def.radius ?? (def.kind === "roar" ? ROAR_RADIUS : 160);
        const edge = def.edgeFactor ?? 0.5;
        this.host.emit({ t: "zatk", z: z.id, k: def.kind, x: Math.round(z.x), y: Math.round(z.y) });
        for (const a of actors) {
          if (!a.alive || a.vehicle) continue;
          const d = Math.hypot(a.x - z.x, a.y - z.y);
          if (d > radius + PLAYER.radius) continue;
          const ang = Math.atan2(a.y - z.y, a.x - z.x);
          const k = def.knockback ?? 0;
          const knock = { x: Math.cos(ang) * k, y: Math.sin(ang) * k };
          // The roar only pushes (a breather between phases).
          const amount = def.kind === "roar" ? 0 : dmg * (1 - (1 - edge) * clamp(d / radius, 0, 1));
          this.host.hurtPlayer(a.id, amount, z, a.x, a.y, knock);
        }
        return;
      }
      case "throw": {
        const n = Math.max(1, def.volley ?? 1);
        const speed = def.projectileSpeed ?? 500;
        for (let i = 0; i < n; i++) {
          // Extra pieces land around the target: the marked circles show where.
          const spread = i === 0 ? 0 : 110;
          const a = (i / n) * Math.PI * 2 + z.angle;
          const tx = z.actX + Math.cos(a) * spread;
          const ty = z.actY + Math.sin(a) * spread;
          const ang = Math.atan2(ty - z.y, tx - z.x);
          const len = Math.hypot(tx - z.x, ty - z.y);
          const p: Projectile = {
            id: this.nextProj++,
            x: z.x,
            y: z.y,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            left: len,
            damage: dmg,
            puddle: undefined,
            from: z.id,
            lob: { radius: def.radius ?? 90, edge: def.edgeFactor ?? 0.4 },
          };
          this.projectiles.set(p.id, p);
          this.host.emit({
            t: "proj",
            id: p.id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            vx: Math.round(p.vx),
            vy: Math.round(p.vy),
            tx: Math.round(tx),
            ty: Math.round(ty),
            r: p.lob!.radius,
          });
        }
        this.host.emit({ t: "zatk", z: z.id, k: "throw", x: Math.round(z.x), y: Math.round(z.y) });
        return;
      }
      case "summon": {
        const sm = def.summon;
        this.host.emit({ t: "zatk", z: z.id, k: "summon", x: Math.round(z.x), y: Math.round(z.y) });
        if (!sm) return;
        const nav = this.host.nav();
        // Summons respect the global enemy cap like every other spawn.
        const n = Math.min(sm.count, Math.max(0, MAX_ZOMBIES - this.alive));
        for (let i = 0; i < n; i++) {
          const a = (i / sm.count) * Math.PI * 2;
          const at = randomWalkableNear(nav, 1, z.x + Math.cos(a) * 120, z.y + Math.sin(a) * 120, 60, () =>
            this.host.rng(),
          );
          if (at) this.spawn(sm.kind, at.x, at.y, { state: "hunt", group: z.id, wave: z.wave });
        }
        return;
      }
      case "melee": {
        this.host.emit({ t: "zatk", z: z.id, k: "melee", x: Math.round(z.actX), y: Math.round(z.actY) });
        if (!target?.alive) return;
        const r = this.reach(z, target);
        const ang = Math.atan2(r.y - z.y, r.x - z.x);
        if (r.dist > def.range + MELEE_GRACE || Math.abs(wrapAngle(ang - z.angle)) > 1.4) return;
        if (r.vehicle) {
          this.host.hurtVehicle(r.vehicle.id, dmg * 1.5, r.x, r.y);
          return;
        }
        const knock = def.knockback
          ? { x: Math.cos(ang) * def.knockback, y: Math.sin(ang) * def.knockback }
          : undefined;
        this.host.hurtPlayer(target.id, dmg, z, target.x, target.y, knock);
        return;
      }
      case "spit": {
        const speed = def.projectileSpeed ?? 400;
        const ang = Math.atan2(z.actY - z.y, z.actX - z.x);
        const p: Projectile = {
          id: this.nextProj++,
          x: z.x + Math.cos(ang) * (z.def.radius + 6),
          y: z.y + Math.sin(ang) * (z.def.radius + 6),
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          left: Math.min(def.range * 1.15, Math.hypot(z.actX - z.x, z.actY - z.y) + 60),
          damage: dmg,
          puddle: def.puddle,
          from: z.id,
        };
        this.projectiles.set(p.id, p);
        this.host.emit({
          t: "proj",
          id: p.id,
          x: Math.round(p.x),
          y: Math.round(p.y),
          vx: Math.round(p.vx),
          vy: Math.round(p.vy),
        });
        this.host.emit({ t: "zatk", z: z.id, k: "spit", x: Math.round(z.x), y: Math.round(z.y) });
        return;
      }
      case "explode":
        this.detonate(z, "");
        return;
      case "pounce":
      case "charge": {
        const ang = Math.atan2(z.actY - z.y, z.actX - z.x);
        const speed = def.lungeSpeed ?? 500;
        z.lungeVx = Math.cos(ang) * speed;
        z.lungeVy = Math.sin(ang) * speed;
        z.lungeUntil = this.host.tick + this.secTicks(def.lungeSec ?? 0.5);
        z.lungeHits.clear();
        z.angle = ang;
        this.host.emit({ t: "zatk", z: z.id, k: def.kind, x: Math.round(z.x), y: Math.round(z.y) });
        void actors;
        return;
      }
    }
  }

  /** Exploder blast: hurts players, vehicles and other enemies (credited to `killer`). */
  private detonate(z: Zombie, killer: string): void {
    if (z.dead) return;
    const atk = z.def.attack;
    const radius = atk.radius ?? 120;
    const edge = atk.edgeFactor ?? 0.4;
    const dmg = atk.damage * z.damageMult;
    z.dead = true;
    z.hp = 0;
    this.host.emit({ t: "boom", x: Math.round(z.x), y: Math.round(z.y), r: radius });
    this.host.emit({ t: "zdie", z: z.id, p: killer, x: Math.round(z.x), y: Math.round(z.y), k: z.def.index });
    this.host.onKilled(z, killer);
    const falloff = (d: number) => dmg * (1 - (1 - edge) * clamp(d / radius, 0, 1));
    for (const a of this.host.actors()) {
      if (!a.alive || a.vehicle) continue;
      const d = Math.hypot(a.x - z.x, a.y - z.y);
      if (d > radius + PLAYER.radius) continue;
      if (!hasLineOfSight(this.host.shotWorld(), z.x, z.y, a.x, a.y)) continue;
      const ang = Math.atan2(a.y - z.y, a.x - z.x);
      this.host.hurtPlayer(a.id, falloff(d), z, a.x, a.y, { x: Math.cos(ang) * 300, y: Math.sin(ang) * 300 });
    }
    for (const v of this.host.vehicles()) {
      const c = v.circles[0];
      if (!c) continue;
      const d = Math.hypot(c.x - z.x, c.y - z.y) - c.r;
      if (d <= radius) this.host.hurtVehicle(v.id, falloff(Math.max(0, d)) * 1.5, c.x, c.y);
    }
    for (const o of this.zombies.values()) {
      if (o === z || o.dead) continue;
      const d = Math.hypot(o.x - z.x, o.y - z.y);
      if (d > radius + o.def.radius) continue;
      this.damage(o, falloff(d) * EXPLODER_ZOMBIE_DAMAGE_MULT, killer, false, o.x, o.y);
    }
  }

  // ------------------------------------------------------------------ damage

  /** A plated enemy in its vulnerability window (the vent's windup). */
  static venting(z: Zombie): boolean {
    return z.cur?.kind === "vent" && z.act === ACT.WINDUP && z.state === AI.ATTACK;
  }

  /** Whether a hit at distance `offset` from the centre is a precision hit. */
  static precision(z: Zombie, offset: number): boolean {
    return offset <= z.def.radius * PRECISION_RADIUS_FRACTION;
  }

  /**
   * Damage to an enemy. Returns the damage actually dealt. Being shot alerts the enemy to the
   * shooter (it knows where the shot came from).
   */
  damage(z: Zombie, raw: number, by: string, precise: boolean, x: number, y: number, scaled = false): number {
    if (z.dead || raw <= 0) return 0;
    let dmg = raw * z.def.armor;
    let armored = z.def.armor < 1;
    const plating = z.def.plating;
    if (plating) {
      // Directional armour replaces the centre-mass bonus: where the hit lands is what counts.
      if (precise && scaled) dmg /= PRECISION_DAMAGE_MULT;
      precise = false;
      const off = Math.hypot(x - z.x, y - z.y);
      // Blasts and rams (no hit point on the body) count as the flank.
      const side = off < 2 ? "side" : hitSide(plating, Math.atan2(y - z.y, x - z.x) - z.angle);
      const mult = platingMult(plating, side, ZombieWorld.venting(z));
      dmg *= mult;
      armored = mult < 1;
      precise = side === "back";
    }
    // `scaled`: the caller already applied the precision bonus per pellet.
    if (precise && !scaled && !plating) dmg *= PRECISION_DAMAGE_MULT;
    if (z.state === AI.STUNNED) dmg *= z.def.stunnedDamageMult;
    // A boss roaring through a phase transition shrugs off almost everything.
    if (z.cur?.kind === "roar" && z.act === ACT.WINDUP) dmg *= 0.1;
    const dealt = Math.max(1, Math.round(dmg));
    z.hp = Math.max(0, z.hp - dealt);
    if (by) {
      z.lastHurtBy = by;
      z.lastHurtTick = this.host.tick;
    }
    const lethal = z.hp === 0;
    if (!lethal && z.def.boss) {
      const ph = bossPhase(z.def, z.hp / z.maxHp);
      if (ph > z.phase) {
        z.phase = ph;
        z.lungeUntil = 0;
        z.cooldowns.clear();
        this.host.emit({ t: "pve", k: "bossPhase", n: ph + 1, s: z.id });
        this.startAct(z, "boss", z.x, z.y, {
          kind: "roar",
          range: 0,
          windupSec: z.def.boss.transitionSec,
          recoverSec: 0.3,
          damage: 0,
          radius: ROAR_RADIUS,
          knockback: ROAR_KNOCKBACK,
        });
        z.curId = "";
        this.armPhase(z);
      }
    }
    const ev: NetEvent = {
      t: "zhit",
      p: by,
      z: z.id,
      dmg: dealt,
      x: Math.round(x),
      y: Math.round(y),
      k: lethal,
    };
    if (precise) ev.c = 1;
    if (armored) ev.a = 1;
    this.host.emit(ev);
    if (lethal) {
      this.kill(z, by);
      return dealt;
    }
    if (by && z.state !== AI.CHASE && z.state !== AI.ATTACK && z.state !== AI.STUNNED) {
      const shooter = this.host.actors().find((a) => a.id === by);
      if (shooter) this.beginChase(z, shooter);
    }
    return dealt;
  }

  kill(z: Zombie, killer: string): void {
    if (z.dead) return;
    if (z.def.attack.kind === "explode") {
      this.detonate(z, killer);
      return;
    }
    z.dead = true;
    this.host.emit({ t: "zdie", z: z.id, p: killer, x: Math.round(z.x), y: Math.round(z.y), k: z.def.index });
    this.host.onKilled(z, killer);
  }

  /** Removes an enemy without a death (straggler culling, mission reset). */
  remove(z: Zombie): void {
    z.dead = true;
  }

  // ------------------------------------------------------------------ movement

  private desiredVelocity(
    z: Zombie,
    actors: readonly PveActor[],
  ): { vx: number; vy: number; face: number | null } {
    const tick = this.host.tick;
    const world = this.host.world();
    const phaseMult = z.def.boss ? (z.def.boss.phases[z.phase]?.speedMult ?? 1) : 1;
    const speed = z.def.speed * z.speedMult * phaseMult * (z.enraged ? 1.25 : 1);
    const toward = (tx: number, ty: number, s: number) => {
      const dx = tx - z.x;
      const dy = ty - z.y;
      const d = Math.hypot(dx, dy) || 1;
      return { vx: (dx / d) * s, vy: (dy / d) * s, face: Math.atan2(dy, dx) };
    };
    const stop = { vx: 0, vy: 0, face: null };
    const followPath = (s: number) => {
      if (!z.path || z.path.length === 0) return stop;
      const wp = z.path[0]!;
      if (Math.hypot(wp.x - z.x, wp.y - z.y) < 18) {
        z.path.shift();
        if (z.path.length === 0) {
          z.path = null;
          return stop;
        }
      }
      const next = z.path[0]!;
      return toward(next.x, next.y, s);
    };
    switch (z.state) {
      case AI.ATTACK: {
        const def = z.cur ?? z.def.attack;
        if (z.act === ACT.ACTIVE && (def.kind === "charge" || def.kind === "pounce") && tick < z.lungeUntil) {
          return { vx: z.lungeVx, vy: z.lungeVy, face: Math.atan2(z.lungeVy, z.lungeVx) };
        }
        // Exploders keep shuffling forward on a lit fuse; everybody else plants their feet.
        if (z.act === ACT.WINDUP && def.kind === "explode") {
          const t = actors.find((a) => a.id === z.target);
          if (t) return toward(t.x, t.y, speed * 0.35);
        }
        return stop;
      }
      case AI.STUNNED:
      case AI.ALERT:
        return stop;
      case AI.IDLE:
        return stop;
      case AI.WANDER:
        return followPath(z.def.wanderSpeed);
      case AI.INVESTIGATE: {
        if (z.path) return followPath(speed * 0.8);
        const d = Math.hypot(z.lastKnownX - z.x, z.lastKnownY - z.y);
        if (d > 30 && clearPath(world, z.x, z.y, z.lastKnownX, z.lastKnownY, z.def.radius)) {
          return toward(z.lastKnownX, z.lastKnownY, speed * 0.8);
        }
        return stop;
      }
      case AI.CHASE: {
        const t = z.target ? actors.find((a) => a.id === z.target) : undefined;
        if (!t) return stop;
        const d = Math.hypot(t.x - z.x, t.y - z.y);
        const direct = d < 220 && clearPath(world, z.x, z.y, t.x, t.y, z.def.radius);
        const pathTo = (s: number) => {
          if (direct) return toward(t.x, t.y, s);
          const f = this.fieldFor(t.id, z.cls);
          let steer = f ? flowSteer(this.host.nav(), world, f, z.x, z.y, z.def.radius) : null;
          if (!steer && z.cls === 3) {
            // A boss on a map without lanes its size: follow the large-body field and let the
            // collision resolver slide it along walls (it may still get wedged; then it throws).
            const f2 = this.fieldFor(t.id, 2);
            steer = f2 ? flowSteer(this.host.nav(), world, f2, z.x, z.y, NAV_CLASS_RADIUS[2]) : null;
          }
          if (steer) return toward(steer.x, steer.y, s);
          // No field yet / unreachable: plan an A* path to the last known position.
          if (!z.path || Math.hypot(z.pathGoalX - t.x, z.pathGoalY - t.y) > 120) this.planPath(z, t.x, t.y);
          return followPath(s);
        };
        if (z.def.behaviour === "keepDistance" && z.def.preferredRange) {
          const pr = z.def.preferredRange;
          const visible = d < z.def.sight && hasLineOfSight(this.host.shotWorld(), z.x, z.y, t.x, t.y);
          if (visible && d < pr * 0.7) {
            const away = toward(z.x * 2 - t.x, z.y * 2 - t.y, speed);
            return { ...away, face: Math.atan2(t.y - z.y, t.x - z.x) };
          }
          if (visible && d < pr * 1.15) {
            // Strafe around the target, facing it.
            const side = Math.sin(tick / 40 + z.jink) > 0 ? 1 : -1;
            const ang = Math.atan2(t.y - z.y, t.x - z.x) + (Math.PI / 2) * side;
            return {
              vx: Math.cos(ang) * speed * 0.45,
              vy: Math.sin(ang) * speed * 0.45,
              face: Math.atan2(t.y - z.y, t.x - z.x),
            };
          }
          return pathTo(speed);
        }
        if (z.def.behaviour === "flank")
          return this.flankVelocity(z, t, d, speed, toward, followPath, pathTo);
        const v = pathTo(speed);
        // Plated enemies keep their front to their quarry in sight, whichever way they walk:
        // the weak back is for a teammate to find.
        if (z.def.plating && d < 520 && hasLineOfSight(this.host.shotWorld(), z.x, z.y, t.x, t.y))
          return { ...v, face: Math.atan2(t.y - z.y, t.x - z.x) };
        if (z.def.kind === "runner" && d > 90) {
          // Erratic: weave across the approach line.
          const w = Math.sin(tick / 6 + z.jink) * 0.55;
          const c = Math.cos(w);
          const s = Math.sin(w);
          return { vx: v.vx * c - v.vy * s, vy: v.vx * s + v.vy * c, face: v.face };
        }
        return v;
      }
      default:
        return stop;
    }
  }

  /**
   * Stalker: circles towards a point behind its prey (out of the prey's aim), waits in cover while
   * being looked at, and closes in when the prey turns away.
   */
  private flankVelocity(
    z: Zombie,
    t: PveActor,
    d: number,
    speed: number,
    toward: (x: number, y: number, s: number) => { vx: number; vy: number; face: number | null },
    followPath: (s: number) => { vx: number; vy: number; face: number | null },
    pathTo: (s: number) => { vx: number; vy: number; face: number | null },
  ) {
    const lookAt = Math.abs(wrapAngle(t.aim - Math.atan2(z.y - t.y, z.x - t.x)));
    const watched = lookAt < 0.5 && hasLineOfSight(this.host.shotWorld(), z.x, z.y, t.x, t.y);
    if (d < 160 && !watched) return toward(t.x, t.y, speed);
    if (watched && d > 140) {
      // Break line of sight: step sideways towards the nearest cover.
      if (!z.path) {
        const nav = this.host.nav();
        for (let k = 0; k < 8; k++) {
          const a = this.host.rng() * Math.PI * 2;
          const px = z.x + Math.cos(a) * 160;
          const py = z.y + Math.sin(a) * 160;
          if (!walkable(nav, cellIndex(nav, px, py), z.cls)) continue;
          if (hasLineOfSight(this.host.shotWorld(), t.x, t.y, px, py)) continue;
          if (this.planPath(z, px, py)) break;
        }
      }
      if (z.path) return followPath(speed);
      return { vx: 0, vy: 0, face: Math.atan2(t.y - z.y, t.x - z.x) };
    }
    // Approach a point behind the prey.
    const behind = t.aim + Math.PI + (Math.sin(z.jink) > 0 ? 0.6 : -0.6);
    const gx = t.x + Math.cos(behind) * 200;
    const gy = t.y + Math.sin(behind) * 200;
    const nav = this.host.nav();
    if (walkable(nav, cellIndex(nav, gx, gy), z.cls) && d > 260) {
      if (!z.path || Math.hypot(z.pathGoalX - gx, z.pathGoalY - gy) > 140) this.planPath(z, gx, gy);
      if (z.path) return followPath(speed);
    }
    return pathTo(speed);
  }

  private move(dt: number, actors: readonly PveActor[]): void {
    const world = this.host.world();
    const tick = this.host.tick;
    const vehicleCircles: Circle[] = [];
    for (const v of this.host.vehicles()) vehicleCircles.push(...v.circles);
    // Spatial hash for separation.
    this.buckets.clear();
    const key = (cx: number, cy: number) => cx * 4096 + cy;
    for (const z of this.zombies.values()) {
      if (z.dead) continue;
      const k = key(Math.floor(z.x / SEPARATION_CELL), Math.floor(z.y / SEPARATION_CELL));
      let b = this.buckets.get(k);
      if (!b) {
        b = [];
        this.buckets.set(k, b);
      }
      b.push(z);
    }
    for (const z of this.zombies.values()) {
      if (z.dead) continue;
      const want = this.desiredVelocity(z, actors);
      const lunging = z.state === AI.ATTACK && z.act === ACT.ACTIVE && tick < z.lungeUntil;
      const accel = lunging ? 1e9 : z.def.speed * 7;
      const dvx = want.vx - z.vx;
      const dvy = want.vy - z.vy;
      const dl = Math.hypot(dvx, dvy);
      const maxDv = accel * dt;
      if (dl <= maxDv) {
        z.vx = want.vx;
        z.vy = want.vy;
      } else {
        z.vx += (dvx / dl) * maxDv;
        z.vy += (dvy / dl) * maxDv;
      }
      if (want.face !== null) {
        const turn = z.def.turnRate * dt;
        const diff = wrapAngle(want.face - z.angle);
        z.angle = wrapAngle(z.angle + clamp(diff, -turn, turn));
      }
      // Separation from neighbours (heavier bodies shove lighter ones).
      let sx = 0;
      let sy = 0;
      const cx = Math.floor(z.x / SEPARATION_CELL);
      const cy = Math.floor(z.y / SEPARATION_CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const b = this.buckets.get(key(cx + ox, cy + oy));
          if (!b) continue;
          for (const o of b) {
            if (o === z) continue;
            const dx = z.x - o.x;
            const dy = z.y - o.y;
            const min = z.def.radius + o.def.radius + 2;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const share = o.def.mass / (o.def.mass + z.def.mass);
            sx += (dx / d) * (min - d) * share;
            sy += (dy / d) * (min - d) * share;
          }
        }
      }
      let nx = z.x + z.vx * dt + sx * 0.5;
      let ny = z.y + z.vy * dt + sy * 0.5;
      // Bodies never overlap players (players are never pushed by the crowd: no mispredictions).
      for (const a of actors) {
        if (!a.alive || a.vehicle) continue;
        const dx = nx - a.x;
        const dy = ny - a.y;
        const min = z.def.radius + PLAYER.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = a.x + (dx / d) * min;
          ny = a.y + (dy / d) * min;
        }
      }
      if (vehicleCircles.length > 0) {
        const out = pushOutOfCircles(nx, ny, z.def.radius, vehicleCircles);
        nx = out.x;
        ny = out.y;
      }
      const r = resolveCircle(world, nx, ny, z.def.radius);
      if (lunging && (r.hitX || r.hitY)) this.onLungeWall(z);
      z.x = r.x;
      z.y = r.y;
      if (r.hitX) z.vx = 0;
      if (r.hitY) z.vy = 0;
      if (lunging) this.lungeContacts(z, actors);
      this.checkStuck(z);
    }
  }

  private onLungeWall(z: Zombie): void {
    z.lungeUntil = 0;
    z.vx = 0;
    z.vy = 0;
    if (z.def.wallStunSec > 0) {
      this.host.emit({ t: "zatk", z: z.id, k: "slam", x: Math.round(z.x), y: Math.round(z.y) });
      z.act = ACT.NONE;
      if (z.actKind === "special" && z.def.special)
        z.specialReadyTick = this.host.tick + this.secTicks(z.def.special.cooldownSec);
      if (z.actKind === "boss" && z.curId) {
        const b = z.cur as BossAttackDef;
        z.cooldowns.set(z.curId, this.host.tick + this.secTicks(b.cooldownSec ?? 6));
      }
      z.cur = null;
      this.setState(z, AI.STUNNED, z.def.wallStunSec);
    }
  }

  private lungeContacts(z: Zombie, actors: readonly PveActor[]): void {
    const def = z.cur ?? z.def.attack;
    for (const a of actors) {
      if (!a.alive || a.vehicle || z.lungeHits.has(a.id)) continue;
      if (Math.hypot(a.x - z.x, a.y - z.y) > z.def.radius + PLAYER.radius + 6) continue;
      z.lungeHits.add(a.id);
      const ang = Math.atan2(a.y - z.y, a.x - z.x);
      const k = def.knockback ?? 0;
      this.host.hurtPlayer(a.id, def.damage * z.damageMult, z, a.x, a.y, {
        x: Math.cos(ang) * k,
        y: Math.sin(ang) * k,
      });
      // A stalker's pounce ends on its prey; a brute's charge ploughs on.
      if (def.kind === "pounce") z.lungeUntil = 0;
    }
  }

  /** Repath when no progress is made; cull stragglers that are stuck far from everybody. */
  private checkStuck(z: Zombie): void {
    const tick = this.host.tick;
    const moving = z.state === AI.CHASE || z.state === AI.INVESTIGATE || z.state === AI.WANDER;
    if (!moving || Math.hypot(z.x - z.progressX, z.y - z.progressY) > 24) {
      z.progressX = z.x;
      z.progressY = z.y;
      z.progressTick = tick;
      return;
    }
    if (tick - z.progressTick > this.secTicks(STUCK_SEC)) {
      z.path = null;
      z.jink += 1.3;
      z.progressTick = tick;
      if (z.state === AI.WANDER) this.setState(z, AI.IDLE, 1);
    }
  }

  /** Moves an enemy (a boss left far behind) and resets its navigation and progress timers. */
  relocate(z: Zombie, x: number, y: number): void {
    z.x = x;
    z.y = y;
    z.vx = 0;
    z.vy = 0;
    z.path = null;
    z.progressX = x;
    z.progressY = y;
    z.progressTick = this.host.tick;
    z.lastNearTick = this.host.tick;
  }

  /** Wave safety: enemies that stayed far from every player for a long time. */
  stragglers(): Zombie[] {
    const tick = this.host.tick;
    const out: Zombie[] = [];
    for (const z of this.zombies.values()) {
      if (!z.dead && z.wave > 0 && tick - z.lastNearTick > this.secTicks(STRAGGLER_SEC)) out.push(z);
    }
    return out;
  }

  // ------------------------------------------------------------------ projectiles and hazards

  private stepProjectiles(dt: number, actors: readonly PveActor[]): void {
    const world = this.host.world();
    for (const [id, p] of this.projectiles) {
      const speed = Math.hypot(p.vx, p.vy);
      const step = Math.min(p.left, speed * dt);
      const ux = p.vx / speed;
      const uy = p.vy / speed;
      if (p.lob) {
        // Lobbed: flies over walls and players, lands on the marked spot.
        p.x += ux * step;
        p.y += uy * step;
        p.left -= step;
        if (p.left > 0.5) continue;
        this.projectiles.delete(id);
        this.host.emit({ t: "projx", id, x: Math.round(p.x), y: Math.round(p.y) });
        this.host.emit({ t: "zatk", z: p.from, k: "impact", x: Math.round(p.x), y: Math.round(p.y) });
        const from = this.zombies.get(p.from) ?? null;
        for (const a of actors) {
          if (!a.alive || a.airborne) continue;
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d > p.lob.radius + PLAYER.radius) continue;
          const amount = p.damage * (1 - (1 - p.lob.edge) * clamp(d / p.lob.radius, 0, 1));
          if (a.vehicle) this.host.hurtVehicle(a.vehicle, amount, p.x, p.y);
          else this.host.hurtPlayer(a.id, amount, from, a.x, a.y);
        }
        continue;
      }
      // Players along this step (vehicle occupants: the hull takes it).
      let hitAt = step;
      let victim: PveActor | null = null;
      for (const a of actors) {
        if (!a.alive || a.airborne) continue;
        const r = a.vehicle ? 34 : PLAYER.radius + 5;
        const ox = a.x - p.x;
        const oy = a.y - p.y;
        const along = ox * ux + oy * uy;
        if (along < -r || along > hitAt + r) continue;
        const perp = Math.abs(ox * uy - oy * ux);
        if (perp > r) continue;
        const at = Math.max(0, along - Math.sqrt(Math.max(0, r * r - perp * perp)));
        if (at <= hitAt) {
          hitAt = at;
          victim = a;
        }
      }
      const wall = step > 0 ? raycastSolids(world, p.x, p.y, ux, uy, step) : 0;
      if (wall < hitAt) {
        victim = null;
        hitAt = wall;
      }
      p.x += ux * hitAt;
      p.y += uy * hitAt;
      p.left -= hitAt;
      const ended = victim !== null || hitAt < step - 0.01 || p.left <= 0.5;
      if (!ended) continue;
      this.projectiles.delete(id);
      // Land just short of a wall so the puddle stays on the walkable side.
      const lx = p.x - ux * 6;
      const ly = p.y - uy * 6;
      this.host.emit({ t: "projx", id, x: Math.round(lx), y: Math.round(ly) });
      if (victim) {
        if (victim.vehicle) this.host.hurtVehicle(victim.vehicle, p.damage, lx, ly);
        else this.host.hurtPlayer(victim.id, p.damage, this.zombies.get(p.from) ?? null, victim.x, victim.y);
      }
      if (p.puddle) {
        const h: Hazard = {
          id: `h${this.nextHazard++}`,
          x: lx,
          y: ly,
          r: p.puddle.radius,
          until: this.host.tick + this.secTicks(p.puddle.sec),
          dps: p.puddle.dps * this.difficulty.enemyDamage,
          acc: new Map(),
        };
        this.hazards.set(h.id, h);
      }
    }
  }

  private stepHazards(dt: number, actors: readonly PveActor[]): void {
    for (const [id, h] of this.hazards) {
      if (this.host.tick >= h.until) {
        this.hazards.delete(id);
        continue;
      }
      for (const a of actors) {
        if (!a.alive || a.vehicle) continue;
        if ((a.x - h.x) ** 2 + (a.y - h.y) ** 2 > (h.r + PLAYER.radius * 0.5) ** 2) continue;
        const acc = (h.acc.get(a.id) ?? 0) + h.dps * dt;
        if (acc >= 1) {
          const dmg = Math.floor(acc);
          this.host.hurtPlayer(a.id, dmg, null, a.x, a.y);
          h.acc.set(a.id, acc - dmg);
        } else {
          h.acc.set(a.id, acc);
        }
      }
    }
  }
}
