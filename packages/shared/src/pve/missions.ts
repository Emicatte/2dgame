/**
 * Outbreak missions as data: steps, doors, interactive props, pre-placed groups, spawn zones and
 * waves. The authoritative room runs them (MissionDirector); the client reads the same definition
 * for objective text, markers, doors and props, so nothing mission-specific is hard-coded in either.
 */
import type { ZombieKind } from "../config/zombies.ts";
import type { MapId } from "../maps/types.ts";
import type { Rect, Vec2 } from "../sim/math.ts";

export interface DoorDef extends Rect {
  id: string;
  label: string;
  /** Open when the mission starts. */
  startOpen?: boolean;
}

export type PropKind = "generator" | "keycard" | "panel" | "terminal";

export interface PropDef extends Vec2 {
  id: string;
  kind: PropKind;
  label: string;
  /** Seconds the interact key must be held (one player at a time; progress pauses if released). */
  holdSec: number;
  /** Mission flag required before the prop can be used ("keycard"). */
  requires?: string;
  /** Flag set when the prop is used. */
  sets?: string;
  /** Holding it is loud: nearby infected come to investigate (radius in px). */
  noise?: number;
}

export interface SpawnZoneDef extends Vec2 {
  id: string;
}

export interface PlacedEnemy extends Vec2 {
  kind: ZombieKind;
  /** Start idle (standing) or wandering around the spot. */
  state?: "idle" | "wander";
}

export interface GroupDef {
  id: string;
  enemies: PlacedEnemy[];
}

export interface WaveDef {
  /** Enemy counts for one player on Veteran; squad size and difficulty scale them. */
  enemies: Partial<Record<ZombieKind, number>>;
  /** Spawn zones used (default: all of the mission's zones). */
  zones?: string[];
  /** A supply crate drops near the squad when the wave is cleared. */
  supply?: boolean;
  /** Banner shown when the wave starts. */
  label?: string;
}

export type Trigger =
  | { open: string }
  | { close: string }
  | { power: boolean }
  | { alarm: boolean }
  | { spawn: string }
  | { hint: string }
  | { supply: Vec2 }
  | { checkpoint: Vec2 };

interface StepBase {
  /** Objective line shown in the HUD. */
  text: string;
  /** Integrated tutorial: a short hint shown once when the step starts. */
  hint?: string;
  /** Where the objective marker points (off-screen arrow). */
  marker?: Vec2;
  onStart?: Trigger[];
  onDone?: Trigger[];
}

export type StepDef =
  | (StepBase & { kind: "reach"; area: Rect })
  | (StepBase & { kind: "interact"; prop: string })
  | (StepBase & { kind: "collect"; props: string[] })
  | (StepBase & { kind: "waves"; waves: WaveDef[]; intermissionSec?: number })
  | (StepBase & { kind: "kill"; group: string })
  | (StepBase & { kind: "extract"; area: Rect; holdSec: number; horde?: WaveDef });

export interface MissionDef {
  id: string;
  /** Campaign order (1-based). */
  chapter: number;
  name: string;
  setting: string;
  /** Briefing shown in the lobby. */
  brief: string;
  map: MapId;
  doors: DoorDef[];
  props: PropDef[];
  groups: GroupDef[];
  spawnZones: SpawnZoneDef[];
  steps: StepDef[];
  /** Background pressure between scripted waves: a few infected trickle in. */
  ambient?: { everySec: number; maxAlive: number; kinds: ZombieKind[]; zones: string[] };
  /** Mission XP at Veteran (difficulty multiplies it). */
  xp: number;
  /** Cosmetic title unlocked on first completion. */
  title: string;
  /** Mission id that must be completed first (campaign unlocks). */
  requires?: string;
}

// ------------------------------------------------------------------ First Contact

const FC_HALL: Rect = { x: 164, y: 784, w: 912, h: 612 };
const FC_EXTRACT: Rect = { x: 2700, y: 190, w: 420, h: 380 };

