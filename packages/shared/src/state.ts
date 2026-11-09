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
    /** Shield points (absorb damage before health), 0..SHIELD.max. */
    shield: t.uint8().default(0),
    /** Shield cells carried (used with BTN.SHIELD), 0..SHIELD.maxCells. */
    cells: t.uint8().default(0),
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
    /** 0 = no team (free for all), 1 = Alpha, 2 = Bravo. */
    team: t.uint8().default(0),
    /** Vehicle the player is in ("" on foot) and the seat index in it. */
    vehicle: t.string().default(""),
    seat: t.int8().default(-1),
    /** PvE: down but not out (crawls, cannot fire; a teammate holds E to revive). */
    downed: t.boolean().default(false),
    /** PvE: tenths of a second left before a downed player bleeds out. */
    bleed: t.uint16().default(0),
    /** PvE: revive progress 0..1 while somebody holds E on this player. */
    revive: t.float32().default(0),
    /** PvE: teammates revived this mission. */
    revives: t.uint8().default(0),
    /** Round modes: ROLE.SEEKER / ROLE.HIDER (0 outside them). Public: everybody knows the sides. */
    role: t.uint8().default(0),
    /**
     * The position is not public: x / y / aim stay at the last pose the other side was allowed to
     * see, and the real pose reaches only the player's own side (MatchState.allies). The client
     * does not draw a masked player it has no ghost for.
     */
    masked: t.boolean().default(false),
    /** Cannot move or act (seekers waiting out the hiding time). Applied by the prediction too. */
    frozen: t.boolean().default(false),
    /** Gun Game: ladder level (0-based). */
    gg: t.uint8().default(0),
    /** Round modes: points this match. */
    pts: t.uint16().default(0),
    /** Results: the map this player votes for next ("" = none). */
    vote: t.string().default(""),

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

/** An item lying on the ground: chest loot or a swapped-out weapon. */
export const DropState = schema(
  {
    /** "weapon" | "shield" | "ammo". */
    kind: t.string().default("ammo"),
    /** Weapon index (weapon drops only). */
    w: t.uint8().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
  },
  "DropState",
);
export type DropState = SchemaType<typeof DropState>;

/**
 * One vehicle. Everybody receives all of it: the driver reconciles its prediction from these
 * values (the vehicle advances only on the driver's inputs, so this is the state after the
 * driver's acknowledged input), everybody else interpolates them.
 */
