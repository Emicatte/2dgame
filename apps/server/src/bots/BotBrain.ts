import {
  BTN,
  buildNavGrid,
  type CollisionWorld,
  findPath,
  hashString,
  hasLineOfSight,
  type InputFrame,
  isFreeSpot,
  mulberry32,
  type NavGrid,
  NET,
  PLAYER,
  quantizeInput,
  type Vec2,
  weaponByIndex,
} from "@scrapline/shared";
import type { GameSimulation, ServerPlayer } from "../simulation/GameSimulation.ts";

/** Names of the three practice bots. */
export const BOT_NAMES = ["Rook", "Vex", "Kestrel"] as const;

/** How good the bots are: tuned to be beatable but to punish standing in the open. */
export const BOT_SKILL = {
  /** Sight range (px) and the delay before the first shot at a newly seen enemy. */
  sight: 1000,
  reactionSec: [0.3, 0.55],
  /** Aim error (rad) on first sight, shrinking towards `aimSteady` while it keeps tracking. */
  aimError: 0.11,
  aimSteady: 0.035,
  aimSettleSec: 1.4,
  /** Trigger discipline: bursts and pauses (s). */
  burstSec: [0.35, 0.8],
  pauseSec: [0.15, 0.4],
  /** Below this health it breaks line of sight and goes for cover (then for a medkit). */
  retreatHp: 0.4,
  /** How long it hunts the last place it saw someone (s). */
  memorySec: 6,
} as const;

type Mode = "fight" | "cover" | "hunt";

/** One nav grid per collision world (a map), shared by every bot of a room. */
const navCache = new WeakMap<CollisionWorld, NavGrid>();
function navFor(world: CollisionWorld): NavGrid {
  let g = navCache.get(world);
  if (!g) {
    g = buildNavGrid(world);
    navCache.set(world, g);
  }
  return g;
}

