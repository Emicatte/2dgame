import { Client, type Room } from "@colyseus/sdk";
import {
  C2S,
  type JoinOptions,
  type MapId,
  type MatchPhase,
  type MatchSettings,
  MatchState,
  type NetEvent,
  type NoticeMessage,
  type ResultsMessage,
  ROOM_NAME,
  type RoomKind,
  S2C,
  type WeaponId,
} from "@scrapline/shared";
import { createStore, Emitter } from "../lib/store.ts";
import { api, identity, SERVER_URL } from "./api.ts";

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

  private options(kind: RoomKind, loadout: Loadout, map?: MapId): JoinOptions {
    const token = identity.get();
    if (!token) throw new Error("No identity: create a profile first");
    return { token, kind, primary: loadout.primary, skin: loadout.skin, ...(map ? { map } : {}) };
  }

  async quickMatch(loadout: Loadout): Promise<void> {
    await this.connect(() => this.client.joinOrCreate(ROOM_NAME, this.options("quick", loadout), MatchState));
  }

  async createPrivate(loadout: Loadout, map: MapId, extra: Record<string, unknown> = {}): Promise<void> {
    await this.connect(() =>
      this.client.create(ROOM_NAME, { ...this.options("private", loadout, map), ...extra }, MatchState),
    );
  }

  async joinByCode(code: string, loadout: Loadout): Promise<void> {
    await this.connect(async () => {
      const { roomId } = await api.roomByCode(code);
      return this.client.joinById(roomId, this.options("private", loadout), MatchState);
    });
  }

  async joinById(roomId: string, loadout: Loadout): Promise<void> {
    await this.connect(() => this.client.joinById(roomId, this.options("quick", loadout), MatchState));
  }

  /** Resumes a match after a page reload, if the server still holds our seat. */
  async tryResume(): Promise<boolean> {
    let token: string | null = null;
    try {
      token = sessionStorage.getItem(RECONNECT_KEY);
    } catch {
      return false;
    }
    if (!token) return false;
    try {
      await this.connect(() => this.client.reconnect(token, MatchState));
      return true;
    } catch {
      this.forgetReconnect();
      sessionStore.patch({ status: "idle", error: null });
      return false;
    }
  }

  private async connect(join: () => Promise<Room<unknown, MatchState>>): Promise<void> {
    if (this.room) await this.leave();
    sessionStore.set({ ...initialState, status: "connecting" });
    try {
      const room = await join();
      this.attach(room);
    } catch (err) {
      const message = humanizeJoinError(err);
      sessionStore.patch({ status: "error", error: message });
      throw new Error(message);
    }
  }

  private attach(room: Room<unknown, MatchState>) {
    this.room = room;
    this.rememberReconnect(room.reconnectionToken);
    sessionStore.patch({ status: "connected", error: null, roomId: room.roomId, selfId: room.sessionId });

    room.onStateChange((state) => this.project(state));
    room.onMessage(S2C.EVENTS, (events: NetEvent[]) => {
      gameEvents.emit("net", { events, tick: room.state.tick + 1 });
    });
    room.onMessage(S2C.NOTICE, (msg: NoticeMessage) => gameEvents.emit("notice", msg));
    room.onMessage(S2C.RESULTS, (msg: ResultsMessage) => {
      sessionStore.patch({ results: msg });
      gameEvents.emit("results", msg);
    });
    room.onDrop(() => sessionStore.patch({ status: "reconnecting" }));
    room.onReconnect(() => {
      this.rememberReconnect(room.reconnectionToken);
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
        error: consented ? null : leaveReason(code),
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
    });
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

export const session = new GameSession();
