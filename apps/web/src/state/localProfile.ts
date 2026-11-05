/**
 * Host mode has no shared database: the profile (callsign, XP, career stats, loadout) lives in this
 * browser's localStorage. Same shapes as the server profile, so the menus render it unchanged.
 */
import {
  applyMatchToCareer,
  type CareerStats,
  DEFAULT_PRIMARY,
  DEFAULT_SKIN,
  isWeaponId,
  levelFromXp,
  normalizeCareer,
  type PersonalResult,
  type PlayerStats,
  type PublicProfile,
  unlocksForLevel,
} from "@scrapline/shared";

const KEY = "scrapline.localProfile.v1";

export interface LocalProfileData {
  v: 1;
  id: string;
  nickname: string;
  xp: number;
  skin: string;
  primary: string;
  createdAt: string;
  stats: PlayerStats;
  career?: CareerStats;
}

const emptyStats = (): PlayerStats => ({
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  kills: 0,
  deaths: 0,
  shotsFired: 0,
  shotsHit: 0,
  playtimeSec: 0,
});

/** Storage access throws in some privacy modes: the profile then lasts for this tab only. */
let memoryCopy: LocalProfileData | null = null;

function read(): LocalProfileData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memoryCopy;
    const d = JSON.parse(raw) as Partial<LocalProfileData>;
    if (d.v !== 1 || typeof d.id !== "string" || typeof d.nickname !== "string") return memoryCopy;
    return {
      v: 1,
      id: d.id,
      nickname: d.nickname,
      xp: Number.isFinite(d.xp) ? Math.max(0, Math.floor(d.xp as number)) : 0,
      skin: typeof d.skin === "string" ? d.skin : DEFAULT_SKIN,
      primary: typeof d.primary === "string" && isWeaponId(d.primary) ? d.primary : DEFAULT_PRIMARY,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : new Date().toISOString(),
      stats: { ...emptyStats(), ...(d.stats ?? {}) },
      career: normalizeCareer(d.career),
    };
  } catch {
    return memoryCopy;
  }
}

function write(d: LocalProfileData) {
  memoryCopy = d;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // keep the in-memory copy
  }
}

function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function toPublic(d: LocalProfileData): PublicProfile {
  const lp = levelFromXp(d.xp);
  return {
    id: d.id,
    nickname: d.nickname,
    level: lp.level,
    xp: d.xp,
    xpIntoLevel: lp.xpIntoLevel,
    xpForNext: lp.xpForNext,
    stats: { ...d.stats, career: normalizeCareer(d.career) },
    skin: d.skin,
    primary: d.primary,
    createdAt: d.createdAt,
  };
}

export const localProfile = {
  load(): LocalProfileData | null {
    return read();
  },

  create(nickname: string): LocalProfileData {
    const d: LocalProfileData = {
      v: 1,
      id: uuid(),
      nickname,
      xp: 0,
      skin: DEFAULT_SKIN,
      primary: DEFAULT_PRIMARY,
      createdAt: new Date().toISOString(),
      stats: emptyStats(),
    };
    write(d);
    return d;
  },

  update(patch: Partial<Pick<LocalProfileData, "nickname" | "skin" | "primary">>): LocalProfileData | null {
    const d = read();
    if (!d) return null;
    const next = { ...d, ...patch };
    write(next);
    return next;
  },

  /**
   * Records a match from the host's results and fills in the totals the results screen shows.
   * Returns the completed personal result (unchanged for practice matches).
   */
  applyResult(personal: PersonalResult): PersonalResult {
    const d = read();
    const rec = personal.record;
    if (!d || !rec || personal.practice) return personal;
    const before = levelFromXp(d.xp).level;
    const { career, rewards } = applyMatchToCareer(
      normalizeCareer(d.career),
      {
        mode: rec.mode ?? "deathmatch",
        completed: rec.completed,
        won: rec.won,
        kills: rec.kills,
        deaths: rec.deaths,
        captures: rec.captures ?? 0,
        flagCaptures: rec.flagCaptures ?? 0,
        flagReturns: rec.flagReturns ?? 0,
        vehicleKills: rec.vehicleKills ?? 0,
      },
      new Date(),
    );
    const bonus = rewards.reduce((sum, l) => sum + l.xp, 0);
    const xp = d.xp + Math.max(0, Math.floor(personal.xpGained)) + bonus;
    const s = d.stats;
    const stats: PlayerStats = {
      matchesPlayed: s.matchesPlayed + (rec.completed ? 1 : 0),
      wins: s.wins + (rec.won ? 1 : 0),
      losses: s.losses + (rec.completed && !rec.won ? 1 : 0),
      kills: s.kills + rec.kills,
      deaths: s.deaths + rec.deaths,
      shotsFired: s.shotsFired + rec.shotsFired,
      shotsHit: s.shotsHit + rec.shotsHit,
      playtimeSec: s.playtimeSec + rec.playtimeSec,
    };
    write({ ...d, xp, stats, career });
    const after = levelFromXp(xp).level;
    const unlocked: string[] = [];
    for (let l = before + 1; l <= after; l++) unlocked.push(...unlocksForLevel(l));
    return {
      ...personal,
      xpGained: personal.xpGained + bonus,
      xpLines: [...personal.xpLines, ...rewards],
      totalXp: xp,
      level: after,
      leveledUp: after > before,
      unlocked,
      persisted: true,
    };
  },
};
