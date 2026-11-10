import { z } from "zod";
import { MATCH_LIMITS, NICKNAME } from "../config/game.ts";
import { GAME_MODES, type GameMode, ROUND_LIMITS, TEAM_SIZE } from "../config/modes.ts";
import { DISGUISES } from "../config/party.ts";
import { PRIMARY_WEAPONS, type WeaponId } from "../config/weapons.ts";
import { DIFFICULTIES, type Difficulty } from "../config/zombies.ts";
import { MAP_IDS, type MapId } from "../maps/index.ts";
import type { MatchPhase } from "../state.ts";

export const ROOM_NAME = "arena";

/** Client → server message types. */
export const C2S = {
  INPUT: "in",
  READY: "ready",
  SETTINGS: "settings",
  START: "start",
  LOADOUT: "loadout",
  KICK: "kick",
  /** Team modes: move to a team (lobby and results only). */
  TEAM: "team",
  /** Team modes, host only: rebalance teams by level. */
  BALANCE: "balance",
  /** Prop Hunt abilities (transform, lock, taunt, decoy). */
  ABILITY: "ab",
  /** Results: vote for the next map. */
  VOTE: "vote",
  /** Leave the running match but stay in the room (back in at the next match). */
  LEAVE_MATCH: "leaveMatch",
} as const;

/** Server → client message types. */
export const S2C = {
  EVENTS: "ev",
  NOTICE: "notice",
  RESULTS: "results",
} as const;

export type RoomKind = "quick" | "private";

const weaponIdSchema = z.enum(PRIMARY_WEAPONS as [WeaponId, ...WeaponId[]]);
const mapIdSchema = z.enum(MAP_IDS as [MapId, ...MapId[]]);
const modeSchema = z.enum(GAME_MODES as [GameMode, ...GameMode[]]);
export const teamIdSchema = z.union([z.literal(1), z.literal(2)]);

export const nicknameSchema = z
  .string()
  .trim()
  .min(NICKNAME.min)
  .max(NICKNAME.max)
  .regex(/^[\p{L}\p{N} _.-]+$/u, "Use letters, numbers, spaces, _ . -");

export const joinOptionsSchema = z.object({
  token: z.string().min(10).max(1024),
  kind: z.enum(["quick", "private"]).default("quick"),
  primary: weaponIdSchema.default("rifle"),
  skin: z.string().max(32).default("foundry"),
  map: mapIdSchema.optional(),
  /** Mode of the room to create or find (quick match). Default deathmatch. */
  mode: modeSchema.optional(),
  /** Preferred team (invite link to a friend's team); honored when that team has room. */
  team: teamIdSchema.optional(),
});
export type JoinOptions = z.input<typeof joinOptionsSchema>;

export const readySchema = z.object({ ready: z.boolean() });

export const settingsSchema = z.object({
  map: mapIdSchema.optional(),
  durationSec: z
    .number()
    .int()
    .min(MATCH_LIMITS.durationSec.min)
    .max(MATCH_LIMITS.durationSec.max)
    .optional(),
  killLimit: z.number().int().min(MATCH_LIMITS.killLimit.min).max(MATCH_LIMITS.killLimit.max).optional(),
  maxPlayers: z.number().int().min(MATCH_LIMITS.maxPlayers.min).max(MATCH_LIMITS.maxPlayers.max).optional(),
  mode: modeSchema.optional(),
  /** Team modes: players per team (1v1 … 4v4). */
  teamSize: z.number().int().min(TEAM_SIZE.min).max(TEAM_SIZE.max).optional(),
  friendlyFire: z.boolean().optional(),
  /** PvE: mission id (Outbreak) and difficulty. Validated against the mission list by the room. */
  mission: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/)
    .optional(),
  difficulty: z.enum(DIFFICULTIES as [Difficulty, ...Difficulty[]]).optional(),
  /** Round modes: variant id (validated against MODE_VARIANTS by the room) and round count. */
  variant: z
    .string()
    .regex(/^[a-z]{1,16}$/)
    .optional(),
  rounds: z.number().int().min(ROUND_LIMITS.min).max(ROUND_LIMITS.max).optional(),
});
export type MatchSettings = z.infer<typeof settingsSchema>;

/**
 * Prop Hunt ability. "transform": turn into kind `k` (an object kind present on the map), or with
 * no `k` copy the object in front of you. "lock" toggles the position lock.
 */
