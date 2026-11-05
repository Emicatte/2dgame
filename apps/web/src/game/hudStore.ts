import { createStore } from "../lib/store.ts";

export interface HudSlot {
  key: string;
  weaponId: string | null;
  name: string;
  mag: number;
  reserve: number;
  active: boolean;
}

/** Vehicle panel: shown while the local player sits in a vehicle. */
export interface HudVehicle {
  name: string;
  kind: string;
  /** Role of the local player's seat: driver, pilot, gunner, passenger. */
  role: string;
  seat: number;
  hp: number;
  maxHp: number;
  /** km/h shown to drivers and pilots. */
  speedKmh: number;
  /** Helicopter: altitude in % and whether take-off is engaged. */
  altitude: number | null;
  lift: boolean;
  /** Cannot touch down here (hovering over an obstacle). */
  landBlocked: boolean;
  occupants: { seat: number; role: string; name: string; you: boolean }[];
  /** Role of every seat (driver/pilot, gunner, passenger), by seat index. */
  seatRoles: string[];
  freeSeats: number;
  seats: number;
  /** The seat can fire (and whether the aim is inside its sector right now). */
  canFire: boolean;
  inSector: boolean;
  /** Seat weapon is a mounted gun. */
  mounted: boolean;
  canExit: boolean;
}

export interface HudState {
  ready: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  weaponId: string | null;
  weaponName: string;
  mag: number;
  magSize: number;
  reserve: number;
  slots: HudSlot[];
  reloading: boolean;
  reloadProgress: number;
  dashProgress: number;
  timeLeftSec: number;
  countdownSec: number;
  kills: number;
  deaths: number;
  streak: number;
  respawnInSec: number | null;
  killedBy: string | null;
  interactPrompt: string | null;
  vehicle: HudVehicle | null;
  protected: boolean;
  ping: number;
  fps: number;
  /** No ack for NET.inputStallMs: local input is held ("connection interrupted"). */
  stalled: boolean;
  damageFlash: number;
  damageAngle: number;
  hitConfirm: number;
  debug: {
    tick: number;
    renderLag: number;
    interpBuffer: number;
    jitter: number;
    pending: number;
    pendingP95: number;
    pendingMax: number;
    ackAge: number;
    snaps: number;
    correction: number;
    corrections: number;
    kbIn: number;
    kbOut: number;
    msgsOut: number;
    entities: number;
    fx: number;
  };
}

export const hudStore = createStore<HudState>({
  ready: false,
  alive: false,
  hp: 100,
  maxHp: 100,
  weaponId: null,
  weaponName: "",
  mag: 0,
  magSize: 0,
  reserve: 0,
  slots: [],
  reloading: false,
  reloadProgress: 0,
  dashProgress: 1,
  timeLeftSec: 0,
  countdownSec: 0,
  kills: 0,
  deaths: 0,
  streak: 0,
  respawnInSec: null,
  killedBy: null,
  interactPrompt: null,
  vehicle: null,
  protected: false,
  ping: 0,
  fps: 0,
  stalled: false,
  damageFlash: 0,
  damageAngle: 0,
  hitConfirm: 0,
  debug: {
    tick: 0,
    renderLag: 0,
    interpBuffer: 0,
    jitter: 0,
    pending: 0,
    pendingP95: 0,
    pendingMax: 0,
    ackAge: 0,
    snaps: 0,
    correction: 0,
    corrections: 0,
    kbIn: 0,
    kbOut: 0,
    msgsOut: 0,
    entities: 0,
    fx: 0,
  },
});

export const uiStore = createStore<{ scoreboard: boolean; menuOpen: boolean }>({
  scoreboard: false,
  menuOpen: false,
});
