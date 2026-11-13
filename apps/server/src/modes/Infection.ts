import { emptySlot, fullSlot, INFECTION, ROLE, SECONDARY_WEAPON } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import type { ModeFacts } from "./ModeController.ts";
import { RoundMode } from "./RoundMode.ts";

/**
 * Infection. One player per eight starts infected (fast, melee claws); the survivors keep their
 * guns with endless ammo. A survivor taken down comes back infected two seconds later. The
 * survivors win the round if one of them is still standing when the timer runs out.
 *
 * Sides reuse the round machinery: infected = SEEKER (1), survivors = HIDER (2). Nothing is
 * hidden on screen; the last survivor is announced by name only (no position).
 */
export class InfectionMode extends RoundMode {
  readonly mode = "infection" as const;
  override readonly hiddenInfo = false;
  protected readonly timing = INFECTION;
  protected readonly seekerShare = INFECTION.playersPerInfected;
  protected readonly seekerWeapons = ["claws"] as const;
  protected readonly surviveBonus = INFECTION.points.survive;
  protected readonly findPoints = INFECTION.points.infect;
  /** Survival points already paid this round, per survivor (units of aliveEverySec). */
  private readonly alivePaid = new Map<string, number>();
  private readonly aliveTicks = new Map<string, number>();
  /** Last tick each infected was hurt (regeneration waits for a pause). */
  private readonly hurtTick = new Map<string, number>();
  /** Survivors taken by an infected: where they rise, infected. */
  private readonly turned = new Map<string, { x: number; y: number }>();

  override reset(): void {
    this.alivePaid.clear();
    this.aliveTicks.clear();
    this.hurtTick.clear();
    this.turned.clear();
    super.reset();
  }

  protected override onRoundStart(): void {
    this.alivePaid.clear();
    this.aliveTicks.clear();
  }

  /** Nothing is secret in Infection. */
  override masked(_h: ServerPlayer): boolean {
    return false;
  }

  override spawnPoint(p: ServerPlayer): { x: number; y: number } {
    const at = this.turned.get(p.id);
    if (at) {
      this.turned.delete(p.id);
      return at;
    }
    // The first infected start in the pen; once the hunt runs, infected come back anywhere far
    // from the survivors.
    if (this.sideOf(p.id) === ROLE.SEEKER && this.stage === "hunt") return this.sim.chooseSpawn(p.id);
    return super.spawnPoint(p);
  }

  override onSpawn(p: ServerPlayer): void {
    super.onSpawn(p);
    if (this.sideOf(p.id) === ROLE.SEEKER) {
      p.hp = INFECTION.infectedHealth;
      return;
    }
    if (this.sideOf(p.id) !== ROLE.HIDER) return;
    const primary = fullSlot(p.primary);
    primary.reserve = -1;
    p.sim.slots = [primary, fullSlot(SECONDARY_WEAPON), emptySlot()];
    p.sim.slot = 0;
  }

  /** Infected come back; a fallen survivor comes back infected. */
  override respawnDelay(victim: ServerPlayer, killer?: ServerPlayer | null): number {
    const taken = this.sideOf(victim.id) === ROLE.HIDER && !!killer && this.sideOf(killer.id) === ROLE.SEEKER;
    return taken ? INFECTION.turnSec : INFECTION.respawnSec;
  }

  override allowJoinSpawn(p: ServerPlayer): boolean {
    // A latecomer joins the infected straight away (no spectating in Infection).
    if (this.stage === "hunt") {
      if (!this.rotation.includes(p.id)) this.rotation.push(p.id);
      this.side.set(p.id, ROLE.SEEKER);
      p.team = ROLE.SEEKER;
      return true;
    }
    return super.allowJoinSpawn(p);
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    const wasSurvivor = this.sideOf(victim.id) === ROLE.HIDER;
    super.onKill(victim, killer, weapon);
    if (!wasSurvivor) return;
    if (killer && this.sideOf(killer.id) === ROLE.SEEKER)
      this.turned.set(victim.id, { x: victim.sim.x, y: victim.sim.y });
    this.side.set(victim.id, ROLE.SEEKER);
    victim.team = ROLE.SEEKER;
    const left = this.aliveSide(ROLE.HIDER).length;
    if (left === 1)
      this.emit({ t: "announce", s: "Last survivor", d: this.aliveSide(ROLE.HIDER)[0]!.name, w: 2 });
  }

  /** Infected respawn: the round goes on while anybody is infected, alive or not. */
  protected override seekersOut(): boolean {
    return this.bySide(ROLE.SEEKER).length === 0;
  }

  /** The infected cannot be hurt while they wait in the pen. */
  override damageScale(attacker: ServerPlayer | null, target: ServerPlayer): number {
    if (this.sideOf(target.id) === ROLE.SEEKER) {
      if (this.stage === "prep") return 0;
      this.hurtTick.set(target.id, this.sim.tick);
    }
    return attacker && this.sideOf(attacker.id) === ROLE.SEEKER ? INFECTION.damageMult : 1;
  }

  protected override huntTick(): void {
    const quiet = this.tickOf(INFECTION.regen.afterSec);
    if (this.sim.tick % this.tickOf(1) === 0)
      for (const z of this.aliveSide(ROLE.SEEKER))
        if (z.hp < INFECTION.infectedHealth && this.sim.tick - (this.hurtTick.get(z.id) ?? 0) >= quiet)
          z.hp = Math.min(INFECTION.infectedHealth, z.hp + INFECTION.regen.perSec);
    const every = this.tickOf(INFECTION.points.aliveEverySec);
    const survivors = this.aliveSide(ROLE.HIDER);
    for (const h of survivors) {
      const ticks = (this.aliveTicks.get(h.id) ?? 0) + 1;
      this.aliveTicks.set(h.id, ticks);
      const units = Math.floor(ticks / every);
      const paid = this.alivePaid.get(h.id) ?? 0;
      if (units > paid) {
        this.addPoints(h, (units - paid) * INFECTION.points.alive);
        this.alivePaid.set(h.id, units);
      }
    }
  }

  override facts(p: ServerPlayer): ModeFacts {
    const base = super.facts(p);
    const extra: Record<string, number> = {};
    if (base.finds) extra.infections = base.finds;
    if (base.roundsSurvived) extra.infectionRounds = base.roundsSurvived;
    return { ...base, extra };
  }
}