export const abilitySchema = z.object({
  a: z.enum(["transform", "lock", "taunt", "decoy"]),
  k: z
    .number()
    .int()
    .min(0)
    .max(DISGUISES.length - 1)
    .optional(),
});
export type AbilityMessage = z.infer<typeof abilitySchema>;

export const voteSchema = z.object({ map: mapIdSchema });

export const teamSchema = z.object({ team: teamIdSchema });

export const loadoutSchema = z.object({
  primary: weaponIdSchema,
  skin: z.string().max(32),
});

export const kickSchema = z.object({ id: z.string().min(1).max(64) });

export const emptySchema = z.object({}).passthrough();

/** Gameplay events broadcast once per tick (compact keys keep them small). */
export type NetEvent =
  /** Shot fired: pellet angles (rad * 1000) and travelled distances (px) for remote tracers. */
  | { t: "shot"; p: string; w: number; x: number; y: number; a: number[]; d: number[]; s: number }
  /** Damage dealt. `k` = lethal. */
  | { t: "hit"; p: string; v: string; dmg: number; x: number; y: number; k: boolean }
  /** `k` is "" when nobody gets the credit (a crash, a driverless vehicle). */
  | { t: "kill"; k: string; v: string; w: number; fb: boolean; st: number }
  | { t: "spawn"; p: string; x: number; y: number }
  | { t: "pickup"; p: string; id: string; kind: string; w?: number }
  | { t: "reload"; p: string; w: number }
  | { t: "dash"; p: string }
  /** Vehicles: entered / left / changed seat (`s` = seat index, -1 when leaving). */
  | { t: "seat"; p: string; v: string; s: number }
  /** Shot damage to a vehicle hull. */
  | { t: "vhit"; p: string; v: string; dmg: number; x: number; y: number }
  /** Vehicle destroyed (explosion at x, y). `p` = credited attacker or "". */
  | { t: "wreck"; v: string; p: string; x: number; y: number }
  /** Hard contact: run-over, vehicle collision or crash (`v` = vehicle, `o` = other party or ""). */
  | { t: "crash"; v: string; o: string; x: number; y: number; f: number }
  | { t: "vspawn"; v: string }
  /**
   * Objective events. Domination: "capture" (point `o` now owned by `team`), "neutral". CTF:
   * "take" / "drop" / "return" / "score" for flag `o` (of team `team`) by player `p`.
   */
  | {
      t: "obj";
      k: "capture" | "neutral" | "take" | "drop" | "return" | "score";
      o: string;
      team: number;
      p: string;
    }
  // ----- PvE (Outbreak / Survival). Enemy ids are "z<n>"; a player hit by an enemy gets a "hit"
  // event whose `p` is the enemy id.
  /** Damage to an enemy. `c` precision hit, `a` armored (brute front, boss plates), `k` lethal. */
  | { t: "zhit"; p: string; z: string; dmg: number; x: number; y: number; k: boolean; c?: 1; a?: 1 }
  /** Enemy eliminated (`p` = credited player or ""), `k` = ZOMBIES index. */
  | { t: "zdie"; z: string; p: string; x: number; y: number; k: number }
  /** An enemy attack lands (sound and impact): melee, spit, pounce, charge, explode. */
  | { t: "zatk"; z: string; k: string; x: number; y: number }
  /** Acid projectile launched (`id`), flying in a straight line until "projx". */
  | {
      t: "proj";
      id: number;
      x: number;
      y: number;
      vx: number;
      vy: number;
      tx?: number;
      ty?: number;
      r?: number;
    }
  | { t: "projx"; id: number; x: number; y: number }
  /** Blast (exploder): centre and radius. */
  | { t: "boom"; x: number; y: number; r: number }
  /** A player is downed (`by` = enemy kind name or ""), revived (`by` = reviver, "" = self), bled out. */
  | { t: "down"; p: string; by: string }
  | { t: "revive"; p: string; by: string }
  | { t: "bleed"; p: string }
  /**
   * Mission flow: "step" (n = step index), "wave" (n = wave, s = label), "clear" (wave cleared),
   * "hint" (s = text), "door" (s = door id opened), "supply" (crate dropped), "checkpoint",
   * "complete", "failed" (s = reason).
   */
  | { t: "pve"; k: string; n?: number; s?: string }
  // ----- Gun Game and round modes
  /** Gun Game: player `p` is now on ladder level `l` (`d` = demoted). */
  | { t: "gg"; p: string; l: number; d?: 1 }
  /** Round flow: stage `s` of round `n` began (`w` = side that won the round that just ended). */
  | { t: "round"; s: string; n: number; w?: number }
  /** A hider was spotted by the seeking side (sent to the seekers and the hider only). */
  | { t: "spot"; p: string }
  /** A hider / prop was found (eliminated or converted) by `by`. */
  | { t: "found"; p: string; by: string; c?: 1 }
  /** Prop Hunt: a shot hit object `d` at x, y (identical for real objects and disguised players). */
  | { t: "dhit"; d: string; x: number; y: number }
  /** Prop Hunt: hunter `p` hit an innocent object and lost `dmg` health. */
  | { t: "penalty"; p: string; dmg: number }
  /** Prop Hunt: a taunt sound at x, y. */
  | { t: "taunt"; x: number; y: number; v: number }
  /** Prop Hunt: hint pings were published. */
  | { t: "hint"; n: number }
  /** A short private message to player `p` (an ability refused, why). */
  | { t: "msg"; p: string; s: string }
  /** A banner for everybody (a Chaos rule, a planted device, a new bounty target). */
  | { t: "announce"; s: string; d?: string; w?: 0 | 1 | 2 };

