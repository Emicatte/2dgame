import { Encoder, StateView } from "@colyseus/schema";
import {
  C2S,
  decodeInput,
  hashString,
  type InputBatch,
  inputBatchSchema,
  isSkinUnlocked,
  isVehicleKind,
  kickSchema,
  loadoutSchema,
  MAPS,
  MATCH_DEFAULTS,
  type MapId,
  type MatchPhase,
  MatchState,
  NET,
  type NoticeMessage,
  type PersonalResult,
  PickupState,
  PlayerState,
  type ResultsMessage,
  readySchema,
  S2C,
  SERVER_TICK_MS,
  settingsSchema,
  teamSchema,
  type VehicleKind,
  type WeaponId,
} from "@scrapline/shared";
import { z } from "zod";
// The dedicated server's simulation, state mirroring and scoring run unchanged in the host's tab.
import { type ComputedResult, computeResults, resultRows } from "../../../server/src/players/results.ts";
import { MatchRules } from "../../../server/src/rules/MatchRules.ts";
import { GameSimulation, type ServerPlayer } from "../../../server/src/simulation/GameSimulation.ts";
import { syncPlayerState, syncVehicles } from "../../../server/src/simulation/stateSync.ts";
import { signal } from "../net/signal.ts";
import type { PeerLink, WireData } from "./link.ts";
import {
  BUILD_ID,
  CLOSE,
  encodeFrame,
  FRAME_FULL,
  FRAME_PATCH,
  type Hello,
  type HostFrame,
  helloSchema,
  parseFrame,
  randomId,
} from "./wire.ts";

const pingSchema = z.object({ ms: z.number().int().min(0).max(5000) });

/** Inputs older than this many seconds of silence during a live match get the player removed. */
const AFK_KICK_SEC = 120;
/** A guest that sends nothing (not even keepalives) for this long is treated as disconnected. */
const GUEST_SILENCE_MS = 6000;
/** A guest whose link cannot keep up (bytes queued) is dropped and resynchronized on reconnect. */
const MAX_BUFFERED_BYTES = 1_000_000;
const HELLO_TIMEOUT_MS = 10_000;

export interface HostProfile {
  name: string;
  level: number;
  skin: string;
  primary: WeaponId;
  profileId: string;
}

export interface HostRoomOptions {
  code: string;
  map: MapId;
  host: HostProfile;
  /** Runs the tick loop from timers only (tests); the game also pumps from animation frames. */
  headless?: boolean;
  /** Test-only fixed spawns / vehicle placement (honored in dev and E2E builds only). */
  debug?: HostDebugOptions;
}

export interface HostDebugOptions {
  spawns?: { x: number; y: number }[];
  vehicles?: { kind: string; x: number; y: number; angle: number }[];
}

interface Seat {
  id: string;
  profileId: string;
  token: string;
  link: PeerLink | null;
  view: StateView;
  /** A full state must be sent before patches (new connection). */
  needsFull: boolean;
  /** performance.now() at which a dropped seat is released; 0 while connected. */
  heldUntil: number;
  lastHeard: number;
  msgWindowStart: number;
  msgCount: number;
}

/** Owner-only results payload extension: what the guest's local profile needs to record. */
export type LocalRecord = NonNullable<PersonalResult["record"]>;

/**
 * Host mode: the arena runs in the browser of the player who created it. This class is both
 *
 *  - the authoritative room (the logic of apps/server ArenaRoom for private rooms: lobby, settings,
 *    ready/start, countdown, match, results, practice targets, AFK removal), running the server's
 *    GameSimulation at 20 Hz and synchronizing state to guests with the same @colyseus/schema
 *    encoding and per-player views (owner-only fields) as the dedicated server; and
 *  - the host player's own "room" object, implementing the subset of the Colyseus SDK Room API the
 *    client uses, so the game scene, HUD and menus run unmodified.
 *
 * Guests connect through PeerLinks (WebRTC DataChannels in the game, memory pipes in tests).
 */