function between([a, b]: readonly [number, number], r: number): number {
  return a + (b - a) * r;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A bot that plays like a person: it looks for enemies it can actually see, reacts after a
 * moment, aims imperfectly and fires in bursts, keeps its weapon's distance while strafing,
 * breaks line of sight to reload or when hurt, picks up health, and hunts where it last saw
 * someone. It only produces input frames: the simulation treats it like any player.
 */
export class BotBrain {
  private mode: Mode = "hunt";
  private target = "";
  private reactAt = 0;
  private trackFrom = 0;
  private lastSeen: Vec2 | null = null;
  private lastSeenTick = -1e9;
  private path: Vec2[] = [];
  private pathGoal: Vec2 | null = null;
  private pathTick = -1e9;
  private cover: Vec2 | null = null;
  private coverUntil = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private fireUntil = 0;
  private pauseUntil = 0;
  private wobble = 0;
  private stuckFrom: Vec2 = { x: 0, y: 0 };
  private stuckTick = 0;
  private roam: Vec2 | null = null;

  constructor(
    readonly id: string,
    private readonly rng: () => number,
  ) {}

  /** Input for this tick (the room enqueues it like a client's frames). */
  think(sim: GameSimulation): Omit<InputFrame, "seq" | "viewTick"> {
    const idle = { mx: 0, my: 0, aim: 0, buttons: 0, slot: -1 };
    const me = sim.players.get(this.id);
    if (!me?.alive) {
      this.reset();
      return idle;
    }
    const tick = sim.tick;
    const rate = NET.serverTickRate;
    const sec = (s: number) => Math.round(s * rate);
    const nav = navFor(sim.world);
    const pos = { x: me.sim.x, y: me.sim.y };
    let buttons = 0;
    let slot = -1;

    // Weapon: switch away from an empty one.
    const cur = me.sim.slots[me.sim.slot];
    if (cur && cur.mag === 0 && cur.reserve === 0) {
      const other = me.sim.slots.findIndex(
        (s, i) => i !== me.sim.slot && s.id >= 0 && (s.mag > 0 || s.reserve !== 0),
      );
      if (other >= 0) slot = other;
    }
    const weapon = cur ? weaponByIndex(cur.id) : undefined;
    const preferred = Math.min(560, Math.max(170, (weapon?.falloffStartPx ?? 300) * 0.85));

    // Perception: enemies it can see (in range, nothing in the way).
    const enemy = this.pick(sim, me);
    if (enemy) {
      if (this.target !== enemy.id || tick - this.lastSeenTick > sec(1)) {
        this.reactAt = tick + sec(between(BOT_SKILL.reactionSec, this.rng()));
        this.trackFrom = tick;
      }
      this.target = enemy.id;
      this.lastSeen = { x: enemy.sim.x, y: enemy.sim.y };
      this.lastSeenTick = tick;
    } else if (tick - this.lastSeenTick > sec(BOT_SKILL.memorySec)) {
      this.lastSeen = null;
    }

    const hurt = me.hp / PLAYER.maxHealth < BOT_SKILL.retreatHp;
    const reloading = me.sim.reload > 0;
    const empty = !!cur && cur.mag === 0;

    // Choose what to do.
    if ((hurt || empty || reloading) && this.lastSeen && this.mode !== "cover") {
      this.cover = this.findCover(sim, nav, pos, this.lastSeen);
      if (this.cover) {
        this.mode = "cover";
        this.coverUntil = tick + sec(hurt ? 4 : 1.6);
        this.path = [];
      }
    }
    if (this.mode === "cover" && tick > this.coverUntil && !reloading) this.mode = enemy ? "fight" : "hunt";
    if (this.mode !== "cover") this.mode = enemy ? "fight" : "hunt";

    let mx = 0;
    let my = 0;
    let aim = me.sim.aim;

    if (this.mode === "fight" && enemy) {
      const dx = enemy.sim.x - pos.x;
      const dy = enemy.sim.y - pos.y;
      const d = Math.hypot(dx, dy) || 1;
      // Keep its weapon's distance, strafing sideways and changing direction now and then.
      if (tick >= this.strafeUntil) {
        this.strafe = this.rng() < 0.5 ? -1 : 1;
        this.strafeUntil = tick + sec(0.5 + this.rng() * 1.1);
      }
      const radial = Math.max(-1, Math.min(1, (d - preferred) / 140));
      mx = (dx / d) * radial + (-dy / d) * this.strafe * 0.85;
      my = (dy / d) * radial + (dx / d) * this.strafe * 0.85;
      // Imperfect aim that settles while it keeps tracking the same target.
      const k = Math.min(1, (tick - this.trackFrom) / sec(BOT_SKILL.aimSettleSec));
      const err = BOT_SKILL.aimError + (BOT_SKILL.aimSteady - BOT_SKILL.aimError) * k;
      this.wobble += (this.rng() * 2 - 1) * err * 0.6;
      this.wobble = Math.max(-err, Math.min(err, this.wobble * 0.9));
      aim = Math.atan2(dy, dx) + this.wobble;
      // Bursts once it has reacted, while it has something in the magazine.
      if (tick >= this.reactAt && !reloading && !empty && d <= (weapon?.rangePx ?? 900)) {
        if (tick >= this.pauseUntil && tick >= this.fireUntil) {
          this.fireUntil = tick + sec(between(BOT_SKILL.burstSec, this.rng()));
          this.pauseUntil = this.fireUntil + sec(between(BOT_SKILL.pauseSec, this.rng()));
        }
        if (tick < this.fireUntil) buttons |= BTN.FIRE;
      }
      if (empty && !reloading) buttons |= BTN.RELOAD;
      // Hit hard at close range: dash sideways out of the line of fire.
      if (me.hp < PLAYER.maxHealth * 0.6 && d < 260 && this.rng() < 0.02) buttons |= BTN.DASH;
      this.path = [];
    } else {
      // Cover, a medkit, the last place it saw someone, or a wander towards the noise.
      let goal: Vec2 | null = null;
      if (this.mode === "cover" && this.cover) goal = this.cover;
      else if (hurt) goal = this.nearestHealth(sim, pos);
      if (!goal && this.lastSeen) goal = this.lastSeen;
      if (!goal) goal = this.wander(sim, me, pos);
      const step = this.follow(sim, nav, pos, goal, tick, sec(0.6));
      mx = step.x;
      my = step.y;
      if (Math.hypot(mx, my) > 0.01) aim = Math.atan2(my, mx);
      // Facing where the enemy was while backing into cover.
      if (this.mode === "cover" && this.lastSeen)
        aim = Math.atan2(this.lastSeen.y - pos.y, this.lastSeen.x - pos.x);
      // Reload whenever it is out of sight and not full.
      if (cur && weapon && !reloading && cur.mag < weapon.magSize && cur.reserve !== 0 && !enemy)
        buttons |= BTN.RELOAD;
      if (this.lastSeen && Math.hypot(this.lastSeen.x - pos.x, this.lastSeen.y - pos.y) < 40)
        this.lastSeen = null;
    }

    // Unstick: no progress for a second while trying to move → new route.
    if (Math.hypot(mx, my) > 0.3) {
      if (Math.hypot(pos.x - this.stuckFrom.x, pos.y - this.stuckFrom.y) > 30) {
        this.stuckFrom = pos;
        this.stuckTick = tick;
      } else if (tick - this.stuckTick > sec(1)) {
        this.path = [];
        this.roam = null;
        this.strafe = -this.strafe;
        this.stuckTick = tick;
      }
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    return { mx, my, aim, buttons, slot };
  }

  private reset(): void {
    this.mode = "hunt";
    this.target = "";
    this.path = [];
    this.cover = null;
    this.lastSeen = null;
    this.roam = null;
  }

  /** The enemy to engage: the current one while visible, else the nearest visible one. */
  private pick(sim: GameSimulation, me: ServerPlayer): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of sim.players.values()) {
      if (p.id === me.id || !p.alive || (me.team !== 0 && p.team === me.team)) continue;
      const d = Math.hypot(p.sim.x - me.sim.x, p.sim.y - me.sim.y);
      if (d > BOT_SKILL.sight) continue;
      if (!hasLineOfSight(sim.shotWorld, me.sim.x, me.sim.y, p.sim.x, p.sim.y)) continue;
      // Stick to the current target unless another is much closer.
      const score = p.id === this.target ? d * 0.6 : d;
      if (score < bestD) {
        bestD = score;
        best = p;
      }
    }
    return best;
  }

  /** A free spot near it that the threat cannot see, not towards the threat. */
  private findCover(sim: GameSimulation, nav: NavGrid, pos: Vec2, threat: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const away = Math.atan2(pos.y - threat.y, pos.x - threat.x);
    for (const r of [90, 160, 240, 320]) {
      for (let i = 0; i < 16; i++) {
        const a = away + ((i - 8) / 16) * Math.PI * 2;
        const c = { x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r };
        if (!isFreeSpot(sim.world, c, PLAYER.radius + 4)) continue;
        if (hasLineOfSight(sim.shotWorld, threat.x, threat.y, c.x, c.y)) continue;
        // Short and away from the threat is best.
        const score = r + Math.abs(wrap(a - away)) * 120;
        if (score < bestScore && findPath(nav, sim.world, 1, pos, c, 600)) {
          bestScore = score;
          best = c;
        }
      }
      if (best) return best;
    }
    return best;
  }

  private nearestHealth(sim: GameSimulation, pos: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const pk of sim.pickups.values()) {
      if (!pk.active || pk.def.kind !== "health") continue;
      const d = Math.hypot(pk.def.x - pos.x, pk.def.y - pos.y);
      if (d < bestD) {
        bestD = d;
        best = { x: pk.def.x, y: pk.def.y };
      }
    }
    return best;
  }

  /**
   * Nobody in sight and nothing remembered: head roughly towards the nearest enemy (people are
   * loud) through a random waypoint of the map, so the hunt does not go straight for them.
   */
  private wander(sim: GameSimulation, me: ServerPlayer, pos: Vec2): Vec2 {
    if (this.roam && Math.hypot(this.roam.x - pos.x, this.roam.y - pos.y) > 60) return this.roam;
    let near: Vec2 | null = null;
    let nearD = Number.POSITIVE_INFINITY;
    for (const p of sim.players.values()) {
      if (p.id === me.id || !p.alive || (me.team !== 0 && p.team === me.team)) continue;
      const d = Math.hypot(p.sim.x - pos.x, p.sim.y - pos.y);
      if (d < nearD) {
        nearD = d;
        near = { x: p.sim.x, y: p.sim.y };
      }
    }
    const spots = [...sim.map.spawns, ...sim.map.pickups];
    if (near && this.rng() < 0.7) {
      // A waypoint around the enemy, not on them.
      const a = this.rng() * Math.PI * 2;
      const r = 150 + this.rng() * 250;
      const c = { x: near.x + Math.cos(a) * r, y: near.y + Math.sin(a) * r };
      this.roam = isFreeSpot(sim.world, c) ? c : near;
    } else {
      const s = spots[Math.floor(this.rng() * spots.length)];
      this.roam = s ? { x: s.x, y: s.y } : pos;
    }
    return this.roam;
  }

  /** Direction to walk along a path to `goal` (replanned every `every` ticks or on a new goal). */
  private follow(
    sim: GameSimulation,
    nav: NavGrid,
    pos: Vec2,
    goal: Vec2,
    tick: number,
    every: number,
  ): Vec2 {
    const moved = !this.pathGoal || Math.hypot(goal.x - this.pathGoal.x, goal.y - this.pathGoal.y) > 48;
    if (moved || tick - this.pathTick > every * 4 || this.path.length === 0) {
      if (moved || tick - this.pathTick > every) {
        const res = findPath(nav, sim.world, 1, pos, goal, 2500);
        this.path = res ? [...res.points] : [];
        this.pathGoal = goal;
        this.pathTick = tick;
      }
    }
    while (this.path.length > 0 && Math.hypot(this.path[0]!.x - pos.x, this.path[0]!.y - pos.y) < 22)
      this.path.shift();
    const next = this.path[0] ?? goal;
    const dx = next.x - pos.x;
    const dy = next.y - pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) return { x: 0, y: 0 };
    return { x: dx / d, y: dy / d };
  }
}

/** Runs the brains of a room's bots: one input frame per input step, like a client sends. */
export class BotDriver {
  private readonly brains = new Map<string, BotBrain>();
  private seq = 0;

  drive(sim: GameSimulation, ids: Iterable<string>): void {
    for (const id of ids) {
      let b = this.brains.get(id);
      if (!b) {
        b = new BotBrain(id, mulberry32(hashString(id) ^ sim.tick));
        this.brains.set(id, b);
      }
      const f = b.think(sim);
      const frames = [0, 1, 2].map(() => quantizeInput({ seq: ++this.seq, ...f, viewTick: sim.tick }));
      sim.enqueue(id, frames);
    }
  }

  forget(id: string): void {
    this.brains.delete(id);
  }

  clear(): void {
    this.brains.clear();
  }
}