export const FIRST_CONTACT: MissionDef = {
  id: "first-contact",
  chapter: 1,
  name: "First Contact",
  setting: "Halvorsen Works · industrial complex",
  brief:
    "The Halvorsen chemical plant went silent two days ago. Get in, bring the power back, find the security keycard and get out through the north-east helipad.",
  map: "works",
  doors: [
    { id: "gen-shutter", label: "Generator shutter", x: 876, y: 300, w: 24, h: 140 },
    { id: "office-door", label: "Office door", x: 2200, y: 1380, w: 24, h: 140 },
    { id: "sec-gate", label: "Security gate", x: 2560, y: 976, w: 160, h: 24 },
  ],
  props: [
    { id: "generator", kind: "generator", label: "Generator", x: 435, y: 330, holdSec: 5, noise: 900 },
    {
      id: "keycard",
      kind: "keycard",
      label: "Security keycard",
      x: 2800,
      y: 1660,
      holdSec: 0.8,
      sets: "keycard",
    },
    {
      id: "gate-panel",
      kind: "panel",
      label: "Gate panel",
      x: 2470,
      y: 1060,
      holdSec: 3,
      requires: "keycard",
      noise: 700,
    },
  ],
  groups: [
    {
      id: "yard",
      enemies: [
        { kind: "walker", x: 860, y: 1500, state: "wander" },
        { kind: "walker", x: 1060, y: 1900, state: "wander" },
      ],
    },
    {
      id: "hall",
      enemies: [
        { kind: "walker", x: 820, y: 1040, state: "idle" },
        { kind: "walker", x: 470, y: 1160, state: "idle" },
        { kind: "walker", x: 900, y: 1330, state: "wander" },
      ],
    },
    {
      id: "gen",
      enemies: [
        { kind: "walker", x: 700, y: 390, state: "idle" },
        { kind: "walker", x: 260, y: 300, state: "idle" },
        { kind: "runner", x: 560, y: 520, state: "idle" },
      ],
    },
    {
      id: "court",
      enemies: [
        { kind: "walker", x: 1500, y: 680, state: "wander" },
        { kind: "walker", x: 1820, y: 1160, state: "wander" },
        { kind: "walker", x: 1360, y: 1040, state: "idle" },
      ],
    },
    {
      id: "office",
      enemies: [
        { kind: "brute", x: 2780, y: 1400, state: "idle" },
        { kind: "walker", x: 2360, y: 1500, state: "idle" },
        { kind: "walker", x: 2720, y: 1700, state: "idle" },
        { kind: "runner", x: 2860, y: 1560, state: "idle" },
      ],
    },
  ],
  spawnZones: [
    { id: "north-1", x: 1320, y: 110 },
    { id: "north-2", x: 1720, y: 110 },
    { id: "east", x: 3100, y: 1110 },
    { id: "south", x: 1600, y: 2150 },
    { id: "south-east", x: 3060, y: 2130 },
    { id: "storage", x: 2420, y: 2150 },
    { id: "west", x: 76, y: 690 },
  ],
  steps: [
    {
      kind: "reach",
      text: "Enter the main hall",
      hint: "Infected react to noise. Gunfire draws them in.",
      area: FC_HALL,
      marker: { x: 600, y: 1410 },
      onStart: [{ spawn: "yard" }, { spawn: "hall" }],
    },
    {
      kind: "interact",
      prop: "generator",
      text: "Restore power at the generator",
      hint: "Hold E at the generator. It is loud: cover whoever holds it.",
      marker: { x: 435, y: 330 },
      onStart: [{ spawn: "gen" }, { checkpoint: { x: 620, y: 1300 } }],
      onDone: [
        { power: true },
        { alarm: true },
        { open: "gen-shutter" },
        { spawn: "court" },
        { hint: "The alarm is drawing them in. Hold the courtyard!" },
      ],
    },
    {
      kind: "waves",
      text: "Hold the courtyard",
      hint: "Downed allies can be revived: hold E next to them.",
      marker: { x: 1600, y: 1050 },
      intermissionSec: 8,
      waves: [
        { enemies: { walker: 8 }, zones: ["north-1", "north-2", "west"], label: "First wave" },
        {
          enemies: { walker: 10, runner: 2 },
          zones: ["north-1", "north-2", "east", "south"],
          supply: true,
          label: "Runners incoming",
        },
        {
          enemies: { walker: 12, runner: 3, exploder: 1 },
          zones: ["north-1", "east", "south", "west"],
          label: "Exploder: pop it at range",
        },
      ],
      onStart: [{ checkpoint: { x: 1450, y: 1150 } }],
      onDone: [
        { alarm: false },
        { open: "office-door" },
        { hint: "The offices are open. Find the keycard." },
      ],
    },
    {
      kind: "collect",
      props: ["keycard"],
      text: "Find the security keycard in the offices",
      hint: "Brute: dodge its charge. It staggers if it slams into a wall.",
      marker: { x: 2800, y: 1660 },
      onStart: [{ spawn: "office" }, { checkpoint: { x: 2050, y: 1450 } }],
    },
    {
      kind: "interact",
      prop: "gate-panel",
      text: "Open the security gate",
      marker: { x: 2470, y: 1060 },
      onDone: [{ open: "sec-gate" }, { alarm: true }],
    },
    {
      kind: "extract",
      area: FC_EXTRACT,
      holdSec: 15,
      text: "Reach the helipad and hold until extraction",
      hint: "Everyone still standing must be on the pad.",
      marker: { x: 2910, y: 380 },
      onStart: [{ checkpoint: { x: 2640, y: 1080 } }],
      horde: {
        enemies: { walker: 14, runner: 4, exploder: 1 },
        zones: ["east", "south-east", "storage"],
        label: "They're swarming the gate!",
      },
    },
  ],
  ambient: {
    everySec: 14,
    maxAlive: 4,
    kinds: ["walker", "walker", "runner"],
    zones: ["south", "storage", "south-east"],
  },
  xp: 900,
  title: "First Responder",
};

