import {
  isPveMode,
  type MapId,
  type MatchSettings,
  type MatchState,
  missionById,
  type PersonalResult,
  PVE_STATUS,
  type PveResult,
  type ResultRow,
} from "@scrapline/shared";
import { MatchRules } from "../rules/MatchRules.ts";
import type { GameSimulation } from "../simulation/GameSimulation.ts";

/**
 * PvE room rules shared by the dedicated ArenaRoom and the browser-hosted HostRoom (the same way
 * MatchRules is): lobby settings, end-of-run detection and results.
 */

/**
 * Applies the PvE part of the host's lobby settings (mission, difficulty). Returns the map the room
 * must switch to (a mission plays on its own map), or null.
 */
export function applyPveSettings(state: MatchState, s: MatchSettings): { map: MapId | null; error?: string } {
  if (!isPveMode(state.mode)) return { map: null };
  let error: string | undefined;
  if (s.mission !== undefined && state.mode === "outbreak") {
    const m = missionById(s.mission);
    if (m) state.pve.mission = m.id;
    else error = "That mission is not available yet";
  }
  if (s.difficulty) state.pve.difficulty = s.difficulty;
  const map = MatchRules.mapForMode(state.mode, state.mapId as MapId, state.pve.mission);
  return error ? { map, error } : { map };
}

/** The run ended (mission complete or failed, squad wiped). */
export function pveOver(sim: GameSimulation): boolean {
  return !!sim.pve && sim.pve.status !== PVE_STATUS.RUNNING;
}

export interface PveResults {
  rows: ResultRow[];
  pve: PveResult;
  personal: Map<string, PersonalResult>;
}

/**
 * Results of a PvE run. XP comes from authoritative counters only. Competitive stats (kills,
 * deaths, wins) are NOT touched by PvE: the record carries the run in its own `pve` section so a
 * profile's PvP numbers stay PvP. Each player's browser (host mode) or the server records the run
 * once per `runId`.
 */
export function buildPveResults(
  sim: GameSimulation,
  runId: string,
  minParticipationTicks: number,
): PveResults {
  const pve = sim.pve!;
  const { result, xp } = pve.results(minParticipationTicks);
  const rows: ResultRow[] = result.squad.map((r, i) => ({
    id: r.id,
    name: r.name,
    team: 1,
    kills: r.kills,
    deaths: r.downs,
    placement: i + 1,
    accuracy: r.accuracy,
  }));
  const personal = new Map<string, PersonalResult>();
  for (const p of sim.players.values()) {
    const x = xp.get(p.id) ?? { total: 0, lines: [] };
    const participated = p.stats.activeTicks >= minParticipationTicks;
    personal.set(p.id, {
      placement: rows.findIndex((r) => r.id === p.id) + 1,
      xpGained: x.total,
      xpLines: x.lines,
      totalXp: null,
      level: null,
      leveledUp: false,
      unlocked: [],
      persisted: false,
      record: {
        kills: 0,
        deaths: 0,
        won: false,
        completed: false,
        shotsFired: p.stats.shotsFired,
        shotsHit: p.stats.shotsHit,
        playtimeSec: Math.round(p.stats.activeTicks / sim.tickRateHz),
        mode: pve.mode,
        pve: {
          runId,
          mode: pve.mode,
          mission: pve.mission?.id ?? "",
          difficulty: pve.difficultyId,
          completed: result.completed && participated,
          kills: p.stats.kills,
          revives: p.pve.revives,
          downs: p.pve.downs,
          progress: pve.progress,
          timeSec: result.timeSec,
        },
      },
    });
  }
  return { rows, pve: result, personal };
}
