import { type SchemaType, schema, t } from "@colyseus/schema";

/**
 * Synchronized room state. Defined once here so the server encodes and the client decodes with
 * identical, typed classes. Fields tagged `.view()` reach only the owning client (via StateView):
 * they carry what reconciliation needs without spending bandwidth on everybody else.
 */
export const PlayerState = schema(
  {
    name: t.string(),
    skin: t.string(),
    level: t.uint8(),
    primary: t.string(),
    ready: t.boolean(),
    connected: t.boolean(),
    alive: t.boolean(),
    x: t.float32(),
    y: t.float32(),
    aim: t.float32(),
    hp: t.uint8(),
    kills: t.uint16(),
    deaths: t.uint16(),
    streak: t.uint8(),
    /** Active weapon index (for drawing remote players). */
    weapon: t.uint8(),
    reloading: t.boolean(),
    protected: t.boolean(),
    /** Server tick at which a dead player respawns (0 while alive). */
    respawnTick: t.uint32(),
    ping: t.uint16(),
    joinedAt: t.uint32(),

    // ----- owner-only reconciliation fields -----
    ack: t.uint32().view(),
    vx: t.float32().view(),
    vy: t.float32().view(),
    dash: t.uint8().view(),
    dashCd: t.uint8().view(),
    dashDx: t.float32().view(),
    dashDy: t.float32().view(),
    dashHeld: t.boolean().view(),
    slot: t.uint8().view(),
    w0: t.uint8().view(),
    m0: t.uint8().view(),
    r0: t.int16().view(),
    w1: t.uint8().view(),
    m1: t.uint8().view(),
    r1: t.int16().view(),
    w2: t.uint8().view(),
    m2: t.uint8().view(),
    r2: t.int16().view(),
    cooldown: t.uint8().view(),
    reload: t.uint16().view(),
    swap: t.uint8().view(),
    bloom: t.float32().view(),
    trigger: t.boolean().view(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PickupState = schema(
  {
    active: t.boolean(),
  },
  "PickupState",
);
export type PickupState = SchemaType<typeof PickupState>;

export type MatchPhase = "lobby" | "countdown" | "playing" | "results";

export const MatchState = schema(
  {
    phase: t.string().default("lobby"),
    mode: t.string().default("deathmatch"),
    roomKind: t.string().default("quick"),
    code: t.string(),
    mapId: t.string(),
    hostId: t.string(),
    tick: t.uint32(),
    /** Server tick at which the current phase ends (countdown, match end, results end). 0 = none. */
    phaseEndTick: t.uint32(),
    durationSec: t.uint16(),
    killLimit: t.uint16(),
    maxPlayers: t.uint8(),
    tickRate: t.uint8(),
    winnerId: t.string(),
    matchIndex: t.uint16(),
    firstBloodDone: t.boolean(),
    players: t.map(PlayerState),
    pickups: t.map(PickupState),
  },
  "MatchState",
);
export type MatchState = SchemaType<typeof MatchState>;
