/**
 * Game modes and teams. Rules are data: rooms (dedicated server and host mode) read them from
 * here, and every value a host can change is validated against MODE_LIMITS.
 *
 * MODES is the single registry of every mode: identity, player limits, structure, respawn,
 * victory, scoring, weapons, vehicles, HUD, rewards, events, join-in-progress and disconnect
 * behavior, release status and feature flag. The menus, the lobby and both room implementations
 * read it; mode-specific behavior lives in one controller per mode on the server
 * (apps/server/src/modes), never in conditions spread through the room code.
 */
import { MATCH_DEFAULTS } from "./game.ts";

export type GameMode =
  | "deathmatch"
  | "tdm"
  | "dom"
  | "ctf"
  | "mayhem"
  | "gungame"
  | "hideseek"
  | "prophunt"
  | "infection"
  | "chaos"
  | "bounty"
  | "sabotage"
  | "pursuit"
  | "convoy"
  | "outbreak"
  | "survival"
  | "maze";

export const GAME_MODES: readonly GameMode[] = [
  "deathmatch",
  "tdm",
  "dom",
  "ctf",
  "mayhem",
  "gungame",
  "hideseek",
  "prophunt",
  "infection",
  "chaos",
  "bounty",
  "sabotage",
  "pursuit",
  "convoy",
  "outbreak",
  "survival",
  "maze",
];

export type ModeCategory = "competitive" | "party" | "coop" | "vehicles" | "challenge";
/** "available": playable. "development": being built, visible but cannot start. "planned": roadmap only. */
export type ModeStatus = "available" | "development" | "planned";
/**
 * "ffa": everyone for themselves. "teams": Alpha vs Bravo chosen in the lobby. "roles": sides are
 * assigned by the server when the match starts and rotate between rounds (seekers / hiders).
 * "coop": all humans on one side against the AI.
 */
export type ModeStructure = "ffa" | "teams" | "roles" | "coop";
export type RespawnRule = "timed" | "fast" | "round" | "checkpoint";
export type ModeHud = "standard" | "teams" | "objectives" | "gungame" | "roles" | "pve";

export interface ModeDef {
  id: GameMode;
  name: string;
  /** One line, shown in the lobby and on the mode card. */
  blurb: string;
  category: ModeCategory;
  structure: ModeStructure;
  /** Humans needed to start (practice bots never count) and the room capacity. */
  players: { min: number; max: number };
  /** Indicative length shown on the mode card (rounds × round length for round modes). */
  durationLabel: string;
  /** Main rules, readable in under 30 seconds. */
  rules: readonly string[];
  respawn: RespawnRule;
  victory: string;
  scoring: string;
  weapons: string;
  /** Vehicles parked on the map are used in this mode. */
  vehicles: boolean;
  abilities: readonly string[];
  hud: ModeHud;
  rewards: string;
  events: readonly string[];
  /** What happens to someone joining a match already running. */
  joinInProgress: "spawn" | "next-round" | "checkpoint";
  disconnect: string;
  /** Offered by quick matchmaking (otherwise private rooms / arenas only). */
  quick: boolean;
  status: ModeStatus;
  /** Feature flag name (see modeEnabled). */
  flag: string;
}

const rotateRoles = "Sides are assigned when the match starts and rotate every round";