export class HostRoom {
  readonly roomId: string;
  readonly sessionId: string;
  readonly reconnectionToken = "";
  readonly state = new MatchState();
  readonly connection = { isOpen: true, transport: {} as { ws?: WebSocket } };
  readonly onStateChange = signal<[MatchState]>();
  readonly onReconnect = signal<[]>();
  readonly onDrop = signal<[number?, string?]>();
  readonly onLeave = signal<[number]>();
  readonly onError = signal<[number, string?]>();
  /** Fires once when the room shuts down (host left). */
  readonly onDispose = signal<[]>();
  readonly isHost = true;

  private readonly handlers = new Map<string, Set<(m: unknown) => void>>();
  private readonly sim: GameSimulation;
  private readonly rules: MatchRules;
  private readonly encoder: Encoder<MatchState>;
  private readonly views = new Map<string, PlayerState>();
  private readonly seats = new Map<string, Seat>();
  private readonly pending = new Set<PeerLink>();
  private readonly lastInputTick = new Map<string, number>();
  private readonly bots = new Set<string>();
  private botSeq = 0;
  private practiceMatch = false;
  private disposed = false;
  private stopTicker: (() => void) | null = null;
  private frame = 0;
  private nextTickAt = 0;
  /** Tick cost (ms) of the host's simulation, for diagnostics. */
  readonly tickCost = { total: 0, count: 0, max: 0 };

  constructor(private readonly opts: HostRoomOptions) {
    this.roomId = opts.code;
    this.sessionId = `h${randomId(6)}`;
    const mapId: MapId = opts.map in MAPS ? opts.map : "industrial";
    this.sim = new GameSimulation(MAPS[mapId], { tickRate: NET.serverTickRate });
    // Deterministic spawns and vehicles for automated tests: dev and E2E builds only (the same
    // gate as the dedicated server's ENABLE_DEBUG_ROUTES).
    if (opts.debug && (import.meta.env.DEV || import.meta.env.VITE_E2E === "true")) {
      if (opts.debug.spawns) this.sim.spawnOverride = opts.debug.spawns;
      if (opts.debug.vehicles) {
        this.sim.setVehicleOverride(
          opts.debug.vehicles
            .filter((v) => isVehicleKind(v.kind))
            .map((v, i) => ({ ...v, kind: v.kind as VehicleKind, id: `dbg-${i}` })),
        );
      }
    }
    Object.assign(this.state, {
      phase: "lobby",
      mode: "deathmatch",
      roomKind: "private",
      code: opts.code,
      mapId,
      durationSec: MATCH_DEFAULTS.durationSec,
      killLimit: MATCH_DEFAULTS.killLimit,
      maxPlayers: MATCH_DEFAULTS.maxPlayers,
      tickRate: NET.serverTickRate,
      hostId: this.sessionId,
    });
    this.rules = new MatchRules(this.sim, this.state, (id) => this.bots.has(id));
    this.rules.setMode("deathmatch");
    this.syncPickups(true);
    this.addPlayer(this.sessionId, opts.host);
    this.syncPracticeTargets();
    this.syncState();
    this.encoder = new Encoder(this.state);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Starts the 20 Hz loop. */
  start(): void {
    this.nextTickAt = performance.now() + SERVER_TICK_MS;
    this.stopTicker = startTicker(SERVER_TICK_MS, () => this.pump());
    if (!this.opts.headless && typeof requestAnimationFrame === "function") {
      const onFrame = () => {
        if (this.disposed) return;
        this.pump();
        this.frame = requestAnimationFrame(onFrame);
      };
      this.frame = requestAnimationFrame(onFrame);
    }
    queueMicrotask(() => this.onStateChange.invoke(this.state));
  }

  /**
   * Fixed 20 Hz schedule driven by a worker timer (not throttled like page timers when the tab is
   * in the background) and by animation frames (smooth when in front).
   */
  private pump(): void {
    if (this.disposed) return;
    const now = performance.now();
    if (now - this.nextTickAt > 1000) this.nextTickAt = now;
    let n = 0;
    while (now >= this.nextTickAt && n < 4) {
      this.tick(SERVER_TICK_MS);
      this.nextTickAt += SERVER_TICK_MS;
      n++;
    }
  }

  /** Advances one server tick. Public for deterministic tests. */
  tick(elapsedMs: number = SERVER_TICK_MS): void {
    if (this.disposed) return;
    const t0 = performance.now();
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
      case "countdown":
        if (tick >= this.state.phaseEndTick) this.startPlaying();
        break;
      case "playing":
        if (this.sim.leaderScore() >= this.state.killLimit) this.endMatch();
        else if (tick >= this.state.phaseEndTick) this.endMatch();
        else this.kickIdle(tick);
        break;
      case "results":
        if (tick >= this.state.phaseEndTick) this.backToLobby();
        break;
    }

    this.syncState();
    this.checkSeats(t0);
    this.broadcastPatch();
    this.onStateChange.invoke(this.state);

    const cost = performance.now() - t0;
    this.tickCost.total += cost;
    this.tickCost.count += 1;
    this.tickCost.max = Math.max(this.tickCost.max, cost);
  }

