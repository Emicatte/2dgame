import { computeMatchXp, levelFromXp, type PersonalResult, type ResultRow, rewardsForLevel } from "@scrapline/shared";
import type { MatchPlayerResult } from "../persistence/repository.ts";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";

export interface ComputedResult {
  player: ServerPlayer;
  placement: number;
  completed: boolean;
  won: boolean;
  xp: ReturnType<typeof computeMatchXp>;
  persist: MatchPlayerResult;
}

/**
 * Turns final standings into XP and persistence rows. Pure function: everything it needs comes from
 * authoritative server-side counters, never from client messages.
 */
export function computeResults(
  standings: readonly ServerPlayer[],
  opts: { tickRate: number; minParticipationTicks: number; completed: boolean },
): ComputedResult[] {
  const count = standings.length;
  return standings.map((p, i) => {
    const placement = i + 1;
    const participated = p.stats.activeTicks >= opts.minParticipationTicks;
    const completed = opts.completed && participated;
    const won = completed && placement === 1 && count >= 2;
    const xp = computeMatchXp({
      completed,
      kills: p.stats.kills,
      placement,
      playerCount: count,
      firstBlood: p.stats.firstBlood,
      bestStreak: p.stats.bestStreak,
      shotsFired: p.stats.shotsFired,
      shotsHit: p.stats.shotsHit,
    });
    return {
      player: p,
      placement,
      completed,
      won,
      xp,
      persist: {
        playerId: p.playerId,
        kills: p.stats.kills,
        deaths: p.stats.deaths,
        placement,
        xpGained: xp.total,
        completed,
        won,
        shotsFired: p.stats.shotsFired,
        shotsHit: p.stats.shotsHit,
        playtimeSec: Math.round(p.stats.activeTicks / opts.tickRate),
      },
    };
  });
}

export function resultRows(results: readonly ComputedResult[]): ResultRow[] {
  return results.map((r) => ({
    id: r.player.id,
    name: r.player.name,
    kills: r.player.stats.kills,
    deaths: r.player.stats.deaths,
    placement: r.placement,
    accuracy: r.player.stats.shotsFired > 0 ? r.player.stats.shotsHit / r.player.stats.shotsFired : null,
  }));
}

export function personalResult(
  r: ComputedResult,
  before: { xp: number } | null,
  after: { xp: number; level: number } | null,
): PersonalResult {
  const levelBefore = before ? levelFromXp(before.xp).level : null;
  const leveledUp = !!(after && levelBefore !== null && after.level > levelBefore);
  const unlocked: string[] = [];
  if (after && levelBefore !== null) {
    for (let l = levelBefore + 1; l <= after.level; l++) unlocked.push(...rewardsForLevel(l).map((s) => s.name));
  }
  return {
    placement: r.placement,
    xpGained: r.xp.total,
    xpLines: r.xp.lines,
    totalXp: after?.xp ?? null,
    level: after?.level ?? null,
    leveledUp,
    unlocked,
    persisted: !!after,
  };
}
