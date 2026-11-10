import {
  type AbilityMessage,
  emptySlot,
  fullSlot,
  hasLineOfSight,
  type MatchState,
  type NetEvent,
  type PickupKind,
  pointInRect,
  ROLE,
  type RoleId,
  type RoundStage,
  SIGHT,
  type Vec2,
  type WeaponId,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { type AllyData, BaseMode, type ModeFacts, type PublicPose } from "./ModeController.ts";

/** Round timing of a mode. */
export interface RoundTiming {
  prepSec: number;
  huntSec: number;
  breakSec: number;
}

/**
 * Shared machinery of the round modes (Hide & Seek, Prop Hunt): sides assigned by the server and
 * rotated every round, round stages (prep → hunt → break), points, spectating after elimination,
 * and the hidden-information rules (masked poses, per-side ghosts, per-viewer events).
 *
 * Sides use the team field (SEEKER = 1, HIDER = 2) so the combat rules (no friendly fire) and the
 * kill feed work unchanged.
 */
export abstract class RoundMode extends BaseMode {
  override readonly hiddenInfo: boolean = true;
  protected abstract readonly timing: RoundTiming;
  protected abstract readonly seekerShare: number;
  protected abstract readonly seekerWeapons: readonly WeaponId[];

  rounds = 4;
  variant = "classic";
  round = 0;
  stage: RoundStage = "";
  stageEnd = 0;
  /** Side that won the last finished round. */
  lastWinner: RoleId | 0 = 0;
  protected matchDone = false;
  protected readonly side = new Map<string, RoleId>();
  protected readonly points = new Map<string, number>();
  protected readonly finds = new Map<string, number>();
  protected readonly survived = new Map<string, number>();
  /** Ticks spent hidden (alive, not exposed) by hiders this match. */
  protected readonly hiddenTicks = new Map<string, number>();
  /** Order in which players take the seeker side. */
  protected rotation: string[] = [];
  protected rotationIndex = 0;
  /** Exposed to the seeking side until this tick. */
  protected readonly exposedUntil = new Map<string, number>();
  /** Last pose the seeking side was allowed to see. */
  protected readonly lastPublic = new Map<string, PublicPose>();

  override configure(opts: { rounds: number; variant: string }): void {
    this.rounds = Math.max(1, Math.min(8, Math.round(opts.rounds)));
    this.variant = opts.variant || "classic";
  }

  sideOf(id: string): RoleId | 0 {
    return this.side.get(id) ?? ROLE.NONE;
  }

  protected tickOf(sec: number): number {
    return this.sim.secToTicks(sec);
  }

  /** Humans in the match (round modes never have practice bots). */
  protected humans(): ServerPlayer[] {
    return this.players().filter((p) => p.playerId !== "" || !p.id.startsWith("bot:"));
  }

  protected bySide(role: RoleId): ServerPlayer[] {
    return this.players().filter((p) => this.side.get(p.id) === role);
  }

  protected aliveSide(role: RoleId): ServerPlayer[] {
    return this.bySide(role).filter((p) => p.alive);
  }

  addPoints(p: ServerPlayer, n: number): void {
    this.points.set(p.id, (this.points.get(p.id) ?? 0) + n);
  }

  pointsOf(id: string): number {
    return this.points.get(id) ?? 0;
  }

  // ------------------------------------------------------------------ match / round flow

  override pickupAllowed(_kind: PickupKind): boolean {
    return false;
  }

  override reset(): void {
    this.round = 0;
    this.matchDone = false;
    this.lastWinner = 0;
    this.points.clear();
    this.finds.clear();
    this.survived.clear();
    this.hiddenTicks.clear();
    // Join order (the room's insertion order): everybody seeks once before anybody twice.
    this.rotation = this.players().map((p) => p.id);
    this.rotationIndex = 0;
    this.assignSides();
    this.round = 1;
    this.beginStage("prep", 0);
    this.onRoundStart();
  }

  /** Seekers for this round: the next players in the rotation; everybody else hides. */
  protected assignSides(): void {
    const all = this.players();
    for (const p of all) if (!this.rotation.includes(p.id)) this.rotation.push(p.id);
    this.rotation = this.rotation.filter((id) => this.sim.players.has(id));
    const n = all.length;
    const seekers = Math.max(1, Math.min(n - 1, Math.ceil(n / this.seekerShare)));
    const chosen = new Set<string>();
    for (let i = 0; i < seekers && this.rotation.length > 0; i++) {
      chosen.add(this.rotation[(this.rotationIndex + i) % this.rotation.length]!);
    }
    this.rotationIndex = (this.rotationIndex + seekers) % Math.max(1, this.rotation.length);
    this.side.clear();
    this.exposedUntil.clear();
    this.lastPublic.clear();
    for (const p of all) {
      const role = chosen.has(p.id) ? ROLE.SEEKER : ROLE.HIDER;
      this.side.set(p.id, role);
      p.team = role;
    }
  }

  /** `end` 0: the stage length starts counting at the first live tick (after the countdown). */
  protected beginStage(stage: RoundStage, end: number): void {
    this.stage = stage;
    this.stageEnd = end;
    if (stage !== "")
      this.emit({
        t: "round",
        s: stage,
        n: this.round,
        ...(stage === "break" && this.lastWinner ? { w: this.lastWinner } : {}),
      });
  }

  protected stageLength(stage: RoundStage): number {
    if (stage === "prep") return this.tickOf(this.timing.prepSec);
    if (stage === "hunt") return this.tickOf(this.timing.huntSec);
    if (stage === "break") return this.tickOf(this.timing.breakSec);
    return 0;
  }

  protected startRound(n: number): void {
    this.round = n;
    this.assignSides();
    for (const p of this.players()) {
      this.sim.leaveVehicle(p, true);
      p.alive = false;
      p.respawnTick = 0;
      this.sim.spawn(p, true);
    }
    this.beginStage("prep", this.sim.tick + this.stageLength("prep"));
    this.onRoundStart();
  }

  protected endRound(winner: RoleId): void {
    if (this.stage !== "hunt" && this.stage !== "prep") return;
    this.lastWinner = winner;
    if (winner === ROLE.HIDER) {
      for (const p of this.aliveSide(ROLE.HIDER)) {
        this.addPoints(p, this.surviveBonus);
        this.survived.set(p.id, (this.survived.get(p.id) ?? 0) + 1);
      }
    }
    this.onRoundEnd(winner);
    this.beginStage("break", this.sim.tick + this.stageLength("break"));
  }

  /** The seeking side can no longer win the round (Infection: only when nobody is infected). */
  protected seekersOut(): boolean {
    return this.aliveSide(ROLE.SEEKER).length === 0;
  }

  protected abstract readonly surviveBonus: number;
  protected onRoundStart(): void {}
  protected onRoundEnd(_winner: RoleId): void {}
  protected onHuntStart(): void {}
  /** Mode work every live tick of the hunt (points, hints). */
  protected huntTick(): void {}

  override step(): void {
    const tick = this.sim.tick;
    if (this.stageEnd === 0 && this.stage !== "") this.stageEnd = tick + this.stageLength(this.stage);
    switch (this.stage) {
      case "prep":
        if (tick >= this.stageEnd) {
          this.beginStage("hunt", tick + this.stageLength("hunt"));
          this.onHuntStart();
        }
        break;
      case "hunt": {
        this.huntTick();
        if (this.aliveSide(ROLE.HIDER).length === 0) this.endRound(ROLE.SEEKER);
        else if (this.seekersOut()) this.endRound(ROLE.HIDER);
        else if (tick >= this.stageEnd) this.endRound(ROLE.HIDER);
        break;
      }
      case "break":
        if (tick >= this.stageEnd) {
          if (this.round >= this.rounds) {
            this.matchDone = true;
            this.stage = "";
          } else this.startRound(this.round + 1);
        }
        break;
    }
    this.updateExposure();
  }

  override over(): string | null {
    if (this.matchDone) return "rounds";
    // Not enough people left to play: never keep a match running that nobody can finish.
    if (this.humans().length < 2) return "opponents-left";
    return null;
  }

  override frozen(p: ServerPlayer): boolean {
    if (this.stage === "break") return true;
    return this.stage === "prep" && this.side.get(p.id) === ROLE.SEEKER;
  }

  override respawnDelay(_victim: ServerPlayer, _killer: ServerPlayer | null): number | null {
    return null;
  }

  override allowJoinSpawn(p: ServerPlayer): boolean {
    // Spectates until the next round; joins the rotation.
    if (!this.rotation.includes(p.id)) this.rotation.push(p.id);
    this.side.set(p.id, ROLE.NONE);
    p.team = 0;
    return false;
  }

  override onLeave(p: ServerPlayer): void {
    this.side.delete(p.id);
    this.exposedUntil.delete(p.id);
    this.lastPublic.delete(p.id);
    const i = this.rotation.indexOf(p.id);
    if (i >= 0) {
      this.rotation.splice(i, 1);
      if (i < this.rotationIndex) this.rotationIndex = Math.max(0, this.rotationIndex - 1);
    }
    // A side left empty ends the round at the next tick (step); nothing waits on a missing player.
  }

  protected seekerSpawn(p: ServerPlayer): Vec2 {
    const pen = this.sim.map.party?.seekerPen;
    const list = pen?.length ? pen : this.sim.map.spawns.slice(0, 2);
    const idx = this.bySide(ROLE.SEEKER).findIndex((s) => s.id === p.id);
    return list[Math.max(0, idx) % list.length]!;
  }

  protected hiderSpawn(p: ServerPlayer): Vec2 {
    const party = this.sim.map.party;
    const seekerAt = this.seekerSpawn(this.bySide(ROLE.SEEKER)[0] ?? p);
    let list: readonly Vec2[] = party?.hiderSpawns ?? [];
    if (list.length === 0) {
      // No party data: the half of the spawns farthest from the seekers.
      const sorted = [...this.sim.map.spawns].sort(
        (a, b) =>
          (b.x - seekerAt.x) ** 2 +
          (b.y - seekerAt.y) ** 2 -
          ((a.x - seekerAt.x) ** 2 + (a.y - seekerAt.y) ** 2),
      );
      list = sorted.slice(0, Math.max(2, Math.ceil(sorted.length / 2)));
    }
    const idx = this.bySide(ROLE.HIDER).findIndex((h) => h.id === p.id);
    return list[Math.max(0, idx) % list.length]!;
  }

  override spawnPoint(p: ServerPlayer): { x: number; y: number } {
    return this.side.get(p.id) === ROLE.SEEKER ? this.seekerSpawn(p) : this.hiderSpawn(p);
  }

  override onSpawn(p: ServerPlayer): void {
    const s = p.sim;
    if (this.side.get(p.id) === ROLE.SEEKER) {
      s.slots = [emptySlot(), emptySlot(), emptySlot()];
      this.seekerWeapons.forEach((w, i) => {
        const slot = fullSlot(w);
        slot.reserve = -1;
        s.slots[i] = slot;
      });
    } else {
      s.slots = [emptySlot(), emptySlot(), emptySlot()];
    }
    s.slot = 0;
    s.reload = 0;
    s.swap = 0;
    p.protectedUntil = 0;
    this.lastPublic.set(p.id, { x: 0, y: 0, aim: 0 });
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null, _weapon: number): void {
    if (this.side.get(victim.id) !== ROLE.HIDER) return;
    this.lastPublic.set(victim.id, { x: victim.sim.x, y: victim.sim.y, aim: victim.sim.aim });
    if (killer && this.side.get(killer.id) === ROLE.SEEKER) {
      this.addPoints(killer, this.findPoints);
      this.finds.set(killer.id, (this.finds.get(killer.id) ?? 0) + 1);
    }
    this.emit({ t: "found", p: victim.id, by: killer?.id ?? "" });
  }

  protected abstract readonly findPoints: number;

  // ------------------------------------------------------------------ hidden information

  /** Whether `h` is currently hidden from the seeking side. */
  masked(h: ServerPlayer): boolean {
    // Outside a running match (lobby after the last round) nothing is secret any more.
    if (this.stage === "" || this.side.get(h.id) !== ROLE.HIDER) return false;
    const until = this.exposedUntil.get(h.id);
    return until === undefined || until < this.sim.tick;
  }

  override publicPose(p: ServerPlayer): PublicPose | null {
    if (!this.masked(p)) return null;
    return this.lastPublic.get(p.id) ?? { x: 0, y: 0, aim: 0 };
  }

  /** Can seeker `s` see hider `h` right now (screen box, range rules, line of sight)? */
  protected sees(s: ServerPlayer, h: ServerPlayer): boolean {
    const dx = h.sim.x - s.sim.x;
    const dy = h.sim.y - s.sim.y;
    if (Math.abs(dx) > SIGHT.halfW || Math.abs(dy) > SIGHT.halfH) return false;
    const d = Math.hypot(dx, dy);
    if (d > this.rangeFor(s, h, dx, dy, d)) return false;
    return hasLineOfSight(this.sim.shotWorld, s.sim.x, s.sim.y, h.sim.x, h.sim.y);
  }

  /** Farthest distance at which `s` can see `h` given shadows and hiding spots. */
  protected rangeFor(_s: ServerPlayer, h: ServerPlayer, _dx: number, _dy: number, _d: number): number {
    const party = this.sim.map.party;
    let range = Number.POSITIVE_INFINITY;
    if (party) {
      for (const r of party.shadows)
        if (pointInRect(h.sim.x, h.sim.y, r)) range = Math.min(range, SIGHT.shadowRange);
      for (const spot of party.hideSpots) {
        if ((h.sim.x - spot.x) ** 2 + (h.sim.y - spot.y) ** 2 <= spot.r * spot.r)
          range = Math.min(range, SIGHT.spotRange);
      }
    }
    return range;
  }

  /** Recomputes who the seeking side can see; emits "spot" when a hider is newly seen. */
  protected updateExposure(): void {
    const tick = this.sim.tick;
    const seekers = this.stage === "hunt" ? this.aliveSide(ROLE.SEEKER).filter((s) => s.connected) : [];
    const hold = this.tickOf(SIGHT.holdSec);
    for (const h of this.bySide(ROLE.HIDER)) {
      if (!h.alive) continue;
      if (!this.exposable(h)) continue;
      const seen = seekers.some((s) => this.sees(s, h));
      if (seen) {
        const until = this.exposedUntil.get(h.id);
        const was = until !== undefined && until >= tick;
        this.exposedUntil.set(h.id, tick + hold);
        if (!was) this.emit({ t: "spot", p: h.id });
      }
      if (!this.masked(h)) {
        this.lastPublic.set(h.id, { x: h.sim.x, y: h.sim.y, aim: h.sim.aim });
      } else if (this.stage === "hunt") {
        this.hiddenTicks.set(h.id, (this.hiddenTicks.get(h.id) ?? 0) + 1);
      }
    }
  }

  /** Prop Hunt never exposes the player body (the object is what the seekers see). */
  protected exposable(_h: ServerPlayer): boolean {
    return true;
  }

  override canSeeAlly(viewerId: string, ownerId: string): boolean {
    if (viewerId === ownerId) return true;
    const vs = this.side.get(viewerId);
    return vs === ROLE.HIDER && this.side.get(ownerId) === ROLE.HIDER;
  }

  /** Events about a masked player reach only those allowed to see them. */
  override eventVisible(viewerId: string, ev: NetEvent): boolean {
    const about = (id: string) => {
      const p = this.sim.players.get(id);
      return !p || !this.masked(p) || this.canSeeAlly(viewerId, id);
    };
    switch (ev.t) {
      case "spawn":
      case "dash":
      case "reload":
      case "pickup":
      case "seat":
        return about(ev.p);
      case "shot":
        return about(ev.p);
      case "spot":
        return viewerId === ev.p || this.side.get(viewerId) === ROLE.SEEKER;
      default:
        return true;
    }
  }

  override allyEntries(): Map<string, AllyData> {
    const out = new Map<string, AllyData>();
    for (const p of this.bySide(ROLE.HIDER)) {
      if (!p.alive) continue;
      if (!this.masked(p) && !this.alwaysGhost(p)) continue;
      out.set(p.id, this.allyData(p));
    }
    return out;
  }

  /** Prop Hunt: the prop's own ghost carries its disguise even while it is exposed. */
  protected alwaysGhost(_p: ServerPlayer): boolean {
    return false;
  }

  protected allyData(p: ServerPlayer): AllyData {
    return {
      x: p.sim.x,
      y: p.sim.y,
      a: p.sim.aim,
      t: ROLE.HIDER,
      d: "",
      k: -1,
      lk: false,
      cdT: 0,
      cdS: 0,
      cdD: 0,
    };
  }

  override ability(_p: ServerPlayer, _msg: AbilityMessage): void {}

  // ------------------------------------------------------------------ results

  override standings(): ServerPlayer[] {
    return this.players().sort(
      (a, b) =>
        this.pointsOf(b.id) - this.pointsOf(a.id) ||
        (this.finds.get(b.id) ?? 0) - (this.finds.get(a.id) ?? 0) ||
        a.stats.deaths - b.stats.deaths ||
        a.joinedTick - b.joinedTick,
    );
  }

  override leaderScore(): number {
    let max = 0;
    for (const v of this.points.values()) max = Math.max(max, v);
    return max;
  }

  override facts(p: ServerPlayer): ModeFacts {
    return {
      points: this.pointsOf(p.id),
      roundsSurvived: this.survived.get(p.id) ?? 0,
      finds: this.finds.get(p.id) ?? 0,
      extra: {},
    };
  }

  override sync(state: MatchState): void {
    const r = state.round;
    if (r.stage !== this.stage) r.stage = this.stage;
    if (r.end !== this.stageEnd) r.end = this.stageEnd;
    if (r.num !== this.round) r.num = this.round;
    if (r.of !== this.rounds) r.of = this.rounds;
    if (r.variant !== this.variant) r.variant = this.variant;
    const seekers = this.aliveSide(ROLE.SEEKER).length;
    const hiders = this.aliveSide(ROLE.HIDER).length;
    if (r.seekers !== seekers) r.seekers = seekers;
    if (r.hiders !== hiders) r.hiders = hiders;
    if (r.winner !== this.lastWinner) r.winner = this.lastWinner;
    for (const [id, p] of this.sim.players) {
      const ps = state.players.get(id);
      if (!ps) continue;
      const role = this.side.get(id) ?? ROLE.NONE;
      if (ps.role !== role) ps.role = role;
      const pts = Math.min(65535, this.pointsOf(id));
      if (ps.pts !== pts) ps.pts = pts;
      const frozen = this.frozen(p);
      if (ps.frozen !== frozen) ps.frozen = frozen;
    }
  }
}
