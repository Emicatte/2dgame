import { BOUNTY, type MatchState } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode, type MarkData, type ModeFacts } from "./ModeController.ts";

/**
 * Bounty Hunt: one player is the target. The target scores a point every two seconds alive and
 * their area is pinged to everybody every five seconds (the ring is never centred on them).
 * Whoever takes the target down claims the bounty (+5) and becomes the next target; any other
 * elimination is worth one point. First to the point limit (the room's score limit) wins.
 */
export class BountyMode extends BaseMode {
  readonly mode = "bounty" as const;
  override readonly usesScoreLimit = true;
  target: string | null = null;
  private readonly points = new Map<string, number>();
  private targetTicks = 0;
  private ping: { x: number; y: number } | null = null;
  private pingTick = 0;

  pointsOf(id: string): number {
    return this.points.get(id) ?? 0;
  }

  private add(p: ServerPlayer, n: number): void {
    this.points.set(p.id, this.pointsOf(p.id) + n);
  }

  override reset(): void {
    this.points.clear();
    this.target = null;
    this.targetTicks = 0;
    this.ping = null;
  }

  override respawnDelay(): number {
    return BOUNTY.respawnSec;
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null): void {
    const wasTarget = victim.id === this.target;
    if (killer && killer !== victim) this.add(killer, wasTarget ? BOUNTY.claimPoints : BOUNTY.killPoints);
    if (!wasTarget) return;
    if (killer && killer !== victim) {
      this.setTarget(killer);
      this.emit({
        t: "announce",
        s: `${killer.name} claimed the bounty`,
        d: `${killer.name} is the new target`,
      });
    } else this.target = null;
  }

  override onLeave(p: ServerPlayer): void {
    if (p.id === this.target) this.target = null;
  }

  private setTarget(p: ServerPlayer): void {
    this.target = p.id;
    this.targetTicks = 0;
    this.ping = null;
  }

  override step(): void {
    let t = this.target ? this.sim.players.get(this.target) : undefined;
    if (!t || t.away) {
      // A new target: the leader among the players standing (the first one at the start).
      const alive = this.players().filter((p) => p.alive);
      if (alive.length < 2) return;
      alive.sort((a, b) => this.pointsOf(b.id) - this.pointsOf(a.id) || a.joinedTick - b.joinedTick);
      t = alive[0]!;
      this.setTarget(t);
      this.emit({ t: "announce", s: "New bounty", d: `${t.name} is the target` });
    }
    if (!t.alive) return;
    this.targetTicks++;
    if (this.targetTicks % this.sim.secToTicks(BOUNTY.targetEverySec) === 0) this.add(t, 1);
    if (!this.ping || this.sim.tick - this.pingTick >= this.sim.secToTicks(BOUNTY.pingEverySec)) {
      const a = this.sim.rng() * Math.PI * 2;
      const off = (0.2 + this.sim.rng() * 0.3) * BOUNTY.pingRadius;
      this.ping = { x: t.sim.x + Math.cos(a) * off, y: t.sim.y + Math.sin(a) * off };
      this.pingTick = this.sim.tick;
    }
  }

  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    const t = this.target ? this.sim.players.get(this.target) : undefined;
    if (t && this.ping)
      out.set("bounty", {
        k: "target",
        x: this.ping.x,
        y: this.ping.y,
        r: BOUNTY.pingRadius,
        c: 0,
        p: 0,
        l: t.name,
        a: "",
      });
    return out;
  }

  override statusText(): string {
    const t = this.target ? this.sim.players.get(this.target) : undefined;
    return t ? `Target: ${t.name} · ${this.pointsOf(t.id)} pts` : "Choosing a target…";
  }

  override leaderScore(): number {
    let max = 0;
    for (const v of this.points.values()) max = Math.max(max, v);
    return max;
  }

  override standings(): ServerPlayer[] {
    return this.players().sort(
      (a, b) =>
        this.pointsOf(b.id) - this.pointsOf(a.id) ||
        b.stats.kills - a.stats.kills ||
        a.stats.deaths - b.stats.deaths ||
        a.joinedTick - b.joinedTick,
    );
  }

  override facts(p: ServerPlayer): ModeFacts {
    return { points: this.pointsOf(p.id), extra: {} };
  }

  override sync(state: MatchState): void {
    for (const [id] of this.sim.players) {
      const ps = state.players.get(id);
      if (!ps) continue;
      const pts = Math.min(65535, this.pointsOf(id));
      if (ps.pts !== pts) ps.pts = pts;
      const role = id === this.target ? 1 : 0;
      if (ps.role !== role) ps.role = role;
    }
  }
}
