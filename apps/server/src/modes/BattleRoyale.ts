import {
  BATTLE_ROYALE,
  BTN,
  DROP,
  emptySlot,
  type MatchState,
  NO_WEAPON,
  type PickupKind,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode, type ModeFacts } from "./ModeController.ts";

interface Zone {
  x: number;
  y: number;
  r: number;
}

/**
 * Battle Royale (first scale: up to 16 players). Everybody starts on the flying bus, which crosses
 * the island on a straight line chosen per match. Each player jumps when they want (dash / SPACE);
 * whoever is still aboard when it leaves the island is dropped. The drop itself (freefall,
 * parachute, landing) is part of the shared player simulation, so it is predicted like walking.
 * Players land unarmed and loot chests and pickups. The storm runs fixed phases: wait, then
 * shrink towards a new circle inside the current one; outside it hurts every second. No
 * respawns; last one standing wins.
 */
export class BattleRoyaleMode extends BaseMode {
  readonly mode = "battleroyale" as const;
  override readonly usesScoreLimit = false;
  override readonly vehicles = true;
  private riders = new Set<string>();
  /** Ticks bots jump at (they choose like players do). */
  private botJump = new Map<string, number>();
  private bus = { x0: 0, y0: 0, x1: 0, y1: 0, start: 0, end: 0 };
  private zone: Zone = { x: 0, y: 0, r: 0 };
  private from: Zone = { x: 0, y: 0, r: 0 };
  private next: Zone = { x: 0, y: 0, r: 0 };
  private phase = 0;
  private shrinking = false;
  private until = 0;
  /** Ids in elimination order (first out first). */
  private out: string[] = [];
  private entrants = 0;

  private get rate(): number {
    return this.sim.secToTicks(1);
  }

  override pickupAllowed(_kind: PickupKind): boolean {
    return true;
  }

  override reset(): void {
    const { width: w, height: h } = this.sim.map;
    const rng = () => this.sim.rng();
    const a = rng() * Math.PI * 2;
    const off = (rng() * 2 - 1) * BATTLE_ROYALE.busOffset;
    const cx = w / 2 + Math.cos(a + Math.PI / 2) * off;
    const cy = h / 2 + Math.sin(a + Math.PI / 2) * off;
    const L = BATTLE_ROYALE.busHalfLength;
    const lengthTicks = Math.round(((2 * L) / BATTLE_ROYALE.busSpeed) * this.rate);
    this.bus = {
      x0: cx - Math.cos(a) * L,
      y0: cy - Math.sin(a) * L,
      x1: cx + Math.cos(a) * L,
      y1: cy + Math.sin(a) * L,
      start: this.sim.tick,
      end: this.sim.tick + lengthTicks,
    };
    this.riders = new Set([...this.sim.players.keys()]);
    this.botJump.clear();
    for (const id of this.riders)
      if (id.startsWith("bot:"))
        this.botJump.set(id, this.sim.tick + Math.round(lengthTicks * (0.3 + rng() * 0.45)));
    this.zone = { x: w / 2, y: h / 2, r: BATTLE_ROYALE.stormStartRadius };
    this.from = { ...this.zone };
    this.phase = 0;
    this.out = [];
    this.entrants = this.riders.size;
    this.startPhase(lengthTicks);
  }

  /** Next storm phase: pick the next circle inside the current one, then wait. */
  private startPhase(extraWait = 0): void {
    const p = BATTLE_ROYALE.phases[this.phase];
    if (!p) return;
    const slack = Math.max(0, this.zone.r - p.radius);
    const a = this.sim.rng() * Math.PI * 2;
    const d = this.sim.rng() * slack * 0.8;
    const { width: w, height: h } = this.sim.map;
    this.next = {
      x: Math.max(p.radius, Math.min(w - p.radius, this.zone.x + Math.cos(a) * d)),
      y: Math.max(p.radius, Math.min(h - p.radius, this.zone.y + Math.sin(a) * d)),
      r: p.radius,
    };
    this.phase++;
    this.shrinking = false;
    this.until = this.sim.tick + extraWait + p.waitSec * this.rate;
  }

  /** Where the bus is now (it may still be off the island). */
  busAt(tick: number): { x: number; y: number } {
    const b = this.bus;
    const k = Math.max(0, Math.min(1, (tick - b.start) / Math.max(1, b.end - b.start)));
    return { x: b.x0 + (b.x1 - b.x0) * k, y: b.y0 + (b.y1 - b.y0) * k };
  }

  private overIsland(p: { x: number; y: number }): boolean {
    return p.x > 0 && p.y > 0 && p.x < this.sim.map.width && p.y < this.sim.map.height;
  }

  override spawnPoint(): { x: number; y: number } {
    const { width: w, height: h } = this.sim.map;
    const b = this.busAt(this.sim.tick);
    return { x: Math.max(20, Math.min(w - 20, b.x)), y: Math.max(20, Math.min(h - 20, b.y)) };
  }

  override onSpawn(p: ServerPlayer): void {
    p.sim.slots = [emptySlot(), emptySlot(), emptySlot()];
    p.sim.slot = 0;
    p.sim.alt = DROP.startAlt;
    p.sim.chute = false;
    p.protectedUntil = 0;
  }

  override respawnDelay(): number | null {
    return null;
  }

