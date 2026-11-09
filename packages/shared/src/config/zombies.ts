/**
 * PvE enemies (Outbreak). Every number the AI and the combat rules use lives here as data, so
 * balancing never touches the simulation. The client reads the same table for rendering (size,
 * colors, telegraph timings), the authoritative room (dedicated server or host tab) for everything.
 *
 * `index` travels on the wire: keep indices stable once a release ships.
 */

export type ZombieKind =
  | "walker"
  | "runner"
  | "brute"
  | "spitter"
  | "stalker"
  | "exploder"
  | "abomination"
  | "warden";

export type AttackKind =
  | "melee"
  | "spit"
  | "explode"
  | "pounce"
  | "charge"
  /** Boss: area slam around itself. */
  | "slam"
  /** Boss: lobbed debris landing on a marked circle. */
  | "throw"
  /** Boss: calls lesser infected. */
  | "summon"
  /** Boss: phase transition (shockwave, no damage). */
  | "roar"
  /** Boss: a cone in front of it, or behind it (`rear`), with an arc of `arc` either side. */
  | "sweep"
  /**
   * Boss: it stops and vents its plating, the vulnerability window: every hit lands as if on the
   * open plates (`plating.open`); the plates slam shut at the end with a short burst around it.
   */
  | "vent";
/** Wire index of an attack kind (ZombieState.ak). Keep the order stable. */
export const ATTACK_KINDS: readonly AttackKind[] = [
  "melee",
  "spit",
  "explode",
  "pounce",
  "charge",
  "slam",
  "throw",
  "summon",
  "roar",
  "sweep",
  "vent",
];

export interface AttackDef {
  kind: AttackKind;
  /** Distance (edge to edge, px) at which the attack starts. */
  range: number;
  /** Telegraph before the attack lands (s). Every significant attack has one. */
  windupSec: number;
  /** Time after the attack before the enemy acts again (s): the punish window. */
  recoverSec: number;
  damage: number;
  /** Knockback speed given to the victim (px/s). */
  knockback?: number;
  /** Area attacks: radius (px) and damage at the edge as a fraction of `damage`. */
  radius?: number;
  edgeFactor?: number;
  /** Projectile attacks. */
  projectileSpeed?: number;
  /** Acid puddle left where a projectile lands. */
  puddle?: { radius: number; sec: number; dps: number };
  /** Lunge/charge speed (px/s) and how long it lasts (s). */
  lungeSpeed?: number;
  lungeSec?: number;
  /** Summon: what and how many. */
  summon?: { kind: ZombieKind; count: number };
  /** Throw: debris pieces per throw (spread around the target). */
  volley?: number;
  /** Sweep: half-angle of the cone (rad) and whether it strikes behind the attacker. */
  arc?: number;
  rear?: boolean;
}

/** One boss attack within a phase: usable in a distance band, with its own cooldown. */
export interface BossAttackDef extends AttackDef {
  id: string;
  minRange: number;
  maxRange: number;
  cooldownSec: number;
  /** Combo: this attack follows immediately when this one ends. */
  combo?: string;
  /** Not used before this many seconds into its phase (a vent window does not open at once). */
  firstSec?: number;
}

export interface BossPhaseDef {
  /** The phase starts when health falls below this fraction (1 = from the start). */
  below: number;
  speedMult: number;
  /** Windups get shorter in later phases (still always telegraphed). */
  windupMult: number;
  attacks: BossAttackDef[];
}

export interface BossDef {
  title: string;
  phases: BossPhaseDef[];
  /** Phase transition: roar and shockwave, the boss takes almost no damage meanwhile. */
  transitionSec: number;
  /** Health grows with the squad: × (1 + perExtraPlayer × (players − 1)). */
  perExtraPlayer: number;
}

/**
 * Directional armour (The Warden): bullet damage multiplier by where the hit lands relative to
 * the enemy's facing. Front plates within `frontArc` either side, the weak point within `backArc`
 * either side of its back, the flanks in between. While it vents (the vulnerability window) the
 * front and flanks take `open` and the weak point `back × open`.
 */
