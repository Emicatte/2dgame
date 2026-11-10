import {
  type AbilityMessage,
  DEG,
  HIDE_SEEK,
  hasLineOfSight,
  PARTY_ABILITIES,
  PLAYER,
  ROLE,
  SIGHT,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import type { ModeFacts } from "./ModeController.ts";
import { RoundMode } from "./RoundMode.ts";

/**
 * Hide & Seek. One seeker per five players waits blindfolded in the pen while the others hide;
 * then the seekers hunt with their weapons. The server publishes a hider's position only while a
 * seeker can actually see them (screen box, line of sight, shadows, hiding spots, and in the
 * Blackout variant the flashlight cone). Variants: "classic" (found hiders are out until the next
 * round), "infect" (found hiders join the seekers), "blackout" (lights out periodically).
 * Seekers have a sonar (G); hiders throw a noise decoy (G): a fake ping where they aim. Mid-hunt
 * the lights go out for 20 s in every variant (Blackout has its own cycle instead).
 */
export class HideSeekMode extends RoundMode {
  readonly mode = "hideseek" as const;
  protected readonly timing = HIDE_SEEK;
  protected readonly seekerShare = HIDE_SEEK.playersPerSeeker;
  protected readonly seekerWeapons = HIDE_SEEK.seekerWeapons;
  protected readonly surviveBonus = HIDE_SEEK.points.survive;
  protected readonly findPoints = HIDE_SEEK.points.find;
  private huntStart = 0;
  /** Hidden-time points already paid out, per player (in units of hiddenEverySec). */
  private readonly hiddenPaid = new Map<string, number>();

  override reset(): void {
    this.hiddenPaid.clear();
    super.reset();
  }

  protected override onHuntStart(): void {
    this.huntStart = this.sim.tick;
  }

  protected override darkNow(): boolean {
    if (this.variant !== "blackout") return super.darkNow();
    const cycle = this.tickOf(HIDE_SEEK.blackout.onSec + HIDE_SEEK.blackout.offSec);
    return (this.sim.tick - this.huntStart) % cycle >= this.tickOf(HIDE_SEEK.blackout.onSec);
  }

  /** Hiders: noise decoy (G), a fake ping at the aimed point. */
  protected override roleAbility(p: ServerPlayer, msg: AbilityMessage): string | null {
    if (msg.a !== "noise") return super.roleAbility(p, msg);
    if (this.sideOf(p.id) !== ROLE.HIDER || !p.alive || this.stage !== "hunt") return null;
    const tick = this.sim.tick;
    if (tick < (this.cdAbility.get(p.id) ?? 0)) return "Noise decoy is recharging";
    const n = PARTY_ABILITIES.noise;
    let tx = msg.x ?? p.sim.x + Math.cos(p.sim.aim) * n.rangePx;
    let ty = msg.y ?? p.sim.y + Math.sin(p.sim.aim) * n.rangePx;
    const d = Math.hypot(tx - p.sim.x, ty - p.sim.y);
    if (d > n.rangePx) {
      tx = p.sim.x + ((tx - p.sim.x) / d) * n.rangePx;
      ty = p.sim.y + ((ty - p.sim.y) / d) * n.rangePx;
    }
    // Thrown, not teleported: it lands where the throw is stopped by a wall.
    for (let i = 0; i < 12 && !hasLineOfSight(this.sim.world, p.sim.x, p.sim.y, tx, ty); i++) {
      tx = p.sim.x + (tx - p.sim.x) * 0.85;
      ty = p.sim.y + (ty - p.sim.y) * 0.85;
    }
    this.cdAbility.set(p.id, tick + this.tickOf(n.cooldownSec));
    this.addPing(tx, ty, n.pingRadius, n.pingSec);
    return null;
  }

  override onSpawn(p: ServerPlayer): void {
    super.onSpawn(p);
    p.hp = this.sideOf(p.id) === ROLE.HIDER ? HIDE_SEEK.hiderHealth : PLAYER.maxHealth;
  }

  override respawnDelay(victim: ServerPlayer): number | null {
    // Infection variant: a found hider comes back as a seeker.
    if (this.variant === "infect" && this.sideOf(victim.id) === ROLE.HIDER) return 2;
    return null;
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    const wasHider = this.sideOf(victim.id) === ROLE.HIDER;
    super.onKill(victim, killer, weapon);
    if (wasHider && this.variant === "infect") {
      this.side.set(victim.id, ROLE.SEEKER);
      victim.team = ROLE.SEEKER;
      this.exposedUntil.delete(victim.id);
    }
  }

  protected override huntTick(): void {
    const every = this.tickOf(HIDE_SEEK.points.hiddenEverySec);
    for (const h of this.aliveSide(ROLE.HIDER)) {
      const units = Math.floor((this.hiddenTicks.get(h.id) ?? 0) / every);
      const paid = this.hiddenPaid.get(h.id) ?? 0;
      if (units > paid) {
        this.addPoints(h, (units - paid) * HIDE_SEEK.points.hidden);
        this.hiddenPaid.set(h.id, units);
      }
    }
  }

  protected override rangeFor(s: ServerPlayer, h: ServerPlayer, dx: number, dy: number, d: number): number {
    let range = super.rangeFor(s, h, dx, dy, d);
    if (this.dark) {
      // Lights out: the seeker sees only what the flashlight cone (or arm's length) reaches.
      const diff = Math.abs(
        Math.atan2(Math.sin(Math.atan2(dy, dx) - s.sim.aim), Math.cos(Math.atan2(dy, dx) - s.sim.aim)),
      );
      const inCone = diff <= SIGHT.flashlightHalfAngleDeg * DEG;
      range = Math.min(range, inCone ? SIGHT.flashlightRange : SIGHT.darkRange);
    }
    return range;
  }

  override facts(p: ServerPlayer): ModeFacts {
    const base = super.facts(p);
    const hideSeconds = Math.round((this.hiddenTicks.get(p.id) ?? 0) / this.sim.tickRateHz);
    const extra: Record<string, number> = {};
    if (hideSeconds > 0) extra.hideSeconds = hideSeconds;
    if (base.roundsSurvived) extra.hideRounds = base.roundsSurvived;
    if (base.finds) extra.hidersFound = base.finds;
    return { ...base, extra };
  }
}
