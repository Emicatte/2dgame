/**
 * Account progression. XP is computed only on the server from authoritative match data;
 * the client uses these same functions purely to display progress bars.
 *
 * Rewards are cosmetic only, so levels never create a competitive advantage.
 */
export const MAX_LEVEL = 50;

export const XP_RULES = {
  matchCompleted: 100,
  perKill: 20,
  /** Kill XP stops counting after this many kills in one match (limits farming in private rooms). */
  maxRewardedKills: 30,
  win: 150,
  podium: 50,
  firstBlood: 30,
  streak3: 40,
  streak5: 80,
  sharpshooter: 30,
  sharpshooterMinShots: 20,
  sharpshooterAccuracy: 0.4,
  /** Objective play (Domination, CTF) and vehicles. Capped like kills. */
  perCapture: 25,
  maxRewardedCaptures: 8,
  perFlagCapture: 100,
  perFlagReturn: 15,
  maxRewardedReturns: 6,
  perVehicleKill: 40,
  maxRewardedVehicleKills: 5,
  /**
   * Gun Game and the round modes: XP for the mode's own play (levels climbed, rounds survived,
   * hiders found), capped per match so long private sessions cannot farm it.
   */
  perGunGameLevel: 15,
  perRoundSurvived: 40,
  perFind: 25,
  maxModeXp: 400,
  maxPerMatch: 2000,
} as const;

/** Levels 1-20 keep the original curve, so no existing profile changes level. */
const ORIGINAL_CURVE_MAX = 20;

/**
 * XP needed to go from `level` to `level + 1`. Up to level 20: 300 + 120(l-1) + 8(l-1)^2 (the v0.1
 * curve). From 20 on the step grows linearly by 300 per level, so the last levels stay reachable:
 * ~43k XP to reach 20, ~330k XP to reach 50 (about 700 completed matches at ~470 XP each).
 */
export function xpToNextLevel(level: number): number {
  if (level < ORIGINAL_CURVE_MAX) return 300 + 120 * (level - 1) + 8 * (level - 1) ** 2;
  const base = 300 + 120 * (ORIGINAL_CURVE_MAX - 2) + 8 * (ORIGINAL_CURVE_MAX - 2) ** 2;
  return base + 300 * (level - (ORIGINAL_CURVE_MAX - 1));
}

/** Total XP required to reach `level` from level 1. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) total += xpToNextLevel(l);
  return total;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  isMax: boolean;
}

export function levelFromXp(totalXp: number): LevelProgress {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level);
    level++;
  }
  const isMax = level >= MAX_LEVEL;
  return { level, xpIntoLevel: isMax ? 0 : remaining, xpForNext: isMax ? 0 : xpToNextLevel(level), isMax };
}

export interface MatchPerformance {
  completed: boolean;
  kills: number;
  placement: number;
  playerCount: number;
  firstBlood: boolean;
  bestStreak: number;
  shotsFired: number;
  shotsHit: number;
  /** Team modes: victory is the team's, placement-based rewards do not apply. */
  team?: { won: boolean };
  captures?: number;
  flagCaptures?: number;
  flagReturns?: number;
  vehicleKills?: number;
  /** Gun Game: levels climbed (net). */
  gunGameLevels?: number;
  /** Round modes: rounds survived as hider / prop, and hiders / props found as seeker. */
  roundsSurvived?: number;
  finds?: number;
}

export interface XpLine {
  reason: string;
  xp: number;
}

