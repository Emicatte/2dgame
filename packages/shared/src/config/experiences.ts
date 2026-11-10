/**
 * Experience catalog: everything a player can pick on the home screen, by platform category.
 *
 * An experience is what the player chooses (a card); a mode (MODES) is how a room runs it. Most
 * experiences are one mode; co-op operations are an Outbreak mission with a card of their own.
 * The catalog is derived from the mode registry, so a new mode becomes a card by adding it to
 * MODES and to EXPERIENCE_CATEGORY_OF below; an experience that is not built yet goes in
 * PLANNED_EXPERIENCES (shown as planned, never startable).
 *
 * The map is not part of an experience choice: the lobby picks it (MatchState is the only
 * authority for mode, map and rules). `maps` here is what the lobby will offer.
 */
import { MAPS, type MapId, mapsForMode } from "../maps/index.ts";
import { MISSIONS, missionById, SURVIVAL_MAPS } from "../pve/missions.ts";
import { COOP_OPERATIONS, GAME_MODES, type GameMode, MODES, type ModeStatus } from "./modes.ts";

export type ExperienceCategory =
  | "action"
  | "survival"
  | "horror"
  | "party"
  | "adventure"
  | "challenge"
  | "racing"
  | "social";

export const EXPERIENCE_CATEGORIES: readonly { id: ExperienceCategory; name: string; blurb: string }[] = [
  { id: "action", name: "Action", blurb: "Shooters, objectives and team fights." },
  { id: "survival", name: "Survival", blurb: "Hold out against the infected." },
  { id: "horror", name: "Horror", blurb: "Dark places and things that hunt you." },
  { id: "party", name: "Party", blurb: "Hide, transform, cause chaos with friends." },
  { id: "adventure", name: "Adventure", blurb: "Co-op operations with a goal." },
  { id: "challenge", name: "Challenge", blurb: "Mazes, obstacle courses and time trials." },
  { id: "racing", name: "Racing", blurb: "Checkpoints, pursuits and convoys." },
  { id: "social", name: "Social", blurb: "Hang out and explore, no pressure." },
];

/** Gameplay systems an experience relies on (what the engine must provide for it to run). */
export type ExperienceSystem =
  | "weapons"
  | "vehicles"
  | "teams"
  | "roles"
  | "rounds"
  | "objectives"
  | "ai"
  | "missions"
  | "secrecy";

export interface ExperienceDef {
  id: string;
  name: string;
  category: ExperienceCategory;
  blurb: string;
  /** Map rendered as the card image (the real map, drawn from game data); null: none yet. */
  thumbnail: MapId | null;
  /** Humans needed to start and room capacity (planned: the design target, not a promise). */
  players: { min: number; max: number };
  /** Weapons and eliminations are part of it ("combat") or not needed at all ("noncombat"). */
  gameplay: "combat" | "noncombat";
  /** Maps the lobby offers for it (empty for planned experiences). */
  maps: readonly MapId[];
  rules: readonly string[];
  durationLabel: string;
  /** What the lobby opens with: the room mode and, for co-op operations, the mission. */
  launch: { mode: GameMode; mission?: string } | null;
  /** A matchmaking queue exists for it (dedicated server only; host mode always opens a lobby). */
  quick: boolean;
  /** What a finished match earns (XP and career stats are kept per mode). */
  progression: string;
  systems: readonly ExperienceSystem[];
  status: ModeStatus;
  /** Planned / in development: what has to exist before it can be played. */
  needs?: string;
}

/** Platform category of every room mode. */
export const EXPERIENCE_CATEGORY_OF: Record<GameMode, ExperienceCategory> = {
  deathmatch: "action",
  tdm: "action",
  gungame: "action",
  dom: "action",
  ctf: "action",
  sabotage: "action",
  bounty: "action",
  mayhem: "action",
  outbreak: "survival",
  survival: "survival",
  infection: "survival",
  hideseek: "party",
  prophunt: "party",
  chaos: "party",
  pursuit: "racing",
  convoy: "racing",
  maze: "challenge",
};

/** Built in later phases of the platform roadmap (PROGRESS.md). Never startable. */
export const PLANNED_EXPERIENCES: readonly Omit<
  ExperienceDef,
  "thumbnail" | "maps" | "launch" | "quick" | "durationLabel" | "progression"