export interface PlatingDef {
  frontArc: number;
  backArc: number;
  front: number;
  side: number;
  back: number;
  open: number;
}

export type HitSide = "front" | "side" | "back";

/** Which side of a plated enemy a hit lands on (`rel`: hit angle minus facing, any range). */
export function hitSide(p: PlatingDef, rel: number): HitSide {
  const a = Math.abs(Math.atan2(Math.sin(rel), Math.cos(rel)));
  if (a <= p.frontArc) return "front";
  if (a >= Math.PI - p.backArc) return "back";
  return "side";
}

/** Bullet damage multiplier of a plated enemy for a hit on `side`, venting or not. */
export function platingMult(p: PlatingDef, side: HitSide, venting: boolean): number {
  if (side === "back") return venting ? p.back * p.open : p.back;
  if (venting) return p.open;
  return side === "front" ? p.front : p.side;
}

export interface ZombieDef {
  kind: ZombieKind;
  index: number;
  name: string;
  /** One line shown in the mission briefing / codex. */
  blurb: string;
  radius: number;
  maxHp: number;
  /** Chase speed (px/s). The player runs at 265. */
  speed: number;
  /** Idle wandering speed. */
  wanderSpeed: number;
  /** Turn rate (rad/s) of the body, purely for steering smoothness. */
  turnRate: number;
  /** Vision range (px; line of sight required) and hearing multiplier on noise radii. */
  sight: number;
  hearing: number;
  /** Seconds a chasing enemy keeps hunting a target it can no longer see before investigating. */
  memorySec: number;
  attack: AttackDef;
  /** Second attack used at mid range (brute charge). */
  special?: AttackDef & { minRange: number; maxRange: number; cooldownSec: number };
  /** Bullet damage taken multiplier (1 = normal). */
  armor: number;
  /** Directional armour instead of a flat multiplier (replaces `armor` for bullets). */
  plating?: PlatingDef;
  /** Damage multiplier while stunned (the brute's vulnerability window). */
  stunnedDamageMult: number;
  /** Seconds stunned after a charge ends in a wall. */
  wallStunSec: number;
  /** Behaviour profile used by the AI. */
  behaviour: "swarm" | "keepDistance" | "flank" | "kamikaze";
  /** keepDistance: preferred engagement distance (px). */
  preferredRange?: number;
  /** Heavier bodies push lighter ones aside (crowd separation). */
  mass: number;
  /** Visual: body and accent tint, and drawing scale. */
  color: number;
  accent: number;
  /** XP per kill (PvE only). */
  xp: number;
  /** Uses the nav grid class for large bodies. */
  large: boolean;
  /** Survival / waves: spawn weight once unlocked (0 = never random). */
  weight: number;
  /** Bosses: phases, attacks and transitions. */
  boss?: BossDef;
}

