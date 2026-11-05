/**
 * Account progression. XP is computed only on the server from authoritative match data;
 * the client uses these same functions purely to display progress bars.
 *
 * Rewards are cosmetic only, so levels never create a competitive advantage.
 */
export const MAX_LEVEL = 20;

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
  maxPerMatch: 1500,
} as const;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNextLevel(level: number): number {
  return 300 + 120 * (level - 1) + 8 * (level - 1) ** 2;
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
  if (p.completed && p.playerCount >= 2) {
    if (p.placement === 1) lines.push({ reason: "Victory", xp: XP_RULES.win });
    else if (p.placement <= 3 && p.playerCount >= 4)
      lines.push({ reason: "Podium finish", xp: XP_RULES.podium });
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
];

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
