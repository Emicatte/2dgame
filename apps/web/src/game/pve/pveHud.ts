import {
  bossPhase,
  DIFFICULTY,
  isDifficulty,
  isVehicleKind,
  type MatchState,
  type MissionDef,
  missionById,
  type NetEvent,
  PLAYER,
  PVE_STATUS,
  parseIdList,
  VEHICLES,
  zombieByIndex,
} from "@scrapline/shared";
import { createStore } from "../../lib/store.ts";
import { sessionStore } from "../../net/session.ts";

/**
 * PvE HUD model: the scene fills it from the synchronized state (objective, wave, squad, prompts,
 * off-screen markers) and events (hints, banners, feed); the DOM HUD renders it. Kept in its own
 * store so the competitive HUD is untouched.
 */

export interface PveSquadMember {
  id: string;
  name: string;
  hp: number;
  downed: boolean;
  /** Seconds before a downed member bleeds out. */
  bleedSec: number;
  dead: boolean;
  you: boolean;
  revive: number;
}

export interface ScreenMarker {
  /** Screen position (CSS px) clamped to the edge when off screen. */
  x: number;
  y: number;
  /** Direction from the screen centre (rad), for the arrow. */
  angle: number;
  onScreen: boolean;
  /** Distance in metres (1 m ≈ 16 px). */
  distM: number;
  label: string;
  downed?: boolean;
}

export interface PveHudState {
  active: boolean;
  mode: "outbreak" | "survival";
  missionName: string;
  difficulty: string;
  objective: string;
  step: number;
  steps: number;
  prog: number;
  count: number;
  countMax: number;
  wave: number;
  left: number;
  nextWaveSec: number | null;
  kills: number;
  selfRevives: number;
  status: number;
  squad: PveSquadMember[];
  me: {
    downed: boolean;
    bleedSec: number;
    revive: number;
    reviver: string;
    selfReviveSec: number | null;
    dead: boolean;
    /** Joined the run in progress (never went down): waits for the next checkpoint. */
    late: boolean;
  } | null;
  prompt: { text: string; progress: number; blocked?: boolean } | null;
  marker: ScreenMarker | null;
  allies: ScreenMarker[];
  hint: { text: string; id: number } | null;
  banner: { text: string; tone: "wave" | "good" | "bad" | "info"; id: number } | null;
  feed: { id: number; text: string; tone: "good" | "bad" | "info"; at: number }[];
  /** The local player is under the top-left panels: they fade so nothing hides the player. */
  fadeLeft: boolean;
  /** Boss health bar (name, health, phase 1-based of `phases`). */
  boss: { name: string; hp: number; mhp: number; phase: number; phases: number } | null;
  /** Escorted vehicle's hull (0..1), when the mission has one. */
  escort: { frac: number; locked: boolean } | null;
}

const initial: PveHudState = {
  active: false,
  mode: "outbreak",
  missionName: "",
  difficulty: "veteran",
  objective: "",
  step: 0,
  steps: 0,
  prog: 0,
  count: 0,
  countMax: 0,
  wave: 0,
  left: 0,
  nextWaveSec: null,
  kills: 0,
  selfRevives: 0,
  status: 0,
  squad: [],
  me: null,
  prompt: null,
  marker: null,
  allies: [],
  hint: null,
  banner: null,
  feed: [],
  boss: null,
  escort: null,
  fadeLeft: false,
};

export const pveHudStore = createStore<PveHudState>({ ...initial });

let counter = 0;
const seenHints = new Set<string>();

function name(id: string): string {
  return sessionStore.get().players.find((p) => p.id === id)?.name ?? "?";
}

function pushFeed(text: string, tone: "good" | "bad" | "info") {
  const now = performance.now();
  const feed = [
    ...pveHudStore.get().feed.filter((f) => now - f.at < 6000),
    { id: ++counter, text, tone, at: now },
  ].slice(-5);
  pveHudStore.patch({ feed });
}

function banner(text: string, tone: "wave" | "good" | "bad" | "info") {
  pveHudStore.patch({ banner: { text, tone, id: ++counter } });
}

export function objectiveText(mission: MissionDef | undefined, state: MatchState): string {
  if (!mission) {
    if (state.pve.wave === 0 || (state.pve.left === 0 && state.pve.nextWave > 0))
      return "Get ready: the next wave is coming";
    return "Survive the horde";
  }
  return mission.steps[state.pve.step]?.text ?? "";
}

/** Mission of the last update (labels for the feed). */
let currentMission = "";