export interface NoticeMessage {
  text: string;
  tone: "info" | "warn" | "good";
}

export interface ResultRow {
  id: string;
  name: string;
  /** 0 in free-for-all. */
  team?: number;
  kills: number;
  deaths: number;
  placement: number;
  accuracy: number | null;
  /** Round modes: points; Gun Game: ladder level reached (1-based). */
  points?: number;
}

export interface PersonalResult {
  placement: number;
  xpGained: number;
  xpLines: { reason: string; xp: number }[];
  /** Totals after the match, if the profile was persisted. */
  totalXp: number | null;
  level: number | null;
  leveledUp: boolean;
  unlocked: string[];
  persisted: boolean;
  /** Solo practice against training targets: nothing is recorded. */
  practice?: boolean;
  /** PvE: cosmetic titles earned and missions unlocked by this run (filled in by the recorder). */
  pveTitles?: string[];
  pveUnlocked?: string[];
  pvePersonalBest?: boolean;
  /**
   * Host mode (no shared database): the match figures the receiving player's browser records in
   * its local profile. Absent from dedicated-server results.
   */
  record?: {
    kills: number;
    deaths: number;
    won: boolean;
    completed: boolean;
    shotsFired: number;
    shotsHit: number;
    playtimeSec: number;
    /** Mode and objective counters (career stats, daily challenges). */
    mode?: string;
    captures?: number;
    flagCaptures?: number;
    flagReturns?: number;
    vehicleKills?: number;
    /** Mode-specific career counters (MODE_STAT_KEYS). */
    extra?: Record<string, number>;
    /** PvE run, recorded once per `runId` by the receiving player's browser. */
    pve?: PveRecord;
  };
}

/** What one player's profile records from a PvE run. */
export interface PveRecord {
  runId: string;
  mode: "outbreak" | "survival";
  mission: string;
  difficulty: string;
  completed: boolean;
  kills: number;
  revives: number;
  downs: number;
  /** Survival: waves cleared. Outbreak: steps completed. */
  progress: number;
  timeSec: number;
}

export interface PveSquadRow {
  id: string;
  name: string;
  kills: number;
  damage: number;
  revives: number;
  downs: number;
  accuracy: number | null;
}

/** End-of-run summary for the whole squad. */
export interface PveResult {
  mode: "outbreak" | "survival";
  mission: string;
  difficulty: string;
  completed: boolean;
  /** Failed: why ("squad wiped", "host left"…). */
  reason?: string;
  timeSec: number;
  /** Survival: waves cleared; Outbreak: steps completed of `steps`. */
  progress: number;
  steps: number;
  kills: number;
  squad: PveSquadRow[];
}

export interface ResultsMessage {
  winnerId: string;
  /** Team modes: winning team (0 = draw) and final scores [Alpha, Bravo]. */
  winnerTeam?: number;
  teamScores?: [number, number];
  rows: ResultRow[];
  /** PvE modes: the squad's run. */
  pve?: PveResult;
  personal: PersonalResult | null;
}

export interface RoomMetadata {
  code: string;
  kind: RoomKind;
  mode?: GameMode;
  map: MapId;
  phase: MatchPhase;
  players: number;
  maxPlayers: number;
  hostName: string;
}

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}
