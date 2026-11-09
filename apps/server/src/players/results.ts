import {
  computeMatchXp,
  levelFromXp,
  type PersonalResult,
  type ResultRow,
  unlocksForLevel,
  type XpLine,
} from "@scrapline/shared";
import type { ModeFacts } from "../modes/ModeController.ts";
import type { MatchPlayerResult } from "../persistence/repository.ts";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";

export interface ComputedResult {
  player: ServerPlayer;
  placement: number;
  completed: boolean;
  won: boolean;
  xp: ReturnType<typeof computeMatchXp>;
  persist: MatchPlayerResult;
  /** Mode points (round modes) / ladder level (Gun Game), when the mode has a controller. */
  points?: number;
}

/**
 * Turns final standings into XP and persistence rows. Pure function: everything it needs comes from
 * authoritative server-side counters, never from client messages.
 */
export function computeResults(
  standings: readonly ServerPlayer[],
  opts: {
    tickRate: number;
    minParticipationTicks: number;
    completed: boolean;
    /** Team modes: the winning team (0 = draw). Undefined in free-for-all. */
    winnerTeam?: number;
    /** Mode controller facts (Gun Game levels, rounds survived, finds, career counters). */
    facts?: (p: ServerPlayer) => ModeFacts;
  },
): ComputedResult[] {
  const count = standings.length;
  const teamMode = opts.winnerTeam !== undefined;
  return standings.map((p, i) => {
    const placement = i + 1;
    const participated = p.stats.activeTicks >= opts.minParticipationTicks;
    const completed = opts.completed && participated;
    const facts = opts.facts?.(p);
    const won = teamMode
      ? completed && (opts.winnerTeam ?? 0) > 0 && p.team === opts.winnerTeam
      : completed && placement === 1 && count >= 2;
    const xp = computeMatchXp({
      ...(teamMode ? { team: { won } } : {}),
      completed,
      kills: p.stats.kills,
      placement,
      playerCount: count,
      firstBlood: p.stats.firstBlood,
      bestStreak: p.stats.bestStreak,
      shotsFired: p.stats.shotsFired,
      shotsHit: p.stats.shotsHit,
      captures: p.stats.captures,
      flagCaptures: p.stats.flagCaptures,
      flagReturns: p.stats.returns,
      vehicleKills: p.stats.vehicleKills,
      ...(facts
        ? { gunGameLevels: facts.gunGameLevels, roundsSurvived: facts.roundsSurvived, finds: facts.finds }
        : {}),
    });
    const extra = facts && completed ? { ...facts.extra } : undefined;
    return {
      player: p,
      placement,
      completed,
      won,
      xp,
      ...(facts ? { points: facts.points } : {}),
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
        captures: p.stats.captures,
        flagCaptures: p.stats.flagCaptures,
        flagReturns: p.stats.returns,
        vehicleKills: p.stats.vehicleKills,
        ...(extra && Object.keys(extra).length > 0 ? { extra } : {}),
      },
    };
  });
}

export function resultRows(results: readonly ComputedResult[]): ResultRow[] {
  return results.map((r) => ({
    id: r.player.id,
    name: r.player.name,
    team: r.player.team,
    kills: r.player.stats.kills,
    deaths: r.player.stats.deaths,
    placement: r.placement,
    accuracy: r.player.stats.shotsFired > 0 ? r.player.stats.shotsHit / r.player.stats.shotsFired : null,
    ...(r.points !== undefined ? { points: r.points } : {}),
  }));
}

export function personalResult(
  r: ComputedResult,
  before: { xp: number } | null,
  after: { xp: number; level: number; challengeRewards?: XpLine[] } | null,
): PersonalResult {
  const levelBefore = before ? levelFromXp(before.xp).level : null;
  const leveledUp = !!(after && levelBefore !== null && after.level > levelBefore);
  const unlocked: string[] = [];
  if (after && levelBefore !== null) {
    for (let l = levelBefore + 1; l <= after.level; l++) unlocked.push(...unlocksForLevel(l));
  }
  const challenges = after?.challengeRewards ?? [];
  return {
    placement: r.placement,
    xpGained: r.xp.total + challenges.reduce((sum, l) => sum + l.xp, 0),
    xpLines: [...r.xp.lines, ...challenges],
    totalXp: after?.xp ?? null,
    level: after?.level ?? null,
    leveledUp,
    unlocked,
    persisted: !!after,
  };
}
