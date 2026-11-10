/**
 * Outbreak missions as data: steps, doors, interactive props, pre-placed groups, spawn zones and
 * waves. The authoritative room runs them (MissionDirector); the client reads the same definition
 * for objective text, markers, doors and props, so nothing mission-specific is hard-coded in either.
 */
import type { VehicleKind } from "../config/vehicles.ts";
import type { ZombieKind } from "../config/zombies.ts";
import type { MapId } from "../maps/types.ts";
import type { Rect, Vec2 } from "../sim/math.ts";

export interface DoorDef extends Rect {
  id: string;
  label: string;
  /** Open when the mission starts. */
  startOpen?: boolean;
  /**
   * Automatic sliding door: while the power is on it opens for anybody (players and infected)
   * near it and closes behind them once the doorway is clear. Without power, or while sealed
   * (a `close` trigger, or `sealed` at the start; an `open` trigger lifts the seal), it stays shut.
   * The infected path through working automatic doors as if they were open.
   */
  auto?: boolean;
  /** Automatic door sealed when the mission starts (lockdown). */
  sealed?: boolean;
}

export type PropKind =
  | "generator"
  | "keycard"
  | "panel"
  | "terminal"
  | "medical"
  | "radio"
  | "engine"
  | "intel"
  | "rig";

/**
 * Security system: a decontamination vent that floods its area with scalding gas on a cycle while
 * the power is on. Each cycle: idle, then `warnSec` of warning lights and hiss, then `activeSec`
 * of gas that hurts players (`dps`) and the infected (`dps` × 2). Everybody sees the same cycle:
 * it runs from the tick the vents came online (PveState.vents).
 */
export interface VentDef {
  id: string;
  area: Rect;
  periodSec: number;
  warnSec: number;
  activeSec: number;
  /** Shifts this vent's cycle (s) so neighbours do not fire together. */
  offsetSec: number;
  dps: number;
  /** Online while this mission flag is set (instead of while the power is on). */
  flag?: string;
}

/** Whether a vent works: its flag is set, or (no flag) the power is on. */
export function ventOnline(v: VentDef, power: boolean, flags: ReadonlySet<string>): boolean {
  return v.flag ? flags.has(v.flag) : power;
}

export const VENT_PHASE = { IDLE: 0, WARN: 1, ACTIVE: 2 } as const;
export type VentPhase = (typeof VENT_PHASE)[keyof typeof VENT_PHASE];

/** Phase of a vent `sinceSec` seconds after the vents came online (negative = offline). */
export function ventPhase(v: VentDef, sinceSec: number): VentPhase {
  if (sinceSec < 0) return VENT_PHASE.IDLE;
  const t = (((sinceSec + v.offsetSec) % v.periodSec) + v.periodSec) % v.periodSec;
  const activeFrom = v.periodSec - v.activeSec;
  if (t >= activeFrom) return VENT_PHASE.ACTIVE;
  if (t >= activeFrom - v.warnSec) return VENT_PHASE.WARN;
  return VENT_PHASE.IDLE;
}

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
  /**
   * Attached to a vehicle (its id): the prop follows it, `x`/`y` are the offset in the vehicle's
   * frame (x forward). Used for the convoy truck's engine.
   */
  attach?: string;
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
  /** A boss leads the wave (spawned first, far from the squad); the wave ends when it falls. */
  boss?: ZombieKind;
}

export type Trigger =
  | { open: string }
  | { close: string }
  | { power: boolean }
  | { alarm: boolean }
  | { spawn: string }
  | { hint: string }
  | { supply: Vec2 }
  | { checkpoint: Vec2 }
  /** Vehicle (id) out of use: everyone aboard gets out, nobody can get in until unlocked. */
  | { lock: string }
  | { unlock: string }
  /** Mission flags set or cleared by the script ("blackout": the main lights go out). */
  | { set: string }
  | { unset: string };

interface StepBase {
  /** Objective line shown in the HUD. */
  text: string;
  /** Integrated tutorial: a short hint shown once when the step starts. */
  hint?: string;
  /** Where the objective marker points (off-screen arrow). */
  marker?: Vec2;
  /** The mission fails if the step is not done within this many seconds (a countdown). */
  limitSec?: number;
  onStart?: Trigger[];
  onDone?: Trigger[];
}

export type StepDef =
  | (StepBase & { kind: "reach"; area: Rect })
  /** `horde`: a wave that attacks while the prop is being used (a repair under fire). */
  | (StepBase & { kind: "interact"; prop: string; horde?: WaveDef })
  | (StepBase & { kind: "collect"; props: string[] })
  | (StepBase & { kind: "waves"; waves: WaveDef[]; intermissionSec?: number })
  /** `onPhase[i]`: triggers when the group's boss enters its phase i (the arena changes). */
  | (StepBase & { kind: "kill"; group: string; onPhase?: Trigger[][] })
  /**
   * Keep a prop (`hp`) alive for `sec` seconds: the infected go for it as they go for players.
   * The mission fails if it is destroyed. `horde` attacks from the start of the step.
   */
  | (StepBase & { kind: "defend"; prop: string; sec: number; hp: number; horde?: WaveDef })
  | (StepBase & { kind: "extract"; area: Rect; holdSec: number; horde?: WaveDef })
  /**
   * Bring a vehicle (of `vehicle` kind, if set) into the area with every standing player there,
   * on foot or aboard. `horde` chases from the start of the step.
   */
  | (StepBase & { kind: "drive"; area: Rect; vehicle?: VehicleKind; horde?: WaveDef });

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
  /** Vehicle (id) the squad escorts: the mission fails if it is destroyed. */
  escort?: string;
  /** Security vents (online while the power is on). */
  vents?: VentDef[];
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

// ------------------------------------------------------------------ Dead District

const DD_LOBBY: Rect = { x: 560, y: 630, w: 660, h: 400 };
const DD_GATE_APPROACH: Rect = { x: 4040, y: 2090, w: 350, h: 340 };
const DD_CHECKPOINT: Rect = { x: 4450, y: 2100, w: 300, h: 320 };

