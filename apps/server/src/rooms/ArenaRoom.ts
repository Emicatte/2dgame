import { randomUUID } from "node:crypto";
import { type Client, CloseCode, Room, ServerError } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  C2S,
  DEFAULT_MAP,
  DEFAULT_SKIN,
  decodeInput,
  hashString,
  type InputBatch,
  inputBatchSchema,
  isSkinUnlocked,
  joinOptionsSchema,
  kickSchema,
  loadoutSchema,
  MAPS,
  MATCH_DEFAULTS,
  type MapId,
  type MatchPhase,
  MatchState,
  NET,
  NO_WEAPON,
  type NoticeMessage,
  PickupState,
  PlayerState,
  type ResultsMessage,
  type RoomKind,
  type RoomMetadata,
  readySchema,
  S2C,
  SERVER_TICK_MS,
  settingsSchema,
  type WeaponId,
} from "@scrapline/shared";
import { z } from "zod";
import { uniqueRoomCode } from "../matchmaking/roomCodes.ts";
import type { MatchPlayerResult } from "../persistence/repository.ts";
import { type ComputedResult, computeResults, personalResult, resultRows } from "../players/results.ts";
import { verifyToken } from "../security/tokens.ts";
import { getServices } from "../services.ts";
import { GameSimulation, type ServerPlayer } from "../simulation/GameSimulation.ts";

interface AuthData {
  playerId: string;
  nickname: string;
  level: number;
  skin: string;
  primary: WeaponId;
}

interface CreateOptions {
  kind?: RoomKind;
  map?: MapId;
  /** Deterministic spawns for automated end-to-end tests; ignored unless debug routes are enabled. */
  debugSpawns?: unknown;
}

