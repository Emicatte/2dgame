import { createStore } from "../lib/store.ts";

export interface HudSlot {
  key: string;
  weaponId: string | null;
  name: string;
  mag: number;
  reserve: number;
  active: boolean;
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
  protected: boolean;
  ping: number;
  fps: number;
  damageFlash: number;
  damageAngle: number;
  hitConfirm: number;
  debug: {
    tick: number;
    renderLag: number;
    jitter: number;
    pending: number;
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
  protected: false,
  ping: 0,
  fps: 0,
  damageFlash: 0,
  damageAngle: 0,
  hitConfirm: 0,
  debug: {
    tick: 0,
    renderLag: 0,
    jitter: 0,
    pending: 0,
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