export const DEAD_DISTRICT: MissionDef = {
  id: "dead-district",
  chapter: 2,
  name: "Dead District",
  setting: "Marlow Street · abandoned city",
  brief:
    "A radio call from the Marlow apartments: survivors, wounded, out of medicine. Get them what they need from St. Anne clinic, hold the building while they patch up, then take their truck across the city to the military checkpoint.",
  map: "district",
  doors: [
    { id: "clinic-door", label: "Clinic door", x: 1920, y: 1460, w: 160, h: 24 },
    { id: "garage-door", label: "Garage door", x: 2550, y: 1460, w: 260, h: 24 },
    { id: "checkpoint-gate", label: "Checkpoint gate", x: 4400, y: 2100, w: 24, h: 280 },
  ],
  props: [
    { id: "radio", kind: "radio", label: "Survivors' radio", x: 890, y: 470, holdSec: 2 },
    { id: "med-1", kind: "medical", label: "Medical supplies", x: 1800, y: 1700, holdSec: 1.5 },
    { id: "med-2", kind: "medical", label: "Medical supplies", x: 2210, y: 1620, holdSec: 1.5 },
    { id: "med-3", kind: "medical", label: "Medical supplies", x: 2060, y: 1960, holdSec: 1.5 },
  ],
  groups: [
    {
      id: "avenue",
      enemies: [
        { kind: "walker", x: 760, y: 1250, state: "wander" },
        { kind: "walker", x: 1100, y: 1180, state: "wander" },
        { kind: "runner", x: 1180, y: 1330, state: "idle" },
        { kind: "walker", x: 1460, y: 900, state: "wander" },
      ],
    },
    {
      id: "lobby",
      enemies: [
        { kind: "walker", x: 700, y: 900, state: "idle" },
        { kind: "walker", x: 1050, y: 820, state: "idle" },
        { kind: "runner", x: 880, y: 980, state: "idle" },
      ],
    },
    {
      id: "clinic",
      enemies: [
        { kind: "spitter", x: 2180, y: 1580, state: "idle" },
        { kind: "walker", x: 1800, y: 1820, state: "idle" },
        { kind: "walker", x: 2220, y: 1880, state: "idle" },
        { kind: "runner", x: 1960, y: 1760, state: "idle" },
      ],
    },
    {
      id: "garage",
      enemies: [
        { kind: "brute", x: 2860, y: 1640, state: "idle" },
        { kind: "walker", x: 2520, y: 1760, state: "idle" },
      ],
    },
    {
      id: "route",
      enemies: [
        { kind: "runner", x: 3360, y: 1580, state: "idle" },
        { kind: "walker", x: 3330, y: 1900, state: "wander" },
        { kind: "walker", x: 3720, y: 2260, state: "wander" },
        { kind: "runner", x: 3960, y: 2380, state: "idle" },
        { kind: "walker", x: 4180, y: 2280, state: "idle" },
      ],
    },
  ],
  spawnZones: [
    { id: "north", x: 1460, y: 150 },
    { id: "alley", x: 2410, y: 150 },
    { id: "parking", x: 250, y: 560 },
    { id: "west", x: 150, y: 1250 },
    { id: "east", x: 3360, y: 1250 },
    { id: "east-far", x: 4600, y: 1250 },
    { id: "south", x: 1460, y: 2300 },
    { id: "southwest", x: 300, y: 2340 },
    { id: "lot", x: 2760, y: 2300 },
    { id: "river", x: 3500, y: 2300 },
    { id: "alley-e", x: 4020, y: 1760 },
  ],
  steps: [
    {
      kind: "reach",
      text: "Get to the Marlow apartments",
      hint: "Runners are fast and weave: let them come and shoot, don't run in a straight line.",
      area: DD_LOBBY,
      marker: { x: 900, y: 1070 },
      onStart: [{ spawn: "avenue" }, { spawn: "lobby" }],
    },
    {
      kind: "interact",
      prop: "radio",
      text: "Answer the survivors' radio",
      hint: "Behind the barricade: hold E at the radio.",
      marker: { x: 890, y: 470 },
      onStart: [{ checkpoint: { x: 890, y: 960 } }],
      onDone: [
        { open: "clinic-door" },
        { hint: "They need medicine. St. Anne clinic is across the avenue." },
      ],
    },
    {
      kind: "collect",
      props: ["med-1", "med-2", "med-3"],
      text: "Recover medical supplies from St. Anne clinic",
      hint: "Spitters keep their distance: close in behind cover, step out of the acid.",
      marker: { x: 2000, y: 1500 },
      onStart: [{ spawn: "clinic" }, { checkpoint: { x: 1460, y: 1250 } }],
      onDone: [{ hint: "Back to the apartments. They will come from every street." }],
    },
    {
      kind: "waves",
      text: "Hold the apartments while the survivors treat the wounded",
      hint: "Attacks come from different streets: split the angles, watch each other's backs.",
      marker: { x: 900, y: 1150 },
      intermissionSec: 7,
      waves: [
        { enemies: { walker: 7, runner: 4 }, zones: ["north", "parking", "west"], label: "North and west!" },
        {
          enemies: { walker: 7, runner: 6, spitter: 1 },
          zones: ["east", "south", "alley"],
          supply: true,
          label: "Now the east and the south!",
        },
        {
          enemies: { walker: 9, runner: 7, exploder: 1, brute: 1 },
          zones: ["north", "east", "south", "west", "alley", "parking"],
          label: "From every street!",
        },
      ],
      onStart: [{ checkpoint: { x: 890, y: 960 } }],
      onDone: [
        { open: "garage-door" },
        { alarm: true },
        { hint: "The survivors' truck is in the garage. The door alarm is loud: move." },
      ],
    },
    {
      kind: "drive",
      area: DD_GATE_APPROACH,
      vehicle: "armored",
      text: "Take the survivors' truck across the city to the checkpoint",
      hint: "One drives, the others take the roof gun (F changes seat). Ram them, don't stop.",
      marker: { x: 4200, y: 2260 },
      onStart: [{ spawn: "garage" }, { spawn: "route" }, { checkpoint: { x: 2680, y: 1300 } }],
      onDone: [{ open: "checkpoint-gate" }, { alarm: false }],
      horde: {
        enemies: { walker: 9, runner: 8 },
        zones: ["east", "east-far", "lot", "river"],
        label: "The engine is drawing the horde!",
      },
    },
    {
      kind: "extract",
      area: DD_CHECKPOINT,
      holdSec: 15,
      text: "Get inside the checkpoint and hold until the gate seals",
      hint: "Everyone still standing must be inside the compound.",
      marker: { x: 4600, y: 2260 },
      onStart: [{ checkpoint: { x: 4200, y: 2260 } }],
      horde: {
        enemies: { walker: 12, runner: 6, exploder: 1 },
        zones: ["river", "alley-e", "lot"],
        label: "Hold the gate!",
      },
    },
  ],
  ambient: {
    everySec: 12,
    maxAlive: 5,
    kinds: ["walker", "runner", "runner"],
    zones: ["north", "alley", "southwest", "parking", "lot"],
  },
  xp: 1100,
  title: "Street Medic",
  requires: "first-contact",
};