export const MODES: Record<GameMode, ModeDef> = {
  deathmatch: {
    id: "deathmatch",
    name: "Deathmatch",
    blurb: "Everyone for themselves. Most eliminations wins.",
    category: "competitive",
    structure: "ffa",
    players: { min: 1, max: 8 },
    durationLabel: "7 min",
    rules: ["Most eliminations wins", "Respawn after 3 s", "Weapons and medkits on the map"],
    respawn: "timed",
    victory: "First to the elimination limit, or most eliminations when time runs out",
    scoring: "1 point per elimination",
    weapons: "Loadout primary + sidearm, weapon pickups",
    vehicles: true,
    abilities: ["Dash"],
    hud: "standard",
    rewards: "Completion, eliminations, placement",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s; a quick match with one player left ends",
    quick: true,
    status: "available",
    flag: "deathmatch",
  },
  tdm: {
    id: "tdm",
    name: "Team Deathmatch",
    blurb: "Two teams. Every enemy eliminated scores a point.",
    category: "competitive",
    structure: "teams",
    players: { min: 1, max: 8 },
    durationLabel: "5 min",
    rules: ["Alpha vs Bravo", "Each enemy eliminated scores 1 for your team", "No friendly fire by default"],
    respawn: "timed",
    victory: "First team to the score limit, or the team ahead at the end",
    scoring: "1 team point per enemy eliminated",
    weapons: "Loadout primary + sidearm, weapon pickups",
    vehicles: true,
    abilities: ["Dash"],
    hud: "teams",
    rewards: "Completion, eliminations, team victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s; a quick match with an empty team ends",
    quick: true,
    status: "available",
    flag: "tdm",
  },
  dom: {
    id: "dom",
    name: "Domination",
    blurb: "Hold capture points A, B and C. Each held point scores every few seconds.",
    category: "competitive",
    structure: "teams",
    players: { min: 1, max: 8 },
    durationLabel: "8 min",
    rules: [
      "Stand on a point to capture it",
      "Every held point scores every 5 s",
      "Eliminations do not score",
    ],
    respawn: "timed",
    victory: "First team to 100 points",
    scoring: "1 point per held point every 5 s",
    weapons: "Loadout primary + sidearm, weapon pickups",
    vehicles: true,
    abilities: ["Dash"],
    hud: "objectives",
    rewards: "Completion, captures, team victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "dom",
  },
  ctf: {
    id: "ctf",
    name: "Capture the Flag",
    blurb: "Take the enemy flag to your base while your own flag is home.",
    category: "competitive",
    structure: "teams",
    players: { min: 1, max: 8 },
    durationLabel: "10 min",
    rules: [
      "Take the enemy flag",
      "Score at your base while your flag is home",
      "Touch your dropped flag to return it",
    ],
    respawn: "timed",
    victory: "First team to 3 captures",
    scoring: "1 point per capture",
    weapons: "Loadout primary + sidearm, weapon pickups",
    vehicles: true,
    abilities: ["Dash"],
    hud: "objectives",
    rewards: "Completion, captures, returns, team victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s; a carried flag drops",
    quick: false,
    status: "available",
    flag: "ctf",
  },
  mayhem: {
    id: "mayhem",
    name: "Vehicle Mayhem",
    blurb: "Team fight on vehicle maps. Eliminations score 1, wrecking a crewed enemy vehicle scores 2.",
    category: "vehicles",
    structure: "teams",
    players: { min: 1, max: 8 },
    durationLabel: "6 min",
    rules: ["Vehicle maps only", "Eliminations score 1", "Wrecking a crewed enemy vehicle scores 2"],
    respawn: "timed",
    victory: "First team to 30 points",
    scoring: "1 per elimination, 2 per crewed vehicle wrecked",
    weapons: "Loadout, vehicle guns",
    vehicles: true,
    abilities: ["Dash", "Vehicle seats"],
    hud: "teams",
    rewards: "Completion, eliminations, vehicles wrecked, team victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s; a disconnected driver leaves the vehicle",
    quick: false,
    status: "available",
    flag: "mayhem",
  },
  gungame: {
    id: "gungame",
    name: "Gun Game",
    blurb: "Every elimination moves you to the next weapon. First through the ladder wins.",
    category: "competitive",
    structure: "ffa",
    players: { min: 1, max: 8 },
    durationLabel: "≤ 8 min",
    rules: [
      "Everyone starts with the same weapon",
      "Each elimination gives you the next weapon on the ladder",
      "Get an elimination with the final weapon to win",
      "Killed by someone behind you on the ladder: back one level",
    ],
    respawn: "fast",
    victory: "First elimination with the final weapon; at time out the highest level (overtime on a tie)",
    scoring: "Ladder level, then eliminations",
    weapons: "The ladder weapon only (no pickups)",
    vehicles: false,
    abilities: ["Dash"],
    hud: "gungame",
    rewards: "Completion, eliminations, levels climbed, victory",
    events: ["Overtime: on a tie at time out, the next level-up wins"],
    joinInProgress: "spawn",
    disconnect: "Seat and level held 20 s",
    quick: true,
    status: "available",
    flag: "gungame",
  },
  hideseek: {
    id: "hideseek",
    name: "Hide & Seek",
    blurb: "One seeker, everyone else hides. Survive the timer without being found.",
    category: "party",
    structure: "roles",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 30 s + 3 min",
    rules: [
      "Hiders get 30 s to hide while the seeker waits blindfolded",
      "The seeker only sees hiders in plain sight: shadows and hiding spots help",
      "Found hiders are out (Infection variant: they join the seekers)",
      "The seeker role rotates every round",
    ],
    respawn: "round",
    victory: "Most points after every player has been seeker once (up to the round count)",
    scoring: "Hiders: +1 per 10 s hidden, +5 for surviving the round. Seekers: +3 per hider found",
    weapons: "Seekers: pistol + SMG. Hiders: unarmed",
    vehicles: false,
    abilities: ["Dash", "Hiding spots", "Blackout variant: seeker flashlight"],
    hud: "roles",
    rewards: "Completion, time hidden, hiders found, victory",
    events: ["Blackout variant: the lights go out periodically"],
    joinInProgress: "next-round",
    disconnect: `Seat held 20 s; if the seeker leaves the round ends. ${rotateRoles}`,
    quick: false,
    status: "available",
    flag: "hideseek",
  },
  prophunt: {
    id: "prophunt",
    name: "Prop Hunt",
    blurb: "Props disguise themselves as objects of the map; hunters must find them.",
    category: "party",
    structure: "roles",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 30 s + 3 min",
    rules: [
      "Props turn into objects of the map (Q), lock in place (C), taunt (T), drop a decoy (G)",
      "Hunters wait blindfolded for 30 s, then have 3 minutes",
      "Shooting an innocent object costs the hunter health",
      "Hints narrow down where the last props are; sides swap every round",
    ],
    respawn: "round",
    victory: "Most points after the rounds; a round goes to the props if one survives",
    scoring: "Props: +1 per 10 s alive, +2 per taunt, +5 surviving. Hunters: +4 per prop found",
    weapons: "Hunters: shotgun + pistol. Props: unarmed",
    vehicles: false,
    abilities: ["Transform", "Lock position", "Taunt", "Decoy", "Quick transform (cooldown)"],
    hud: "roles",
    rewards: "Completion, rounds survived, props found, victory",
    events: ["Progressive hints at 1:30, 2:15 and 2:40 into the hunt"],
    joinInProgress: "next-round",
    disconnect: `Seat held 20 s; a side left empty ends the round. ${rotateRoles}`,
    quick: false,
    status: "available",
    flag: "prophunt",
  },
  infection: {
    id: "infection",
    name: "Infection",
    blurb: "One infected at the start; every survivor eliminated joins the infected.",
    category: "party",
    structure: "roles",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 2:30",
    rules: [
      "One player starts infected: fast, melee claws only",
      "Survivors keep their guns, with endless ammo",
      "A survivor taken down comes back infected",
      "Survive the timer to win the round; the first infected rotates",
    ],
    respawn: "fast",
    victory: "Most points after the rounds",
    scoring: "Survivors: +1 per 10 s alive, +5 surviving the round. Infected: +3 per infection",
    weapons: "Survivors: loadout primary + sidearm. Infected: claws",
    vehicles: false,
    abilities: ["Dash"],
    hud: "roles",
    rewards: "Completion, rounds survived, infections, victory",
    events: ["Last survivor: announced by name, never shown on the map"],
    joinInProgress: "next-round",
    disconnect: `Seat held 20 s; a side left empty ends the round. ${rotateRoles}`,
    quick: false,
    status: "available",
    flag: "infection",
  },
  chaos: {
    id: "chaos",
    name: "Chaos Arena",
    blurb: "A free-for-all whose rules change every 30–45 seconds.",
    category: "party",
    structure: "ffa",
    players: { min: 1, max: 8 },
    durationLabel: "8 min",
    rules: [
      "Free-for-all: most eliminations wins",
      "Every 30–45 s a new rule: double damage, rockets only, vampire, regeneration…",
      "The current rule is always shown at the top of the screen",
    ],
    respawn: "timed",
    victory: "First to the elimination limit, or most eliminations when time runs out",
    scoring: "1 point per elimination",
    weapons: "Loadout, chests and pickups; some rules hand everyone the same weapon",
    vehicles: false,
    abilities: ["Dash"],
    hud: "standard",
    rewards: "Completion, eliminations, placement",
    events: ["A rule change every 30–45 s"],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "chaos",
  },
  bounty: {
    id: "bounty",
    name: "Bounty Hunt",
    blurb: "One marked target scores while alive; whoever takes them down is the next target.",
    category: "competitive",
    structure: "ffa",
    players: { min: 2, max: 8 },
    durationLabel: "8 min",
    rules: [
      "One player is the target: their area is pinged to everyone every few seconds",
      "The target scores 1 point every 2 s alive",
      "Take down the target: +5 points, and you become the target",
      "Other eliminations: +1 point",
    ],
    respawn: "timed",
    victory: "First to the point limit, or most points when time runs out",
    scoring: "Target: 1 point / 2 s. Bounty claimed: 5. Elimination: 1",
    weapons: "Loadout primary + sidearm, pickups and chests",
    vehicles: false,
    abilities: ["Dash"],
    hud: "standard",
    rewards: "Completion, eliminations, placement",
    events: ["Target pinged every 5 s"],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s; a target who leaves passes the bounty on",
    quick: false,
    status: "available",
    flag: "bounty",
  },
  sabotage: {
    id: "sabotage",
    name: "Sabotage",
    blurb: "Rounds of attack and defence: plant the device on a site, or stop it. No respawns in a round.",
    category: "competitive",
    structure: "teams",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 1:40",
    rules: [
      "Attackers plant the device on site A or B (hold E for 3 s)",
      "Defenders defuse it (hold E for 5 s) or hold out until time runs out",
      "No respawns inside a round; eliminating the other team also wins it",
      "Sides swap at half time",
    ],
    respawn: "round",
    victory: "Most rounds won",
    scoring: "1 point per round won",
    weapons: "Loadout primary + sidearm",
    vehicles: false,
    abilities: ["Dash"],
    hud: "teams",
    rewards: "Completion, eliminations, victory",
    events: ["Device planted: 35 s fuse"],
    joinInProgress: "next-round",
    disconnect: "Seat held 20 s; a team left empty loses the round",
    quick: false,
    status: "available",
    flag: "sabotage",
  },
  pursuit: {
    id: "pursuit",
    name: "Vehicle Pursuit",
    blurb: "Runners cross the map through checkpoints to a destination; interceptors must stop them.",
    category: "vehicles",
    structure: "teams",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 2:30",
    rules: [
      "Runners pass every checkpoint in order, then reach the destination (on foot or driving)",
      "Interceptors stop them until the time runs out",
      "Respawn after 4 s; sides swap every round",
    ],
    respawn: "timed",
    victory: "Most rounds won",
    scoring: "1 point per round won",
    weapons: "Loadout primary + sidearm, vehicles",
    vehicles: true,
    abilities: ["Dash", "Vehicles"],
    hud: "teams",
    rewards: "Completion, eliminations, victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "pursuit",
  },
  convoy: {
    id: "convoy",
    name: "Convoy",
    blurb: "One team escorts an armored truck to its destination, the other intercepts it.",
    category: "vehicles",
    structure: "teams",
    players: { min: 2, max: 8 },
    durationLabel: "Rounds of 3 min",
    rules: [
      "Escorts drive the armored truck through the checkpoints to the destination",
      "Interceptors win by wrecking the truck or holding out until time runs out",
      "Respawn after 4 s; sides swap every round",
    ],
    respawn: "timed",
    victory: "Most rounds won",
    scoring: "1 point per round won",
    weapons: "Loadout primary + sidearm, vehicles",
    vehicles: true,
    abilities: ["Dash", "Vehicles"],
    hud: "teams",
    rewards: "Completion, eliminations, victory",
    events: [],
    joinInProgress: "spawn",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "convoy",
  },
  outbreak: {
    id: "outbreak",
    name: "Outbreak",
    blurb: "Co-op campaign: 1-4 players, mission objectives, infected, bosses.",
    category: "coop",
    structure: "coop",
    players: { min: 1, max: 4 },
    durationLabel: "15–30 min per mission",
    rules: ["Complete the mission steps", "Revive downed teammates (hold E)", "Missions unlock in order"],
    respawn: "checkpoint",
    victory: "Complete the mission",
    scoring: "Objectives, enemies, revives",
    weapons: "Loadout, supply crates",
    vehicles: true,
    abilities: ["Dash", "Revive"],
    hud: "pve",
    rewards: "Mission completion, difficulty, kills, revives",
    events: ["Waves, blackouts, alarms, bosses"],
    joinInProgress: "checkpoint",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "outbreak",
  },
  survival: {
    id: "survival",
    name: "Survival",
    blurb: "Co-op endless waves. How long can the squad hold?",
    category: "coop",
    structure: "coop",
    players: { min: 1, max: 4 },
    durationLabel: "Endless",
    rules: ["Endless waves of infected", "Revive downed teammates (hold E)"],
    respawn: "checkpoint",
    victory: "Survive as many waves as possible",
    scoring: "Waves survived",
    weapons: "Loadout, supply crates",
    vehicles: false,
    abilities: ["Dash", "Revive"],
    hud: "pve",
    rewards: "Waves, kills, revives",
    events: ["Waves"],
    joinInProgress: "checkpoint",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "survival",
  },
  maze: {
    id: "maze",
    name: "Classic Maze",
    blurb: "A seeded labyrinth. Find the key, hit the switch, dodge the traps, reach the exit first.",
    category: "challenge",
    structure: "ffa",
    players: { min: 1, max: 8 },
    durationLabel: "5 min",
    rules: [
      "No weapons: fastest to the exit wins",
      "Carry the key to the amber gate, press E on the switch for the cyan gate",
      "Floor traps send you back to your last checkpoint",
    ],
    respawn: "checkpoint",
    victory: "Fastest time to the exit",
    scoring: "Finish time",
    weapons: "None",
    vehicles: false,
    abilities: ["Dash"],
    hud: "objectives",
    rewards: "Completion, finish placement",
    events: ["Gates opening", "Traps"],
    joinInProgress: "checkpoint",
    disconnect: "Seat held 20 s",
    quick: false,
    status: "available",
    flag: "maze",
  },
};