export const ZOMBIES: Record<ZombieKind, ZombieDef> = {
  walker: {
    kind: "walker",
    index: 0,
    name: "Walker",
    blurb: "Slow and fragile alone. Dangerous in numbers.",
    radius: 16,
    maxHp: 70,
    speed: 74,
    wanderSpeed: 32,
    turnRate: 5,
    sight: 520,
    hearing: 1,
    memorySec: 6,
    attack: { kind: "melee", range: 18, windupSec: 0.45, recoverSec: 0.7, damage: 12 },
    armor: 1,
    stunnedDamageMult: 1,
    wallStunSec: 0,
    behaviour: "swarm",
    mass: 1,
    color: 0x6f7d5a,
    accent: 0xb9c48f,
    xp: 5,
    large: false,
    weight: 10,
  },
  runner: {
    kind: "runner",
    index: 1,
    name: "Runner",
    blurb: "Fast, erratic, frail. Keep moving and keep firing.",
    radius: 14,
    maxHp: 45,
    speed: 228,
    wanderSpeed: 60,
    turnRate: 9,
    sight: 650,
    hearing: 1.2,
    memorySec: 8,
    attack: { kind: "melee", range: 16, windupSec: 0.28, recoverSec: 0.5, damage: 8 },
    armor: 1,
    stunnedDamageMult: 1,
    wallStunSec: 0,
    behaviour: "swarm",
    mass: 0.8,
    color: 0x8a5d4a,
    accent: 0xff9a6a,
    xp: 7,
    large: false,
    weight: 5,
  },
  brute: {
    kind: "brute",
    index: 2,
    name: "Brute",
    blurb: "Soaks bullets and knocks you flat. Dodge the charge, punish the stagger.",
    radius: 26,
    maxHp: 650,
    speed: 64,
    wanderSpeed: 28,
    turnRate: 3,
    sight: 600,
    hearing: 0.9,
    memorySec: 10,
    attack: { kind: "melee", range: 24, windupSec: 0.7, recoverSec: 1, damage: 28, knockback: 380 },
    special: {
      kind: "charge",
      range: 0,
      minRange: 170,
      maxRange: 460,
      cooldownSec: 6,
      windupSec: 0.85,
      recoverSec: 0.6,
      damage: 35,
      knockback: 560,
      lungeSpeed: 520,
      lungeSec: 0.9,
    },
    armor: 0.9,
    stunnedDamageMult: 1.6,
    wallStunSec: 1.6,
    behaviour: "swarm",
    mass: 4,
    color: 0x5b4e58,
    accent: 0xd8a7c8,
    xp: 40,
    large: true,
    weight: 1,
  },
  spitter: {
    kind: "spitter",
    index: 3,
    name: "Spitter",
    blurb: "Keeps its distance and lobs acid. Rush it or break line of sight.",
    radius: 15,
    maxHp: 85,
    speed: 96,
    wanderSpeed: 30,
    turnRate: 5,
    sight: 640,
    hearing: 1,
    memorySec: 8,
    attack: {
      kind: "spit",
      range: 470,
      windupSec: 0.65,
      recoverSec: 1.7,
      damage: 14,
      projectileSpeed: 430,
      puddle: { radius: 56, sec: 3.5, dps: 12 },
    },
    armor: 1,
    stunnedDamageMult: 1,
    wallStunSec: 0,
    behaviour: "keepDistance",
    preferredRange: 360,
    mass: 1,
    color: 0x5f7a3c,
    accent: 0xc6ff4a,
    xp: 15,
    large: false,
    weight: 2,
  },
  stalker: {
    kind: "stalker",
    index: 4,
    name: "Stalker",
    blurb: "Hunts the one who strays from the group. Watch each other's backs.",
    radius: 15,
    maxHp: 110,
    speed: 150,
    wanderSpeed: 50,
    turnRate: 8,
    sight: 700,
    hearing: 1.3,
    memorySec: 12,
    attack: {
      kind: "pounce",
      range: 150,
      windupSec: 0.4,
      recoverSec: 1.3,
      damage: 30,
      knockback: 200,
      lungeSpeed: 640,
      lungeSec: 0.32,
    },
    armor: 1,
    stunnedDamageMult: 1.3,
    wallStunSec: 0.8,
    behaviour: "flank",
    mass: 1,
    color: 0x3e4250,
    accent: 0x8fd3ff,
    xp: 25,
    large: false,
    weight: 1.2,
  },
  exploder: {
    kind: "exploder",
    index: 5,
    name: "Exploder",
    blurb: "Swollen and unstable. Pop it at range: the blast hurts zombies too.",
    radius: 18,
    maxHp: 60,
    speed: 118,
    wanderSpeed: 30,
    turnRate: 5,
    sight: 520,
    hearing: 1,
    memorySec: 6,
    attack: {
      kind: "explode",
      range: 54,
      windupSec: 0.9,
      recoverSec: 0,
      damage: 55,
      radius: 125,
      edgeFactor: 0.35,
    },
    armor: 1,
    stunnedDamageMult: 1,
    wallStunSec: 0,
    behaviour: "kamikaze",
    mass: 1.2,
    color: 0x7c6a33,
    accent: 0xffd34a,
    xp: 12,
    large: false,
    weight: 1.5,
  },
  abomination: {
    kind: "abomination",
    index: 6,
    name: "The Abomination",
    blurb: "A mass of fused infected. Learn its tells: the lane, the circle, the falling debris.",
    radius: 40,
    maxHp: 3200,
    speed: 82,
    wanderSpeed: 30,
    turnRate: 2.4,
    sight: 1400,
    hearing: 2,
    memorySec: 60,
    attack: { kind: "melee", range: 30, windupSec: 0.8, recoverSec: 0.9, damage: 30, knockback: 420 },
    armor: 1,
    stunnedDamageMult: 2,
    wallStunSec: 2.4,
    behaviour: "swarm",
    mass: 12,
    color: 0x6b4a52,
    accent: 0xff6a4a,
    xp: 300,
    large: true,
    weight: 0,
    boss: {
      title: "Boss",
      transitionSec: 1.6,
      perExtraPlayer: 0.45,
      phases: [
        {
          below: 1,
          speedMult: 1,
          windupMult: 1,
          attacks: [
            {
              id: "slam",
              kind: "slam",
              range: 0,
              minRange: 0,
              maxRange: 150,
              cooldownSec: 7,
              windupSec: 1.1,
              recoverSec: 1,
              damage: 35,
              radius: 170,
              edgeFactor: 0.5,
              knockback: 380,
            },
            {
              id: "charge",
              kind: "charge",
              range: 0,
              minRange: 220,
              maxRange: 640,
              cooldownSec: 8,
              windupSec: 1,
              recoverSec: 0.8,
              damage: 40,
              knockback: 600,
              lungeSpeed: 500,
              lungeSec: 1,
            },
          ],
        },
        {
          below: 0.66,
          speedMult: 1.15,
          windupMult: 0.85,
          attacks: [
            {
              id: "slam",
              kind: "slam",
              range: 0,
              minRange: 0,
              maxRange: 150,
              cooldownSec: 6,
              windupSec: 1.1,
              recoverSec: 0.9,
              damage: 35,
              radius: 180,
              edgeFactor: 0.5,
              knockback: 400,
            },
            {
              id: "throw",
              kind: "throw",
              range: 0,
              minRange: 230,
              maxRange: 900,
              cooldownSec: 4.5,
              windupSec: 0.9,
              recoverSec: 0.7,
              damage: 30,
              radius: 95,
              edgeFactor: 0.4,
              projectileSpeed: 520,
              volley: 1,
            },
            {
              id: "charge",
              kind: "charge",
              range: 0,
              minRange: 220,
              maxRange: 640,
              cooldownSec: 7,
              windupSec: 1,
              recoverSec: 0.8,
              damage: 40,
              knockback: 600,
              lungeSpeed: 520,
              lungeSec: 1,
            },
            {
              id: "summon",
              kind: "summon",
              range: 0,
              minRange: 0,
              maxRange: 3000,
              cooldownSec: 16,
              windupSec: 1.2,
              recoverSec: 0.8,
              damage: 0,
              summon: { kind: "walker", count: 4 },
            },
          ],
        },
        {
          below: 0.33,
          speedMult: 1.25,
          windupMult: 0.75,
          attacks: [
            {
              id: "slam",
              kind: "slam",
              range: 0,
              minRange: 0,
              maxRange: 160,
              cooldownSec: 6,
              windupSec: 1.1,
              recoverSec: 0.5,
              damage: 35,
              radius: 190,
              edgeFactor: 0.5,
              knockback: 420,
              combo: "charge",
            },
            {
              id: "throw",
              kind: "throw",
              range: 0,
              minRange: 230,
              maxRange: 950,
              cooldownSec: 4,
              windupSec: 0.9,
              recoverSec: 0.6,
              damage: 26,
              radius: 85,
              edgeFactor: 0.4,
              projectileSpeed: 560,
              volley: 3,
            },
            {
              id: "charge",
              kind: "charge",
              range: 0,
              minRange: 220,
              maxRange: 680,
              cooldownSec: 6,
              windupSec: 1,
              recoverSec: 0.7,
              damage: 40,
              knockback: 620,
              lungeSpeed: 560,
              lungeSec: 1,
            },
            {
              id: "summon",
              kind: "summon",
              range: 0,
              minRange: 0,
              maxRange: 3000,
              cooldownSec: 14,
              windupSec: 1.2,
              recoverSec: 0.8,
              damage: 0,
              summon: { kind: "runner", count: 4 },
            },
          ],
        },
      ],
    },
  },
  warden: {
    kind: "warden",
    index: 7,
    name: "The Warden",
    blurb:
      "A containment specimen the lab bolted into plate. Hold its gaze while someone hits the glowing back; shoot it when it vents.",
    radius: 34,
    maxHp: 3600,
    speed: 72,
    wanderSpeed: 30,
    // Turns slowly: a teammate who keeps moving can stay at its back.
    turnRate: 1.5,
    sight: 1200,
    hearing: 2,
    memorySec: 60,
    attack: { kind: "melee", range: 26, windupSec: 0.75, recoverSec: 0.9, damage: 26, knockback: 380 },
    armor: 1,
    plating: { frontArc: 1.05, backArc: 0.85, front: 0.15, side: 0.55, back: 1.6, open: 1.4 },
    stunnedDamageMult: 1.6,
    wallStunSec: 2.6,
    behaviour: "swarm",
    mass: 14,
    color: 0x4f565e,
    accent: 0x6affd2,
    xp: 220,
    large: true,
    weight: 0,
    boss: {
      title: "Miniboss",
      transitionSec: 1.4,
      perExtraPlayer: 0.45,
      phases: [
        {
          below: 1,
          speedMult: 1,
          windupMult: 1,
          attacks: [
            {
              id: "vent",
              kind: "vent",
              range: 0,
              minRange: 0,
              maxRange: 99999,
              cooldownSec: 13,
              firstSec: 9,
              windupSec: 3.2,
              recoverSec: 0.5,
              damage: 14,
              radius: 140,
              edgeFactor: 0.6,
              knockback: 340,
            },
            {
              id: "lash",
              kind: "sweep",
              rear: true,
              range: 0,
              minRange: 0,
              maxRange: 99999,
              cooldownSec: 5,
              firstSec: 3,
              windupSec: 0.8,
              recoverSec: 0.6,
              damage: 24,
              radius: 180,
              arc: 0.9,
              knockback: 380,
            },
            {
              id: "sweep",
              kind: "sweep",
              range: 0,
              minRange: 0,
              maxRange: 170,
              cooldownSec: 3.5,
              windupSec: 0.95,
              recoverSec: 0.9,
              damage: 32,
              radius: 200,
              arc: 1.1,
              knockback: 440,
            },
            {
              id: "bash",
              kind: "charge",
              range: 0,
              minRange: 230,
              maxRange: 640,
              cooldownSec: 7,
              firstSec: 4,
              windupSec: 1,
              recoverSec: 0.8,
              damage: 38,
              knockback: 600,
              lungeSpeed: 540,
              lungeSec: 0.9,
            },
            {
              id: "call",
              kind: "summon",
              range: 0,
              minRange: 0,
              maxRange: 3000,
              cooldownSec: 22,
              firstSec: 14,
              windupSec: 1.2,
              recoverSec: 0.8,
              damage: 0,
              summon: { kind: "walker", count: 4 },
            },
          ],
        },
        {
          below: 0.5,
          speedMult: 1.2,
          windupMult: 0.85,
          attacks: [
            {
              id: "vent",
              kind: "vent",
              range: 0,
              minRange: 0,
              maxRange: 99999,
              cooldownSec: 12,
              firstSec: 8,
              windupSec: 2.8,
              recoverSec: 0.4,
              damage: 18,
              radius: 150,
              edgeFactor: 0.6,
              knockback: 360,
            },
            {
              id: "lash",
              kind: "sweep",
              rear: true,
              range: 0,
              minRange: 0,
              maxRange: 99999,
              cooldownSec: 4.5,
              windupSec: 0.75,
              recoverSec: 0.5,
              damage: 26,
              radius: 185,
              arc: 0.95,
              knockback: 400,
            },
            {
              id: "sweep",
              kind: "sweep",
              range: 0,
              minRange: 0,
              maxRange: 170,
              cooldownSec: 3,
              windupSec: 0.95,
              recoverSec: 0.6,
              damage: 32,
              radius: 205,
              arc: 1.15,
              knockback: 460,
              // A sweep in front, then the tail behind: whoever hides at its back gets lashed.
              combo: "lash",
            },
            {
              id: "bash",
              kind: "charge",
              range: 0,
              minRange: 230,
              maxRange: 680,
              cooldownSec: 6,
              windupSec: 1,
              recoverSec: 0.7,
              damage: 40,
              knockback: 620,
              lungeSpeed: 580,
              lungeSec: 0.9,
            },
            {
              id: "call",
              kind: "summon",
              range: 0,
              minRange: 0,
              maxRange: 3000,
              cooldownSec: 18,
              firstSec: 3,
              windupSec: 1.2,
              recoverSec: 0.8,
              damage: 0,
              summon: { kind: "stalker", count: 2 },
            },
          ],
        },
      ],
    },
  },
};

