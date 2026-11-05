import { type MatchState, NO_WEAPON, type PlayerState, VehicleState } from "@scrapline/shared";
import type { GameSimulation, ServerPlayer } from "./GameSimulation.ts";

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
  ps.vehicle = p.vehicle ?? "";
  ps.seat = p.vehicle ? p.seat : -1;

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

/**
 * Mirrors the simulated vehicles into the synchronized map (created on first use and after a map
 * change). Shared by ArenaRoom and the host-mode room.
 */
export function syncVehicles(state: MatchState, sim: GameSimulation): void {
  for (const id of [...state.vehicles.keys()]) if (!sim.vehicles.has(id)) state.vehicles.delete(id);
  for (const [id, v] of sim.vehicles) {
    let vs = state.vehicles.get(id);
    if (!vs) {
      vs = new VehicleState();
      state.vehicles.set(id, vs);
    }
    vs.kind = v.def.kind;
    const s = v.sim;
    vs.x = s.x;
    vs.y = s.y;
    vs.angle = s.angle;
    vs.vx = s.vx;
    vs.vy = s.vy;
    vs.av = s.av;
    vs.alt = s.alt;
    vs.rotor = s.rotor;
    vs.lift = s.lift;
    vs.liftHeld = s.liftHeld;
    vs.hp = v.hp;
    vs.status = v.status;
    vs.s0 = v.seats[0] ?? "";
    vs.s1 = v.seats[1] ?? "";
    vs.s2 = v.seats[2] ?? "";
    vs.s3 = v.seats[3] ?? "";
  }
}