  // ------------------------------------------------------------------ local player (SDK Room API)

  onMessage(type: string, cb: (m: unknown) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  /** The host's own messages take the same validated path as a guest's. */
  send(type: string, payload?: unknown): void {
    if (this.disposed) return;
    this.handleMessage(this.sessionId, type, payload ?? {});
  }

  ping(cb: (ms: number) => void): void {
    cb(0);
  }

  async leave(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTicker?.();
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    for (const seat of this.seats.values()) this.closeLink(seat, CLOSE.HOST_CLOSED, "host closed the arena");
    for (const link of this.pending) link.close();
    this.pending.clear();
    for (const seat of this.seats.values()) seat.view.dispose();
    this.connection.isOpen = false;
    this.onDispose.invoke();
    this.onLeave.invoke(CLOSE.CONSENTED);
  }

  removeAllListeners(): void {
    for (const s of [this.onStateChange, this.onReconnect, this.onDrop, this.onLeave, this.onError])
      s.clear();
    this.handlers.clear();
  }

  /** Connected and held guests (for the lobby and diagnostics). */
  get guestCount(): number {
    return this.seats.size;
  }

  get isFull(): boolean {
    return 1 + this.seats.size >= this.state.maxPlayers;
  }

  // ------------------------------------------------------------------ guest connections

  /** A new guest pipe (DataChannel open). The guest must say hello within a few seconds. */
  acceptLink(link: PeerLink): void {
    if (this.disposed) {
      link.close();
      return;
    }
    this.pending.add(link);
    const timer = setTimeout(() => {
      if (this.pending.delete(link)) link.close();
    }, HELLO_TIMEOUT_MS);
    link.onclose = () => {
      clearTimeout(timer);
      this.pending.delete(link);
    };
    link.onmessage = (data) => {
      const frame = typeof data === "string" ? parseFrame(data) : null;
      if (frame?.[0] !== "hello") {
        clearTimeout(timer);
        this.pending.delete(link);
        this.reject(link, CLOSE.PROTOCOL, "expected hello");
        return;
      }
      clearTimeout(timer);
      this.pending.delete(link);
      this.onHello(link, frame[1]);
    };
  }

  private reject(link: PeerLink, code: number, reason: string) {
    link.onmessage = null;
    link.onclose = null;
    link.send(encodeFrame(["reject", code, reason]));
    link.close();
  }

  private onHello(link: PeerLink, raw: unknown) {
    const parsed = helloSchema.safeParse(raw);
    if (!parsed.success) return this.reject(link, CLOSE.PROTOCOL, "invalid hello");
    const hello = parsed.data;
    if (hello.build !== BUILD_ID) return this.reject(link, CLOSE.VERSION, "version mismatch");
    if (hello.profileId === this.opts.host.profileId)
      return this.reject(link, CLOSE.DUPLICATE, "host profile");

    // Same seat again: by token (reconnect, also while the old pipe still looks alive), or by
    // profile when the seat is waiting for its owner (page reload lost the token).
    let seat = hello.resume ? [...this.seats.values()].find((s) => s.token === hello.resume) : undefined;
    if (!seat) {
      const sameProfile = [...this.seats.values()].find((s) => s.profileId === hello.profileId);
      if (sameProfile) {
        if (sameProfile.link) return this.reject(link, CLOSE.DUPLICATE, "already in this room");
        seat = sameProfile;
      }
    }
    if (seat) {
      this.reattach(seat, link);
      return;
    }
    if (hello.resume) return this.reject(link, CLOSE.SEAT_EXPIRED, "seat expired");
    if (this.isFull) return this.reject(link, CLOSE.ROOM_FULL, "room full");
    this.join(link, hello);
  }

  private join(link: PeerLink, hello: Hello) {
    const id = randomId(6);
    const skin = isSkinUnlocked(hello.skin, hello.level) ? hello.skin : "foundry";
    const ps = this.addPlayer(id, { ...hello, skin }, hello.team);
    const view = new StateView();
    view.add(ps);
    const now = performance.now();
    const seat: Seat = {
      id,
      profileId: hello.profileId,
      token: randomId(18),
      link,
      view,
      needsFull: true,
      heldUntil: 0,
      lastHeard: now,
      msgWindowStart: now,
      msgCount: 0,
    };
    this.seats.set(id, seat);
    this.bindLink(seat, link);
    link.send(encodeFrame(["welcome", { sessionId: id, token: seat.token, code: this.opts.code }]));
    const p = this.sim.players.get(id);
    if (p && (this.state.phase === "countdown" || this.state.phase === "playing")) this.sim.spawnLater(p, 1);
    this.notice(`${hello.name} joined`, "info", id);
    this.syncPracticeTargets();
  }

  private reattach(seat: Seat, link: PeerLink) {
    if (seat.link) this.closeLink(seat, CLOSE.CONSENTED, "replaced by a new connection");
    const ps = this.state.players.get(seat.id);
    const p = this.sim.players.get(seat.id);
    if (ps) ps.connected = true;
    if (p) p.connected = true;
    // The guest may have reloaded and restarted its input sequence: reset before any snapshot.
    this.sim.resetInputStream(seat.id);
    if (ps) ps.ack = 0;
    seat.view.dispose();
    seat.view = new StateView();
    if (ps) seat.view.add(ps);
    seat.heldUntil = 0;
    seat.needsFull = true;
    seat.lastHeard = performance.now();
    this.lastInputTick.set(seat.id, this.state.tick);
    this.bindLink(seat, link);
    link.send(encodeFrame(["welcome", { sessionId: seat.id, token: seat.token, code: this.opts.code }]));
  }

  private bindLink(seat: Seat, link: PeerLink) {
    seat.link = link;
    link.onmessage = (data) => this.onGuestData(seat, link, data);
    link.onclose = () => this.onGuestDrop(seat, link);
  }

  private closeLink(seat: Seat, code: number, reason: string) {
    const link = seat.link;
    if (!link) return;
    seat.link = null;
    link.onmessage = null;
    link.onclose = null;
    link.send(encodeFrame(["bye", code, reason]));
    link.close();
  }

  /** Network drop: hold the seat for NET.reconnectSeconds. */
  private onGuestDrop(seat: Seat, link: PeerLink) {
    if (seat.link !== link) return;
    seat.link = null;
    seat.heldUntil = performance.now() + NET.reconnectSeconds * 1000;
    const ps = this.state.players.get(seat.id);
    const p = this.sim.players.get(seat.id);
    if (ps) ps.connected = false;
    if (p) p.connected = false;
  }

  private onGuestData(seat: Seat, link: PeerLink, data: WireData) {
    if (seat.link !== link) return;
    const now = performance.now();
    seat.lastHeard = now;
    if (now - seat.msgWindowStart >= 1000) {
      seat.msgWindowStart = now;
      seat.msgCount = 0;
    }
    if (++seat.msgCount > NET.maxMessagesPerSecond)
      return this.kick(seat.id, CLOSE.PROTOCOL, "message flood");
    const frame = typeof data === "string" ? parseFrame(data) : null;
    if (!frame) return this.kick(seat.id, CLOSE.PROTOCOL, "malformed frame");
    switch (frame[0]) {
      case "m":
        if (typeof frame[1] !== "string") return this.kick(seat.id, CLOSE.PROTOCOL, "malformed message");
        this.handleMessage(seat.id, frame[1], frame[2]);
        return;
      case "pi":
        if (typeof frame[1] === "number") link.send(encodeFrame(["po", frame[1]]));
        return;
      case "bye":
        this.removeSeat(seat);
        return;
      default:
        this.kick(seat.id, CLOSE.PROTOCOL, "unknown frame");
    }
  }

  /** Releases expired seats, and drops silent or backed-up links. */
  private checkSeats(now: number) {
    for (const seat of [...this.seats.values()]) {
      if (seat.link) {
        if (now - seat.lastHeard > GUEST_SILENCE_MS || seat.link.bufferedAmount > MAX_BUFFERED_BYTES) {
          const link = seat.link;
          link.onmessage = null;
          link.onclose = null;
          link.close();
          this.onGuestDrop(seat, link);
        }
      } else if (seat.heldUntil > 0 && now >= seat.heldUntil) {
        this.removeSeat(seat);
      }
    }
  }

  private removeSeat(seat: Seat) {
    if (!this.seats.delete(seat.id)) return;
    if (seat.link) {
      const link = seat.link;
      seat.link = null;
      link.onmessage = null;
      link.onclose = null;
      link.close();
    }
    seat.view.dispose();
    const p = this.sim.removePlayer(seat.id);
    this.state.players.delete(seat.id);
    this.views.delete(seat.id);
    this.lastInputTick.delete(seat.id);
    if (p) this.notice(`${p.name} left`, "warn");
    this.syncPracticeTargets();
  }

  private kick(id: string, code: number, reason: string) {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.closeLink(seat, code, reason);
    this.removeSeat(seat);
  }

  // ------------------------------------------------------------------ messages

  private handleMessage(id: string, type: string, payload: unknown) {
    const isGuest = id !== this.sessionId;
    const parse = <T>(schema: z.ZodType<T>): T | null => {
      const r = schema.safeParse(payload);
      if (r.success) return r.data;
      if (isGuest) this.kick(id, CLOSE.PROTOCOL, `invalid ${type}`);
      return null;
    };
    switch (type) {
      case C2S.INPUT: {
        const msg = parse(inputBatchSchema);
        if (msg) this.handleInput(id, msg);
        return;
      }
      case C2S.READY: {
        const msg = parse(readySchema);
        if (msg) this.handleReady(id, msg.ready);
        return;
      }
      case C2S.SETTINGS: {
        const msg = parse(settingsSchema);
        if (msg) this.handleSettings(id, msg);
        return;
      }
      case C2S.START:
        this.handleStart(id);
        return;
      case C2S.LOADOUT: {
        const msg = parse(loadoutSchema);
        if (msg) this.handleLoadout(id, msg);
        return;
      }
      case C2S.TEAM: {
        const msg = parse(teamSchema);
        if (!msg || (this.state.phase !== "lobby" && this.state.phase !== "results")) return;
        if (!this.rules.switchTeam(id, msg.team) && this.rules.teamMode)
          this.notice("That team is full", "warn", undefined, id);
        return;
      }
      case C2S.BALANCE:
        if (id === this.sessionId && this.state.phase === "lobby" && this.rules.teamMode) {
          this.rules.balance();
          this.notice("Teams balanced by level", "info");
        }
        return;
      case C2S.KICK: {
        const msg = parse(kickSchema);
        if (msg && id === this.sessionId && msg.id !== this.sessionId)
          this.kick(msg.id, CLOSE.KICKED, "kicked by host");
        return;
      }
      case "ping": {
        const msg = parse(pingSchema);
        const ps = this.state.players.get(id);
        if (msg && ps) ps.ping = msg.ms;
        return;
      }
      default:
        if (isGuest) this.kick(id, CLOSE.PROTOCOL, "unknown message type");
    }
  }

  private handleInput(id: string, msg: InputBatch) {
    const phase = this.state.phase as MatchPhase;
    if (phase !== "countdown" && phase !== "playing") return;
    this.sim.enqueue(id, msg.i.map(decodeInput));
    this.lastInputTick.set(id, this.state.tick);
  }

  private handleReady(id: string, ready: boolean) {
    const ps = this.state.players.get(id);
    if (!ps) return;
    if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
    ps.ready = ready;
  }

  private handleSettings(id: string, s: z.infer<typeof settingsSchema>) {
    if (id !== this.sessionId || this.state.phase !== "lobby") return;
    // Mode first: it resets length, score limit and size to the mode's defaults.
    if (s.mode && s.mode !== this.state.mode) this.rules.setMode(s.mode);
    if (s.teamSize && this.rules.teamMode && s.teamSize !== this.state.teamSize) {
      if (!this.rules.setTeamSize(s.teamSize))
        this.notice("Too many players in the room for that team size", "warn", undefined, id);
    }
    if (s.friendlyFire !== undefined && this.rules.teamMode) this.rules.setFriendlyFire(s.friendlyFire);
    if (s.map && s.map !== this.state.mapId) {
      this.state.mapId = s.map;
      this.sim.setMap(MAPS[s.map]);
      this.syncPickups(true);
    }
    if (s.durationSec) this.state.durationSec = s.durationSec;
    if (s.killLimit) this.state.killLimit = s.killLimit;
    if (s.maxPlayers && !this.rules.teamMode)
      this.state.maxPlayers = Math.max(s.maxPlayers, 1 + this.seats.size);
  }

  private handleStart(id: string) {
    if (id !== this.sessionId || this.state.phase !== "lobby") return;
    const notReady = [...this.state.players.entries()].filter(
      ([pid, p]) => pid !== this.sessionId && !p.ready,
    );
    if (notReady.length > 0) {
      this.notice(`Waiting for: ${notReady.map(([, p]) => p.name).join(", ")}`, "warn", undefined, id);
      return;
    }
    this.startCountdown();
  }

  private handleLoadout(id: string, msg: { primary: WeaponId; skin: string }) {
    const p = this.sim.players.get(id);
    const ps = this.state.players.get(id);
    if (!p || !ps) return;
    p.primary = msg.primary;
    ps.primary = msg.primary;
    if (isSkinUnlocked(msg.skin, p.level)) {
      p.skin = msg.skin;
      ps.skin = msg.skin;
    }
  }

  // ------------------------------------------------------------------ phases

  private startCountdown() {
    this.syncPracticeTargets();
    this.practiceMatch = this.bots.size > 0;
    this.rules.prepareMatch();
    this.sim.resetForMatch();
    this.state.phase = "countdown";
    this.state.winnerId = "";
    this.state.winnerTeam = 0;
    this.state.matchIndex += 1;
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(MATCH_DEFAULTS.countdownSec);
    for (const ps of this.state.players.values()) ps.ready = false;
    for (const id of this.lastInputTick.keys()) this.lastInputTick.set(id, this.sim.tick);
    this.syncPickups(true);
  }

  private startPlaying() {
    this.state.phase = "playing";
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(this.state.durationSec);
  }

  private endMatch() {
    if (this.state.phase !== "playing") return;
    this.state.phase = "results";
    this.state.phaseEndTick = this.sim.tick + this.sim.secToTicks(MATCH_DEFAULTS.resultsSec);
    const standings = this.sim.standings();
    this.state.winnerId = standings[0]?.id ?? "";
    this.state.winnerTeam = this.sim.winningTeam();
    this.rules.sync();
    this.sendResults(standings);
  }

  private backToLobby() {
    this.state.phase = "lobby";
    this.state.phaseEndTick = 0;
    for (const p of this.sim.players.values()) {
      p.alive = false;
      p.respawnTick = 0;
    }
    this.syncPracticeTargets();
  }

  private kickIdle(tick: number) {
    const limit = this.sim.secToTicks(AFK_KICK_SEC);
    for (const [id, last] of this.lastInputTick) {
      if (id === this.sessionId || this.bots.has(id)) continue;
      const p = this.sim.players.get(id);
      if (p?.connected && tick - last > limit) {
        this.lastInputTick.set(id, tick);
        this.kick(id, CLOSE.INACTIVE, "inactive");
      }
    }
  }

  /**
   * XP and stats are computed here with the server's scoring, then each player's own browser
   * records them in its local profile (there is no shared database in host mode).
   */
  private sendResults(standings: ServerPlayer[]) {
    const practice = this.practiceMatch;
    const results = computeResults(standings, {
      tickRate: NET.serverTickRate,
      minParticipationTicks: practice
        ? Number.MAX_SAFE_INTEGER
        : this.sim.secToTicks(MATCH_DEFAULTS.minParticipationSec),
      completed: !practice,
      ...(this.rules.teamMode ? { winnerTeam: this.state.winnerTeam } : {}),
    });
    const rows = resultRows(results);
    const team: Pick<ResultsMessage, "winnerTeam" | "teamScores"> = this.rules.teamMode
      ? { winnerTeam: this.state.winnerTeam, teamScores: [this.sim.teamScores[1], this.sim.teamScores[2]] }
      : {};
    for (const r of results) {
      if (this.bots.has(r.player.id)) continue;
      const msg: ResultsMessage = {
        winnerId: this.state.winnerId,
        ...team,
        rows,
        personal: personal(r, practice),
      };
      this.sendTo(r.player.id, S2C.RESULTS, msg);
    }
  }

  // ------------------------------------------------------------------ practice targets

  /** Same as the dedicated server: a host alone in the lobby gets three strafing targets. */
  private syncPracticeTargets() {
    const alone = this.seats.size === 0;
    const wanted = alone && this.state.phase === "lobby" ? 3 : 0;
    const keep = alone && this.state.phase !== "lobby";
    if (wanted > 0 && this.bots.size === 0) {
      for (let i = 1; i <= wanted; i++) {
        const id = `bot:${i}`;
        this.bots.add(id);
        this.addPlayer(id, {
          name: `Target ${i}`,
          skin: "ash",
          level: 1,
          primary: "rifle",
          profileId: "",
        });
        const ps = this.state.players.get(id);
        if (ps) ps.ready = true;
      }
    } else if (wanted === 0 && !keep && this.bots.size > 0) {
      for (const id of this.bots) {
        this.sim.removePlayer(id);
        this.state.players.delete(id);
        this.views.delete(id);
        this.lastInputTick.delete(id);
      }
      this.bots.clear();
    }
  }

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

  // ------------------------------------------------------------------ state

  private addPlayer(
    id: string,
    who: Omit<HostProfile, "profileId"> & { profileId: string },
    preferredTeam?: number,
  ): PlayerState {
    const p = this.sim.addPlayer({
      id,
      playerId: who.profileId,
      name: who.name,
      skin: who.skin,
      level: who.level,
      primary: who.primary,
      seed: hashString(id),
    });
    this.rules.assign(id, preferredTeam);
    const ps = new PlayerState();
    Object.assign(ps, {
      name: who.name,
      skin: who.skin,
      level: who.level,
      primary: who.primary,
      connected: true,
      joinedAt: this.state.tick,
      team: p.team,
    });
    this.state.players.set(id, ps);
    this.views.set(id, ps);
    this.lastInputTick.set(id, this.state.tick);
    return ps;
  }

  private syncState() {
    for (const [id, p] of this.sim.players) {
      const ps = this.views.get(id);
      if (ps) syncPlayerState(ps, p, this.sim.tick);
    }
    this.rules.sync();
    this.syncPickups(false);
    syncVehicles(this.state, this.sim);
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

  /**
   * One patch per tick, encoded like Colyseus' SchemaSerializer with filters: shared changes once,
   * then each guest's view (owner-only fields). New connections get a full state afterwards.
   */
  private broadcastPatch() {
    const live = [...this.seats.values()].filter((s) => s.link && !s.needsFull);
    if (this.encoder.hasChanges) {
      if (live.length > 0) {
        const it = { offset: 1 };
        this.encoder.sharedBuffer[0] = FRAME_PATCH;
        this.encoder.encode(it);
        const sharedOffset = it.offset;
        for (const seat of live) seat.link?.send(this.encoder.encodeView(seat.view, sharedOffset, it));
      }
      this.encoder.discardChanges();
    } else {
      const changed = live.filter((s) => s.view.changes.size > 0);
      if (changed.length > 0) {
        const it = { offset: 1 };
        this.encoder.sharedBuffer[0] = FRAME_PATCH;
        const sharedOffset = it.offset;
        for (const seat of changed) seat.link?.send(this.encoder.encodeView(seat.view, sharedOffset, it));
      }
    }
    for (const seat of this.seats.values()) {
      if (!seat.link || !seat.needsFull) continue;
      seat.needsFull = false;
      this.encoder.sharedBuffer[0] = FRAME_FULL;
      const shared = this.encoder.encodeAll({ offset: 1 }).slice();
      this.encoder.sharedBuffer.set(shared);
      seat.link.send(this.encoder.encodeAllView(seat.view, shared.byteLength, { offset: shared.byteLength }));
    }
  }

  // ------------------------------------------------------------------ messaging

  private broadcast(type: string, payload: unknown) {
    this.deliverLocal(type, payload);
    const frame = encodeFrame(["m", type, payload] as HostFrame);
    for (const seat of this.seats.values()) if (seat.link && !seat.needsFull) seat.link.send(frame);
  }

  private sendTo(id: string, type: string, payload: unknown) {
    if (id === this.sessionId) {
      this.deliverLocal(type, payload);
      return;
    }
    this.seats.get(id)?.link?.send(encodeFrame(["m", type, payload] as HostFrame));
  }

  private deliverLocal(type: string, payload: unknown) {
    for (const h of this.handlers.get(type) ?? []) h(payload);
  }

  private notice(text: string, tone: NoticeMessage["tone"], except?: string, only?: string) {
    const msg: NoticeMessage = { text, tone };
    if (only) return this.sendTo(only, S2C.NOTICE, msg);
    if (except !== this.sessionId) this.deliverLocal(S2C.NOTICE, msg);
    const frame = encodeFrame(["m", S2C.NOTICE, msg]);
    for (const seat of this.seats.values()) if (seat.id !== except && seat.link) seat.link.send(frame);
  }
}

function personal(r: ComputedResult, practice: boolean): PersonalResult {
  return {
    placement: r.placement,
    xpGained: practice ? 0 : r.xp.total,
    xpLines: practice ? [] : r.xp.lines,
    totalXp: null,
    level: null,
    leveledUp: false,
    unlocked: [],
    persisted: false,
    ...(practice
      ? { practice: true }
      : {
          record: {
            kills: r.persist.kills,
            deaths: r.persist.deaths,
            won: r.persist.won,
            completed: r.persist.completed,
            shotsFired: r.persist.shotsFired,
            shotsHit: r.persist.shotsHit,
            playtimeSec: r.persist.playtimeSec,
          },
        }),
  };
}

/**
 * Calls `cb` every `ms` from a dedicated worker: worker timers keep running at full rate when the
 * host's tab is in the background (page timers are throttled to once per second or less).
 */
function startTicker(ms: number, cb: () => void): () => void {
  if (
    typeof Worker === "function" &&
    typeof Blob === "function" &&
    typeof URL.createObjectURL === "function"
  ) {
    try {
      const src = `const t = setInterval(() => postMessage(0), ${ms}); onmessage = () => { clearInterval(t); close(); };`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const worker = new Worker(url);
      let revoked = false;
      worker.onmessage = () => {
        if (!revoked) {
          revoked = true;
          URL.revokeObjectURL(url);
        }
        cb();
      };
      // A blocked worker (CSP, policy) falls back to a page timer.
      let fallback: ReturnType<typeof setInterval> | null = null;
      worker.onerror = () => {
        if (!fallback) fallback = setInterval(cb, ms);
      };
      return () => {
        worker.terminate();
        if (fallback) clearInterval(fallback);
      };
    } catch {
      // fall through
    }
  }
  const t = setInterval(cb, ms);
  return () => clearInterval(t);
}
