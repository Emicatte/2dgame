import { randomUUID } from "node:crypto";
import { type Client, CloseCode, Room, ServerError } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  C2S,
  DEFAULT_MAP,
  DEFAULT_SKIN,
  decodeInput,
  GAME_MODES,
  type GameMode,
  hashString,
  type InputBatch,
  inputBatchSchema,
  isPveMode,
  isSkinUnlocked,
  joinOptionsSchema,
  kickSchema,
  loadoutSchema,
  MAPS,
  MATCH_DEFAULTS,
  type MapId,
  type MatchPhase,
  MatchState,
  MODE_NAMES,
  NET,
  type NoticeMessage,
  PickupState,
  PlayerState,
  PVE_SQUAD,
  type ResultsMessage,
  type RoomKind,
  type RoomMetadata,
  readySchema,
  S2C,
  SERVER_TICK_MS,
  settingsSchema,
  teamSchema,
  VEHICLE_KINDS,
  type VehicleKind,
  type WeaponId,
  type XpLine,
} from "@scrapline/shared";
import { z } from "zod";
import { BOT_NAMES, BotDriver } from "../bots/BotBrain.ts";
import { uniqueRoomCode } from "../matchmaking/roomCodes.ts";
import type { MatchPlayerResult } from "../persistence/repository.ts";
import { type ComputedResult, computeResults, personalResult, resultRows } from "../players/results.ts";
import { applyPveSettings, buildPveResults, pveOver } from "../pve/pveRoom.ts";
import { MatchRules } from "../rules/MatchRules.ts";
import { verifyToken } from "../security/tokens.ts";
import { getServices } from "../services.ts";
import { GameSimulation, type ServerPlayer } from "../simulation/GameSimulation.ts";
import { syncObjectives, syncPlayerState, syncPve, syncVehicles } from "../simulation/stateSync.ts";

interface AuthData {
  playerId: string;
  nickname: string;
  level: number;
  skin: string;
  primary: WeaponId;
  /** Preferred team (invite link); honored when it has room. */
  team?: number;
}

interface CreateOptions {
  kind?: RoomKind;
  map?: MapId;
  mode?: GameMode;
  /** Deterministic spawns for automated end-to-end tests; ignored unless debug routes are enabled. */
  debugSpawns?: unknown;
  /** Deterministic vehicle placement for end-to-end tests (same gate as debugSpawns). */
  debugVehicles?: unknown;
}

const debugSpawnsSchema = z
  .array(z.object({ x: z.number().min(0).max(10_000), y: z.number().min(0).max(10_000) }))
  .min(2)
  .max(16);

const debugVehiclesSchema = z
  .array(
    z.object({
      kind: z.enum(VEHICLE_KINDS as [VehicleKind, ...VehicleKind[]]),
      x: z.number().min(0).max(10_000),
      y: z.number().min(0).max(10_000),
      angle: z.number().min(-7).max(7),
    }),
  )
  .min(1)
  .max(12);

const pingSchema = z.object({ ms: z.number().int().min(0).max(5000) });

/** Application close codes (4000-4099 are reserved by Colyseus). */
const CLOSE_KICKED = 4101;
const CLOSE_INACTIVE = 4102;

/** Inputs older than this many seconds of silence during a live match get the player kicked as AFK. */
const AFK_KICK_SEC = 120;
/** Private lobbies with no state change for this long are closed. */
const IDLE_LOBBY_SEC = 30 * 60;

/**
 * One arena = one lobby + repeated deathmatches. The room orchestrates phases, validates every
 * client message and mirrors the authoritative GameSimulation into the synchronized state.
 */
export class ArenaRoom extends Room<{ state: MatchState; metadata: RoomMetadata }> {
  override maxClients: number = MATCH_DEFAULTS.maxPlayers;
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;
  override state = new MatchState();

  private sim!: GameSimulation;
  private rules!: MatchRules;
  private kind: RoomKind = "quick";
  private code = "";
  private readonly views = new Map<string, PlayerState>();
  private readonly lastInputTick = new Map<string, number>();
  private leavers: ComputedResult[] = [];
  private matchStartedAt: Date | null = null;
  private matchStartPlayers = 0;
  private lastActivityTick = 0;
  private persisting = false;
  /** Tick cost and interval statistics (ms), exposed on /api/debug/rooms. */
  private tickStats = { count: 0, total: 0, max: 0, maxInterval: 0 };
  private readonly replacedSessions = new Set<string>();
  /** Training targets present while a private room has a single human (solo practice). */
  private readonly bots = new Set<string>();
  private readonly botDriver = new BotDriver();
  private practiceMatch = false;

