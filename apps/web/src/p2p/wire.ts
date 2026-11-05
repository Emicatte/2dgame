import { MAX_LEVEL, nicknameSchema, PRIMARY_WEAPONS, type WeaponId } from "@scrapline/shared";
import { z } from "zod";

/** Binary frames: byte 0, followed by @colyseus/schema bytes. */
export const FRAME_FULL = 1;
export const FRAME_PATCH = 2;

/**
 * Text frames are JSON arrays.
 * Guest → host: ["hello", Hello] | ["m", type, payload] | ["pi", n] | ["bye"]
 * Host → guest: ["welcome", Welcome] | ["reject", code, reason] | ["m", type, payload] | ["po", n]
 *               | ["bye", code, reason]
 */
export type GuestFrame = ["hello", Hello] | ["m", string, unknown] | ["pi", number] | ["bye"];
export type HostFrame =
  | ["welcome", Welcome]
  | ["reject", number, string]
  | ["m", string, unknown]
  | ["po", number]
  | ["bye", number, string];

/**
 * Host and guests run the same simulation code: a guest on another build (the page was open
 * before a deploy) would mispredict everything, so the build id must match.
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

export const helloSchema = z.object({
  build: z.string().max(64),
  name: nicknameSchema,
  level: z.number().int().min(1).max(MAX_LEVEL),
  skin: z.string().max(32),
  primary: z.enum(PRIMARY_WEAPONS as [WeaponId, ...WeaponId[]]),
  /** Local profile id: the same profile cannot hold two seats. */
  profileId: z.string().min(8).max(64),
  /** Seat token from a previous connection to this room (reconnect after a network drop). */
  resume: z.string().min(16).max(64).optional(),
  /** Team modes: preferred team (invite link); honored when it has room. */
  team: z.union([z.literal(1), z.literal(2)]).optional(),
});
export type Hello = z.infer<typeof helloSchema>;

export interface Welcome {
  sessionId: string;
  /** Seat token: presenting it again within the reconnection window takes the same seat back. */
  token: string;
  code: string;
}

/** Close codes (4000-4099 mirror Colyseus; 41xx the dedicated server; 42xx host mode). */
export const CLOSE = {
  CONSENTED: 4000,
  PROTOCOL: 4002,
  RECONNECT_FAILED: 4003,
  KICKED: 4101,
  INACTIVE: 4102,
  HOST_CLOSED: 4201,
  ROOM_FULL: 4202,
  VERSION: 4203,
  DUPLICATE: 4204,
  SEAT_EXPIRED: 4205,
  NOT_FOUND: 4206,
  UNREACHABLE: 4207,
} as const;

export function closeReason(code: number): string {
  switch (code) {
    case CLOSE.HOST_CLOSED:
      return "The host closed the arena.";
    case CLOSE.ROOM_FULL:
      return "That arena is full.";
    case CLOSE.VERSION:
      return "Your game version differs from the host's. Both reload the page, then try again.";
    case CLOSE.DUPLICATE:
      return "You are already in this arena in another tab.";
    case CLOSE.SEAT_EXPIRED:
      return "Your seat in the arena expired. Join again with the code.";
    case CLOSE.NOT_FOUND:
      return "Arena not found. Check the code, or ask the host to create a new one.";
    case CLOSE.UNREACHABLE:
      return "Could not connect to the host's computer. The network may block direct connections between computers (see the host-mode notes).";
    case CLOSE.KICKED:
      return "You were removed from the room by the host.";
    case CLOSE.INACTIVE:
      return "Disconnected for inactivity.";
    case CLOSE.PROTOCOL:
      return "Disconnected: the host rejected a message from this client.";
    case CLOSE.RECONNECT_FAILED:
      return "Connection to the host lost and could not be restored.";
    default:
      return `Disconnected from the host (code ${code}).`;
  }
}

export function encodeFrame(frame: GuestFrame | HostFrame): string {
  return JSON.stringify(frame);
}

export function parseFrame(data: string): unknown[] | null {
  if (data.length > 16_384) return null;
  try {
    const v = JSON.parse(data) as unknown;
    return Array.isArray(v) && typeof v[0] === "string" ? v : null;
  } catch {
    return null;
  }
}

export function randomId(bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