/**
 * Modes designed in docs/v4/MODES.md but not built yet. They are shown on the Play screen with
 * their status and no Play button: nothing pretends to start them.
 */
export interface PlannedMode {
  id: string;
  name: string;
  blurb: string;
  category: ModeCategory;
  players: { min: number; max: number };
  status: Exclude<ModeStatus, "available">;
  /** What has to exist first. */
  needs: string;
}

export const PLANNED_MODES: readonly PlannedMode[] = [];

/**
 * Co-op operations: Outbreak missions with a card of their own on the Play screen (they run on
 * the Outbreak systems; the card opens a co-op room with the mission chosen).
 */
export interface CoopOperation {
  id: string;
  name: string;
  blurb: string;
  mission: string;
  players: { min: number; max: number };
}

export const COOP_OPERATIONS: readonly CoopOperation[] = [
  {
    id: "extraction",
    name: "Extraction PvE",
    blurb: "Find the cargo, carry it to the extraction point through the infected.",
    mission: "extraction",
    players: { min: 1, max: 4 },
  },
  {
    id: "bossrush",
    name: "Boss Rush",
    blurb: "The Outbreak bosses back to back, with limited supplies.",
    mission: "boss-rush",
    players: { min: 1, max: 4 },
  },
];

export const MODE_CATEGORIES: readonly { id: ModeCategory; name: string; modes: readonly string[] }[] = [
  {
    id: "competitive",
    name: "Competitive",
    modes: ["deathmatch", "tdm", "gungame", "dom", "ctf", "sabotage", "bounty"],
  },
  { id: "party", name: "Party", modes: ["hideseek", "prophunt", "infection", "chaos"] },
  { id: "coop", name: "Co-op", modes: ["outbreak", "survival", "extraction", "bossrush"] },
  { id: "vehicles", name: "Vehicles", modes: ["mayhem", "pursuit", "convoy"] },
  { id: "challenge", name: "Challenge", modes: ["maze"] },
];