// ------------------------------------------------------------------ The Convoy

export const THE_CONVOY: MissionDef = {
  id: "the-convoy",
  chapter: 3,
  name: "The Convoy",
  setting: "Kessler Road · industrial road and outskirts",
  brief:
    "The evacuation needs the vaccine samples in the depot truck. One of you drives, the others ride the roof gun: get it through the warehouse district and the outskirts, keep it running, and over the river. If the truck dies, the mission does.",
  map: "outskirts",
  escort: "cv-truck",
  doors: [],
  props: [
    {
      id: "keys",
      kind: "keycard",
      label: "Truck keys",
      x: 220,
      y: 1640,
      holdSec: 1,
      sets: "keys",
    },
    // The engine sits at the truck's nose (offset in the vehicle's frame: 62 px forward).
    {
      id: "engine",
      kind: "engine",
      label: "Engine",
      x: 62,
      y: 0,
      holdSec: 18,
      noise: 900,
      attach: "cv-truck",
    },
  ],
  groups: [
    {
      id: "depot",
      enemies: [
        { kind: "walker", x: 600, y: 1700, state: "wander" },
        { kind: "walker", x: 900, y: 2150, state: "idle" },
        { kind: "runner", x: 420, y: 1960, state: "idle" },
        { kind: "walker", x: 300, y: 1690, state: "idle" },
      ],
    },
    {
      id: "district",
      enemies: [
        { kind: "walker", x: 2000, y: 1400, state: "wander" },
        { kind: "walker", x: 1990, y: 960, state: "idle" },
        { kind: "runner", x: 2050, y: 700, state: "idle" },
        { kind: "walker", x: 2600, y: 640, state: "wander" },
        { kind: "spitter", x: 2760, y: 300, state: "idle" },
        { kind: "walker", x: 3100, y: 560, state: "idle" },
        { kind: "runner", x: 3500, y: 620, state: "idle" },
        { kind: "walker", x: 3860, y: 560, state: "idle" },
        { kind: "walker", x: 3920, y: 680, state: "idle" },
      ],
    },
    {
      id: "outskirts",
      enemies: [
        { kind: "walker", x: 3900, y: 1000, state: "wander" },
        { kind: "exploder", x: 3860, y: 1320, state: "idle" },
        { kind: "walker", x: 3960, y: 1500, state: "idle" },
        { kind: "runner", x: 4200, y: 1700, state: "idle" },
        { kind: "spitter", x: 4560, y: 1240, state: "idle" },
        { kind: "walker", x: 4500, y: 1650, state: "idle" },
        { kind: "walker", x: 4700, y: 1760, state: "idle" },
      ],
    },
    {
      id: "bridge",
      enemies: [
        { kind: "walker", x: 5300, y: 1650, state: "idle" },
        { kind: "walker", x: 5450, y: 1760, state: "idle" },
        { kind: "runner", x: 5600, y: 1640, state: "idle" },
        { kind: "walker", x: 5820, y: 1720, state: "wander" },
      ],
    },
  ],
  spawnZones: [
    { id: "lot-w", x: 600, y: 1080 },
    { id: "lot-n", x: 1300, y: 640 },
    { id: "n-alley-1", x: 2760, y: 200 },
    { id: "n-alley-2", x: 3360, y: 200 },
    { id: "c-alley", x: 2940, y: 1300 },
    { id: "s-lot", x: 1600, y: 2250 },
    { id: "houses", x: 2700, y: 2200 },
    { id: "houses-e", x: 3620, y: 2250 },
    { id: "ne-north", x: 4400, y: 520 },
    { id: "ne-field", x: 4700, y: 1340 },
    { id: "pump-back", x: 4640, y: 2300 },
    { id: "se-lot", x: 4250, y: 2300 },
    { id: "east-n", x: 5850, y: 300 },
    { id: "east-s", x: 5850, y: 2250 },
  ],
  steps: [
    {
      kind: "collect",
      props: ["keys"],
      text: "Find the truck keys in the depot office",
      hint: "The convoy truck is locked. The keys are in the office.",
      marker: { x: 300, y: 1640 },
      onStart: [{ lock: "cv-truck" }, { spawn: "depot" }],
      onDone: [
        { unlock: "cv-truck" },
        { hint: "Truck unlocked. One drives (E); the others take the roof gun or a seat (F)." },
      ],
    },
    {
      kind: "drive",
      area: { x: 3700, y: 490, w: 310, h: 220 },
      vehicle: "armored",
      text: "Drive the convoy through the warehouse district",
      hint: "Keep moving: infected that reach the truck tear at its hull.",
      marker: { x: 3860, y: 600 },
      onStart: [{ spawn: "district" }, { checkpoint: { x: 2000, y: 1900 } }],
      horde: {
        enemies: { walker: 8, runner: 6 },
        zones: ["lot-w", "lot-n", "n-alley-1", "n-alley-2", "c-alley"],
        label: "The district wakes up!",
      },
    },
    {
      kind: "drive",
      area: { x: 4400, y: 1460, w: 460, h: 500 },
      vehicle: "armored",
      text: "Cross the outskirts to the pump station",
      hint: "Spitters and exploders ahead: the gunner clears, the driver weaves.",
      marker: { x: 4620, y: 1700 },
      onStart: [{ spawn: "outskirts" }, { checkpoint: { x: 3880, y: 640 } }],
      horde: {
        enemies: { walker: 8, runner: 4, spitter: 2, exploder: 1 },
        zones: ["c-alley", "houses", "houses-e", "ne-north"],
        label: "Infested outskirts!",
      },
    },
    {
      kind: "interact",
      prop: "engine",
      text: "Repair the overheating engine while the squad holds",
      hint: "Hold E at the truck's nose. Repairs pause when you let go: fight, then get back to it.",
      marker: { x: 4620, y: 1700 },
      onStart: [{ lock: "cv-truck" }, { checkpoint: { x: 4620, y: 1640 } }],
      onDone: [{ unlock: "cv-truck" }, { hint: "Engine running. Everyone aboard: the bridge!" }],
      horde: {
        enemies: { walker: 12, runner: 6, spitter: 2, brute: 1 },
        zones: ["ne-field", "pump-back", "se-lot", "houses-e"],
        label: "They heard the engine!",
      },
    },
    {
      kind: "drive",
      area: { x: 5720, y: 1460, w: 256, h: 500 },
      vehicle: "armored",
      text: "Get the convoy across the bridge",
      hint: "Don't stop on the bridge.",
      marker: { x: 5850, y: 1700 },
      onStart: [{ spawn: "bridge" }, { checkpoint: { x: 4620, y: 1640 } }],
      horde: {
        enemies: { walker: 10, runner: 8 },
        zones: ["pump-back", "se-lot", "ne-field", "houses-e"],
        label: "The whole road is coming!",
      },
    },
    {
      kind: "extract",
      area: { x: 5740, y: 1520, w: 230, h: 400 },
      holdSec: 20,
      text: "Hold the bridgehead until the helicopter lands",
      hint: "Everyone still standing must be on the pad. The truck makes good cover.",
      marker: { x: 5860, y: 1700 },
      onStart: [{ checkpoint: { x: 5850, y: 1700 } }],
      horde: {
        enemies: { walker: 12, runner: 8, exploder: 2 },
        zones: ["pump-back", "ne-field", "east-n", "east-s"],
        label: "Hold the bridgehead!",
      },
    },
  ],
  ambient: {
    everySec: 13,
    maxAlive: 5,
    kinds: ["walker", "walker", "runner"],
    zones: ["lot-w", "n-alley-1", "houses", "se-lot"],
  },
  xp: 1300,
  title: "Convoy Runner",
  requires: "dead-district",
};