export const MISSIONS: readonly MissionDef[] = [FIRST_CONTACT];

/**
 * The rest of the planned campaign (shown in the lobby as "in development"; not playable until
 * built and verified — no placeholder missions).
 */
export const CAMPAIGN_PLAN: readonly { chapter: number; name: string; setting: string }[] = [
  { chapter: 1, name: "First Contact", setting: "Industrial complex" },
  { chapter: 2, name: "Dead District", setting: "Abandoned city" },
  { chapter: 3, name: "The Convoy", setting: "Industrial road and outskirts" },
  { chapter: 4, name: "Black Site", setting: "Underground laboratory" },
  { chapter: 5, name: "Final Breach", setting: "Research facility" },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

// ------------------------------------------------------------------ Survival

/** Maps offered for Survival Endless; zones are derived from the map when not authored. */
export const SURVIVAL_MAPS: readonly MapId[] = ["works", "industrial", "facility"];

export const SURVIVAL = {
  intermissionSec: 15,
  /** A supply crate every this many waves. */
  supplyEvery: 3,
  /** Every this many waves the wave is a special event (brute pack). */
  eventEvery: 5,
} as const;

/** Wave composition for Survival (one player, Veteran: scaled by squad size and difficulty). */
export function survivalWave(n: number): WaveDef {
  // Waves 1-5 follow the design table; afterwards the horde grows and specials unlock.
  switch (n) {
    case 1:
      return { enemies: { walker: 8 }, label: "Wave 1" };
    case 2:
      return { enemies: { walker: 12, runner: 3 }, label: "Wave 2 · runners" };
    case 3:
      return { enemies: { walker: 12, runner: 4, exploder: 2 }, supply: true, label: "Wave 3" };
    case 4:
      return { enemies: { walker: 14, runner: 4, spitter: 3, brute: 1 }, label: "Wave 4 · brute" };
    case 5:
      return { enemies: { brute: 2, walker: 10, runner: 4, exploder: 2 }, label: "Wave 5 · brute pack" };
  }
  const k = n - 5;
  const total = 26 + k * 3;
  const event = n % SURVIVAL.eventEvery === 0;
  const brutes = event ? 2 + Math.floor(k / 5) : n >= 7 ? 1 : 0;
  const stalkers = n >= 6 ? 1 + Math.floor(k / 4) : 0;
  const spitters = 2 + Math.floor(k / 3);
  const exploders = 2 + Math.floor(k / 4);
  const runners = 4 + Math.floor(k / 2);
  const walkers = Math.max(6, total - brutes - stalkers - spitters - exploders - runners);
  return {
    enemies: {
      walker: walkers,
      runner: runners,
      spitter: spitters,
      exploder: exploders,
      stalker: stalkers,
      brute: brutes,
    },
    supply: n % SURVIVAL.supplyEvery === 0,
    label: event ? `Wave ${n} · brute pack` : `Wave ${n}`,
  };
}
