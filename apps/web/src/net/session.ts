import { Client, type Room } from "@colyseus/sdk";
import {
  type AbilityMessage,
  C2S,
  DEFAULT_PRIMARY,
  DEFAULT_SKIN,
  type GameMode,
  isRoleMode,
  isWeaponId,
  type JoinOptions,
  levelFromXp,
  MAPS,
  type MapId,
  type MatchPhase,
  type MatchSettings,
  MatchState,
  mapsForMode,
  type NetEvent,
  type NoticeMessage,
  type ResultsMessage,
  ROOM_NAME,
  type RoomKind,
  S2C,
  type WeaponId,
} from "@scrapline/shared";
import { createStore, Emitter } from "../lib/store.ts";
import { hostArena, joinArena, type LocalPlayer } from "../p2p/hostMode.ts";
import { JoinError } from "../p2p/PeerRoom.ts";
import { CLOSE, closeReason } from "../p2p/wire.ts";
import { localProfile } from "../state/localProfile.ts";
import { api, HOST_MODE, identity, SERVER_URL } from "./api.ts";

/** Keeps the previous object when nothing changed (store subscribers compare by reference). */
function roundOf(state: MatchState, prev: SessionState["round"]): SessionState["round"] {
  const r = state.round;
  if (!r) return prev;
  const next = {
    stage: r.stage,
    end: r.end,
    num: r.num,
    of: r.of,
    variant: r.variant,
    dark: r.dark,
    seekers: r.seekers,
    hiders: r.hiders,
    winner: r.winner,
  };
  return (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === prev[k]) ? prev : next;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface LobbyPlayer {
  id: string;
  name: string;
  ready: boolean;
  level: number;
  skin: string;
  primary: string;
  connected: boolean;
  kills: number;
  deaths: number;
  ping: number;
  alive: boolean;
  /** 0 = no team, 1 = Alpha, 2 = Bravo. */
  team: number;
  /** Round modes: side (ROLE.*) and points; Gun Game: ladder level (0-based). */
  role: number;
  pts: number;
  gg: number;
  /** Results: map voted for. */
  vote: string;
}

export interface SessionState {
  status: ConnectionStatus;
  error: string | null;
  roomId: string;
  selfId: string;
  code: string;
  kind: RoomKind;
  phase: MatchPhase;
  mapId: MapId;
  hostId: string;
  durationSec: number;
  killLimit: number;
  maxPlayers: number;
  tickRate: number;
  phaseEndTick: number;
  tick: number;
  winnerId: string;
  matchIndex: number;
  players: LobbyPlayer[];
  results: ResultsMessage | null;
  mode: GameMode;
  teamSize: number;
  friendlyFire: boolean;
  scoreA: number;
  scoreB: number;
  winnerTeam: number;
  /** PvE lobby settings. */
  mission: string;
  difficulty: string;
  /** Round modes: stage, its end tick, round number / count, variant, lights out, side sizes. */
  round: {
    stage: string;
    end: number;
    num: number;
    of: number;
    variant: string;
    dark: boolean;
    seekers: number;
    hiders: number;
    winner: number;
  };
  /** Results: maps offered for the next match. */
  voteMaps: string[];
  /** This player left the running match and waits in the room for the next one. */
  away: boolean;
}

const initialState: SessionState = {
  status: "idle",
  error: null,
  roomId: "",
  selfId: "",
  code: "",
  kind: "quick",
  phase: "lobby",
  mapId: "industrial",
  hostId: "",
  durationSec: 0,
  killLimit: 0,
  maxPlayers: 8,
  tickRate: 20,
  phaseEndTick: 0,
  tick: 0,
  winnerId: "",
  matchIndex: 0,
  players: [],
  results: null,
  mode: "deathmatch",
  teamSize: 0,
  friendlyFire: false,
  scoreA: 0,
  scoreB: 0,
  winnerTeam: 0,
  mission: "",
  difficulty: "veteran",
  round: { stage: "", end: 0, num: 0, of: 0, variant: "", dark: false, seekers: 0, hiders: 0, winner: 0 },
  voteMaps: [],
  away: false,
};

export const sessionStore = createStore<SessionState>({ ...initialState });

export interface GameEvents extends Record<string, unknown> {
  net: { events: NetEvent[]; tick: number };
  notice: NoticeMessage;
  results: ResultsMessage;
  roomChanged: Room<unknown, MatchState> | null;
}

export const gameEvents = new Emitter<GameEvents>();

const RECONNECT_KEY = "scrapline.reconnect.v1";

export interface Loadout {
  primary: WeaponId;
  skin: string;
}

function wsUrl(): string {
  return SERVER_URL;
}

/**
 * Owns the connection to the game server: matchmaking, the joined room, reconnection, and the
 * projection of the synchronized state into React-friendly stores.
 */
class GameSession {
  readonly client = new Client(wsUrl());
  room: Room<unknown, MatchState> | null = null;
  private lastListUpdate = 0;

  private options(
    kind: RoomKind,
    loadout: Loadout,
    map?: MapId,
    extra: { mode?: GameMode; team?: 1 | 2 } = {},
  ): JoinOptions {
    const token = identity.get();
    if (!token) throw new Error("No identity: create a profile first");
    return { token, kind, primary: loadout.primary, skin: loadout.skin, ...(map ? { map } : {}), ...extra };
  }

  /** Quick match: joins (or opens) a public room of that mode. */
  async quickMatch(loadout: Loadout, mode: GameMode = "deathmatch"): Promise<void> {
    if (HOST_MODE)
      throw new Error("Quick match needs a game server. Create an arena or join one with a code.");
    await this.connect(() =>
      this.client.joinOrCreate(ROOM_NAME, this.options("quick", loadout, undefined, { mode }), MatchState),
    );
  }

  /** Co-op: a private room (arena in host mode) set to Outbreak on its mission map. */
  /**
   * Opens a private room / arena already set to `mode` (Play screen). The map is the first one
   * compatible with the mode unless one is given.
   */
  async createWithMode(loadout: Loadout, mode: GameMode, map?: MapId): Promise<void> {
    const maps = mapsForMode(mode);
    // Round modes play best on a party map (hiding spots, shadows, objects to turn into).
    const target =
      map ?? (isRoleMode(mode) ? maps.find((m) => MAPS[m].party) : undefined) ?? maps[0] ?? "industrial";
    await this.createPrivate(loadout, target, HOST_MODE ? {} : { mode });
    if (HOST_MODE) this.updateSettings({ mode });
  }

  async createCoop(loadout: Loadout): Promise<void> {
    await this.createPrivate(loadout, "works", HOST_MODE ? {} : { mode: "outbreak" });
    if (HOST_MODE) this.updateSettings({ mode: "outbreak" });
  }

  async createPrivate(loadout: Loadout, map: MapId, extra: Record<string, unknown> = {}): Promise<void> {
    if (HOST_MODE) {
      const debug =
        extra.debugSpawns || extra.debugVehicles
          ? {
              spawns: extra.debugSpawns as { x: number; y: number }[] | undefined,
              vehicles: extra.debugVehicles as
                | { kind: string; x: number; y: number; angle: number }[]
                | undefined,
            }
          : undefined;
      await this.connect(async () => asRoom(await hostArena(localPlayer(loadout), map, debug)), false);
      return;
    }
    await this.connect(() =>
      this.client.create(ROOM_NAME, { ...this.options("private", loadout, map), ...extra }, MatchState),
    );
  }

  /** `team`: preferred team from an invite link ("join my team"), honored when it has room. */
  async joinByCode(code: string, loadout: Loadout, team?: 1 | 2): Promise<void> {
    if (HOST_MODE) {
      await this.connect(async () =>
        asRoom(await joinArena(code, { ...localPlayer(loadout), ...(team ? { team } : {}) })),
      );
      return;
    }
    await this.connect(async () => {
      const { roomId } = await api.roomByCode(code);
      return this.client.joinById(
        roomId,
        this.options("private", loadout, undefined, team ? { team } : {}),
        MatchState,
      );
    });
  }

  async joinById(roomId: string, loadout: Loadout): Promise<void> {
    await this.connect(() => this.client.joinById(roomId, this.options("quick", loadout), MatchState));
  }

  /** Resumes a match after a page reload, if the server still holds our seat. */
  async tryResume(): Promise<boolean> {
    // Already in a room: nothing to resume (resuming would leave it first).
    if (this.room) return true;
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(RECONNECT_KEY);
    } catch {
      return false;
    }
    if (!token) return false;
    try {
      if (HOST_MODE) {
        // Host mode stores "<code>:<seat token>": rejoin the same arena and take the seat back.
        const [code, seat] = token.split(":");
        if (!code || !seat) throw new Error("bad token");
        await this.connect(async () => asRoom(await joinArena(code, localPlayer(currentLoadoutOf()), seat)));
        return true;
      }
      await this.connect(() => this.client.reconnect(token, MatchState));
      return true;
    } catch {
      this.forgetReconnect();
      sessionStore.patch({ status: "idle", error: null });
      return false;
    }
  }

  private async connect(join: () => Promise<Room<unknown, MatchState>>, resumable = true): Promise<void> {
    if (this.room) await this.leave();
    sessionStore.set({ ...initialState, status: "connecting" });
    try {
      const room = await join();
      this.attach(room, resumable);
    } catch (err) {
      const message = humanizeJoinError(err);
      sessionStore.patch({ status: "error", error: message });
      throw new Error(message);
    }
  }

  /**
   * Offline benchmark only (bench/LocalRoom.ts): attaches an in-browser room through the same path
   * as a joined one, so the scene and HUD run unmodified. Never stored for reconnection.
   */
  attachLocal(room: Room<unknown, MatchState>): void {
    this.attach(room, false);
  }

  private attach(room: Room<unknown, MatchState>, resumable = true) {
    this.room = room;
    if (resumable) this.rememberReconnect(resumeToken(room));
    sessionStore.patch({ status: "connected", error: null, roomId: room.roomId, selfId: room.sessionId });

    room.onStateChange((state) => this.project(state));
    room.onMessage(S2C.EVENTS, (events: NetEvent[]) => {
      gameEvents.emit("net", { events, tick: room.state.tick + 1 });
    });
    room.onMessage(S2C.NOTICE, (msg: NoticeMessage) => gameEvents.emit("notice", msg));
    room.onMessage(S2C.RESULTS, (raw: ResultsMessage) => {
      // Host mode: this browser records its own match in the local profile.
      const msg =
        HOST_MODE && raw.personal ? { ...raw, personal: localProfile.applyResult(raw.personal) } : raw;
      sessionStore.patch({ results: msg });
      gameEvents.emit("results", msg);
    });
    room.onDrop(() => sessionStore.patch({ status: "reconnecting" }));
    room.onReconnect(() => {
      if (resumable) this.rememberReconnect(resumeToken(room));
      sessionStore.patch({ status: "connected" });
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      this.room = null;
      this.forgetReconnect();
      gameEvents.emit("roomChanged", null);
      const consented = code === 1000 || code === 4000;
      sessionStore.set({
        ...initialState,
        status: consented ? "idle" : "error",
        error: consented ? null : HOST_MODE ? closeReason(code) : leaveReason(code),
      });
    });
    room.onError((code, message) => {
      sessionStore.patch({ error: message ?? `Room error ${code}` });
    });
    gameEvents.emit("roomChanged", room);
  }

  private project(state: MatchState) {
    const now = performance.now();
    const phase = state.phase as MatchPhase;
    const s = sessionStore.get();
    const listDue =
      phase !== "playing" || now - this.lastListUpdate > 250 || s.players.length !== state.players.size;
    let players = s.players;
    if (listDue) {
      this.lastListUpdate = now;
      players = [];
      state.players.forEach((p, id) => {
        players.push({
          id,
          name: p.name,
          ready: p.ready,
          level: p.level,
          skin: p.skin,
          primary: p.primary,
          connected: p.connected,
          kills: p.kills,
          deaths: p.deaths,
          ping: p.ping,
          alive: p.alive,
          team: p.team,
          role: p.role,
          pts: p.pts,
          gg: p.gg,
          vote: p.vote,
        });
      });
    }
    sessionStore.patch({
      code: state.code,
      kind: state.roomKind as RoomKind,
      phase,
      mapId: state.mapId as MapId,
      hostId: state.hostId,
      durationSec: state.durationSec,
      killLimit: state.killLimit,
      maxPlayers: state.maxPlayers,
      tickRate: state.tickRate,
      phaseEndTick: state.phaseEndTick,
      tick: phase === "playing" ? s.tick : state.tick,
      winnerId: state.winnerId,
      matchIndex: state.matchIndex,
      players,
      results: phase === "results" ? s.results : null,
      mode: (state.mode as GameMode) || "deathmatch",
      teamSize: state.teamSize,
      friendlyFire: state.friendlyFire,
      scoreA: state.scoreA,
      scoreB: state.scoreB,
      winnerTeam: state.winnerTeam,
      mission: state.pve?.mission ?? "",
      difficulty: state.pve?.difficulty || "veteran",
      round: roundOf(state, s.round),
      voteMaps: state.voteMaps ? state.voteMaps.split(",") : [],
      away: !!this.room && !!state.players.get(this.room.sessionId)?.away,
    });
  }

  /** Prop Hunt ability (the server decides). */
  ability(msg: AbilityMessage) {
    this.send(C2S.ABILITY, msg);
  }

  /** Results: vote for the next map. */
  voteMap(map: MapId) {
    this.send(C2S.VOTE, { map });
  }

  /** Leaves the running match only: stays in the room (and team) for the next match. */
  leaveMatch() {
    this.send(C2S.LEAVE_MATCH, {});
  }

  send(type: string, payload?: unknown) {
    this.room?.send(type, payload);
  }

  setReady(ready: boolean) {
    this.send(C2S.READY, { ready });
  }

  updateSettings(settings: MatchSettings) {
    this.send(C2S.SETTINGS, settings);
  }

  startMatch() {
    this.send(C2S.START, {});
  }

  setLoadout(loadout: Loadout) {
    this.send(C2S.LOADOUT, loadout);
  }

  kick(id: string) {
    this.send(C2S.KICK, { id });
  }

  /** Team modes: move to a team (lobby and results). */
  setTeam(team: 1 | 2) {
    this.send(C2S.TEAM, { team });
  }

  /** Team modes, host only: rebalance by level. */
  balanceTeams() {
    this.send(C2S.BALANCE, {});
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.forgetReconnect();
    if (room) {
      try {
        await room.leave(true);
      } catch {
        // already closed
      }
    }
    gameEvents.emit("roomChanged", null);
    sessionStore.set({ ...initialState });
  }

  private rememberReconnect(token: string) {
    try {
      sessionStorage.setItem(RECONNECT_KEY, token);
    } catch {
      // ignore
    }
  }

  private forgetReconnect() {
    try {
      sessionStorage.removeItem(RECONNECT_KEY);
    } catch {
      // ignore
    }
  }
}