// ------------------------------------------------------------------ Black Site

const BS_ATRIUM: Rect = { x: 1260, y: 1000, w: 920, h: 800 };
const BS_LIFT: Rect = { x: 3780, y: 2200, w: 460, h: 380 };
const BS_CELLS = ["cells-n1", "cells-n2", "cells-s1", "cells-s2"];

export const BLACK_SITE: MissionDef = {
  id: "black-site",
  chapter: 4,
  name: "Black Site",
  setting: "Site K-9 · underground laboratory",
  brief:
    "The convoy's manifest pointed here: a lab under the quarry where the outbreak began. Bring the power back, break the containment lockdown, recover Dr. Varga's research on the contagion and get out through the service lift. Something they kept in primary containment is still awake.",
  map: "blacksite",
  doors: [
    { id: "cont-door", label: "Containment blast door", x: 2196, y: 1260, w: 24, h: 160 },
    { id: "srv-door", label: "Server access", x: 2900, y: 960, w: 160, h: 24, auto: true, sealed: true },
    { id: "lab-door", label: "Lab access", x: 2760, y: 1816, w: 160, h: 24, auto: true, sealed: true },
    { id: "archive-door", label: "Archive door", x: 2460, y: 2220, w: 24, h: 160, auto: true },
    { id: "vault-door", label: "Primary containment", x: 3700, y: 1340, w: 24, h: 160 },
    { id: "lift-door", label: "Service lift", x: 3920, y: 2080, w: 180, h: 24 },
  ],
  props: [
    { id: "term-sec", kind: "terminal", label: "Security terminal", x: 1810, y: 300, holdSec: 3, noise: 650 },
    {
      id: "term-reactor",
      kind: "terminal",
      label: "Reactor terminal",
      x: 1700,
      y: 2540,
      holdSec: 3,
      noise: 650,
    },
    {
      id: "term-server",
      kind: "terminal",
      label: "Server terminal",
      x: 3140,
      y: 300,
      holdSec: 3,
      noise: 650,
    },
    { id: "override", kind: "panel", label: "Lockdown override", x: 2130, y: 1200, holdSec: 6, noise: 900 },
    { id: "intel-varga", kind: "intel", label: "Varga's notes", x: 3410, y: 1740, holdSec: 2 },
    { id: "intel-backup", kind: "intel", label: "Server backup", x: 2540, y: 720, holdSec: 2.5, noise: 500 },
    { id: "intel-archive", kind: "intel", label: "Contagion file", x: 3412, y: 2500, holdSec: 2 },
  ],
  groups: [
    {
      id: "entry",
      enemies: [
        { kind: "walker", x: 850, y: 1380, state: "idle" },
        { kind: "walker", x: 1120, y: 1440, state: "wander" },
        { kind: "walker", x: 1520, y: 1300, state: "idle" },
        { kind: "walker", x: 1900, y: 1480, state: "wander" },
        { kind: "walker", x: 1360, y: 1080, state: "idle" },
      ],
    },
    {
      id: "security",
      enemies: [
        { kind: "walker", x: 1400, y: 580, state: "idle" },
        { kind: "walker", x: 2000, y: 680, state: "idle" },
        { kind: "runner", x: 1600, y: 380, state: "idle" },
        { kind: "walker", x: 1900, y: 320, state: "wander" },
      ],
    },
    {
      id: "servers",
      enemies: [
        { kind: "walker", x: 2670, y: 340, state: "idle" },
        { kind: "walker", x: 2950, y: 520, state: "idle" },
        { kind: "spitter", x: 3120, y: 720, state: "idle" },
        { kind: "walker", x: 2800, y: 720, state: "wander" },
      ],
    },
    {
      id: "reactor",
      enemies: [
        { kind: "walker", x: 1600, y: 2340, state: "idle" },
        { kind: "walker", x: 2000, y: 2200, state: "wander" },
        { kind: "stalker", x: 2100, y: 2540, state: "idle" },
        { kind: "walker", x: 1480, y: 2560, state: "idle" },
      ],
    },
    {
      id: "archive",
      enemies: [
        { kind: "walker", x: 2620, y: 2300, state: "idle" },
        { kind: "spitter", x: 3284, y: 2320, state: "idle" },
        { kind: "walker", x: 2720, y: 2560, state: "wander" },
        { kind: "runner", x: 3412, y: 2300, state: "idle" },
        { kind: "stalker", x: 3284, y: 2100, state: "idle" },
      ],
    },
    { id: "warden", enemies: [{ kind: "warden", x: 4010, y: 1100, state: "idle" }] },
  ],
  spawnZones: [
    { id: "lobby", x: 150, y: 1220 },
    { id: "sec-nw", x: 1270, y: 230 },
    { id: "sec-ne", x: 2150, y: 250 },
    { id: "srv-ne", x: 3150, y: 230 },
    { id: "srv-se", x: 3150, y: 770 },
    { id: "reactor-sw", x: 1270, y: 2380 },
    { id: "reactor-se", x: 2160, y: 2580 },
    { id: "cells-n1", x: 2560, y: 1060 },
    { id: "cells-n2", x: 3260, y: 1060 },
    { id: "cells-s1", x: 2560, y: 1740 },
    { id: "cells-s2", x: 3260, y: 1740 },
    { id: "archive-w", x: 2530, y: 2560 },
    { id: "archive-e", x: 3412, y: 2060 },
    { id: "hall-n", x: 4250, y: 790 },
    { id: "hall-sw", x: 3770, y: 1890 },
  ],
  steps: [
    {
      kind: "reach",
      text: "Enter the laboratory",
      hint: "No power down here: stay in each other's flashlights and keep together.",
      area: BS_ATRIUM,
      marker: { x: 1720, y: 1400 },
      onStart: [{ spawn: "entry" }],
    },
    {
      kind: "collect",
      props: ["term-sec", "term-reactor", "term-server"],
      text: "Restore the three terminals",
      hint: "Security is north, the reactor south, the servers past security. Hold E at each terminal.",
      marker: { x: 1720, y: 890 },
      onStart: [
        { spawn: "security" },
        { spawn: "reactor" },
        { spawn: "servers" },
        { checkpoint: { x: 1500, y: 1500 } },
      ],
      onDone: [
        { power: true },
        {
          hint: "Power restored. Automatic doors and security systems are online: mind the decontamination vents.",
        },
      ],
    },
    {
      kind: "interact",
      prop: "override",
      text: "Override the containment lockdown",
      hint: "The override takes time and it is loud. Cover whoever holds it.",
      marker: { x: 2130, y: 1200 },
      onDone: [
        { open: "cont-door" },
        { open: "srv-door" },
        { open: "lab-door" },
        { alarm: true },
        { set: "blackout" },
        { checkpoint: { x: 1980, y: 1340 } },
        { hint: "Containment breach! The lights are gone. Something got out of the cells." },
      ],
    },
    {
      kind: "waves",
      text: "Survive the specimens",
      hint: "Specials hunt in the dark: stalkers flank, spitters keep their distance. Watch each other's backs.",
      marker: { x: 2900, y: 1400 },
      intermissionSec: 7,
      waves: [
        {
          enemies: { walker: 6, stalker: 2, spitter: 2 },
          zones: ["cells-n1", "cells-n2", "srv-se"],
          label: "Specimens loose",
        },
        {
          enemies: { runner: 5, exploder: 3, stalker: 2 },
          zones: ["cells-s1", "cells-s2", "archive-e", "archive-w"],
          supply: true,
          label: "They're coming through the vents",
        },
        {
          enemies: { brute: 1, spitter: 3, stalker: 3, walker: 6 },
          zones: [...BS_CELLS, "srv-ne", "archive-e"],
          label: "Containment failure",
        },
      ],
      onDone: [
        { alarm: false },
        { unset: "blackout" },
        { checkpoint: { x: 2900, y: 1400 } },
        { hint: "Lockdown lifted, lights back. Recover Varga's research before you go any further." },
      ],
    },
    {
      kind: "collect",
      props: ["intel-varga", "intel-backup", "intel-archive"],
      text: "Recover the contagion research",
      hint: "Three records: Varga's notes in containment, the server backup, the archive's contagion file.",
      marker: { x: 3410, y: 1740 },
      onStart: [{ spawn: "archive" }],
      onDone: [
        { open: "vault-door" },
        { hint: "Varga's last entry: subject W-1 was never moved out of primary containment." },
      ],
    },
    {
      kind: "kill",
      group: "warden",
      text: "Defeat The Warden",
      hint: "Its front is plated: one of you holds its gaze while the others shoot the glowing back. When it vents, everyone fires.",
      marker: { x: 4010, y: 1340 },
      onStart: [{ spawn: "warden" }, { checkpoint: { x: 3590, y: 1420 } }],
      onDone: [
        { open: "lift-door" },
        { checkpoint: { x: 4010, y: 1800 } },
        { hint: "The Warden is down. Get to the service lift!" },
      ],
    },
    {
      kind: "extract",
      text: "Ride the service lift out",
      hint: "Everybody on the lift and hold it: it takes its time.",
      area: BS_LIFT,
      holdSec: 15,
      marker: { x: 4010, y: 2380 },
      horde: {
        enemies: { runner: 6, stalker: 2, walker: 8 },
        zones: ["hall-n", "hall-sw", "cells-n2", "cells-s2"],
        label: "The whole lab is awake",
      },
      onStart: [{ alarm: true }],
    },
  ],
  vents: [
    {
      id: "vent-cont",
      area: { x: 3000, y: 1208, w: 160, h: 384 },
      periodSec: 9,
      warnSec: 1.6,
      activeSec: 2.6,
      offsetSec: 0,
      dps: 26,
    },
    {
      id: "vent-archive",
      area: { x: 2960, y: 2004, w: 160, h: 592 },
      periodSec: 8,
      warnSec: 1.6,
      activeSec: 2.4,
      offsetSec: 3,
      dps: 26,
    },
    {
      id: "vent-hall-nw",
      area: { x: 3724, y: 744, w: 200, h: 200 },
      periodSec: 10,
      warnSec: 1.8,
      activeSec: 3,
      offsetSec: 2,
      dps: 24,
    },
    {
      id: "vent-hall-se",
      area: { x: 4096, y: 1736, w: 200, h: 200 },
      periodSec: 10,
      warnSec: 1.8,
      activeSec: 3,
      offsetSec: 7,
      dps: 24,
    },
  ],
  ambient: {
    everySec: 9,
    maxAlive: 9,
    kinds: ["walker", "walker", "runner", "stalker"],
    zones: ["lobby", "sec-nw", "sec-ne", "srv-ne", "srv-se", "reactor-sw", "reactor-se"],
  },
  xp: 1500,
  title: "Containment Breaker",
  requires: "the-convoy",
};