/**
 * Feature flags. Every available mode is on unless switched off; a "development" mode is off
 * unless switched on. `spec` is a comma-separated list: "-prophunt" switches a mode off,
 * "+name" or "name" switches it on, "*" switches every mode on (VITE_MODE_FLAGS in the client,
 * MODE_FLAGS on the dedicated server).
 */
export function modeFlags(spec: string | undefined | null): ReadonlySet<GameMode> {
  const on = new Set<GameMode>(GAME_MODES.filter((m) => MODES[m].status === "available"));
  for (const raw of (spec ?? "").split(",")) {
    const item = raw.trim();
    if (!item) continue;
    if (item === "*") {
      for (const m of GAME_MODES) on.add(m);
      continue;
    }
    const off = item.startsWith("-");
    const name = item.replace(/^[+-]/, "");
    const mode = GAME_MODES.find((m) => MODES[m].flag === name);
    if (!mode) continue;
    if (off) on.delete(mode);
    else on.add(mode);
  }
  return on;
}

export function modeEnabled(mode: string, flags: ReadonlySet<GameMode>): mode is GameMode {
  return (GAME_MODES as readonly string[]).includes(mode) && flags.has(mode as GameMode);
}

/** Competitive modes (the PvP lobby picker). */
export const PVP_MODES: readonly GameMode[] = GAME_MODES.filter((m) => MODES[m].structure !== "coop");
/** Cooperative PvE modes: Outbreak missions and Survival Endless. */
export const PVE_MODES: readonly GameMode[] = ["outbreak", "survival"];