>[] = [
  {
    id: "battleroyale",
    name: "Battle Royale",
    category: "action",
    blurb: "Drop from the flying bus, loot, outlast the storm. Solo, duos and squads.",
    players: { min: 2, max: 50 },
    gameplay: "combat",
    rules: ["Jump when you want, open the parachute", "Loot chests", "Stay inside the safe zone"],
    systems: ["weapons", "vehicles", "teams", "ai"],
    status: "planned",
    needs: "A large streamed map, the drop, the storm, an inventory and load tests at 8/16/32/50 players",
  },
  {
    id: "haunted",
    name: "Haunted Facility",
    category: "horror",
    blurb: "Restore the power, find the keys, reach the exit. Something walks the halls.",
    players: { min: 1, max: 4 },
    gameplay: "noncombat",
    rules: ["No weapons", "Objectives in the dark", "Avoid the creature"],
    systems: ["ai", "objectives"],
    status: "planned",
    needs: "2D lighting, positional audio, the monster AI and the tension director",
  },
  {
    id: "nighthunt",
    name: "Night Hunt",
    category: "horror",
    blurb: "One player is the monster. Everyone else hides, runs and completes objectives.",
    players: { min: 2, max: 8 },
    gameplay: "noncombat",
    rules: ["One monster with its own abilities", "Survivors cooperate", "Objectives to escape"],
    systems: ["roles", "objectives", "secrecy"],
    status: "planned",
    needs: "The horror lighting and audio, monster abilities",
  },
  {
    id: "horrormaze",
    name: "Horror Maze",
    category: "horror",
    blurb: "A dark maze, a flashlight and a creature that hears you.",
    players: { min: 1, max: 4 },
    gameplay: "noncombat",
    rules: ["Flashlight only", "Collect items", "Reach the exit"],
    systems: ["ai", "objectives"],
    status: "planned",
    needs: "The monster AI and the 2D lighting",
  },
  {
    id: "parkour",
    name: "Parkour Challenge",
    category: "challenge",
    blurb: "Obstacle courses with dashes, moving hazards and checkpoints against the clock.",
    players: { min: 1, max: 8 },
    gameplay: "noncombat",
    rules: ["Checkpoints", "Moving obstacles", "Timer and records"],
    systems: ["objectives"],
    status: "planned",
    needs: "Courses, moving hazards and the time-trial board",
  },
  {
    id: "escaperoom",
    name: "Escape Room",
    category: "adventure",
    blurb: "Codes, mechanisms and shared puzzles. Get everyone out together.",
    players: { min: 2, max: 4 },
    gameplay: "noncombat",
    rules: ["Puzzles need teamwork", "No weapons", "One exit"],
    systems: ["objectives"],
    status: "planned",
    needs: "The shared interaction system and puzzle content",
  },
  {
    id: "racing",
    name: "Vehicle Racing",
    category: "racing",
    blurb: "Laps, checkpoints and bumpers on dedicated circuits.",
    players: { min: 2, max: 8 },
    gameplay: "noncombat",
    rules: ["Countdown start", "Laps and checkpoints", "Lap records"],
    systems: ["vehicles", "objectives"],
    status: "planned",
    needs: "Circuits and lap timing",
  },
  {
    id: "hotpotato",
    name: "Hot Potato",
    category: "party",
    blurb: "Pass the ticking charge before it goes off.",
    players: { min: 3, max: 8 },
    gameplay: "noncombat",
    rules: ["Tag to pass it on", "Last one standing wins"],
    systems: ["rounds"],
    status: "planned",
    needs: "A tag interaction",
  },
  {
    id: "freeroam",
    name: "Free Roam",
    category: "social",
    blurb: "A big map with no objectives: drive, explore and meet friends.",
    players: { min: 1, max: 8 },
    gameplay: "noncombat",
    rules: ["No PvP", "Vehicles everywhere", "Minigames to find"],
    systems: ["vehicles"],
    status: "planned",
    needs: "A hub map and PvP-off rules",
  },
];

function systemsOf(mode: GameMode): ExperienceSystem[] {
  const def = MODES[mode];
  const out: ExperienceSystem[] = def.weapons === "None" ? [] : ["weapons"];
  if (def.vehicles) out.push("vehicles");
  if (def.structure === "teams") out.push("teams");
  if (def.structure === "roles") out.push("roles", "rounds", "secrecy");
  if (def.hud === "objectives") out.push("objectives");
  if (def.structure === "coop") out.push("ai");
  if (mode === "outbreak") out.push("missions");
  return out;
}