/** Boss phase index (0-based) for a health fraction. */
export function bossPhase(def: ZombieDef, hpFraction: number): number {
  const phases = def.boss?.phases ?? [];
  let idx = 0;
  phases.forEach((p, i) => {
    if (hpFraction <= p.below) idx = i;
  });
  return idx;
}

export const ZOMBIE_LIST: readonly ZombieDef[] = Object.values(ZOMBIES).sort((a, b) => a.index - b.index);

export function zombieByIndex(index: number): ZombieDef | undefined {
  return ZOMBIE_LIST[index];
}

export function isZombieKind(v: unknown): v is ZombieKind {
  return typeof v === "string" && v in ZOMBIES;
}

/** Explosion damage to other zombies relative to the damage dealt to players. */
export const EXPLODER_ZOMBIE_DAMAGE_MULT = 2;

/** Hits within this fraction of the radius from an enemy's centre are precision hits. */
export const PRECISION_RADIUS_FRACTION = 0.4;
export const PRECISION_DAMAGE_MULT = 1.5;

/** AI state as synchronized (the client animates from it). */
export const AI = {
  IDLE: 0,
  WANDER: 1,
  ALERT: 2,
  INVESTIGATE: 3,
  CHASE: 4,
  ATTACK: 5,
  STUNNED: 6,
  DEAD: 7,
} as const;
export type AiState = (typeof AI)[keyof typeof AI];
export const AI_STATE_NAMES = [
  "idle",
  "wander",
  "alert",
  "investigate",
  "chase",
  "attack",
  "stunned",
  "dead",
] as const;