/** 1 to 4 humans against the infected; all humans are on one side (team 1), no friendly fire. */
export function isPveMode(mode: string): boolean {
  return mode === "outbreak" || mode === "survival";
}

/** Sides assigned by the server at match start and rotated between rounds (Hide & Seek, Prop Hunt). */
export function isRoleMode(mode: string): boolean {
  return mode === "hideseek" || mode === "prophunt" || mode === "infection";
}

/** Rounds inside one match (round stages, round results between them). */
export function isRoundMode(mode: string): boolean {
  return isRoleMode(mode) || mode === "sabotage" || mode === "pursuit" || mode === "convoy";
}

/** Co-op squad size limits. */
export const PVE_SQUAD = { min: 1, max: 4 } as const;

export const MODE_NAMES: Record<GameMode, string> = Object.fromEntries(
  GAME_MODES.map((m) => [m, MODES[m].name]),
) as Record<GameMode, string>;

/** One-line rules shown in the lobby. */
export const MODE_BLURBS: Record<GameMode, string> = Object.fromEntries(
  GAME_MODES.map((m) => [m, MODES[m].blurb]),
) as Record<GameMode, string>;

/** What the score limit counts, per mode (lobby badges, HUD). */
export const MODE_SCORE_UNIT: Record<GameMode, string> = {
  deathmatch: "eliminations",
  tdm: "team points",
  dom: "points",
  ctf: "captures",
  mayhem: "team points",
  gungame: "levels",
  hideseek: "rounds",
  prophunt: "rounds",
  infection: "rounds",
  chaos: "eliminations",
  bounty: "points",
  sabotage: "rounds",
  pursuit: "rounds",
  convoy: "rounds",
  outbreak: "objectives",
  survival: "waves",
  maze: "finishes",
};

