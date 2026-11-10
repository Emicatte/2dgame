/**
 * Tuning of the modes added in 0.8 (Infection, Chaos Arena, Bounty Hunt, Sabotage, Vehicle
 * Pursuit, Convoy). Server controllers read these; the client only shows them.
 */
import type { WeaponId } from "./weapons.ts";

export const INFECTION = {
  prepSec: 8,
  huntSec: 150,
  breakSec: 6,
  /** One infected per this many players at the start of a round. */
  playersPerInfected: 8,
  respawnSec: 2,
  points: { aliveEverySec: 10, alive: 1, survive: 5, infect: 3 },
} as const;

export interface ChaosRule {
  id: string;
  name: string;
  sub: string;
  /** Damage multiplier while the rule holds. */
  damage?: number;
  /** Everybody holds this weapon only (endless reserve). */
  weapon?: WeaponId;
  /** Health given back per second. */
  regen?: number;
  /** Share of the damage dealt healed to the attacker. */
  vampire?: number;
  /** Everybody gets this much shield when the rule starts (and on spawn). */
  shield?: number;
}

export const CHAOS = {
  minSec: 30,
  maxSec: 45,
  rules: [
    { id: "double", name: "Double damage", sub: "Every hit counts twice", damage: 2 },
    { id: "rockets", name: "Rocket party", sub: "Everybody gets a rocket launcher", weapon: "rpg" },
    { id: "snipers", name: "Snipers only", sub: "Thunder .50 for everyone", weapon: "heavysniper" },
    { id: "shotguns", name: "Close quarters", sub: "Twin Fang shotguns only", weapon: "doublebarrel" },
    { id: "minigun", name: "Bullet hell", sub: "Grinder miniguns for everyone", weapon: "minigun" },
    { id: "flames", name: "Hot zone", sub: "Scorchers only", weapon: "flamethrower" },
    { id: "vampire", name: "Vampire", sub: "Half the damage you deal heals you", vampire: 0.5 },
    { id: "regen", name: "Regeneration", sub: "Health comes back fast", regen: 12 },
    { id: "armor", name: "Heavy armor", sub: "Full shields for everyone", shield: 100 },
    { id: "glass", name: "Glass cannon", sub: "Triple damage, no second chances", damage: 3 },
    { id: "rail", name: "Railgun duel", sub: "Arc railguns only", weapon: "railgun" },
  ] satisfies readonly ChaosRule[] as readonly ChaosRule[],
} as const;

export const BOUNTY = {
  /** The target scores 1 point this often (seconds). */
  targetEverySec: 2,
  claimPoints: 5,
  killPoints: 1,
  pingEverySec: 5,
  /** Radius of the pinged area; its centre is off by up to half of it. */
  pingRadius: 220,
  respawnSec: 3,
} as const;

export const SABOTAGE = {
  prepSec: 5,
  liveSec: 100,
  breakSec: 5,
  plantSec: 3,
  defuseSec: 5,
  fuseSec: 35,
  siteRadius: 110,
} as const;

export const PURSUIT = {
  prepSec: 5,
  roundSec: 150,
  breakSec: 5,
  respawnSec: 4,
  checkpointRadius: 170,
  goalRadius: 200,
  /** Convoy: the escorted truck's extra time and the radius in which it counts. */
  convoyRoundSec: 180,
} as const;

/** Names and lines of the two sides of a role mode (HUD, banners). */
export interface RoleText {
  seeker: string;
  hider: string;
  /** "Hiders / seekers" counter label. */
  sides: string;
  prep: string;
  hunt: string;
  seekerPrep: string;
  hiderPrep: string;
  huntBanner: string;
  seekerWin: string;
  hiderWin: string;
  /** The seeking side is blindfolded during the prep stage. */
  blind: boolean;
}

export function roleText(mode: string): RoleText {
  if (mode === "prophunt")
    return {
      seeker: "Hunter",
      hider: "Prop",
      sides: "Props / hunters",
      prep: "Props hide",
      hunt: "Hunt",
      seekerPrep: "You are a Hunter: wait for the others to hide",
      hiderPrep: "You are a Prop: press Q (or E on an object) to transform",
      huntBanner: "The hunt begins",
      seekerWin: "Hunters win the round",
      hiderWin: "Props win the round",
      blind: true,
    };
  if (mode === "infection")
    return {
      seeker: "Infected",
      hider: "Survivor",
      sides: "Survivors / infected",
      prep: "Infection incoming",
      hunt: "Survive",
      seekerPrep: "You are infected: claws only, but you are fast. Wait in the pen",
      hiderPrep: "You are a Survivor: get to a defensible spot",
      huntBanner: "The infection spreads",
      seekerWin: "The infection took everyone",
      hiderWin: "Survivors hold out",
      blind: false,
    };
  return {
    seeker: "Seeker",
    hider: "Hider",
    sides: "Hiders / seekers",
    prep: "Hiding time",
    hunt: "Search",
    seekerPrep: "You are a Seeker: wait for the others to hide",
    hiderPrep: "You are a Hider: find a place out of sight",
    huntBanner: "Ready or not, here they come",
    seekerWin: "Seekers win the round",
    hiderWin: "Hiders win the round",
    blind: true,
  };
}

/**
 * Battle Royale: the flying bus, the drop and the storm. Storm phases: wait, then shrink to a
 * fraction of the map's half-diagonal; damage per second outside the safe zone.
 */
export const BATTLE_ROYALE = {
  busSpeed: 420,
  /** Bus line: half length (px) and how far from the map centre it may pass. */
  busHalfLength: 2700,
  busOffset: 600,
  /** The storm starts as a circle around the whole map. */
  stormStartRadius: 2950,
  phases: [
    { waitSec: 60, shrinkSec: 45, radius: 1700, dps: 2 },
    { waitSec: 45, shrinkSec: 35, radius: 1000, dps: 4 },
    { waitSec: 35, shrinkSec: 30, radius: 550, dps: 7 },
    { waitSec: 25, shrinkSec: 25, radius: 250, dps: 10 },
    { waitSec: 20, shrinkSec: 20, radius: 80, dps: 14 },
    { waitSec: 15, shrinkSec: 20, radius: 0, dps: 20 },
  ],
} as const;
