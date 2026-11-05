import { type SchemaType, schema, t } from "@colyseus/schema";

/**
 * Synchronized room state. Defined once here so the server encodes and the client decodes with
 * identical, typed classes. Fields tagged `.view()` reach only the owning client (via StateView):
 * they carry what reconciliation needs without spending bandwidth on everybody else.
 */
export const PlayerState = schema(
  {
    name: t.string().default(""),
    skin: t.string().default(""),
    level: t.uint8().default(0),
    primary: t.string().default(""),
    ready: t.boolean().default(false),
    connected: t.boolean().default(false),
    alive: t.boolean().default(false),
    x: t.float32().default(0),
    y: t.float32().default(0),
    aim: t.float32().default(0),
    hp: t.uint8().default(0),
    kills: t.uint16().default(0),
    deaths: t.uint16().default(0),
    streak: t.uint8().default(0),
    /** Active weapon index (for drawing remote players). */
    weapon: t.uint8().default(0),
    reloading: t.boolean().default(false),
    protected: t.boolean().default(false),
    /** Server tick at which a dead player respawns (0 while alive). */
    respawnTick: t.uint32().default(0),
    ping: t.uint16().default(0),
    joinedAt: t.uint32().default(0),

    // ----- owner-only reconciliation fields -----
    ack: t.uint32().default(0).view(),
    vx: t.float32().default(0).view(),
    vy: t.float32().default(0).view(),
    dash: t.uint8().default(0).view(),
    dashCd: t.uint8().default(0).view(),
    dashDx: t.float32().default(0).view(),
    dashDy: t.float32().default(0).view(),
    dashHeld: t.boolean().default(false).view(),
    slot: t.uint8().default(0).view(),
    w0: t.uint8().default(0).view(),
    m0: t.uint8().default(0).view(),
    r0: t.int16().default(0).view(),
    w1: t.uint8().default(0).view(),
    m1: t.uint8().default(0).view(),
    r1: t.int16().default(0).view(),
    w2: t.uint8().default(0).view(),
    m2: t.uint8().default(0).view(),
    r2: t.int16().default(0).view(),
    cooldown: t.uint8().default(0).view(),
    reload: t.uint16().default(0).view(),
    swap: t.uint8().default(0).view(),
    bloom: t.float32().default(0).view(),
    trigger: t.boolean().default(false).view(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PickupState = schema(
  {
    active: t.boolean().default(false),
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
    code: t.string().default(""),
    mapId: t.string().default(""),
    hostId: t.string().default(""),
    tick: t.uint32().default(0),
    /** Server tick at which the current phase ends (countdown, match end, results end). 0 = none. */
    phaseEndTick: t.uint32().default(0),
    durationSec: t.uint16().default(0),
    killLimit: t.uint16().default(0),
    maxPlayers: t.uint8().default(0),
    tickRate: t.uint8().default(0),
    winnerId: t.string().default(""),
    matchIndex: t.uint16().default(0),
    firstBloodDone: t.boolean().default(false),
    players: t.map(PlayerState),
    pickups: t.map(PickupState),
  },
  "MatchState",
);
export type MatchState = SchemaType<typeof MatchState>;