/** Modes that only make sense on maps with vehicles. */
export function modeNeedsVehicles(mode: string): boolean {
  return mode === "mayhem" || mode === "pursuit" || mode === "convoy";
}

/** Vehicles parked on the map are spawned in this mode. */
export function modeUsesVehicles(mode: string): boolean {
  return (GAME_MODES as readonly string[]).includes(mode) ? MODES[mode as GameMode].vehicles : true;
}

/** Team score comes from objectives only (eliminations do not score). */
export function modeScoresObjectives(mode: string): boolean {
  return mode === "dom" || mode === "ctf" || mode === "sabotage" || mode === "pursuit" || mode === "convoy";
}

/**
 * Canonical lifecycle shared by every mode. The room phases (lobby, countdown, playing, results)
 * carry it on the wire; round modes add a stage inside "playing" (MatchState.round.stage).
 * PREPARING is the synchronous setup between LOBBY and COUNTDOWN (sides, loadouts, map reset);
 * REMATCH is the results screen's ready/vote step that leads back to a new COUNTDOWN.
 */
export type LifecycleStage =
  | "LOBBY"
  | "PREPARING"
  | "COUNTDOWN"
  | "ACTIVE"
  | "OVERTIME"
  | "RESULTS"
  | "REMATCH";

export function lifecycleOf(phase: string, roundStage: string, rematchVoting = false): LifecycleStage {
  switch (phase) {
    case "lobby":
      return "LOBBY";
    case "countdown":
      return "COUNTDOWN";
    case "playing":
      if (roundStage === "prep") return "PREPARING";
      return roundStage === "overtime" ? "OVERTIME" : "ACTIVE";
    case "results":
      return rematchVoting ? "REMATCH" : "RESULTS";
    default:
      return "LOBBY";
  }
}