const CAMPAIGN_MAPS: readonly MapId[] = [
  ...new Set(
    MISSIONS.filter((m) => !COOP_OPERATIONS.some((op) => op.mission === m.id)).map((m) => m.map as MapId),
  ),
];

function mapsOf(mode: GameMode): readonly MapId[] {
  if (mode === "outbreak") return CAMPAIGN_MAPS;
  if (mode === "survival") return SURVIVAL_MAPS;
  return mapsForMode(mode);
}

/** Card image per mode, so the catalog does not show the same map twelve times (must be a map of the mode). */
const CARD_MAP: Partial<Record<GameMode, MapId>> = {
  deathmatch: "industrial",
  tdm: "harbor",
  dom: "urban",
  ctf: "desert",
  mayhem: "airbase",
  gungame: "neon",
  hideseek: "motel",
  prophunt: "depot",
  infection: "market",
  chaos: "facility",
  bounty: "mountain",
  sabotage: "industrial",
  pursuit: "downtown",
  convoy: "urban",
  maze: "maze-m-4721",
};

function fromMode(mode: GameMode): ExperienceDef {
  const def = MODES[mode];
  const maps = mapsOf(mode);
  const preferred = CARD_MAP[mode];
  const thumb =
    (preferred && maps.includes(preferred) ? preferred : undefined) ??
    maps.find((m) => MAPS[m].party && def.category === "party") ??
    maps[0] ??
    null;
  return {
    id: mode,
    name: def.name,
    category: EXPERIENCE_CATEGORY_OF[mode],
    blurb: def.blurb,
    thumbnail: thumb,
    players: def.players,
    gameplay: def.weapons === "None" ? "noncombat" : "combat",
    maps,
    rules: def.rules,
    durationLabel: def.durationLabel,
    launch: { mode },
    quick: def.quick,
    progression: def.rewards,
    systems: systemsOf(mode),
    status: def.status,
  };
}

function fromOperation(op: (typeof COOP_OPERATIONS)[number]): ExperienceDef {
  const mission = missionById(op.mission);
  const map = (mission?.map ?? "works") as MapId;
  return {
    id: op.id,
    name: op.name,
    category: "adventure",
    blurb: op.blurb,
    thumbnail: map,
    players: op.players,
    gameplay: "combat",
    maps: [map],
    rules: mission?.brief ? [mission.brief] : [],
    durationLabel: MODES.outbreak.durationLabel,
    launch: { mode: "outbreak", mission: op.mission },
    quick: false,
    progression: MODES.outbreak.rewards,
    systems: ["weapons", "ai", "missions", "objectives"],
    status: "available",
  };
}

export const EXPERIENCES: readonly ExperienceDef[] = [
  ...GAME_MODES.map(fromMode),
  ...COOP_OPERATIONS.map(fromOperation),
  ...PLANNED_EXPERIENCES.map(
    (p): ExperienceDef => ({
      ...p,
      thumbnail: null,
      maps: [],
      launch: null,
      quick: false,
      durationLabel: "",
      progression: "",
    }),
  ),
];

export function experienceById(id: string): ExperienceDef | undefined {
  return EXPERIENCES.find((e) => e.id === id);
}

/** The card a running room belongs to (an Outbreak room on an operation's mission is that operation). */
export function experienceForRoom(mode: string, mission?: string): ExperienceDef | undefined {
  if (mode === "outbreak" && mission) {
    const op = EXPERIENCES.find((e) => e.launch?.mode === "outbreak" && e.launch.mission === mission);
    if (op) return op;
  }
  return experienceById(mode);
}

/**
 * Experiences a player can start in this build: available, with their mode switched on by the
 * feature flags (see modeFlags).
 */
export function playableExperience(e: ExperienceDef, flags: ReadonlySet<GameMode>): boolean {
  return e.status === "available" && !!e.launch && flags.has(e.launch.mode);
}

/** Shown first on the home screen (curated; only the playable ones are shown). */
export const FEATURED_EXPERIENCES: readonly string[] = [
  "deathmatch",
  "outbreak",
  "prophunt",
  "infection",
  "tdm",
  "chaos",
  "maze",
  "hideseek",
  "pursuit",
];
