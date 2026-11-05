import { z } from "zod";
import { MATCH_LIMITS, NICKNAME } from "../config/game.ts";
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
});
export type MatchSettings = z.infer<typeof settingsSchema>;

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
  | { t: "kill"; k: string; v: string; w: number; fb: boolean; st: number }
  | { t: "spawn"; p: string; x: number; y: number }
  | { t: "pickup"; p: string; id: string; kind: string; w?: number }
  | { t: "reload"; p: string; w: number }
  | { t: "dash"; p: string };

export interface NoticeMessage {
  text: string;
  tone: "info" | "warn" | "good";
}

export interface ResultRow {
  id: string;
  name: string;
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
  };
}

export interface ResultsMessage {
  winnerId: string;
  rows: ResultRow[];
  personal: PersonalResult | null;
}

export interface RoomMetadata {
  code: string;
  kind: RoomKind;
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