/** Attack phase as synchronized: what the telegraph on the client shows. */
export const ACT = { NONE: 0, WINDUP: 1, ACTIVE: 2, RECOVER: 3 } as const;

// ------------------------------------------------------------------ difficulty and scaling

export type Difficulty = "recruit" | "veteran" | "nightmare";
export const DIFFICULTIES: readonly Difficulty[] = ["recruit", "veteran", "nightmare"];

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  blurb: string;
  enemyDamage: number;
  enemyHp: number;
  /** Enemy count multiplier. */
  density: number;
  /** Spawn pacing: lower = enemies arrive faster. */
  spawnInterval: number;
  /** Extra share of special enemies in mixed groups. */
  specialBonus: number;
  /** Ammo/health from drops and supply crates. */
  supply: number;
  /** Seconds a downed player lasts before bleeding out. */
  bleedoutSec: number;
  /** Solo play: self-revives per mission. */
  selfRevives: number;
  /** Health after a revive. */
  reviveHp: number;
  /** XP multiplier for the mission result. */
  xp: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  recruit: {
    id: "recruit",
    name: "Recruit",
    blurb: "Fewer, weaker infected and generous supplies. Learn the ropes.",
    enemyDamage: 0.7,
    enemyHp: 0.85,
    density: 0.8,
    spawnInterval: 1.2,
    specialBonus: -0.05,
    supply: 1.3,
    bleedoutSec: 40,
    selfRevives: 2,
    reviveHp: 50,
    xp: 0.8,
  },
  veteran: {
    id: "veteran",
    name: "Veteran",
    blurb: "The intended experience. Stick together.",
    enemyDamage: 1,
    enemyHp: 1,
    density: 1,
    spawnInterval: 1,
    specialBonus: 0,
    supply: 1,
    bleedoutSec: 30,
    selfRevives: 1,
    reviveHp: 40,
    xp: 1,
  },
  nightmare: {
    id: "nightmare",
    name: "Nightmare",
    blurb: "Hard-hitting hordes, scarce supplies, no second chances alone.",
    enemyDamage: 1.35,
    enemyHp: 1.2,
    density: 1.25,
    spawnInterval: 0.85,
    specialBonus: 0.08,
    supply: 0.75,
    bleedoutSec: 20,
    selfRevives: 0,
    reviveHp: 30,
    xp: 1.5,
  },
};