function humanizeJoinError(err: unknown): string {
  if (err instanceof JoinError) return err.code === CLOSE.UNREACHABLE ? err.message : closeReason(err.code);
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid identity|unknown player/i.test(msg))
    return "Your profile is no longer valid. Create a new one.";
  if (/already in this room/i.test(msg)) return "You are already in this room in another tab.";
  if (/not found|closed|expired/i.test(msg)) return "Room not found, full, or already closed.";
  if (/locked|full/i.test(msg)) return "That room is full.";
  if (/fetch|network|ECONNREFUSED|reach/i.test(msg)) return "Cannot reach the game server.";
  return msg || "Could not join the room.";
}

function leaveReason(code: number): string {
  if (code === 4101) return "You were removed from the room by the host.";
  if (code === 4102) return "Disconnected for inactivity.";
  if (code === 4002) return "Disconnected: the server rejected a message from this client.";
  if (code === 4001) return "The server restarted for an update. Join a new match.";
  if (code === 4003) return "Connection lost and could not be restored.";
  return `Disconnected from the server (code ${code}).`;
}

/** The client only uses the SDK Room API subset that the in-browser rooms implement. */
function asRoom(room: object): Room<unknown, MatchState> {
  return room as unknown as Room<unknown, MatchState>;
}

function resumeToken(room: Room<unknown, MatchState>): string {
  return HOST_MODE ? `${room.roomId}:${room.reconnectionToken}` : room.reconnectionToken;
}

function localPlayer(loadout: Loadout): LocalPlayer {
  const d = localProfile.load();
  if (!d) throw new Error("No profile: create one first");
  return {
    name: d.nickname,
    level: levelFromXp(d.xp).level,
    skin: loadout.skin,
    primary: loadout.primary,
    profileId: d.id,
  };
}

function currentLoadoutOf(): Loadout {
  const d = localProfile.load();
  return {
    primary: d && isWeaponId(d.primary) ? d.primary : DEFAULT_PRIMARY,
    skin: d?.skin ?? DEFAULT_SKIN,
  };
}

export const session = new GameSession();
