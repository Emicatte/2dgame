/**
 * Tuning of Gun Game, Hide & Seek and Prop Hunt. Data only: the server controllers
 * (apps/server/src/modes) and the client read these values; balancing never touches game code.
 */
import type { WeaponId } from "./weapons.ts";

// ------------------------------------------------------------------ Gun Game

export const GUN_GAME = {
  /**
   * The ladder. Only weapons that exist in the game: with five hand-held weapons the final level
   * is the sidearm again (the hardest weapon to finish with), not an invented one.
   */
  ladder: ["pistol", "smg", "rifle", "shotgun", "sniper", "pistol"] as readonly WeaponId[],
  respawnSec: 1.5,
  spawnProtectionSec: 1.5,
  /** Killed by somebody on a lower level than yours: you go back one level (catch-up rule). */
  demoteOnLowerKiller: true,
  /** At time out with a tie on the top level: this long, the first level-up wins. */
  overtimeSec: 60,
} as const;

export function gunGameWeapon(level: number): WeaponId {
  const l = GUN_GAME.ladder;
  return l[Math.max(0, Math.min(l.length - 1, level))]!;
}

// ------------------------------------------------------------------ shared by the round modes

/** Side ids inside a round mode (PlayerState.role). */
export const ROLE = { NONE: 0, SEEKER: 1, HIDER: 2 } as const;
export type RoleId = (typeof ROLE)[keyof typeof ROLE];

/**
 * Round stages (MatchState.round.stage). "prep": hiders hide, seekers wait blindfolded in their
 * pen. "hunt": the search. "break": a few seconds of round results before the next round.
 */
export type RoundStage = "" | "prep" | "hunt" | "break" | "overtime";

/**
 * What a seeker can see: the screen of a player is 1600×900 world px at base zoom (plus the
 * look-ahead towards the cursor). Hiders are exposed to the seeking side only inside this box and
 * in line of sight; the server never publishes the others.
 */
export const SIGHT = {
  halfW: 860,
  halfH: 500,
  /** Inside a shadow zone: only this close. */
  shadowRange: 150,
  /** Inside a hiding spot: only this close (or by touching it). */
  spotRange: 60,
  /** Once exposed, stays exposed this long after the sight line breaks (no flicker). */
  holdSec: 0.6,
  /** Blackout, lights out: exposed inside the flashlight cone, or this close. */
  darkRange: 110,
  flashlightRange: 560,
  flashlightHalfAngleDeg: 28,
} as const;

// ------------------------------------------------------------------ Hide & Seek

export const HIDE_SEEK = {
  prepSec: 30,
  huntSec: 180,
  breakSec: 6,
  hiderHealth: 60,
  /** Seekers in a match: 1 per this many players (at least 1). */
  playersPerSeeker: 5,
  seekerWeapons: ["smg", "pistol"] as readonly WeaponId[],
  points: { hiddenEverySec: 10, hidden: 1, survive: 5, find: 3 },
  blackout: { onSec: 22, offSec: 14 },
} as const;

// ------------------------------------------------------------------ Prop Hunt

export type DisguiseKind =
  | "crate"
  | "barrel"
  | "chair"
  | "box"
  | "bin"
  | "cooler"
  | "plant"
  | "tires"
  | "cone"
  | "vending";

export interface DisguiseDef {
  kind: DisguiseKind;
  /** Wire index (DisguiseState.k). Keep stable once released. */
  index: number;
  name: string;
  /** Collision circle and hit circle (px). Large props cannot pass narrow gaps. */
  radius: number;
  /** Drawn size (px). */
  w: number;
  h: number;
  /** A disguised player's health as this prop: small props are hard to hit, so they are fragile. */
  health: number;
  /** Walking speed as this prop (synchronized in the owner's ghost, applied by the prediction). */
  speed: number;
}

export const DISGUISES: readonly DisguiseDef[] = [
  { kind: "crate", index: 0, name: "Crate", radius: 22, w: 44, h: 44, health: 110, speed: 0.9 },
  { kind: "barrel", index: 1, name: "Barrel", radius: 18, w: 36, h: 36, health: 95, speed: 0.95 },
  { kind: "chair", index: 2, name: "Chair", radius: 15, w: 30, h: 30, health: 75, speed: 1 },
  { kind: "box", index: 3, name: "Cardboard box", radius: 14, w: 30, h: 26, health: 70, speed: 1 },
  { kind: "bin", index: 4, name: "Bin", radius: 16, w: 32, h: 32, health: 85, speed: 1 },
  { kind: "cooler", index: 5, name: "Cooler box", radius: 15, w: 34, h: 24, health: 75, speed: 1 },
  { kind: "plant", index: 6, name: "Potted plant", radius: 14, w: 30, h: 30, health: 70, speed: 1 },
  { kind: "tires", index: 7, name: "Tire stack", radius: 19, w: 38, h: 38, health: 100, speed: 0.95 },
  { kind: "cone", index: 8, name: "Traffic cone", radius: 12, w: 24, h: 24, health: 60, speed: 1 },
  { kind: "vending", index: 9, name: "Vending machine", radius: 26, w: 52, h: 40, health: 140, speed: 0.8 },
];

export function disguiseDef(index: number): DisguiseDef | undefined {
  return DISGUISES[index];
}

export function disguiseByName(kind: string): DisguiseDef | undefined {
  return DISGUISES.find((k) => k.kind === kind);
}

export const PROP_HUNT = {
  prepSec: 30,
  huntSec: 180,
  breakSec: 6,
  /** Hunters in a match: 1 per this many players (at least 1). */
  playersPerHunter: 3,
  hunterWeapons: ["shotgun", "pistol"] as readonly WeaponId[],
  /** Health a hunter loses per shot that hits an innocent object (can be lethal: no spraying). */
  innocentPenalty: 6,
  /** Health a hunter gets back for every prop found. */
  findHeal: 20,
  /** Reach of "copy the object in front of you" (E) and of a decoy drop (px). */
  copyReach: 90,
  quickTransformCooldownSec: 8,
  tauntCooldownSec: 10,
  decoyCooldownSec: 30,
  decoySec: 20,
  /** Share of the map's prop spots that are real objects each round (the rest stay empty). */
  spotFill: 0.85,
  /** Hints: seconds into the hunt and ping radius around each remaining prop. */
  hints: [
    { atSec: 90, radius: 420 },
    { atSec: 135, radius: 300 },
    { atSec: 160, radius: 200 },
  ] as readonly { atSec: number; radius: number }[],
  hintSec: 6,
  /**
   * A prop that has not moved more than `stillPx` for `stillSec` gets its own approximate ping
   * (a wide circle, never its position): incentive to move now and then, never a forced reveal.
   */
  stillSec: 40,
  stillPx: 24,
  stillPingRadius: 360,
  points: { aliveEverySec: 10, alive: 1, taunt: 2, survive: 5, find: 4 },
} as const;
