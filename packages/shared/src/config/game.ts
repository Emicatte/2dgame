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
  /**
   * Without ack progress for this long the client stops producing inputs and shows "connection
   * interrupted" instead of predicting further ahead of a server that is not receiving them.
   * Measured worst ack gap in normal play: ~290 ms (120 ms RTT, 30 ms jitter, 1 % 150 ms stalls)
   * and ~270 ms across an automatic reconnect (docs/audit/AUDIT_REPORT.md, N4).
   */
  inputStallMs: 750,
  /**
   * Real time a player may bank while its queue is empty, so the inputs that pile up during a
   * network stall are still applied instead of being corrected away. It bounds how far ahead of
   * real time a client can ever act (lag-switch exposure). Equal to the client stall guard: a
   * client never sends more than this much input without an ack.
   */
  maxInputCreditSeconds: 0.75,
  /** A backlog is consumed at most this many times faster than real time (no teleports). */
  inputCatchUpRate: 2,
  /** A queue that never drains below this many frames for `standingQueueWindowSec` is trimmed. */
  standingQueueFrames: 2,
  standingQueueWindowSec: 1,
  /** Queued inputs beyond this evict the oldest (protects memory; newest intent wins). */
  maxQueuedInputs: 60,
  /** Remote players are rendered this far in the past (ms) so there are always two snapshots to blend. */
  interpolationDelayMs: 110,
  /** Lag compensation never rewinds further than this (ms). */
  maxRewindMs: 300,
  /**
   * Messages per second accepted from one client before Colyseus disconnects it. Normal play sends
   * at most ~61 (one input message per 60 Hz step + ping); the burst released after a network
   * stall adds up to inputStallMs worth (45), so the limit must be above ~106.
   */
  maxMessagesPerSecond: 150,
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
  killLimit: { min: 1, max: 200 },
  maxPlayers: { min: 2, max: 8 },
} as const;

export const NICKNAME = { min: 2, max: 16 } as const;