  override async onCreate(options: CreateOptions = {}) {
    const { log } = getServices();
    this.kind = options.kind === "private" ? "private" : "quick";
    const mapId: MapId = options.map && options.map in MAPS ? options.map : DEFAULT_MAP;
    this.code = await uniqueRoomCode();

    this.sim = new GameSimulation(MAPS[mapId], { tickRate: NET.serverTickRate });
    const { cfg } = getServices();
    if (cfg.ENABLE_DEBUG_ROUTES && options.debugSpawns) {
      const parsed = debugSpawnsSchema.safeParse(options.debugSpawns);
      if (parsed.success) this.sim.spawnOverride = parsed.data;
    }
    if (cfg.ENABLE_DEBUG_ROUTES && options.debugVehicles) {
      const parsed = debugVehiclesSchema.safeParse(options.debugVehicles);
      if (parsed.success) this.sim.setVehicleOverride(parsed.data.map((v, i) => ({ ...v, id: `dbg-${i}` })));
    }
    Object.assign(this.state, {
      phase: "lobby",
      mode: "deathmatch",
      roomKind: this.kind,
      code: this.code,
      mapId,
      durationSec: MATCH_DEFAULTS.durationSec,
      killLimit: MATCH_DEFAULTS.killLimit,
      maxPlayers: MATCH_DEFAULTS.maxPlayers,
      tickRate: NET.serverTickRate,
    });
    this.rules = new MatchRules(this.sim, this.state, (id) => this.bots.has(id));
    let mode: GameMode = options.mode && GAME_MODES.includes(options.mode) ? options.mode : "deathmatch";
    // Co-op PvE runs in private rooms only (a squad of friends), never through quick matchmaking.
    if (this.kind === "quick" && isPveMode(mode)) mode = "deathmatch";
    this.rules.setMode(mode);
    this.enforceModeMap();
    this.maxClients = this.state.maxPlayers;
    this.syncPickups(true);

    if (this.kind === "private") await this.setPrivate(true);

    // Elapsed time is measured here rather than taken from the room clock: setting patchRate to
    // null before a timestep exists makes Colyseus tick the clock from an extra 60 Hz interval,
    // so its deltaTime under-reports the real tick interval (the v0.1.0 "pending 190" bug).
    let last = performance.now();
    this.setTimestep(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      this.onTick(elapsed);
      const cost = performance.now() - now;
      this.tickStats.count += 1;
      this.tickStats.total += cost;
      this.tickStats.max = Math.max(this.tickStats.max, cost);
      this.tickStats.maxInterval = Math.max(this.tickStats.maxInterval, elapsed);
    }, SERVER_TICK_MS);
    // Exactly one patch per simulation tick: snapshots carry the tick number used for interpolation.
    // Set after setTimestep so Colyseus does not start its own 60 Hz clock interval.
    this.patchRate = null;

    this.onMessage(C2S.INPUT, inputBatchSchema, (client, msg) => this.handleInput(client, msg));
    this.onMessage(C2S.READY, readySchema, (client, msg) => this.handleReady(client, msg.ready));
    this.onMessage(C2S.SETTINGS, settingsSchema, (client, msg) => this.handleSettings(client, msg));
    this.onMessage(C2S.START, (client) => this.handleStart(client));
    this.onMessage(C2S.LOADOUT, loadoutSchema, (client, msg) => this.handleLoadout(client, msg));
    this.onMessage(C2S.KICK, kickSchema, (client, msg) => this.handleKick(client, msg.id));
    this.onMessage(C2S.TEAM, teamSchema, (client, msg) => this.handleTeam(client, msg.team));
    this.onMessage(C2S.BALANCE, (client) => this.handleBalance(client));
    this.onMessage("ping", pingSchema, (client, msg) => {
      const ps = this.state.players.get(client.sessionId);
      if (ps) ps.ping = msg.ms;
    });