// ------------------------------------------------------------------ Final Breach

const FB_ATRIUM: Rect = { x: 2240, y: 440, w: 1120, h: 1320 };
const FB_ANTE: Rect = { x: 3930, y: 830, w: 340, h: 500 };
const FB_HANGAR: Rect = { x: 4760, y: 100, w: 780, h: 260 };

export const FINAL_BREACH: MissionDef = {
  id: "final-breach",
  chapter: 5,
  name: "Final Breach",
  setting: "Halvorsen research complex",
  brief:
    "Varga's research names the place: the complex where Subject Zero is still alive and still spreading it. Slip in through the maintenance tunnels, hold the atrium while the security grid reboots, keep the decryption rig alive until the core opens, and end it. Then run: the complex will not survive what you do down there.",
  map: "breach",
  doors: [
    { id: "cryo-door", label: "Cryo lab", x: 2720, y: 1776, w: 160, h: 24 },
    { id: "core-door", label: "Core descent", x: 3376, y: 1000, w: 24, h: 160 },
    { id: "arena-door", label: "Core hall", x: 4080, y: 1520, w: 140, h: 24 },
    { id: "exit-door", label: "Service shaft", x: 4776, y: 2080, w: 24, h: 160 },
  ],
  props: [{ id: "rig", kind: "rig", label: "Decryption rig", x: 2800, y: 2450, holdSec: 0 }],
  groups: [
    {
      id: "tunnels",
      enemies: [
        { kind: "walker", x: 1000, y: 1540, state: "idle" },
        { kind: "walker", x: 1420, y: 1500, state: "idle" },
        { kind: "walker", x: 1520, y: 1380, state: "idle" },
        { kind: "walker", x: 1420, y: 1080, state: "idle" },
        { kind: "runner", x: 1600, y: 760, state: "idle" },
        { kind: "walker", x: 2000, y: 740, state: "idle" },
      ],
    },
    {
      id: "atrium",
      enemies: [
        { kind: "walker", x: 2600, y: 1100, state: "idle" },
        { kind: "walker", x: 3000, y: 1150, state: "idle" },
        { kind: "spitter", x: 3200, y: 600, state: "idle" },
      ],
    },
    { id: "core", enemies: [{ kind: "subject-zero", x: 4250, y: 2400, state: "idle" }] },
  ],
  spawnZones: [
    { id: "dock", x: 160, y: 1760 },
    { id: "tunnel-j1", x: 1560, y: 1340 },
    { id: "tunnel-j2", x: 1300, y: 860 },
    { id: "atrium-nw", x: 2260, y: 460 },
    { id: "atrium-ne", x: 3340, y: 460 },
    { id: "atrium-sw", x: 2260, y: 1740 },
    { id: "atrium-se", x: 3340, y: 1740 },
    { id: "cryo-nw", x: 2360, y: 2060 },
    { id: "cryo-ne", x: 3240, y: 2060 },
    { id: "cryo-sw", x: 2360, y: 2760 },
    { id: "cryo-se", x: 3240, y: 2760 },
    { id: "ante", x: 4260, y: 840 },
    { id: "core-nw", x: 3760, y: 1580 },
    { id: "core-ne", x: 4740, y: 1580 },
    { id: "core-sw", x: 3760, y: 2760 },
    { id: "core-se", x: 4740, y: 2760 },
    { id: "shaft-s", x: 5340, y: 2340 },
    { id: "shaft-n", x: 5100, y: 660 },
    { id: "hangar-w", x: 4840, y: 120 },
  ],
  steps: [
    {
      kind: "reach",
      text: "Infiltrate through the maintenance tunnels",
      hint: "They sleep in the tunnels. Gunfire wakes the whole block: walk, and shoot only if you must.",
      area: FB_ATRIUM,
      marker: { x: 2300, y: 740 },
      onStart: [{ power: true }, { spawn: "tunnels" }],
    },
    {
      kind: "waves",
      text: "Hold the atrium while the security grid reboots",
      hint: "Three waves. Use the pillars, and keep an eye on the doors behind you.",
      marker: { x: 2800, y: 1100 },
      intermissionSec: 8,
      onStart: [{ spawn: "atrium" }, { checkpoint: { x: 2400, y: 1100 } }],
      waves: [
        {
          enemies: { walker: 10, runner: 4, spitter: 2 },
          zones: ["atrium-nw", "atrium-ne", "tunnel-j2"],
          label: "The grid is down",
        },
        {
          enemies: { runner: 6, exploder: 3, stalker: 2, walker: 6 },
          zones: ["atrium-ne", "atrium-se", "atrium-sw"],
          supply: true,
          label: "From every side",
        },
        {
          enemies: { brute: 2, spitter: 3, runner: 6, walker: 8 },
          zones: ["atrium-nw", "atrium-ne", "atrium-sw", "atrium-se"],
          label: "Grid rebooting",
        },
      ],
      onDone: [
        { open: "cryo-door" },
        { checkpoint: { x: 2800, y: 1700 } },
        { hint: "Grid online. The decryption rig is in the cryo lab, south." },
      ],
    },
    {
      kind: "defend",
      prop: "rig",
      sec: 50,
      hp: 1500,
      text: "Keep the decryption rig alive",
      hint: "They go for the rig as much as for you. Stay close to it and keep them off it.",
      marker: { x: 2800, y: 2450 },
      horde: {
        enemies: { walker: 14, runner: 8, exploder: 2, spitter: 2 },
        zones: ["cryo-nw", "cryo-ne", "cryo-sw", "cryo-se"],
        label: "They want the rig",
      },
      onDone: [
        { open: "core-door" },
        { checkpoint: { x: 3300, y: 1080 } },
        { hint: "Decrypted. The core is down the east descent." },
      ],
    },
    {
      kind: "reach",
      text: "Descend to the core",
      hint: "Restock in the antechamber: there is little ammo down there, and it comes back slowly.",
      area: FB_ANTE,
      marker: { x: 4100, y: 1080 },
      onDone: [{ open: "arena-door" }, { checkpoint: { x: 4100, y: 1080 } }],
    },
    {
      kind: "kill",
      group: "core",
      text: "Kill Subject Zero",
      hint: "Its core shows at its back and when it vents. Spread out, and read every tell: the ring, the cone, the acid.",
      marker: { x: 4250, y: 2170 },
      onStart: [{ spawn: "core" }],
      onPhase: [
        [],
        [{ set: "core-vents" }, { hint: "The hall's vents are waking up: watch the amber lights." }],
        [
          { set: "core-vents-2" },
          { set: "blackout" },
          { alarm: true },
          { hint: "Blackout! The whole floor vents now. Stay together." },
        ],
      ],
      onDone: [
        { unset: "core-vents" },
        { unset: "core-vents-2" },
        { open: "exit-door" },
        { set: "self-destruct" },
        { checkpoint: { x: 4700, y: 2160 } },
        { hint: "Subject Zero is dead. The self-destruct is armed: up the service shaft, now!" },
      ],
    },
    {
      kind: "reach",
      text: "Escape up the service shaft",
      hint: "Don't stop to fight: the timer does not wait.",
      area: FB_HANGAR,
      limitSec: 60,
      marker: { x: 5220, y: 500 },
      onStart: [{ alarm: true }],
    },
    {
      kind: "extract",
      text: "Hold the evac hangar until the dropship lands",
      hint: "Everyone on the pad. This is the last of it.",
      area: FB_HANGAR,
      holdSec: 25,
      marker: { x: 5150, y: 230 },
      onStart: [{ checkpoint: { x: 5150, y: 230 } }],
      horde: {
        enemies: { runner: 10, stalker: 3, walker: 10, brute: 1 },
        zones: ["shaft-s", "shaft-n", "hangar-w"],
        label: "Everything left in the complex",
      },
    },
  ],
  vents: [
    // Phase 2: the four corners.
    {
      id: "core-nw",
      flag: "core-vents",
      area: { x: 3724, y: 1544, w: 260, h: 260 },
      periodSec: 9,
      warnSec: 1.8,
      activeSec: 2.8,
      offsetSec: 0,
      dps: 24,
    },
    {
      id: "core-se",
      flag: "core-vents",
      area: { x: 4516, y: 2536, w: 260, h: 260 },
      periodSec: 9,
      warnSec: 1.8,
      activeSec: 2.8,
      offsetSec: 0,
      dps: 24,
    },
    {
      id: "core-ne",
      flag: "core-vents",
      area: { x: 4516, y: 1544, w: 260, h: 260 },
      periodSec: 9,
      warnSec: 1.8,
      activeSec: 2.8,
      offsetSec: 4.5,
      dps: 24,
    },
    {
      id: "core-sw",
      flag: "core-vents",
      area: { x: 3724, y: 2536, w: 260, h: 260 },
      periodSec: 9,
      warnSec: 1.8,
      activeSec: 2.8,
      offsetSec: 4.5,
      dps: 24,
    },
    // Phase 3: the cross through the middle.
    {
      id: "core-cross-v",
      flag: "core-vents-2",
      area: { x: 4180, y: 1544, w: 120, h: 1252 },
      periodSec: 10,
      warnSec: 2,
      activeSec: 2.6,
      offsetSec: 2,
      dps: 26,
    },
    {
      id: "core-cross-h",
      flag: "core-vents-2",
      area: { x: 3724, y: 2110, w: 1052, h: 120 },
      periodSec: 10,
      warnSec: 2,
      activeSec: 2.6,
      offsetSec: 7,
      dps: 26,
    },
  ],
  ambient: {
    everySec: 10,
    maxAlive: 8,
    kinds: ["walker", "walker", "runner"],
    zones: ["dock", "tunnel-j1", "tunnel-j2", "atrium-nw", "atrium-se"],
  },
  xp: 2500,
  title: "Patient Zero's End",
  requires: "black-site",
};