export function computeMatchXp(p: MatchPerformance): { total: number; lines: XpLine[] } {
  const lines: XpLine[] = [];
  if (p.completed) lines.push({ reason: "Match completed", xp: XP_RULES.matchCompleted });
  const rewardedKills = Math.min(p.kills, XP_RULES.maxRewardedKills);
  if (rewardedKills > 0)
    lines.push({ reason: `${rewardedKills} eliminations`, xp: rewardedKills * XP_RULES.perKill });
  if (p.completed && p.team) {
    if (p.team.won) lines.push({ reason: "Team victory", xp: XP_RULES.win });
  } else if (p.completed && p.playerCount >= 2) {
    if (p.placement === 1) lines.push({ reason: "Victory", xp: XP_RULES.win });
    else if (p.placement <= 3 && p.playerCount >= 4)
      lines.push({ reason: "Podium finish", xp: XP_RULES.podium });
  }
  const caps = Math.min(p.captures ?? 0, XP_RULES.maxRewardedCaptures);
  if (caps > 0) lines.push({ reason: `${caps} point captures`, xp: caps * XP_RULES.perCapture });
  if ((p.flagCaptures ?? 0) > 0)
    lines.push({
      reason: `${p.flagCaptures} flag captures`,
      xp: (p.flagCaptures ?? 0) * XP_RULES.perFlagCapture,
    });
  const returns = Math.min(p.flagReturns ?? 0, XP_RULES.maxRewardedReturns);
  if (returns > 0) lines.push({ reason: `${returns} flags returned`, xp: returns * XP_RULES.perFlagReturn });
  const wrecks = Math.min(p.vehicleKills ?? 0, XP_RULES.maxRewardedVehicleKills);
  if (wrecks > 0) lines.push({ reason: `${wrecks} vehicles wrecked`, xp: wrecks * XP_RULES.perVehicleKill });
  const mode: XpLine[] = [];
  if ((p.gunGameLevels ?? 0) > 0)
    mode.push({
      reason: `${p.gunGameLevels} weapon levels`,
      xp: (p.gunGameLevels ?? 0) * XP_RULES.perGunGameLevel,
    });
  if ((p.roundsSurvived ?? 0) > 0)
    mode.push({
      reason: `${p.roundsSurvived} rounds survived`,
      xp: (p.roundsSurvived ?? 0) * XP_RULES.perRoundSurvived,
    });
  if ((p.finds ?? 0) > 0) mode.push({ reason: `${p.finds} found`, xp: (p.finds ?? 0) * XP_RULES.perFind });
  // Mode XP is earned only in a completed match and capped (a long private session cannot farm it).
  if (p.completed) {
    let left: number = XP_RULES.maxModeXp;
    for (const l of mode) {
      const xp = Math.min(l.xp, left);
      if (xp <= 0) break;
      lines.push({ reason: l.reason, xp });
      left -= xp;
    }
  }
  if (p.firstBlood) lines.push({ reason: "First blood", xp: XP_RULES.firstBlood });
  if (p.bestStreak >= 5) lines.push({ reason: "Streak x5", xp: XP_RULES.streak5 });
  else if (p.bestStreak >= 3) lines.push({ reason: "Streak x3", xp: XP_RULES.streak3 });
  if (
    p.shotsFired >= XP_RULES.sharpshooterMinShots &&
    p.shotsHit / p.shotsFired >= XP_RULES.sharpshooterAccuracy
  ) {
    lines.push({ reason: "Sharpshooter", xp: XP_RULES.sharpshooter });
  }
  const raw = lines.reduce((sum, l) => sum + l.xp, 0);
  return { total: Math.min(raw, XP_RULES.maxPerMatch), lines };
}

/** Cosmetic skins. `unlockLevel` 1 means available from the start. */
export interface SkinDef {
  id: string;
  name: string;
  unlockLevel: number;
  /** Armor / jacket color. */
  primary: number;
  /** Trim, helmet stripe. */
  accent: number;
  /** Visor glow. */
  visor: number;
}

