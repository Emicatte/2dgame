import { randomInt } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_NAME, type RoomMetadata } from "@scrapline/shared";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/**
 * Finds a room by invite code through the matchmaker's room cache. Using the matchmaker (rather
 * than a local map) keeps this correct when several processes share a Redis driver later on.
 */
export async function findRoomIdByCode(code: string): Promise<string | null> {
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const hit = rooms.find((r) => (r.metadata as RoomMetadata | undefined)?.code === code);
  return hit?.roomId ?? null;
}

export async function uniqueRoomCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    if (!(await findRoomIdByCode(code))) return code;
  }
  throw new Error("could not allocate a unique room code");
}
