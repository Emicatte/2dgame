import { NO_WEAPON, type PlayerState } from "@scrapline/shared";
import type { ServerPlayer } from "./GameSimulation.ts";

/**
 * Mirrors one simulated player into its synchronized schema object. Shared by ArenaRoom and the
 * offline client benchmark host (apps/web/src/bench), so both publish exactly the same state.
 */
export function syncPlayerState(ps: PlayerState, p: ServerPlayer, tick: number): void {
  const s = p.sim;
  ps.alive = p.alive;
  ps.x = s.x;
  ps.y = s.y;
  ps.aim = s.aim;
  ps.hp = p.hp;
  ps.kills = p.stats.kills;
  ps.deaths = p.stats.deaths;
  ps.streak = p.stats.streak;
  const slot = s.slots[s.slot];
  ps.weapon = slot?.id ?? NO_WEAPON;
  ps.reloading = s.reload > 0;
  ps.protected = p.alive && p.protectedUntil > tick;
  ps.respawnTick = p.alive ? 0 : p.respawnTick;

  ps.ack = p.lastProcessedSeq;
  ps.vx = s.vx;
  ps.vy = s.vy;
  ps.dash = s.dash;
  ps.dashCd = s.dashCd;
  ps.dashDx = s.dashDx;
  ps.dashDy = s.dashDy;
  ps.dashHeld = s.dashHeld;
  ps.slot = s.slot;
  const [a, b, c] = s.slots;
  ps.w0 = a!.id;
  ps.m0 = a!.mag;
  ps.r0 = a!.reserve;
  ps.w1 = b!.id;
  ps.m1 = b!.mag;
  ps.r1 = b!.reserve;
  ps.w2 = c!.id;
  ps.m2 = c!.mag;
  ps.r2 = c!.reserve;
  ps.cooldown = s.cooldown;
  ps.reload = s.reload;
  ps.swap = s.swap;
  ps.bloom = s.bloom;
  ps.trigger = s.trigger;
}