// ------------------------------------------------------------------ Operations (chapter 0)
// Stand-alone co-op operations with their own card on the Play screen. They reuse the campaign
// maps and spawn zones; none of their doors exist (every passage is open).

export const EXTRACTION: MissionDef = {
  id: "extraction",
  chapter: 0,
  name: "Extraction",
  setting: "Halvorsen Works · cargo recovery",
  brief:
    "Three cargo cases are still somewhere in the Halvorsen plant. Recover all three, then carry them to the north-east helipad and hold it until the bird lands.",
  map: "works",
  doors: [],
  props: [
    { id: "cargo-gen", kind: "intel", label: "Cargo case", x: 470, y: 400, holdSec: 1.5, noise: 500 },
    { id: "cargo-court", kind: "intel", label: "Cargo case", x: 1600, y: 1080, holdSec: 1.5, noise: 500 },
    { id: "cargo-office", kind: "intel", label: "Cargo case", x: 2780, y: 1640, holdSec: 1.5, noise: 500 },
  ],
  groups: [
    {
      id: "gen",
      enemies: [
        { kind: "walker", x: 700, y: 390, state: "idle" },
        { kind: "walker", x: 260, y: 300, state: "idle" },
        { kind: "runner", x: 560, y: 520, state: "idle" },
        { kind: "walker", x: 820, y: 1040, state: "wander" },
      ],
    },
    {
      id: "court",
      enemies: [
        { kind: "walker", x: 1500, y: 680, state: "wander" },
        { kind: "walker", x: 1820, y: 1160, state: "wander" },
        { kind: "spitter", x: 1360, y: 1040, state: "idle" },
        { kind: "runner", x: 1700, y: 900, state: "idle" },
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
  spawnZones: FIRST_CONTACT.spawnZones,
  steps: [
    {
      kind: "collect",
      props: ["cargo-gen"],
      text: "Recover the cargo case by the generator",
      hint: "Hold E on a cargo case to pick it up. It makes noise.",
      marker: { x: 470, y: 400 },
      onStart: [{ spawn: "gen" }],
    },
    {
      kind: "collect",
      props: ["cargo-court"],
      text: "Recover the cargo case in the courtyard",
      marker: { x: 1600, y: 1080 },
      onStart: [{ spawn: "court" }, { checkpoint: { x: 900, y: 1100 } }],
      onDone: [{ supply: { x: 1500, y: 1150 } }],
    },
    {
      kind: "collect",
      props: ["cargo-office"],
      text: "Recover the last cargo case in the offices",
      hint: "Brute: dodge its charge.",
      marker: { x: 2780, y: 1640 },
      onStart: [{ spawn: "office" }, { checkpoint: { x: 2050, y: 1450 } }],
    },
    {
      kind: "extract",
      area: FC_EXTRACT,
      holdSec: 20,
      text: "Carry the cargo to the helipad and hold until extraction",
      hint: "Everyone still standing must be on the pad.",
      marker: { x: 2910, y: 380 },
      onStart: [{ alarm: true }, { checkpoint: { x: 2640, y: 1080 } }],
      horde: {
        enemies: { walker: 16, runner: 5, exploder: 2, spitter: 1 },
        zones: ["east", "south-east", "storage", "north-2"],
        label: "They followed the cargo!",
      },
    },
  ],
  ambient: {
    everySec: 12,
    maxAlive: 5,
    kinds: ["walker", "walker", "runner"],
    zones: ["south", "storage", "south-east", "west"],
  },
  xp: 800,
  title: "Cargo Runner",
};

export const BOSS_RUSH: MissionDef = {
  id: "boss-rush",
  chapter: 0,
  name: "Boss Rush",
  setting: "Halvorsen research complex · atrium",
  brief:
    "Everything the outbreak made, one after another, in the atrium of the research complex: the Abomination, the Warden, then Subject Zero. One supply drop between each fight. No running.",
  map: "breach",
  doors: [],
  props: [],
  groups: [],
  spawnZones: FINAL_BREACH.spawnZones,
  steps: [
    {
      kind: "reach",
      text: "Get to the atrium",
      area: FB_ATRIUM,
      marker: { x: 2800, y: 1100 },
      onStart: [{ power: true }],
    },
    {
      kind: "waves",
      text: "Defeat every boss",
      hint: "Each boss leads its wave. A supply crate drops after each fight.",
      marker: { x: 2800, y: 1100 },
      intermissionSec: 12,
      onStart: [{ checkpoint: { x: 2400, y: 1100 } }],
      waves: [
        {
          boss: "abomination",
          enemies: { walker: 6, runner: 2 },
          zones: ["atrium-nw", "atrium-ne", "atrium-sw", "atrium-se"],
          supply: true,
          label: "Boss 1 · The Abomination",
        },
        {
          boss: "warden",
          enemies: { walker: 6, stalker: 2 },
          zones: ["atrium-nw", "atrium-ne", "atrium-sw", "atrium-se"],
          supply: true,
          label: "Boss 2 · The Warden",
        },
        {
          boss: "subject-zero",
          enemies: { runner: 4, spitter: 2 },
          zones: ["atrium-nw", "atrium-ne", "atrium-sw", "atrium-se"],
          label: "Boss 3 · Subject Zero",
        },
      ],
    },
  ],
  xp: 1200,
  title: "Boss Breaker",
};

export const MISSIONS: readonly MissionDef[] = [
  FIRST_CONTACT,
  DEAD_DISTRICT,
  THE_CONVOY,
  BLACK_SITE,
  FINAL_BREACH,
  EXTRACTION,
  BOSS_RUSH,
];

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
  // Every tenth wave: a boss with support.
  if (n % 10 === 0) {
    return {
      boss: "abomination",
      enemies: { walker: 6 + n / 2, runner: 2 + n / 5, exploder: 1 + n / 10 },
      supply: true,
      label: `Wave ${n} · The Abomination`,
    };
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
