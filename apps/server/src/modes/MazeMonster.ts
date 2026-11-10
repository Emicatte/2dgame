import {
  AI,
  buildNavGrid,
  type CollisionWorld,
  type MazeDef,
  type NavGrid,
  type NetEvent,
  PLAYER,
} from "@scrapline/shared";
import {
  type PveActor,
  type VehicleBody,
  type Zombie,
  type ZombieHost,
  ZombieWorld,
} from "../pve/ZombieWorld.ts";
import type { GameSimulation, ServerPlayer } from "../simulation/GameSimulation.ts";

/** How fast the creature hunts compared with a stalker (players still outrun it in a straight line). */
const SPEED_MULT = 1.4;
/** Director: quiet seconds before it draws the creature towards someone, and its cooldown. */
const QUIET_SEC = 28;
const NUDGE_COOLDOWN_SEC = 18;

/**
 * Horror Maze: one creature in the dark, run by the Outbreak enemy AI (sight with line of sight,
 * hearing, memory of the last position seen, investigate, wander; never told where players are).
 * Players are unarmed: being caught sends them back to their checkpoint.
 *
 * Tension director (server side, once a second): footsteps of running players and dashes make
 * noise; gates and traps are loud. After a long quiet spell it makes a sound a few hundred px from
 * the player furthest ahead, so the creature comes to investigate near them, not on them. No
 * teleports: the creature always walks.
 */
export class MazeMonster implements ZombieHost {
  readonly zw: ZombieWorld;
  private grid: NavGrid;
  private creature: Zombie | null = null;
  private lastChase = 0;
  private lastNudge = 0;
  private lastStep = new Map<string, number>();

  constructor(
    private readonly sim: GameSimulation,
    private readonly maze: MazeDef,
    private readonly playing: () => ServerPlayer[],
    private readonly caught: (p: ServerPlayer) => void,
  ) {
    this.zw = new ZombieWorld(this);
    this.grid = buildNavGrid(sim.world);
    this.lastChase = sim.tick;
    this.lastNudge = sim.tick;
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
    return this.playing()
      .filter((p) => p.alive)
      .map((p) => ({
        id: p.id,
        x: p.sim.x,
        y: p.sim.y,
        vx: p.sim.vx,
        vy: p.sim.vy,
        aim: p.sim.aim,
        alive: true,
        downed: false,
        vehicle: null,
        airborne: false,
      }));
  }
  vehicles(): readonly VehicleBody[] {
    return [];
  }
  hurtPlayer(id: string): void {
    const p = this.sim.players.get(id);
    if (p?.alive && this.sim.tick >= p.protectedUntil) this.caught(p);
  }
  hurtVehicle(): void {}
  emit(ev: NetEvent): void {
    this.sim.pushEvent(ev);
  }
  onKilled(): void {}

  // ------------------------------------------------------------------ the creature

  /** Starts in the dead end farthest from the start, wandering. */
  spawn(at: { x: number; y: number }): void {
    this.creature = this.zw.spawn("stalker", at.x, at.y, { state: "wander" });
    this.creature.speedMult = SPEED_MULT;
  }

  /** Walls changed (a gate opened): the creature's map follows. */
  wallsChanged(): void {
    this.grid = buildNavGrid(this.sim.world);
    this.zw.invalidateNav();
  }

  noise(x: number, y: number, radius: number): void {
    this.zw.noise(x, y, radius);
  }

  get chasing(): boolean {
    const s = this.creature?.state;
    return s === AI.CHASE || s === AI.ATTACK;
  }

  step(): void {
    const t = this.sim.tick;
    const rate = this.sim.tickRateHz;
    // Footsteps: running is heard nearby, a dash farther; walking slowly is silent.
    for (const p of this.playing()) {
      if (!p.alive) continue;
      const speed = Math.hypot(p.sim.vx, p.sim.vy);
      const last = this.lastStep.get(p.id) ?? 0;
      if (speed > PLAYER.maxSpeed * 1.4) {
        this.zw.noise(p.sim.x, p.sim.y, 460);
        this.lastStep.set(p.id, t);
      } else if (speed > PLAYER.maxSpeed * 0.75 && t - last > rate * 0.6) {
        this.zw.noise(p.sim.x, p.sim.y, 190);
        this.lastStep.set(p.id, t);
      }
    }
    if (this.chasing) this.lastChase = t;
    if (t % rate === 0) this.direct();
    this.zw.step();
  }

  /** Director: after a quiet spell, a sound near the player furthest ahead. */
  private direct(): void {
    const t = this.sim.tick;
    const rate = this.sim.tickRateHz;
    if (
      this.chasing ||
      t - this.lastChase < QUIET_SEC * rate ||
      t - this.lastNudge < NUDGE_COOLDOWN_SEC * rate
    )
      return;
    const exit = this.maze.exit;
    const lead = this.playing()
      .filter((p) => p.alive)
      .sort(
        (a, b) =>
          (a.sim.x - exit.x) ** 2 +
          (a.sim.y - exit.y) ** 2 -
          ((b.sim.x - exit.x) ** 2 + (b.sim.y - exit.y) ** 2),
      )[0];
    if (!lead) return;
    const ang = this.sim.rng() * Math.PI * 2;
    const d = 320 + this.sim.rng() * 160;
    const x = Math.max(40, Math.min(this.sim.map.width - 40, lead.sim.x + Math.cos(ang) * d));
    const y = Math.max(40, Math.min(this.sim.map.height - 40, lead.sim.y + Math.sin(ang) * d));
    this.zw.noise(x, y, 4000);
    this.lastNudge = t;
  }

  /** For tests and diagnostics. */
  get position(): { x: number; y: number; state: number } | null {
    const z = this.creature;
    return z ? { x: z.x, y: z.y, state: z.state } : null;
  }
}