const debugSpawnsSchema = z
  .array(z.object({ x: z.number().min(0).max(10_000), y: z.number().min(0).max(10_000) }))
  .min(2)
  .max(16);

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
  private kind: RoomKind = "quick";
  private code = "";
  private readonly views = new Map<string, PlayerState>();
  private readonly lastInputTick = new Map<string, number>();
  private leavers: ComputedResult[] = [];
  private matchStartedAt: Date | null = null;
  private matchStartPlayers = 0;
  private lastActivityTick = 0;
  private persisting = false;
  /** Training targets present while a private room has a single human (solo practice). */
  private readonly bots = new Set<string>();
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
    this.syncPickups(true);

    if (this.kind === "private") await this.setPrivate(true);

    // Exactly one patch per simulation tick: snapshots carry the tick number used for interpolation.
    this.patchRate = null;
    // Elapsed time is measured here: the room clock's deltaTime is shared with other timers and
    // under-reports the real interval, which would throttle input processing below real time.
    let last = performance.now();
    this.setTimestep(() => {
      const now = performance.now();
      const elapsed = now - last;
      last = now;
      this.onTick(elapsed);
    }, SERVER_TICK_MS);

    this.onMessage(C2S.INPUT, inputBatchSchema, (client, msg) => this.handleInput(client, msg));
    this.onMessage(C2S.READY, readySchema, (client, msg) => this.handleReady(client, msg.ready));
    this.onMessage(C2S.SETTINGS, settingsSchema, (client, msg) => this.handleSettings(client, msg));
    this.onMessage(C2S.START, (client) => this.handleStart(client));
    this.onMessage(C2S.LOADOUT, loadoutSchema, (client, msg) => this.handleLoadout(client, msg));
    this.onMessage(C2S.KICK, kickSchema, (client, msg) => this.handleKick(client, msg.id));
    this.onMessage("ping", pingSchema, (client, msg) => {
      const ps = this.state.players.get(client.sessionId);
      if (ps) ps.ping = msg.ms;
    });

    await this.updateMetadata();
    log.info({ roomId: this.roomId, code: this.code, kind: this.kind }, "room created");
  }

  override async onAuth(_client: Client, rawOptions: unknown): Promise<AuthData> {
    const { cfg, repo } = getServices();
    const parsed = joinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) throw new ServerError(400, "invalid join options");
    const payload = verifyToken(parsed.data.token, cfg.tokenSecret);
    if (!payload) throw new ServerError(401, "invalid identity token");
    const record = await repo.getPlayer(payload.sub);
    if (!record) throw new ServerError(401, "unknown player");
    const skin = isSkinUnlocked(parsed.data.skin, record.level) ? parsed.data.skin : DEFAULT_SKIN;
    for (const p of this.sim.players.values()) {
      if (p.playerId === record.id) throw new ServerError(409, "already in this room");
    }
    return {
      playerId: record.id,
      nickname: record.nickname,
      level: record.level,
      skin,
      primary: parsed.data.primary,
    };
  }

  override onJoin(client: Client, _options: unknown, auth: AuthData) {
    const p = this.sim.addPlayer({
      id: client.sessionId,
      playerId: auth.playerId,
      name: auth.nickname,
      skin: auth.skin,
      level: auth.level,
      primary: auth.primary,
      seed: hashString(client.sessionId),
    });
    const ps = new PlayerState();
    Object.assign(ps, {
      name: auth.nickname,
      skin: auth.skin,
      level: auth.level,
      primary: auth.primary,
      connected: true,
      joinedAt: this.state.tick,
    });
    this.state.players.set(client.sessionId, ps);
    this.views.set(client.sessionId, ps);
    client.view = new StateView();
    client.view.add(ps);

    if (!this.state.hostId || !this.state.players.has(this.state.hostId))
      this.state.hostId = client.sessionId;
    if (this.state.phase === "countdown" || this.state.phase === "playing") this.sim.spawnLater(p, 1);
    this.lastInputTick.set(client.sessionId, this.state.tick);
    this.touchActivity();
    this.notice(`${auth.nickname} joined`, "info", client);
    this.syncPracticeTargets();
    void this.updateMetadata();
  }

  override onDrop(client: Client, code?: number) {
    // Protocol violations (malformed messages) are not network drops: no seat is held.
    if (code === CloseCode.WITH_ERROR) return;
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
    // The client may have reloaded the page and restarted its input sequence.
    this.sim.resetInputStream(client.sessionId);
    if (ps && client.view && !client.view.has?.(ps)) client.view.add(ps);
    this.lastInputTick.set(client.sessionId, this.state.tick);
  }

  override onLeave(client: Client) {
    const p = this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.views.delete(client.sessionId);
    this.lastInputTick.delete(client.sessionId);
    if (p && this.state.phase === "playing") {
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
    if (p) this.notice(`${p.name} left`, "warn");
    if (
      this.state.phase === "playing" &&
      this.kind === "quick" &&
      this.matchStartPlayers >= 2 &&
      this.sim.players.size < 2
    ) {
      this.endMatch("opponents-left");
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
      players: [...this.sim.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        queue: p.queue.length,
        credit: Math.round(p.credit * 100) / 100,
        lastQueuedSeq: p.lastQueuedSeq,
        lastProcessedSeq: p.lastProcessedSeq,
        droppedInputs: p.droppedInputs,
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
    if (s.map && s.map !== this.state.mapId) {
      this.state.mapId = s.map;
      this.sim.setMap(MAPS[s.map]);
      this.syncPickups(true);
    }
    if (s.durationSec) this.state.durationSec = s.durationSec;
    if (s.killLimit) this.state.killLimit = s.killLimit;
    if (s.maxPlayers) {
      const n = Math.max(s.maxPlayers, this.clients.length);
      this.state.maxPlayers = n;
      this.maxClients = n;
      void this.setMatchmaking({ maxClients: n });
    }
    this.touchActivity();
    void this.updateMetadata();
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
        if (this.sim.leaderKills() >= this.state.killLimit) this.endMatch("kill-limit");
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
    this.sim.resetForMatch();
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
    void this.updateMetadata();
    void this.persistMatch(standings, reason);
  }

  private backToLobby() {
    this.state.phase = "lobby";
    this.state.phaseEndTick = 0;
    this.matchStartedAt = null;
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
   * Solo players in a private room get three strafing training targets, so the arena is
   * playable alone. Targets disappear as soon as a second human joins. Practice matches never
   * award XP or touch persistent stats (nothing to farm).
   */
  private syncPracticeTargets() {
    const humans = this.clients.length;
    const wanted = this.kind === "private" && humans === 1 && this.state.phase === "lobby" ? 3 : 0;
    const keep = this.kind === "private" && humans === 1 && this.state.phase !== "lobby";
    if (wanted > 0 && this.bots.size === 0) {
      for (let i = 1; i <= wanted; i++) {
        const id = `bot:${i}`;
        this.sim.addPlayer({
          id,
          playerId: "",
          name: `Target ${i}`,
          skin: "ash",
          level: 1,
          primary: "rifle",
          seed: hashString(id),
        });
        const ps = new PlayerState();
        Object.assign(ps, {
          name: `Target ${i}`,
          skin: "ash",
          level: 1,
          primary: "rifle",
          connected: true,
          ready: true,
        });
        this.state.players.set(id, ps);
        this.views.set(id, ps);
        this.bots.add(id);
      }
    } else if (wanted === 0 && !keep && this.bots.size > 0) {
      for (const id of this.bots) {
        this.sim.removePlayer(id);
        this.state.players.delete(id);
        this.views.delete(id);
      }
      this.bots.clear();
    }
  }

  private botSeq = 0;

  /** Targets strafe on a slow deterministic pattern and never shoot back. */
  private driveBots() {
    if (this.bots.size === 0) return;
    let k = 0;
    for (const id of this.bots) {
      k++;
      const phase = Math.floor((this.sim.tick + k * 13) / (25 + k * 7)) % 2;
      const frames = [0, 1, 2].map(() => ({
        seq: ++this.botSeq,
        mx: phase === 0 ? 1 : -1,
        my: 0,
        aim: Math.PI,
        buttons: 0,
        slot: -1,
        viewTick: this.sim.tick,
      }));
      this.sim.enqueue(id, frames);
    }
  }

  private sendPracticeResults(standings: ServerPlayer[]) {
    const results = computeResults(standings, {
      tickRate: NET.serverTickRate,
      minParticipationTicks: Number.MAX_SAFE_INTEGER,
      completed: false,
    });
    const rows = resultRows(results);
    for (const r of results) {
      const client = this.clients.getById(r.player.id);
      if (!client) continue;
      client.send(S2C.RESULTS, {
        winnerId: this.state.winnerId,
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
    });
    const rows = resultRows(results);
    const winnerId = this.state.winnerId;
    const all: MatchPlayerResult[] = [
      ...results.map((r) => r.persist),
      ...this.leavers.map((l) => l.persist),
    ];
    const before = new Map<string, { xp: number }>();
    let updated = new Map<string, { xp: number; level: number }>();
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
      if (!ps) continue;
      const s = p.sim;
      ps.alive = p.alive;
      ps.x = s.x;
      ps.y = s.y;
      ps.aim = s.aim;
      ps.hp = p.hp;
      ps.kills = p.stats.kills;
      ps.deaths = p.stats.deaths;
      ps.streak = p.stats.streak;
      const slot = s.slots[s.slot];
      ps.weapon = slot?.id ?? NO_WEAPON;
      ps.reloading = s.reload > 0;
      ps.protected = p.alive && p.protectedUntil > this.sim.tick;
      ps.respawnTick = p.alive ? 0 : p.respawnTick;

      ps.ack = p.lastProcessedSeq;
      ps.vx = s.vx;
      ps.vy = s.vy;
      ps.dash = s.dash;
      ps.dashCd = s.dashCd;
      ps.dashDx = s.dashDx;
      ps.dashDy = s.dashDy;
      ps.dashHeld = s.dashHeld;
      ps.slot = s.slot;
      const [a, b, c] = s.slots;
      ps.w0 = a!.id;
      ps.m0 = a!.mag;
      ps.r0 = a!.reserve;
      ps.w1 = b!.id;
      ps.m1 = b!.mag;
      ps.r1 = b!.reserve;
      ps.w2 = c!.id;
      ps.m2 = c!.mag;
      ps.r2 = c!.reserve;
      ps.cooldown = s.cooldown;
      ps.reload = s.reload;
      ps.swap = s.swap;
      ps.bloom = s.bloom;
      ps.trigger = s.trigger;
    }
    this.syncPickups(false);
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
