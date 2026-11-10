import {
  bodyFits,
  emptySlot,
  objectivesFor,
  PLAYER,
  VEHICLES,
  type Vec2,
  type VehicleSpawnDef,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode, type MarkData, type ModeFacts } from "./ModeController.ts";

const unarm = (p: ServerPlayer) => {
  p.sim.slots = [emptySlot(), emptySlot(), emptySlot()];
  p.sim.slot = 0;
};

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Hot Potato: one player holds a ticking charge (15–25 s, shown to all). Touching another player
 * passes it on (not straight back for 1 s). At zero it goes off: the holder is out, a new round
 * starts with someone else. Last one standing wins. No weapons.
 */
export class HotPotatoMode extends BaseMode {
  readonly mode = "hotpotato" as const;
  holder = "";
  private boomTick = 0;
  private passBack = { from: "", until: 0 };
  private out: string[] = [];

  private get rate(): number {
    return this.sim.secToTicks(1);
  }
  override pickupAllowed(): boolean {
    return false;
  }
  override onSpawn(p: ServerPlayer): void {
    unarm(p);
  }
  override respawnDelay(): number | null {
    return null;
  }
  override allowJoinSpawn(): boolean {
    return false;
  }
  override playerTargetable(): boolean {
    return false;
  }
  override body(p: ServerPlayer): { radius: number; speed: number } | null {
    return p.id === this.holder ? { radius: PLAYER.radius, speed: 1.1 } : null;
  }
  override reset(): void {
    this.out = [];
    // Runs before everyone spawns: choose among the players taking part.
    const ps = this.players();
    this.holder = ps[Math.floor(this.sim.rng() * ps.length)]?.id ?? "";
    this.boomTick = this.sim.tick + Math.round((15 + this.sim.rng() * 10) * this.rate);
  }
  private alive(): ServerPlayer[] {
    return this.players().filter((p) => p.alive);
  }
  private newRound(): void {
    const live = this.alive();
    this.holder = live[Math.floor(this.sim.rng() * live.length)]?.id ?? "";
    this.boomTick = this.sim.tick + Math.round((15 + this.sim.rng() * 10) * this.rate);
    this.passBack = { from: "", until: 0 };
  }
  override step(): void {
    const h = this.sim.players.get(this.holder);
    if (!h?.alive || h.away) {
      if (this.alive().length > 1) this.newRound();
      return;
    }
    for (const q of this.alive()) {
      if (q.id === h.id) continue;
      if (q.id === this.passBack.from && this.sim.tick < this.passBack.until) continue;
      if (Math.hypot(q.sim.x - h.sim.x, q.sim.y - h.sim.y) < PLAYER.radius * 2.3) {
        this.passBack = { from: h.id, until: this.sim.tick + this.rate };
        this.holder = q.id;
        this.emit({ t: "announce", s: `${h.name} passed it to ${q.name}`, d: "", w: 0 });
        return;
      }
    }
    if (this.sim.tick >= this.boomTick) {
      this.emit({ t: "boom", x: Math.round(h.sim.x), y: Math.round(h.sim.y), r: 120 });
      this.emit({ t: "announce", s: `${h.name} is out`, d: "", w: 0 });
      h.protectedUntil = 0;
      h.shield = 0;
      this.sim.damageFromMode(h, 999, null, 0, h.sim.x, h.sim.y);
      if (this.alive().length > 1) this.newRound();
    }
  }
  override onKill(victim: ServerPlayer): void {
    if (!this.out.includes(victim.id)) this.out.push(victim.id);
  }
  override over(): string | null {
    return this.players().length >= 2 && this.alive().length <= 1 ? "last-standing" : null;
  }
  override standings(): ServerPlayer[] {
    const rank = (p: ServerPlayer) => {
      const i = this.out.indexOf(p.id);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    };
    return [...this.sim.players.values()].sort((a, b) => rank(b) - rank(a));
  }
  override facts(p: ServerPlayer): ModeFacts {
    return { points: this.out.length - Math.max(0, this.out.indexOf(p.id)), extra: {} };
  }
  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    const h = this.sim.players.get(this.holder);
    if (!h?.alive) return out;
    const left = Math.max(0, (this.boomTick - this.sim.tick) / this.rate);
    out.set("potato", {
      k: "target",
      x: h.sim.x,
      y: h.sim.y,
      r: 46,
      c: 0,
      p: 0,
      l: `${h.name} · ${left.toFixed(1)} s`,
      a: "",
    });
    return out;
  }
  override statusText(): string {
    const h = this.sim.players.get(this.holder);
    const left = Math.max(0, Math.ceil((this.boomTick - this.sim.tick) / this.rate));
    return h ? `Charge: ${h.name} · ${left} s · ${this.alive().length} left` : `${this.alive().length} left`;
  }
}

/** Free Roam: the island with vehicles and no damage between players. */
export class FreeRoamMode extends BaseMode {
  readonly mode = "freeroam" as const;
  override readonly vehicles = true;
  override onSpawn(p: ServerPlayer): void {
    unarm(p);
  }
  override respawnDelay(): number {
    return 2;
  }
  override damageScale(): number {
    return 0;
  }
  override statusText(): string {
    return `${this.players().length} exploring · no damage`;
  }
}

