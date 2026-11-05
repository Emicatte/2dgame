/**
 * Central gameplay and network tuning. Every value the client and the server must agree on
 * lives here, so prediction on the client matches the authoritative simulation on the server.
 */
export const GAME_TITLE = "SCRAPLINE";

export const NET = {
  /** Server simulation + snapshot rate (Hz). Changing it keeps the game correct; only smoothness changes. */
  serverTickRate: 20,
  /** Client fixed input/prediction step (Hz). One input message entry per step. */
  inputRate: 60,
  /** Maximum inputs the client may send in one batch message. */
  maxInputsPerMessage: 6,
  /** Inputs a player may bank (catch-up after jitter). Bounds how far ahead of real time a client can act. */
  maxInputCreditSeconds: 0.25,
  /** Queued inputs beyond this are dropped (protects memory and blocks speed hacks). */
  maxQueuedInputs: 60,
  /** Remote players are rendered this far in the past (ms) so there are always two snapshots to blend. */
  interpolationDelayMs: 110,
  /** Lag compensation never rewinds further than this (ms). */
  maxRewindMs: 300,
  /** Messages per second accepted from one client before Colyseus drops them. */
  maxMessagesPerSecond: 90,
  /** Seconds a dropped client keeps its seat (and score) while reconnecting. */
  reconnectSeconds: 20,
} as const;

export const STEP_DT = 1 / NET.inputRate;
export const SERVER_TICK_MS = 1000 / NET.serverTickRate;

export const PLAYER = {
  radius: 18,
  maxHealth: 100,
  maxSpeed: 265,
  acceleration: 2600,
  deceleration: 2300,
  dashSpeed: 760,
  dashDuration: 0.14,
  dashCooldown: 1.6,
  respawnSeconds: 3,
  spawnProtectionSeconds: 1.5,
  interactRadius: 52,
} as const;

export const MATCH_DEFAULTS = {
  minPlayers: 2,
  maxPlayers: 8,
  durationSec: 7 * 60,
  killLimit: 20,
  countdownSec: 5,
  /** Quick match rooms start on their own after this many seconds once minPlayers are present. */
  quickMatchAutoStartSec: 12,
  resultsSec: 14,
  /** Seconds of match participation required before completion XP is awarded. */
  minParticipationSec: 60,
} as const;

export const MATCH_LIMITS = {
  durationSec: { min: 120, max: 20 * 60 },
  killLimit: { min: 5, max: 100 },
  maxPlayers: { min: 2, max: 8 },
} as const;

export type GameMode = "deathmatch";
export const GAME_MODES: readonly GameMode[] = ["deathmatch"];

export const NICKNAME = { min: 2, max: 16 } as const;