    await this.updateMetadata();
    log.info({ roomId: this.roomId, code: this.code, kind: this.kind }, "room created");
  }

  /**
   * Runs during the matchmaking HTTP request, before any room is created or a seat reserved. With
   * the instance-level onAuth of v0.1.0 an unauthenticated POST /matchmake/create created a real
   * room (20 Hz timer, room code) that lived until the seat reservation expired.
   */
  static override async onAuth(_token: string | undefined, rawOptions: unknown): Promise<AuthData> {
    const { cfg, repo } = getServices();
    const parsed = joinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) throw new ServerError(400, "invalid join options");
    const payload = verifyToken(parsed.data.token, cfg.tokenSecret);
    if (!payload) throw new ServerError(401, "invalid identity token");
    const record = await repo.getPlayer(payload.sub);
    if (!record) throw new ServerError(401, "unknown player");
    const skin = isSkinUnlocked(parsed.data.skin, record.level) ? parsed.data.skin : DEFAULT_SKIN;
    return {
      playerId: record.id,
      nickname: record.nickname,
      level: record.level,
      skin,
      primary: parsed.data.primary,
      ...(parsed.data.team ? { team: parsed.data.team } : {}),
    };
  }

  override onJoin(client: Client, _options: unknown, auth: AuthData) {
    // Same identity twice in one room (second tab, replayed seat): refuse before any state change.
    for (const existing of this.sim.players.values()) {
      if (existing.playerId === auth.playerId) throw new ServerError(409, "already in this room");
    }
    if (this.rules.teamMode) {
      const c = this.rules.counts();
      if (c[1] + c[2] >= this.state.teamSize * 2) throw new ServerError(409, "room full");
    }
    const p = this.sim.addPlayer({
      id: client.sessionId,
      playerId: auth.playerId,
      name: auth.nickname,
      skin: auth.skin,
      level: auth.level,
      primary: auth.primary,
      seed: hashString(client.sessionId),
    });
    this.rules.assign(client.sessionId, auth.team);
    const ps = new PlayerState();
    Object.assign(ps, {
      name: auth.nickname,
      skin: auth.skin,
      level: auth.level,
      primary: auth.primary,
      connected: true,
      joinedAt: this.state.tick,
      team: p.team,
    });
    this.state.players.set(client.sessionId, ps);
    this.views.set(client.sessionId, ps);
    client.view = new StateView();
    client.view.add(ps);

    if (!this.state.hostId || !this.state.players.has(this.state.hostId))
      this.state.hostId = client.sessionId;
    if (this.state.phase === "playing" && this.sim.pve) {
      this.sim.pve.lateJoin(p);
      this.notice("You join the squad at the next checkpoint", "info", client);
    } else if (this.state.phase === "countdown" || this.state.phase === "playing") this.sim.spawnLater(p, 1);
    this.lastInputTick.set(client.sessionId, this.state.tick);
    this.touchActivity();
    this.notice(`${auth.nickname} joined`, "info", client);
    this.syncPracticeTargets();
    void this.updateMetadata();
  }

  /**
   * A reconnect that presents the token of a still-connected client (the server has not yet
   * noticed that the old socket is dead, e.g. after a Wi-Fi to mobile switch) makes Colyseus close
   * the old connection with WITH_ERROR. Remember it, so onDrop holds the seat for the new
   * connection instead of treating it as a protocol violation (v0.1.0 kicked the player).
   */
  override checkReconnectionToken(reconnectionToken: string): string {
    const live = this.clients.find((c) => c.reconnectionToken === reconnectionToken);
    if (live) this.replacedSessions.add(live.sessionId);
    return super.checkReconnectionToken(reconnectionToken);
  }

  override onDrop(client: Client, code?: number) {
    const replaced = this.replacedSessions.delete(client.sessionId);
    // Protocol violations (malformed messages, flooding) are not network drops: no seat is held.
    if (code === CloseCode.WITH_ERROR && !replaced) return;
    const ps = this.state.players.get(client.sessionId);
    const p = this.sim.players.get(client.sessionId);
    if (ps) ps.connected = false;
    if (p) p.connected = false;
    try {
      const pending = this.allowReconnection(client, NET.reconnectSeconds) as unknown as Promise<unknown>;
      // Rejected when the seat expires or the room shuts down: both are normal outcomes.
      pending?.catch?.(() => undefined);
    } catch {
      // Room is disposing: no seat to hold.
    }
  }

  override onReconnect(client: Client) {
    const ps = this.state.players.get(client.sessionId);
    const p = this.sim.players.get(client.sessionId);
    if (ps) ps.connected = true;
    if (p) p.connected = true;
    // The client may have reloaded the page and restarted its input sequence. The ack is reset
    // now, not at the next tick, so no snapshot can carry the previous stream's ack.
    this.sim.resetInputStream(client.sessionId);
    if (ps) ps.ack = 0;
    if (ps && client.view && !client.view.has?.(ps)) client.view.add(ps);
    this.lastInputTick.set(client.sessionId, this.state.tick);
  }

  override onLeave(client: Client) {
    const p = this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.views.delete(client.sessionId);
    this.lastInputTick.delete(client.sessionId);
    // PvE runs are never recorded as PvP matches (zombie kills must not reach PvP stats).
    if (p && this.state.phase === "playing" && !this.rules.pveMode) {
      const [r] = computeResults([p], {
        tickRate: NET.serverTickRate,
        minParticipationTicks: 1,
        completed: false,
      });
      if (r && (r.player.stats.activeTicks > NET.serverTickRate * 10 || r.player.stats.kills > 0)) {
        r.placement = 0;
        r.persist.placement = 0;
        this.leavers.push(r);
      }
    }
    if (this.state.hostId === client.sessionId) {
      const next = [...this.state.players.keys()].find((id) => !this.bots.has(id));
      this.state.hostId = next ?? "";
      const host = this.state.players.get(this.state.hostId);
      if (host) this.notice(`${host.name} is now the host`, "info");
    }
    if (p) {
      this.notice(`${p.name} left`, "warn");
      // Input pipeline summary per session: the production signal for netcode problems.
      getServices().log.info(
        { roomId: this.roomId, sessionId: client.sessionId, inputs: p.inputStats },
        "player left",
      );
    }
    if (this.state.phase === "playing" && this.kind === "quick" && this.matchStartPlayers >= 2) {
      const c = this.rules.counts();
      const oneSided = this.rules.teamMode && (c[1] === 0 || c[2] === 0);
      if (this.sim.players.size < 2 || oneSided) this.endMatch("opponents-left");
    }
    this.syncPracticeTargets();
    void this.updateMetadata();
  }

  override async onDispose() {
    // Everybody left during a match: still record what the leavers earned.
    if (this.leavers.length > 0 && this.matchStartedAt && !this.persisting) {
      await this.persistMatch([], "abandoned").catch(() => undefined);
    }
    getServices().log.info({ roomId: this.roomId, code: this.code }, "room disposed");
  }

  override onUncaughtException(error: Error, methodName: string) {
    getServices().log.error({ err: error, methodName, roomId: this.roomId }, "room exception");
  }

  /** Diagnostics for /api/debug/rooms (debug builds only). */
  debugSnapshot() {
    return {
      roomId: this.roomId,
      code: this.code,
      phase: this.state.phase,
      tick: this.sim.tick,
      tickCostMs: {
        avg: this.tickStats.count
          ? Math.round((this.tickStats.total / this.tickStats.count) * 1000) / 1000
          : 0,
        max: Math.round(this.tickStats.max * 1000) / 1000,
        maxIntervalMs: Math.round(this.tickStats.maxInterval * 10) / 10,
      },
      players: [...this.sim.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        queue: p.queue.length,
        credit: Math.round(p.credit * 100) / 100,
        lastQueuedSeq: p.lastQueuedSeq,
        lastProcessedSeq: p.lastProcessedSeq,
        inputs: { ...p.inputStats },
        alive: p.alive,
        x: Math.round(p.sim.x),
        y: Math.round(p.sim.y),
      })),
    };
  }

  // ---------------------------------------------------------------- messages

  private handleInput(client: Client, msg: InputBatch) {
    const phase = this.state.phase as MatchPhase;
    if (phase !== "countdown" && phase !== "playing") return;
    const frames = msg.i.map(decodeInput);
    const { dropped } = this.sim.enqueue(client.sessionId, frames);
    this.lastInputTick.set(client.sessionId, this.state.tick);
    if (dropped > 0) getServices().log.debug({ sessionId: client.sessionId, dropped }, "inputs dropped");
  }

  private handleReady(client: Client, ready: boolean) {
    const ps = this.state.players.get(client.sessionId);
    if (!ps) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
    ps.ready = ready;
    this.touchActivity();
  }

  private handleSettings(client: Client, s: z.infer<typeof settingsSchema>) {
    if (client.sessionId !== this.state.hostId || this.kind !== "private") return;
    if (this.state.phase !== "lobby") return;
    // Mode first: it resets length, score limit and size to the mode's defaults.
    if (
      s.mode &&
      s.mode !== this.state.mode &&
      isPveMode(s.mode) &&
      this.rules.humans().length > PVE_SQUAD.max
    ) {
      this.notice(`Co-op is for up to ${PVE_SQUAD.max} players`, "warn", undefined, client);
      return;
    }
    if (s.mode && s.mode !== this.state.mode) {
      this.rules.setMode(s.mode);
      this.applyCapacity();
      this.enforceModeMap();
      this.syncPracticeTargets();
    }
    if (this.rules.pveMode) {
      const r = applyPveSettings(this.state, s);
      if (r.map) this.enforceModeMap();
      if (r.error) this.notice(r.error, "warn", undefined, client);
    }
    if (s.teamSize && this.rules.teamMode && s.teamSize !== this.state.teamSize) {
      if (this.rules.setTeamSize(s.teamSize)) this.applyCapacity();
      else this.notice("Too many players in the room for that team size", "warn", undefined, client);
    }
    if (s.friendlyFire !== undefined && this.rules.teamMode) this.rules.setFriendlyFire(s.friendlyFire);
    if (s.map && s.map !== this.state.mapId) {
      if (this.rules.mapAllowed(s.map)) {
        this.state.mapId = s.map;
        this.sim.setMap(MAPS[s.map]);
        this.syncPickups(true);
      } else {
        this.notice(
          `${MODE_NAMES[this.state.mode as GameMode]} needs a map with vehicles`,
          "warn",
          undefined,
          client,
        );
      }
    }
    // Co-op has no length, score limit or room size to choose (1–4 players, as in host mode).
    if (!this.rules.pveMode) {
      if (s.durationSec) this.state.durationSec = s.durationSec;
      if (s.killLimit) this.state.killLimit = s.killLimit;
      if (s.maxPlayers && !this.rules.teamMode) {
        this.state.maxPlayers = s.maxPlayers;
        this.applyCapacity();
      }
    }
    this.touchActivity();
    void this.updateMetadata();
  }

  /** Vehicle Mayhem moves the room to a vehicle map. */
  private enforceModeMap() {
    const forced = MatchRules.mapForMode(this.state.mode, this.state.mapId as MapId, this.state.pve.mission);
    if (!forced) return;
    this.state.mapId = forced;
    this.sim.setMap(MAPS[forced]);
    this.syncPickups(true);
  }

  /** Room capacity follows the settings, never below the players already present. */
  private applyCapacity() {
    const n = Math.max(this.state.maxPlayers, this.clients.length);
    this.state.maxPlayers = n;
    this.maxClients = n;
    void this.setMatchmaking({ maxClients: n });
  }

  private handleTeam(client: Client, team: number) {
    if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
    if (!this.rules.teamMode) return;
    if (this.rules.switchTeam(client.sessionId, team)) this.touchActivity();
    else this.notice("That team is full", "warn", undefined, client);
  }

  private handleBalance(client: Client) {
    if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby" || !this.rules.teamMode)
      return;
    this.rules.balance();
    this.notice("Teams balanced by level", "info");
    this.touchActivity();
  }

  private handleStart(client: Client) {
    if (client.sessionId !== this.state.hostId || this.kind !== "private") return;
    if (this.state.phase !== "lobby") return;
    const notReady = [...this.state.players.entries()].filter(
      ([id, p]) => id !== this.state.hostId && !p.ready,
    );
    if (notReady.length > 0) {
      this.notice(`Waiting for: ${notReady.map(([, p]) => p.name).join(", ")}`, "warn", undefined, client);
      return;
    }
    this.startCountdown();
  }

  private handleLoadout(client: Client, msg: { primary: WeaponId; skin: string }) {
    const p = this.sim.players.get(client.sessionId);
    const ps = this.state.players.get(client.sessionId);
    if (!p || !ps) return;
    p.primary = msg.primary;
    ps.primary = msg.primary;
    if (isSkinUnlocked(msg.skin, p.level)) {
      p.skin = msg.skin;
      ps.skin = msg.skin;
    }
  }

  private handleKick(client: Client, targetId: string) {
    if (client.sessionId !== this.state.hostId || targetId === client.sessionId) return;
    if (!this.state.players.has(targetId)) return;
    this.kickClient(targetId, CLOSE_KICKED, "kicked by host");
  }

  // ---------------------------------------------------------------- loop

  private onTick(elapsedMs: number) {
    const phase = this.state.phase as MatchPhase;
    if (phase === "countdown" || phase === "playing") {
      this.driveBots();
      const events = this.sim.step(elapsedMs, phase === "playing" ? "live" : "frozen");
      if (events.length > 0) this.broadcast(S2C.EVENTS, events);
    } else {
      this.sim.tick += 1;
    }
    const tick = this.sim.tick;
    this.state.tick = tick;
    this.state.firstBloodDone = this.sim.firstBloodDone;

    switch (phase) {
      case "lobby":
        this.updateLobby(tick);
        break;
      case "countdown":
        if (tick >= this.state.phaseEndTick) this.startPlaying();
        break;
      case "playing":
        if (this.rules.pveMode) {
          if (pveOver(this.sim)) this.endMatch("pve");
          else if (tick >= this.state.phaseEndTick) this.endMatch("time");
          else this.kickIdle(tick);
        } else if (this.sim.leaderScore() >= this.state.killLimit) this.endMatch("score-limit");
        else if (tick >= this.state.phaseEndTick) this.endMatch("time");
        else this.kickIdle(tick);
        break;
      case "results":
        if (tick >= this.state.phaseEndTick) this.backToLobby();
        break;
    }

    this.syncState();
    this.broadcastPatch();
  }

  private updateLobby(tick: number) {
    const count = this.state.players.size;
    if (this.kind === "quick") {
      if (count >= MATCH_DEFAULTS.minPlayers) {
        const allReady = [...this.state.players.values()].every((p) => p.ready);
        const target = allReady
          ? tick + this.sim.secToTicks(3)
          : tick + this.sim.secToTicks(MATCH_DEFAULTS.quickMatchAutoStartSec);
        if (this.state.phaseEndTick === 0 || (allReady && target < this.state.phaseEndTick)) {
          this.state.phaseEndTick = target;
        }
        if (tick >= this.state.phaseEndTick) this.startCountdown();
      } else {
        this.state.phaseEndTick = 0;
      }
    } else if (tick - this.lastActivityTick > this.sim.secToTicks(IDLE_LOBBY_SEC)) {
      getServices().log.info({ roomId: this.roomId }, "closing idle private lobby");
      void this.disconnect();
    }
  }

  private startCountdown() {
    this.syncPracticeTargets();
    this.practiceMatch = this.bots.size > 0;
    this.rules.prepareMatch();
    this.sim.setPve(this.rules.pveConfig());
    this.sim.resetForMatch();
    this.state.winnerTeam = 0;
    this.leavers = [];
    this.state.phase = "countdown";
    this.state.winnerId = "";
    this.state.matchIndex += 1;
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(MATCH_DEFAULTS.countdownSec);
    for (const ps of this.state.players.values()) ps.ready = false;
    for (const id of this.lastInputTick.keys()) this.lastInputTick.set(id, this.sim.tick);
    this.syncPickups(true);
    void this.updateMetadata();
  }

  private startPlaying() {
    this.state.phase = "playing";
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(this.state.durationSec);
    this.matchStartedAt = new Date();
    this.matchStartPlayers = this.sim.players.size;
    void this.updateMetadata();
  }

  private endMatch(reason: string) {
    if (this.state.phase !== "playing") return;
    this.state.phase = "results";
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(MATCH_DEFAULTS.resultsSec);
    const standings = this.sim.standings();
    this.state.winnerId = standings[0]?.id ?? "";
    this.state.winnerTeam = this.sim.winningTeam();
    this.rules.sync();
    void this.updateMetadata();
    if (this.sim.pve) {
      if (reason === "time") this.sim.pve.abort("Time limit reached");
      syncPve(this.state, this.sim);
      this.sendPveResults();
      return;
    }
    void this.persistMatch(standings, reason);
  }

  /**
   * PvE results. The dedicated server does not persist PvE runs yet (host mode records them in
   * each player's browser): XP is shown, `persisted` stays false.
   */
  private sendPveResults() {
    const runId = randomUUID();
    const res = buildPveResults(this.sim, runId, this.sim.secToTicks(MATCH_DEFAULTS.minParticipationSec));
    for (const client of this.clients) {
      const msg: ResultsMessage = {
        winnerId: "",
        rows: res.rows,
        pve: res.pve,
        personal: res.personal.get(client.sessionId) ?? null,
      };
      client.send(S2C.RESULTS, msg);
    }
  }

  private backToLobby() {
    this.state.phase = "lobby";
    this.state.phaseEndTick = 0;
    this.matchStartedAt = null;
    this.sim.setPve(null);
    for (const p of this.sim.players.values()) {
      p.alive = false;
      p.respawnTick = 0;
    }
    this.touchActivity();
    void this.updateMetadata();
  }

  private kickIdle(tick: number) {
    const limit = this.sim.secToTicks(AFK_KICK_SEC);
    for (const [id, last] of this.lastInputTick) {
      const p = this.sim.players.get(id);
      if (p?.connected && tick - last > limit) {
        this.lastInputTick.set(id, tick);
        this.kickClient(id, CLOSE_INACTIVE, "inactive");
      }
    }
  }

  // ---------------------------------------------------------------- practice targets

  /**
   * Solo players in a private room get three practice bots that play like people, so the arena
   * is playable alone. Targets disappear as soon as a second human joins. Practice matches never
   * award XP or touch persistent stats (nothing to farm).
   */
  private syncPracticeTargets() {
    const humans = this.clients.length;
    const solo = this.kind === "private" && humans === 1 && !this.rules.pveMode;
    const wanted = solo && this.state.phase === "lobby" ? 3 : 0;
    const keep = solo && this.state.phase !== "lobby";
    if (wanted > 0 && this.bots.size === 0) {
      for (let i = 1; i <= wanted; i++) {
        const id = `bot:${i}`;
        this.sim.addPlayer({
          id,
          playerId: "",
          name: BOT_NAMES[i - 1] ?? `Bot ${i}`,
          skin: "ash",
          level: 1,
          primary: "rifle",
          seed: hashString(id),
        });
        this.bots.add(id);
        this.rules.assign(id);
        const ps = new PlayerState();
        Object.assign(ps, {
          name: BOT_NAMES[i - 1] ?? `Bot ${i}`,
          skin: "ash",
          level: 1,
          primary: "rifle",
          connected: true,
          ready: true,
        });
        this.state.players.set(id, ps);
        this.views.set(id, ps);
      }
    } else if (wanted === 0 && !keep && this.bots.size > 0) {
      for (const id of this.bots) {
        this.sim.removePlayer(id);
        this.state.players.delete(id);
        this.views.delete(id);
      }
      this.bots.clear();
      this.botDriver.clear();
    }
  }

  /** Practice bots play like people (see BotBrain): they move, take cover and shoot back. */
  private driveBots() {
    if (this.bots.size > 0) this.botDriver.drive(this.sim, this.bots);
  }

  private sendPracticeResults(standings: ServerPlayer[]) {
    const results = computeResults(standings, {
      tickRate: NET.serverTickRate,
      minParticipationTicks: Number.MAX_SAFE_INTEGER,
      completed: false,
    });
    const rows = resultRows(results);
    const team = this.teamResult();
    for (const r of results) {
      const client = this.clients.getById(r.player.id);
      if (!client) continue;
      client.send(S2C.RESULTS, {
        winnerId: this.state.winnerId,
        ...team,
        rows,
        personal: {
          placement: r.placement,
          xpGained: 0,
          xpLines: [],
          totalXp: null,
          level: null,
          leveledUp: false,
          unlocked: [],
          persisted: false,
          practice: true,
        },
      } satisfies ResultsMessage);
    }
  }

  // ---------------------------------------------------------------- persistence

  private async persistMatch(standings: ServerPlayer[], reason: string) {
    const { repo, log } = getServices();
    if (this.practiceMatch) {
      this.sendPracticeResults(standings);
      return;
    }
    this.persisting = true;
    const results = computeResults(standings, {
      tickRate: NET.serverTickRate,
      minParticipationTicks: this.sim.secToTicks(MATCH_DEFAULTS.minParticipationSec),
      completed: reason !== "abandoned",
      ...(this.rules.teamMode ? { winnerTeam: this.state.winnerTeam } : {}),
    });
    const rows = resultRows(results);
    const winnerId = this.state.winnerId;
    const all: MatchPlayerResult[] = [
      ...results.map((r) => r.persist),
      ...this.leavers.map((l) => l.persist),
    ];
    const before = new Map<string, { xp: number }>();
    let updated = new Map<string, { xp: number; level: number; challengeRewards?: XpLine[] }>();
    try {
      for (const r of results) {
        const rec = await repo.getPlayer(r.player.playerId);
        if (rec) before.set(rec.id, { xp: rec.xp });
      }
      if (all.length > 0) {
        updated = await repo.recordMatch({
          id: randomUUID(),
          roomId: this.roomId,
          mapId: this.state.mapId,
          mode: this.state.mode,
          roomKind: this.kind,
          startedAt: this.matchStartedAt ?? new Date(),
          endedAt: new Date(),
          winnerPlayerId: results.find((r) => r.won)?.player.playerId ?? null,
          endReason: reason,
          players: all,
        });
      }
    } catch (err) {
      log.error({ err, roomId: this.roomId }, "failed to persist match");
    } finally {
      this.persisting = false;
      this.leavers = [];
    }

    for (const r of results) {
      const after = updated.get(r.player.playerId) ?? null;
      const ps = this.state.players.get(r.player.id);
      if (after) {
        r.player.level = after.level;
        if (ps) ps.level = after.level;
      }
      const client = this.clients.getById(r.player.id);
      if (!client) continue;
      const msg: ResultsMessage = {
        winnerId,
        ...this.teamResult(),
        rows,
        personal: personalResult(r, before.get(r.player.playerId) ?? null, after),
      };
      client.send(S2C.RESULTS, msg);
    }
  }

  // ---------------------------------------------------------------- state mirroring

  private syncState() {
    for (const [id, p] of this.sim.players) {
      const ps = this.views.get(id);
      if (ps) syncPlayerState(ps, p, this.sim.tick);
    }
    this.rules.sync();
    this.syncPickups(false);
    syncVehicles(this.state, this.sim);
    syncObjectives(this.state, this.sim);
    syncPve(this.state, this.sim);
  }

  /** Team modes: winner and final scores for the results message. */
  private teamResult(): Pick<ResultsMessage, "winnerTeam" | "teamScores"> {
    if (!this.rules.teamMode) return {};
    return {
      winnerTeam: this.state.winnerTeam,
      teamScores: [this.sim.teamScores[1], this.sim.teamScores[2]],
    };
  }

  private syncPickups(rebuild: boolean) {
    if (rebuild) {
      this.state.pickups.clear();
      for (const id of this.sim.pickups.keys()) this.state.pickups.set(id, new PickupState());
    }
    for (const [id, pk] of this.sim.pickups) {
      const st = this.state.pickups.get(id);
      if (st) st.active = pk.active;
    }
  }

  private touchActivity() {
    this.lastActivityTick = this.sim.tick;
  }

  private notice(text: string, tone: NoticeMessage["tone"], except?: Client, only?: Client) {
    const msg: NoticeMessage = { text, tone };
    if (only) only.send(S2C.NOTICE, msg);
    else this.broadcast(S2C.NOTICE, msg, except ? { except } : undefined);
  }

  private async updateMetadata() {
    const host = this.state.players.get(this.state.hostId);
    try {
      await this.setMetadata({
        code: this.code,
        kind: this.kind,
        mode: this.state.mode as GameMode,
        map: this.state.mapId as MapId,
        phase: this.state.phase as MatchPhase,
        players: this.clients.length,
        maxPlayers: this.maxClients,
        hostName: host?.name ?? "",
      });
    } catch (err) {
      getServices().log.warn({ err }, "metadata update failed");
    }
  }
}