export const pveHud = {
  reset(): void {
    seenHints.clear();
    pveHudStore.set({ ...initial });
  },

  onEvent(ev: NetEvent, self: string): void {
    switch (ev.t) {
      case "pve":
        switch (ev.k) {
          case "hint":
            // Integrated tutorial: each hint once per run.
            if (ev.s && !seenHints.has(ev.s)) {
              seenHints.add(ev.s);
              pveHudStore.patch({ hint: { text: ev.s, id: ++counter } });
            }
            break;
          case "wave":
            banner(ev.s ?? `Wave ${ev.n ?? ""}`, "wave");
            break;
          case "clear":
            banner(`Wave ${ev.n ?? ""} cleared`, "good");
            break;
          case "supply":
            pushFeed("Supply crate dropped nearby", "good");
            break;
          case "door":
            pushFeed("A door opened", "info");
            break;
          case "prop": {
            const label = missionById(currentMission)?.props.find((p) => p.id === ev.s)?.label;
            pushFeed(
              ev.s === "keycard" ? "Keycard secured" : label ? `${label}: done` : "Objective done",
              "good",
            );
            break;
          }
          case "complete":
            banner("Mission complete", "good");
            break;
          case "bossPhase":
            banner(`Phase ${ev.n ?? ""}: it's enraged!`, "wave");
            break;
          case "failed":
            banner(ev.s || "Mission failed", "bad");
            break;
        }
        break;
      case "down":
        pushFeed(ev.p === self ? "You are down! A teammate can revive you" : `${name(ev.p)} is down`, "bad");
        if (ev.p === self && !seenHints.has("downed")) {
          seenHints.add("downed");
          pveHudStore.patch({
            hint: {
              text: "Downed: crawl to cover. A teammate holds E next to you to revive you.",
              id: ++counter,
            },
          });
        }
        break;
      case "revive":
        pushFeed(
          ev.by === ""
            ? `${ev.p === self ? "You" : name(ev.p)} got back up`
            : `${name(ev.by)} revived ${ev.p === self ? "you" : name(ev.p)}`,
          "good",
        );
        break;
      case "bleed":
        pushFeed(`${ev.p === self ? "You" : name(ev.p)} bled out: back at the next checkpoint`, "bad");
        break;
      default:
        break;
    }
  },

  /** Snapshot from the synchronized state (the scene calls this a few times per second). */
  update(
    state: MatchState,
    self: string,
    serverTick: number,
    extra: Pick<PveHudState, "prompt" | "marker" | "allies" | "fadeLeft">,
  ): void {
    const mode = state.mode === "survival" ? "survival" : "outbreak";
    const mission = mode === "outbreak" ? missionById(state.pve.mission) : undefined;
    currentMission = state.pve.mission;
    const tickRate = state.tickRate || 20;
    const squad: PveSquadMember[] = [];
    state.players.forEach((p, id) => {
      squad.push({
        id,
        name: p.name,
        hp: p.hp,
        downed: p.downed,
        bleedSec: p.bleed / 10,
        dead: !p.alive,
        you: id === self,
        revive: p.revive,
      });
    });
    const me = state.players.get(self);
    const solo = state.players.size === 1;
    const bz = state.pve.boss ? state.zombies.get(state.pve.boss) : undefined;
    const bdef = bz ? zombieByIndex(bz.k) : undefined;
    const boss =
      bz && bdef?.boss
        ? {
            name: bdef.name,
            hp: bz.hp,
            mhp: bz.mhp,
            phase: bossPhase(bdef, bz.hp / Math.max(1, bz.mhp)) + 1,
            phases: bdef.boss.phases.length,
          }
        : null;
    const difficulty = isDifficulty(state.pve.difficulty) ? state.pve.difficulty : "veteran";
    const ev = mission?.escort ? state.vehicles.get(mission.escort) : undefined;
    const escort =
      ev && isVehicleKind(ev.kind)
        ? {
            frac: ev.status === 0 ? Math.max(0, ev.hp / VEHICLES[ev.kind].maxHp) : 0,
            locked: parseIdList(state.pve.flags).has(`locked-${mission!.escort}`),
          }
        : null;
    pveHudStore.patch({
      escort,
      active: true,
      mode,
      missionName: mission?.name ?? "Survival",
      difficulty: DIFFICULTY[difficulty].name,
      objective: objectiveText(mission, state),
      step: state.pve.step,
      steps: mission?.steps.length ?? 0,
      prog: state.pve.prog,
      count: state.pve.count,
      countMax: state.pve.countMax,
      wave: state.pve.wave,
      left: state.pve.left,
      nextWaveSec: state.pve.nextWave > serverTick ? (state.pve.nextWave - serverTick) / tickRate : null,
      kills: state.pve.kills,
      selfRevives: state.pve.selfRevives,
      status: state.pve.status,
      squad,
      me: me
        ? {
            downed: me.downed,
            bleedSec: me.bleed / 10,
            revive: me.revive,
            reviver: "",
            selfReviveSec: solo && me.downed && state.pve.selfRevives > 0 ? null : null,
            dead: !me.alive && state.pve.status === PVE_STATUS.RUNNING,
            late: !me.alive && me.deaths === 0 && state.pve.status === PVE_STATUS.RUNNING,
          }
        : null,
      boss,
      ...extra,
    });
    void PLAYER;
  },
};