export const VehicleState = schema(
  {
    kind: t.string().default("car"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    angle: t.float32().default(0),
    vx: t.float32().default(0),
    vy: t.float32().default(0),
    av: t.float32().default(0),
    alt: t.float32().default(0),
    rotor: t.float32().default(0),
    lift: t.boolean().default(false),
    liftHeld: t.boolean().default(false),
    hp: t.uint16().default(0),
    /** 0 = ready, 1 = wrecked (burning hulk), 2 = gone (waiting to respawn). */
    status: t.uint8().default(0),
    /** Occupant session ids by seat ("" = free). */
    s0: t.string().default(""),
    s1: t.string().default(""),
    s2: t.string().default(""),
    s3: t.string().default(""),
  },
  "VehicleState",
);
export type VehicleState = SchemaType<typeof VehicleState>;

export const VEHICLE_STATUS = { READY: 0, WRECK: 1, GONE: 2 } as const;

export function seatOccupant(v: VehicleState, seat: number): string {
  return seat === 0 ? v.s0 : seat === 1 ? v.s1 : seat === 2 ? v.s2 : seat === 3 ? v.s3 : "";
}

/**
 * Mode objective: a Domination capture point or a CTF flag. Positions of points never change;
 * a flag's x / y follow its carrier or where it was dropped.
 */
export const ObjectiveState = schema(
  {
    kind: t.string().default("point"),
    /** Point: owning team (0 = neutral). Flag: the team it belongs to. */
    team: t.uint8().default(0),
    /** Point: capture progress -1 (Bravo) … 1 (Alpha). */
    progress: t.float32().default(0),
    x: t.float32().default(0),
    y: t.float32().default(0),
    /** Flag: carrier id ("" when not carried). */
    carrier: t.string().default(""),
    /** Flag: on its stand. */
    home: t.boolean().default(true),
  },
  "ObjectiveState",
);
export type ObjectiveState = SchemaType<typeof ObjectiveState>;

/**
 * PvE enemy. Compact on purpose (dozens move every tick): positions in whole pixels, the facing
 * angle in 1/256 turns. The client interpolates them like remote players.
 */
export const ZombieState = schema(
  {
    /** ZOMBIES index. */
    k: t.uint8().default(0),
    x: t.int16().default(0),
    y: t.int16().default(0),
    /** Facing, angle * 256 / 2π. */
    a: t.uint8().default(0),
    hp: t.uint16().default(0),
    mhp: t.uint16().default(0),
    /** AI state (AI.*), for animation. */
    st: t.uint8().default(0),
    /** Attack phase (ACT.*) and the tick it began: the client draws the telegraph from it. */
    act: t.uint8().default(0),
    at: t.uint32().default(0),
    /** Telegraph target (charge end point, spit target, blast centre). */
    tx: t.int16().default(0),
    ty: t.int16().default(0),
    /** Current attack: ATTACK_KINDS index, windup length (ticks) and area radius (px). */
    ak: t.uint8().default(0),
    aw: t.uint16().default(0),
    ar: t.uint8().default(0),
  },
  "ZombieState",
);
export type ZombieState = SchemaType<typeof ZombieState>;

/** PvE area hazard (acid puddle): damages players standing in it until `until` (tick). */
export const HazardState = schema(
  {
    x: t.int16().default(0),
    y: t.int16().default(0),
    r: t.uint8().default(0),
    until: t.uint32().default(0),
  },
  "HazardState",
);
export type HazardState = SchemaType<typeof HazardState>;

/**
 * PvE world object: a mission prop (generator, keycard, gate panel), a supply crate or a loot drop.
 * `kind`: a mission PropKind ("generator", "terminal", "intel"…), "supply", "ammo" or "health".
 */
export const PropState = schema(
  {
    kind: t.string().default(""),
    x: t.int16().default(0),
    y: t.int16().default(0),
    /** Can be used right now (mission step active, requirement met). */
    active: t.boolean().default(false),
    used: t.boolean().default(false),
    /** Hold progress 0..1 and who is holding (session id, "" = nobody). */
    prog: t.float32().default(0),
    by: t.string().default(""),
  },
  "PropState",
);
export type PropState = SchemaType<typeof PropState>;

/**
 * Real pose of a masked player, delivered only to the players allowed to see it (the player
 * themselves and their side): `MatchState.allies` is a filtered collection, every entry is added to
 * the StateView of exactly those clients. Prop Hunt: the disguise the player controls.
 */
export const AllyState = schema(
  {
    x: t.float32().default(0),
    y: t.float32().default(0),
    a: t.float32().default(0),
    /** Side of the player (ROLE.*), so a host's local state can draw only its own side. */
    t: t.uint8().default(0),
    /** Prop Hunt: id of the disguise entity in MatchState.disguises ("" = not disguised). */
    d: t.string().default(""),
    /** Prop Hunt: disguise kind index, -1 = none. Drives the prediction (radius, speed). */
    k: t.int8().default(-1),
    /** Prop Hunt: position and rotation locked. */
    lk: t.boolean().default(false),
    /** Prop Hunt: ticks at which quick transform, taunt and decoy are ready again. */
    cdT: t.uint32().default(0),
    cdS: t.uint32().default(0),
    cdD: t.uint32().default(0),
  },
  "AllyState",
);
export type AllyState = SchemaType<typeof AllyState>;

/**
 * Prop Hunt object. Real objects of the map and disguised players are the same kind of entity
 * with random ids regenerated every round: nothing on the wire says which is which. The collection
 * is filtered: hunters receive it only once the hunt starts.
 */
export const DisguiseState = schema(
  {
    /** DISGUISES index. */
    k: t.uint8().default(0),
    x: t.int16().default(0),
    y: t.int16().default(0),
    /** Rotation, angle * 256 / 2π. */
    r: t.uint8().default(0),
  },
  "DisguiseState",
);
export type DisguiseState = SchemaType<typeof DisguiseState>;

/** Approximate area shown to the seeking side (Prop Hunt hints). Never centered on the target. */
export const PingState = schema(
  {
    x: t.int16().default(0),
    y: t.int16().default(0),
    r: t.uint16().default(0),
    until: t.uint32().default(0),
  },
  "PingState",
);
export type PingState = SchemaType<typeof PingState>;

/** Round modes: current stage, its end, the round number and the variant. */
export const RoundState = schema(
  {
    /** "" | "prep" | "hunt" | "break" | "overtime" (RoundStage). */
    stage: t.string().default(""),
    /** Tick the stage ends at (0 = none). */
    end: t.uint32().default(0),
    num: t.uint8().default(0),
    of: t.uint8().default(0),
    variant: t.string().default(""),
    /** Blackout: the lights are out. */
    dark: t.boolean().default(false),
    /** Players on each side still in the round. */
    seekers: t.uint8().default(0),
    hiders: t.uint8().default(0),
    /** Side that won the last finished round (ROLE.*), 0 = none yet. */
    winner: t.uint8().default(0),
  },
  "RoundState",
);
export type RoundState = SchemaType<typeof RoundState>;

export const PVE_STATUS = { RUNNING: 0, COMPLETE: 1, FAILED: 2 } as const;

/** PvE match: mission progress, waves and world flags. */
export const PveState = schema(
  {
    /** Mission id (Outbreak) or "" (Survival). */
    mission: t.string().default(""),
    difficulty: t.string().default("veteran"),
    /** Current mission step index. */
    step: t.uint8().default(0),
    /** Step progress 0..1 (hold, extraction) and counters (collected / waves). */
    prog: t.float32().default(0),
    count: t.uint8().default(0),
    countMax: t.uint8().default(0),
    /** Current wave (1-based, 0 = none) and enemies of it still to defeat. */
    wave: t.uint16().default(0),
    left: t.uint16().default(0),
    /** Tick the next wave starts (intermission countdown), 0 = none pending. */
    nextWave: t.uint32().default(0),
    status: t.uint8().default(0),
    power: t.boolean().default(false),
    alarm: t.boolean().default(false),
    /** Open mission doors, comma separated (rarely changes). */
    doors: t.string().default(""),
    /** Mission flags set by props ("keycard"), comma separated. */
    flags: t.string().default(""),
    /** Solo: self-revives left. */
    selfRevives: t.uint8().default(0),
    kills: t.uint16().default(0),
    startTick: t.uint32().default(0),
    /** Boss enemy id ("" = none) for the boss health bar. */
    boss: t.string().default(""),
    /** Tick the security vents came online (0 = offline): every vent's cycle runs from it. */
    vents: t.uint32().default(0),
    /** Tick the current step must be done by (0 = no countdown); missing it fails the mission. */
    deadline: t.uint32().default(0),
  },
  "PveState",
);
export type PveState = SchemaType<typeof PveState>;

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
    drops: t.map(DropState),
    vehicles: t.map(VehicleState),
    /** Domination points ("A", "B", "C") or CTF flags ("1", "2"); empty in other modes. */
    objectives: t.map(ObjectiveState),
    /** Team modes: players per team (0 in free-for-all). */
    teamSize: t.uint8().default(0),
    friendlyFire: t.boolean().default(false),
    /** Team scores (eliminations of the other team). */
    scoreA: t.uint16().default(0),
    scoreB: t.uint16().default(0),
    /** Team that won the last match: 0 = none or draw. */
    winnerTeam: t.uint8().default(0),
    /** PvE (Outbreak, Survival): enemies, hazards, props and mission progress. */
    zombies: t.map(ZombieState),
    hazards: t.map(HazardState),
    props: t.map(PropState),
    pve: t.ref(PveState),
    /** Round modes (Hide & Seek, Prop Hunt): stage, timer, round number, variant. */
    round: t.ref(RoundState),
    /** Real poses of masked players, each visible only to that player's side (filtered). */
    allies: t.map(AllyState).view(),
    /** Prop Hunt objects (filtered: hunters receive them once the hunt starts). */
    disguises: t.map(DisguiseState).view(),
    /** Prop Hunt hints: approximate areas. */
    pings: t.map(PingState),
    /** Results: map ids offered for the next match, comma separated ("" = no vote). */
    voteMaps: t.string().default(""),
  },
  "MatchState",
);
export type MatchState = SchemaType<typeof MatchState>;