export const OBJECTIVES = {
  /** Domination: capture radius (px). */
  pointRadius: 120,
  /** Seconds for one player to turn a neutral point (more players capture faster, up to 3). */
  captureSec: 6,
  /** Every owned point scores 1 point this often (seconds). */
  scoreEverySec: 5,
  /** CTF: pick-up / return / capture reach (px). */
  flagReach: 44,
  /** A dropped flag returns home after this long untouched (seconds). */
  flagReturnSec: 20,
  /** Vehicle Mayhem: team points for wrecking an enemy vehicle with a crew. */
  wreckPoints: 2,
  /** Vehicle Mayhem: vehicles come back faster. */
  mayhemRespawnFactor: 0.5,
} as const;

/** 0 = no team (free for all), 1 = Alpha, 2 = Bravo. */
export type TeamId = 0 | 1 | 2;
export const TEAM_NONE = 0;
export const TEAM_ALPHA = 1;
export const TEAM_BRAVO = 2;
export const PLAYABLE_TEAMS = [TEAM_ALPHA, TEAM_BRAVO] as const;

export interface TeamDef {
  id: 1 | 2;
  name: string;
  /** Ring, name tag and HUD color (0xRRGGBB). Chosen to stay distinct for common color blindness. */
  color: number;
  css: string;
}

export const TEAMS: Record<1 | 2, TeamDef> = {
  1: { id: 1, name: "Alpha", color: 0x3da5ff, css: "#3da5ff" },
  2: { id: 2, name: "Bravo", color: 0xff8a3d, css: "#ff8a3d" },
};

export function teamName(team: number): string {
  return team === 1 || team === 2 ? TEAMS[team].name : "";
}

/** Lobby-chosen teams (Alpha / Bravo). Role modes have sides only during the match. */
export function isTeamMode(mode: string): boolean {
  return (
    mode === "tdm" ||
    mode === "dom" ||
    mode === "ctf" ||
    mode === "mayhem" ||
    mode === "sabotage" ||
    mode === "pursuit" ||
    mode === "convoy"
  );
}

/** True when `a` may damage `b` under the given rules. Self-damage does not exist. */
export function canDamage(
  a: { id: string; team: number },
  b: { id: string; team: number },
  rules: { teams: boolean; friendlyFire: boolean },
): boolean {
  if (a.id === b.id) return false;
  if (!rules.teams || rules.friendlyFire) return true;
  return a.team === 0 || a.team !== b.team;
}

export interface ModeRules {
  mode: GameMode;
  /** Players per team (team modes); 0 in free-for-all. */
  teamSize: number;
  maxPlayers: number;
  durationSec: number;
  /** Kills (free-for-all) or team score (team modes) that end the match. */
  scoreLimit: number;
  friendlyFire: boolean;
}

