import { z } from "zod";
import { MATCH_LIMITS, NICKNAME } from "../config/game.ts";
import { GAME_MODES, type GameMode, TEAM_SIZE } from "../config/modes.ts";
import { PRIMARY_WEAPONS, type WeaponId } from "../config/weapons.ts";
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
});
export type MatchSettings = z.infer<typeof settingsSchema>;

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
    };

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
  };
}

export interface ResultsMessage {
  winnerId: string;
  /** Team modes: winning team (0 = draw) and final scores [Alpha, Bravo]. */
  winnerTeam?: number;
  teamScores?: [number, number];
  rows: ResultRow[];
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
