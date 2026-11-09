import { DEG, HIDE_SEEK, type MatchState, PLAYER, ROLE, type RoleId, SIGHT } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import type { ModeFacts } from "./ModeController.ts";
import { RoundMode } from "./RoundMode.ts";

/**
 * Hide & Seek. One seeker per five players waits blindfolded in the pen while the others hide;
 * then the seekers hunt with their weapons. The server publishes a hider's position only while a
 * seeker can actually see them (screen box, line of sight, shadows, hiding spots, and in the
 * Blackout variant the flashlight cone). Variants: "classic" (found hiders are out until the next
 * round), "infect" (found hiders join the seekers), "blackout" (lights out periodically).
 */
export class HideSeekMode extends RoundMode {
  readonly mode = "hideseek" as const;
  protected readonly timing = HIDE_SEEK;
  protected readonly seekerShare = HIDE_SEEK.playersPerSeeker;
  protected readonly seekerWeapons = HIDE_SEEK.seekerWeapons;
  protected readonly surviveBonus = HIDE_SEEK.points.survive;
  protected readonly findPoints = HIDE_SEEK.points.find;
  dark = false;
  private huntStart = 0;
  /** Hidden-time points already paid out, per player (in units of hiddenEverySec). */
  private readonly hiddenPaid = new Map<string, number>();

  override reset(): void {
    this.hiddenPaid.clear();
    super.reset();
  }

  protected override onRoundStart(): void {
    this.dark = false;
  }

  protected override onHuntStart(): void {
    this.huntStart = this.sim.tick;
  }

  protected override onRoundEnd(_winner: RoleId): void {
    this.dark = false;
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
    if (this.variant === "blackout") {
      const cycle = this.tickOf(HIDE_SEEK.blackout.onSec + HIDE_SEEK.blackout.offSec);
      const t = (this.sim.tick - this.huntStart) % cycle;
      this.dark = t >= this.tickOf(HIDE_SEEK.blackout.onSec);
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

  override sync(state: MatchState): void {
    super.sync(state);
    if (state.round.dark !== this.dark) state.round.dark = this.dark;
  }
}