export function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === "string" && v in DIFFICULTY;
}

/**
 * Squad-size scaling. Health grows only a little; what grows is density, pace, the share of
 * specials and supplies, so four players face more pressure from more directions instead of
 * bullet sponges.
 */
export interface SquadScale {
  density: number;
  maxAlive: number;
  spawnInterval: number;
  enemyHp: number;
  specialBonus: number;
  /** Directions enemies arrive from at once (spawn zones used together). */
  fronts: number;
}

const SQUAD: readonly SquadScale[] = [
  { density: 1, maxAlive: 18, spawnInterval: 1, enemyHp: 1, specialBonus: 0, fronts: 1 },
  {
    density: 1.55,
    maxAlive: 26,
    spawnInterval: 0.82,
    enemyHp: 1,
    specialBonus: 0.04,
    fronts: 2,
  },
  {
    density: 2.05,
    maxAlive: 34,
    spawnInterval: 0.7,
    enemyHp: 1.05,
    specialBonus: 0.08,
    fronts: 2,
  },
  {
    density: 2.5,
    maxAlive: 42,
    spawnInterval: 0.62,
    enemyHp: 1.1,
    specialBonus: 0.12,
    fronts: 3,
  },
];

export function squadScale(players: number): SquadScale {
  return SQUAD[Math.max(0, Math.min(SQUAD.length - 1, players - 1))]!;
}

/** Hard cap on simultaneous enemies (performance budget, any difficulty, any squad). */
export const MAX_ZOMBIES = 48;

/** Downed players: crawl speed multiplier, revive reach and duration. */
export const DOWNED = {
  speedMult: 0.28,
  reviveReach: 60,
  reviveSec: 3.2,
  /** A revive interrupted for longer than this restarts from zero. */
  reviveGraceSec: 0.35,
  /** Solo self-revive: seconds downed before getting back up (if charges remain). */
  selfReviveSec: 6,
  /** Each point of damage taken while downed costs this many seconds of bleed-out time. */
  bleedPerDamage: 0.12,
  /** Everybody down for this long = mission failed (time for a last self-revive to land). */
  wipeGraceSec: 1.5,
} as const;