  override allowJoinSpawn(): boolean {
    return false;
  }

  override frozen(p: ServerPlayer): boolean {
    return this.riders.has(p.id);
  }

  override playerTargetable(p: ServerPlayer): boolean {
    return !this.riders.has(p.id) && p.sim.alt <= 0;
  }

  /** Leaves the bus where it is now (over the island). */
  jump(p: ServerPlayer): void {
    if (!this.riders.delete(p.id)) return;
    const at = this.spawnPoint();
    p.sim.x = at.x;
    p.sim.y = at.y;
    p.sim.vx = 0;
    p.sim.vy = 0;
    p.sim.alt = DROP.startAlt;
    p.sim.chute = false;
    // The key that made it jump must not also open the parachute.
    p.sim.dashHeld = true;
  }

  override step(): void {
    const t = this.sim.tick;
    const bus = this.busAt(t);
    const over = this.overIsland(bus);
    for (const id of [...this.riders]) {
      const p = this.sim.players.get(id);
      if (!p || p.away) {
        this.riders.delete(id);
        continue;
      }
      const at = this.spawnPoint();
      p.sim.x = at.x;
      p.sim.y = at.y;
      p.sim.alt = DROP.startAlt;
      const wants =
        (p.prevButtons & BTN.DASH) !== 0 || (this.botJump.get(id) ?? Number.POSITIVE_INFINITY) <= t;
      // Forced out at the end of the line.
      if ((over && wants) || t >= this.bus.end - this.rate) this.jump(p);
    }

    // Storm.
    const ph = BATTLE_ROYALE.phases[this.phase - 1];
    if (ph) {
      if (!this.shrinking && t >= this.until) {
        this.shrinking = true;
        this.from = { ...this.zone };
        this.until = t + ph.shrinkSec * this.rate;
      }
      if (this.shrinking) {
        const k = 1 - Math.max(0, this.until - t) / (ph.shrinkSec * this.rate);
        this.zone = {
          x: this.from.x + (this.next.x - this.from.x) * k,
          y: this.from.y + (this.next.y - this.from.y) * k,
          r: this.from.r + (this.next.r - this.from.r) * k,
        };
        if (t >= this.until) {
          this.zone = { ...this.next };
          this.startPhase();
        }
      }
      if (t % this.rate === 0) {
        for (const p of this.players()) {
          if (!p.alive || this.riders.has(p.id)) continue;
          const d = Math.hypot(p.sim.x - this.zone.x, p.sim.y - this.zone.y);
          if (d > this.zone.r) this.sim.damageFromMode(p, ph.dps, null, NO_WEAPON, p.sim.x, p.sim.y);
        }
      }
    }
  }

  override onKill(victim: ServerPlayer): void {
    if (!this.out.includes(victim.id)) this.out.push(victim.id);
  }

  override onLeave(p: ServerPlayer): void {
    this.riders.delete(p.id);
    if (!this.out.includes(p.id)) this.out.push(p.id);
  }

  private alive(): ServerPlayer[] {
    return this.players().filter((p) => p.alive || this.riders.has(p.id));
  }

  override over(): string | null {
    if (this.entrants < 2) return null;
    return this.alive().length <= 1 ? "last-standing" : null;
  }

  override standings(): ServerPlayer[] {
    const order = [...this.out];
    const rank = (p: ServerPlayer) => {
      const i = order.indexOf(p.id);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    };
    return [...this.sim.players.values()].sort((a, b) => rank(b) - rank(a) || b.stats.kills - a.stats.kills);
  }

  override facts(p: ServerPlayer): ModeFacts {
    return { points: p.stats.kills, extra: this.alive().some((x) => x.id === p.id) ? { brWins: 1 } : {} };
  }

  override statusText(): string {
    const left = this.alive().length;
    const secs = Math.max(0, Math.ceil((this.until - this.sim.tick) / this.rate));
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const storm =
      this.phase === 0 ? "" : this.shrinking ? ` · storm closing ${clock}` : ` · storm moves in ${clock}`;
    return `${left} alive${storm}`;
  }

  override sync(state: MatchState): void {
    const br = state.br;
    const set = <K extends keyof typeof br>(k: K, v: (typeof br)[K]) => {
      if (br[k] !== v) br[k] = v;
    };
    set("bx0", Math.round(this.bus.x0));
    set("by0", Math.round(this.bus.y0));
    set("bx1", Math.round(this.bus.x1));
    set("by1", Math.round(this.bus.y1));
    set("busStart", this.bus.start);
    set("busEnd", this.riders.size > 0 ? this.bus.end : 0);
    set("cx", Math.round(this.zone.x));
    set("cy", Math.round(this.zone.y));
    set("r", Math.round(this.zone.r));
    set("ncx", Math.round(this.next.x));
    set("ncy", Math.round(this.next.y));
    set("nr", Math.round(this.next.r));
    set("phase", this.phase);
    set("shrinking", this.shrinking);
    set("until", this.until);
    set("dps", BATTLE_ROYALE.phases[this.phase - 1]?.dps ?? 0);
    set("alive", this.alive().length);
    for (const [id, ps] of state.players) {
      const frozen = this.riders.has(id);
      if (ps.frozen !== frozen) ps.frozen = frozen;
    }
  }
}
