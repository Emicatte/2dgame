import { experienceForRoom } from "@scrapline/shared";

const KEY = "scrapline.recent.v1";
const MAX = 6;

/** Experiences this browser actually played (a match started), most recent first. */
export function recentExperiences(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX);
}

/** Called when a match starts: the card it belongs to moves to the front of "Recently played". */
export function recordPlayed(mode: string, mission?: string): void {
  const exp = experienceForRoom(mode, mission);
  if (!exp) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(pushRecent(recentExperiences(), exp.id)));
  } catch {
    // storage unavailable (private window): recent list just stays empty
  }
}