export const SKINS: readonly SkinDef[] = [
  { id: "foundry", name: "Foundry", unlockLevel: 1, primary: 0x4a5560, accent: 0xff8a3d, visor: 0xffb070 },
  { id: "ash", name: "Ash", unlockLevel: 1, primary: 0x5b5752, accent: 0xd9d4c7, visor: 0x9fe7ff },
  { id: "rust", name: "Rust", unlockLevel: 2, primary: 0x7a4632, accent: 0xe0b48a, visor: 0xffd27a },
  { id: "cobalt", name: "Cobalt", unlockLevel: 4, primary: 0x2c4a7a, accent: 0x8fc3ff, visor: 0x8ff4ff },
  { id: "moss", name: "Moss", unlockLevel: 6, primary: 0x3f5a3a, accent: 0xc9e26b, visor: 0xe9ff8a },
  { id: "signal", name: "Signal", unlockLevel: 8, primary: 0x8a2f2f, accent: 0xffd8c2, visor: 0xff7a7a },
  { id: "dune", name: "Dune", unlockLevel: 10, primary: 0x9a7a4c, accent: 0x3d2f22, visor: 0xffe2a0 },
  { id: "neon", name: "Neon Runner", unlockLevel: 12, primary: 0x2a1f3d, accent: 0xff4fd8, visor: 0x4ff0ff },
  { id: "ivory", name: "Ivory", unlockLevel: 15, primary: 0xd8d2c4, accent: 0x2b2b2b, visor: 0xff9a3d },
  { id: "obsidian", name: "Obsidian", unlockLevel: 18, primary: 0x15161a, accent: 0xffc53d, visor: 0xffe066 },
  { id: "prism", name: "Prism", unlockLevel: 20, primary: 0x1d2b3a, accent: 0x7affc1, visor: 0xffffff },
  { id: "tundra", name: "Tundra", unlockLevel: 22, primary: 0xc9d3d8, accent: 0x3d5a6b, visor: 0x9fe7ff },
  { id: "ember", name: "Ember", unlockLevel: 25, primary: 0x3a1d16, accent: 0xff6a2e, visor: 0xffb070 },
  { id: "jade", name: "Jade", unlockLevel: 28, primary: 0x1f4a3d, accent: 0x7affc1, visor: 0xd8fff0 },
  { id: "marine", name: "Marine", unlockLevel: 31, primary: 0x1b2f4a, accent: 0xffd23f, visor: 0xfff1b0 },
  { id: "carbon", name: "Carbon", unlockLevel: 34, primary: 0x202226, accent: 0x9aa0a6, visor: 0x4ff0ff },
  { id: "rustbelt", name: "Rustbelt", unlockLevel: 37, primary: 0x6b4a2e, accent: 0x2b2b2b, visor: 0xffd27a },
  { id: "violet", name: "Violet", unlockLevel: 40, primary: 0x3a2556, accent: 0xd8a8ff, visor: 0xffffff },
  { id: "arctic", name: "Arctic", unlockLevel: 43, primary: 0xeef2f5, accent: 0x2f6e8a, visor: 0x3fd0ff },
  { id: "inferno", name: "Inferno", unlockLevel: 46, primary: 0x2a0f0b, accent: 0xff3d2e, visor: 0xffd23f },
  { id: "aurum", name: "Aurum", unlockLevel: 50, primary: 0x4a3a12, accent: 0xffd75a, visor: 0xffffff },
];

/** Cosmetic ranks shown next to the callsign. */
export const TITLES: readonly { level: number; name: string }[] = [
  { level: 1, name: "Recruit" },
  { level: 5, name: "Private" },
  { level: 10, name: "Corporal" },
  { level: 15, name: "Sergeant" },
  { level: 20, name: "Lieutenant" },
  { level: 25, name: "Captain" },
  { level: 30, name: "Major" },
  { level: 35, name: "Colonel" },
  { level: 40, name: "Commander" },
  { level: 45, name: "Warlord" },
  { level: 50, name: "Legend" },
];

export function titleForLevel(level: number): string {
  let t = TITLES[0]!.name;
  for (const x of TITLES) if (level >= x.level) t = x.name;
  return t;
}

/** Everything unlocked by reaching `level` (skin names and rank titles), for the results screen. */
export function unlocksForLevel(level: number): string[] {
  return [
    ...SKINS.filter((s) => s.unlockLevel === level).map((s) => `${s.name} skin`),
    ...TITLES.filter((t) => t.level === level && level > 1).map((t) => `Rank: ${t.name}`),
  ];
}

export const DEFAULT_SKIN = "foundry";

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

export function isSkinUnlocked(skinId: string, level: number): boolean {
  const skin = SKINS.find((s) => s.id === skinId);
  return !!skin && level >= skin.unlockLevel;
}

export function rewardsForLevel(level: number): SkinDef[] {
  return SKINS.filter((s) => s.unlockLevel === level);
}