/**
 * Vehicle Racing: one car per player on a start grid next to the first checkpoint; the course is
 * the map's objective points and bases in a loop; three laps (the lobby's limit). Positions are
 * checked on foot or seated, so getting out does not cheat a checkpoint. No weapons, no damage.
 */
export class RacingMode extends BaseMode {
  readonly mode = "racing" as const;
  override readonly vehicles = true;
  private course: Vec2[] = [];
  private grid: VehicleSpawnDef[] = [];
  private next = new Map<string, number>();
  private done = new Map<string, number>();
  private laps = 3;
  private startTick = 0;

  private get rate(): number {
    return this.sim.secToTicks(1);
  }
  override configure(opts: { rounds: number }): void {
    this.laps = Math.max(1, Math.min(5, opts.rounds || 3));
  }
  override reset(): void {
    const o = objectivesFor(this.sim.map);
    const by = (id: string) => o.points.find((p) => p.id === id);
    this.course = [o.flags[1], by("A"), by("B"), o.flags[2], by("C")]
      .filter((p): p is Vec2 => !!p)
      .map((p) => ({ x: p.x, y: p.y }));
    this.next.clear();
    this.done.clear();
    this.startTick = this.sim.tick;
    this.grid = this.buildGrid(this.course[0] ?? { x: 400, y: 400 }, Math.max(1, this.players().length));
    this.sim.resetVehicles();
  }
  /** Free spots for cars in rows around the start. */
  private buildGrid(start: Vec2, n: number): VehicleSpawnDef[] {
    const out: VehicleSpawnDef[] = [];
    for (let ring = 1; ring < 12 && out.length < n; ring++)
      for (let k = 0; k < ring * 6 && out.length < n; k++) {
        const a = (k / (ring * 6)) * Math.PI * 2;
        const v: VehicleSpawnDef = {
          id: `race-${out.length}`,
          kind: "car",
          x: start.x + Math.cos(a) * ring * 110,
          y: start.y + Math.sin(a) * ring * 110,
          angle: 0,
        };
        if (
          bodyFits(this.sim.world, v, VEHICLES.car) &&
          out.every((u) => Math.hypot(u.x - v.x, u.y - v.y) > 150)
        )
          out.push(v);
      }
    return out;
  }
  override vehicleSpawns(): readonly VehicleSpawnDef[] | null {
    return this.grid;
  }
  override spawnPoint(p: ServerPlayer): { x: number; y: number } | null {
    const i = [...this.sim.players.keys()].indexOf(p.id);
    const car = this.grid[i % Math.max(1, this.grid.length)];
    return car ? { x: car.x + 70, y: car.y + 70 } : null;
  }
  override onSpawn(p: ServerPlayer): void {
    unarm(p);
  }
  override respawnDelay(): number {
    return 2;
  }
  override damageScale(): number {
    return 0;
  }
  override frozen(p: ServerPlayer): boolean {
    return this.done.has(p.id);
  }
  override step(): void {
    const n = this.course.length;
    if (n === 0) return;
    for (const p of this.players()) {
      if (!p.alive || this.done.has(p.id)) continue;
      const k = this.next.get(p.id) ?? 1;
      const target = this.course[k % n]!;
      if (Math.hypot(p.sim.x - target.x, p.sim.y - target.y) > 170) continue;
      this.next.set(p.id, k + 1);
      if (k >= n * this.laps) {
        this.done.set(p.id, this.sim.tick - this.startTick);
        const sec = (this.sim.tick - this.startTick) / this.rate;
        this.emit({
          t: "announce",
          s: `${p.name} finished · ${fmt(sec)}`,
          d: this.done.size === 1 ? "Winner" : "",
          w: 0,
        });
      } else if (k % n === 0)
        this.emit({ t: "announce", s: `${p.name}: lap ${k / n + 1}/${this.laps}`, d: "", w: 0 });
    }
  }
  private progress(p: ServerPlayer): number {
    return this.next.get(p.id) ?? 1;
  }
  override over(): string | null {
    const ps = this.players();
    return ps.length > 0 && ps.every((p) => this.done.has(p.id)) ? "finished" : null;
  }
  override standings(): ServerPlayer[] {
    const t = (p: ServerPlayer) => this.done.get(p.id) ?? Number.POSITIVE_INFINITY;
    return [...this.sim.players.values()].sort((a, b) => t(a) - t(b) || this.progress(b) - this.progress(a));
  }
  override facts(p: ServerPlayer): ModeFacts {
    const t = this.done.get(p.id);
    return { points: t === undefined ? 0 : Math.max(1, Math.round((t / this.rate) * 10)), extra: {} };
  }
  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    this.course.forEach((c, i) => {
      out.set(`cp-${i}`, {
        k: i === 0 ? "goal" : "checkpoint",
        x: c.x,
        y: c.y,
        r: 170,
        c: 0,
        p: 100,
        l: i === 0 ? "Start / finish" : `Checkpoint ${i}`,
        a: "",
      });
    });
    return out;
  }
  override statusText(): string {
    const total = this.course.length * this.laps;
    const lead = Math.max(1, ...this.players().map((p) => this.progress(p)));
    return `${this.laps} laps · leader ${Math.min(total, lead - 1)}/${total} checkpoints · ${this.done.size} finished`;
  }
}