export const MODE_DEFAULTS: Record<GameMode, ModeRules> = {
  deathmatch: {
    mode: "deathmatch",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: MATCH_DEFAULTS.durationSec,
    scoreLimit: MATCH_DEFAULTS.killLimit,
    friendlyFire: false,
  },
  // First team release: 2v2, five minutes, first team to 15, no friendly fire.
  tdm: { mode: "tdm", teamSize: 2, maxPlayers: 4, durationSec: 5 * 60, scoreLimit: 15, friendlyFire: false },
  dom: { mode: "dom", teamSize: 2, maxPlayers: 4, durationSec: 8 * 60, scoreLimit: 100, friendlyFire: false },
  ctf: { mode: "ctf", teamSize: 2, maxPlayers: 4, durationSec: 10 * 60, scoreLimit: 3, friendlyFire: false },
  mayhem: {
    mode: "mayhem",
    teamSize: 2,
    maxPlayers: 4,
    durationSec: 6 * 60,
    scoreLimit: 30,
    friendlyFire: false,
  },
  // The ladder ends the match; the clock is a cap (overtime on a tie). The score limit is unused.
  gungame: {
    mode: "gungame",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 8 * 60,
    scoreLimit: 6,
    friendlyFire: false,
  },
  // Round modes: `scoreLimit` is the round count; the match clock is a safety cap.
  hideseek: {
    mode: "hideseek",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 20 * 60,
    scoreLimit: 4,
    friendlyFire: false,
  },
  prophunt: {
    mode: "prophunt",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 20 * 60,
    scoreLimit: 4,
    friendlyFire: false,
  },
  infection: {
    mode: "infection",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 20 * 60,
    scoreLimit: 4,
    friendlyFire: false,
  },
  chaos: {
    mode: "chaos",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 8 * 60,
    scoreLimit: 25,
    friendlyFire: false,
  },
  // Bounty: the score limit is in points.
  bounty: {
    mode: "bounty",
    teamSize: 0,
    maxPlayers: MATCH_DEFAULTS.maxPlayers,
    durationSec: 8 * 60,
    scoreLimit: 60,
    friendlyFire: false,
  },
  // Team round modes: `scoreLimit` is the round count, the clock a safety cap.
  sabotage: {
    mode: "sabotage",
    teamSize: 2,
    maxPlayers: 4,
    durationSec: 20 * 60,
    scoreLimit: 6,
    friendlyFire: false,
  },
  pursuit: {
    mode: "pursuit",
    teamSize: 2,
    maxPlayers: 4,
    durationSec: 20 * 60,
    scoreLimit: 4,
    friendlyFire: false,
  },
  convoy: {
    mode: "convoy",
    teamSize: 2,
    maxPlayers: 4,
    durationSec: 20 * 60,
    scoreLimit: 4,
    friendlyFire: false,
  },
  // PvE: the mission (or the squad's survival) ends the match, not a clock or a score. The
  // duration is a safety cap only.
  outbreak: {
    mode: "outbreak",
    teamSize: 0,
    maxPlayers: 4,
    durationSec: 60 * 60,
    scoreLimit: 0,
    friendlyFire: false,
  },
  survival: {
    mode: "survival",
    teamSize: 0,
    maxPlayers: 4,
    durationSec: 90 * 60,
    scoreLimit: 0,
    friendlyFire: false,
  },
  maze: {
    mode: "maze",
    teamSize: 0,
    maxPlayers: 8,
    durationSec: 5 * 60,
    scoreLimit: 0,
    friendlyFire: false,
  },
};

/** 1v1 … 4v4. */
export const TEAM_SIZE = { min: 1, max: 4 } as const;

/** Variants of the round modes (lobby setting). */
export const MODE_VARIANTS: Partial<
  Record<GameMode, readonly { id: string; name: string; blurb: string }[]>
> = {
  hideseek: [
    { id: "classic", name: "Classic", blurb: "Found hiders are out until the next round." },
    { id: "infect", name: "Infection", blurb: "Found hiders join the seekers." },
    {
      id: "blackout",
      name: "Blackout",
      blurb: "The lights go out periodically; the seeker has a flashlight.",
    },
  ],
  prophunt: [{ id: "classic", name: "Classic", blurb: "Props vs hunters, sides swap every round." }],
};

export function defaultVariant(mode: string): string {
  return MODE_VARIANTS[mode as GameMode]?.[0]?.id ?? "";
}

/** Round counts a host may pick in round modes. */
export const ROUND_LIMITS = { min: 1, max: 8 } as const;
