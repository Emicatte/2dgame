/**
 * Data-driven weapon definitions. The simulation (shared by client prediction and the server)
 * reads only these values, so balancing or adding a weapon never requires touching game code.
 *
 * Numeric `index` is what travels on the wire; keep indices stable once a release ships.
 */
export type WeaponId =
  | "pistol"
  | "rifle"
  | "smg"
  | "shotgun"
  | "sniper"
  | "mg"
  | "doorgun"
  | "carbine"
  | "battlerifle"
  | "minigun"
  | "rpg";
export type FireMode = "semi" | "auto";
/**
 * "mounted": vehicle weapons, only usable from their seat (never in loadouts or pickups).
 * "loot": found in chests only (never in loadouts).
 */
export type WeaponSlotKind = "primary" | "secondary" | "mounted" | "loot";
/** Visual family of a weapon (tracer, muzzle flash, crosshair kick, animation set). Client only. */
export type WeaponFxCategory = "pistol" | "rifle" | "smg" | "shotgun" | "sniper" | "mounted";

export interface WeaponDef {
  id: WeaponId;
  index: number;
  name: string;
  /** Short marketing line shown in the loadout screen. */
  blurb: string;
  slotKind: WeaponSlotKind;
  fireMode: FireMode;
  /** Damage per pellet before distance falloff. */
  damage: number;
  pellets: number;
  /** Rounds per minute. */
  rpm: number;
  magSize: number;
  /** Spare ammo granted on spawn/pickup; -1 means infinite. */
  reserveAmmo: number;
  reloadSec: number;
  /** Cone half-angle in degrees when standing still and fully recovered. */
  spreadDeg: number;
  bloomPerShotDeg: number;
  maxBloomDeg: number;
  bloomRecoveryDegPerSec: number;
  /** Extra spread while moving (scaled by current speed / max speed). */
  movingSpreadDeg: number;
  /** Shotguns spread pellets evenly across the cone instead of randomly. */
  evenPelletSpread: boolean;
  rangePx: number;
  falloffStartPx: number;
  /** Damage multiplier reached at max range. */
  minDamageMult: number;
  moveSpeedMult: number;
  swapSec: number;
  /** Explosive (rocket): no direct damage; everything within `radius` of the impact takes up to `damage`. */
  splash?: { radius: number; damage: number };
  /** Visual-only feedback. */
  fx: {
    tracerColor: number;
    tracerWidth: number;
    tracerSpeed: number;
    muzzleScale: number;
    recoilKickPx: number;
    shake: number;
    /** Laser sight visible to everyone: counterplay for long-range weapons. */
    laserSight: boolean;
    /** Visual family; the client derives one from the definition when absent. */
    category?: WeaponFxCategory;
    /** Rotational kick of the weapon sprite per shot, in degrees. */
    recoilRotDeg?: number;
    /** Manual action animated after every shot (shell ejected mid-cycle). */
    cycle?: "pump" | "bolt";
  };
  /** Parameters for the procedural sound synthesizer on the client. */
  sound: {
    body: number;
    pitch: number;
    decay: number;
    noise: number;
    crack: number;
    gain: number;
  };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: "pistol",
    index: 0,
    name: "Warden P9",
    blurb: "Reliable sidearm. Infinite reserve, fast draw.",
    slotKind: "secondary",
    fireMode: "semi",
    damage: 26,
    pellets: 1,
    rpm: 400,
    magSize: 12,
    reserveAmmo: -1,
    reloadSec: 1.1,
    spreadDeg: 1.2,
    bloomPerShotDeg: 1.4,
    maxBloomDeg: 6,
    bloomRecoveryDegPerSec: 16,
    movingSpreadDeg: 1.5,
    evenPelletSpread: false,
    rangePx: 950,
    falloffStartPx: 450,
    minDamageMult: 0.6,
    moveSpeedMult: 1,
    swapSec: 0.2,
    fx: {
      tracerColor: 0xffe7a3,
      tracerWidth: 2,
      tracerSpeed: 5200,
      muzzleScale: 0.7,
      recoilKickPx: 3,
      shake: 0.6,
      laserSight: false,
      category: "pistol",
      recoilRotDeg: 4,
    },
    sound: { body: 140, pitch: 1.25, decay: 0.12, noise: 0.7, crack: 0.5, gain: 0.55 },
  },
  rifle: {
    id: "rifle",
    index: 1,
    name: "Halberd AR",
    blurb: "Automatic all-rounder. Controlled bursts stay accurate.",
    slotKind: "primary",
    fireMode: "auto",
    damage: 18,
    pellets: 1,
    rpm: 600,
    magSize: 30,
    reserveAmmo: 120,
    reloadSec: 1.8,
    spreadDeg: 1,
    bloomPerShotDeg: 0.85,
    maxBloomDeg: 7,
    bloomRecoveryDegPerSec: 12,
    movingSpreadDeg: 2,
    evenPelletSpread: false,
    rangePx: 1350,
    falloffStartPx: 700,
    minDamageMult: 0.65,
    moveSpeedMult: 0.92,
    swapSec: 0.32,
    fx: {
      tracerColor: 0xffc46b,
      tracerWidth: 2,
      tracerSpeed: 6000,
      muzzleScale: 0.9,
      recoilKickPx: 4,
      shake: 0.8,
      laserSight: false,
      category: "rifle",
      recoilRotDeg: 1.6,
    },
    sound: { body: 110, pitch: 1, decay: 0.16, noise: 0.85, crack: 0.65, gain: 0.6 },
  },
  smg: {
    id: "smg",
    index: 2,
    name: "Wasp SMG",
    blurb: "Shreds up close. Light enough to run faster.",
    slotKind: "primary",
    fireMode: "auto",
    damage: 13,
    pellets: 1,
    rpm: 900,
    magSize: 35,
    reserveAmmo: 140,
    reloadSec: 1.5,
    spreadDeg: 2.6,
    bloomPerShotDeg: 0.55,
    maxBloomDeg: 8,
    bloomRecoveryDegPerSec: 18,
    movingSpreadDeg: 1,
    evenPelletSpread: false,
    rangePx: 800,
    falloffStartPx: 340,
    minDamageMult: 0.5,
    moveSpeedMult: 1.06,
    swapSec: 0.26,
    fx: {
      tracerColor: 0xa6f0ff,
      tracerWidth: 1.5,
      tracerSpeed: 5000,
      muzzleScale: 0.65,
      recoilKickPx: 2.5,
      shake: 0.45,
      laserSight: false,
      category: "smg",
      recoilRotDeg: 1.2,
    },
    sound: { body: 170, pitch: 1.5, decay: 0.08, noise: 0.75, crack: 0.45, gain: 0.45 },
  },
  shotgun: {
    id: "shotgun",
    index: 3,
    name: "Breacher 12",
    blurb: "Eight pellets. Decisive at arm's length, useless far away.",
    slotKind: "primary",
    fireMode: "semi",
    damage: 13,
    pellets: 8,
    rpm: 72,
    magSize: 6,
    reserveAmmo: 30,
    reloadSec: 2.3,
    spreadDeg: 9,
    bloomPerShotDeg: 0,
    maxBloomDeg: 0,
    bloomRecoveryDegPerSec: 0,
    movingSpreadDeg: 1,
    evenPelletSpread: true,
    rangePx: 540,
    falloffStartPx: 170,
    minDamageMult: 0.25,
    moveSpeedMult: 0.95,
    swapSec: 0.38,
    fx: {
      tracerColor: 0xffd89a,
      tracerWidth: 1.5,
      tracerSpeed: 4200,
      muzzleScale: 1.3,
      recoilKickPx: 8,
      shake: 2.2,
      laserSight: false,
      category: "shotgun",
      recoilRotDeg: 6,
      cycle: "pump",
    },
    sound: { body: 70, pitch: 0.7, decay: 0.32, noise: 1, crack: 0.8, gain: 0.8 },
  },
  sniper: {
    id: "sniper",
    index: 4,
    name: "Longwatch .50",
    blurb: "Near one-shot at any range. Inaccurate on the move, laser gives you away.",
    slotKind: "primary",
    fireMode: "semi",
    damage: 95,
    pellets: 1,
    rpm: 46,
    magSize: 5,
    reserveAmmo: 20,
    reloadSec: 2.6,
    spreadDeg: 0.15,
    bloomPerShotDeg: 0,
    maxBloomDeg: 0,
    bloomRecoveryDegPerSec: 0,
    movingSpreadDeg: 9,
    evenPelletSpread: false,
    rangePx: 2400,
    falloffStartPx: 2400,
    minDamageMult: 1,
    moveSpeedMult: 0.86,
    swapSec: 0.45,
    fx: {
      tracerColor: 0xfff4f4,
      tracerWidth: 3,
      tracerSpeed: 9000,
      muzzleScale: 1.4,
      recoilKickPx: 10,
      shake: 2.8,
      laserSight: true,
      category: "sniper",
      recoilRotDeg: 7,
      cycle: "bolt",
    },
    sound: { body: 60, pitch: 0.6, decay: 0.45, noise: 0.9, crack: 1, gain: 0.85 },
  },
  // ----- loot weapons: found in chests only (indices 7+)
  carbine: {
    id: "carbine",
    index: 7,
    name: "Talon Carbine",
    blurb: "Fast-firing assault rifle. Less damage per round, very controllable.",
    slotKind: "loot",
    fireMode: "auto",
    damage: 15,
    pellets: 1,
    rpm: 760,
    magSize: 32,
    reserveAmmo: 128,
    reloadSec: 1.6,
    spreadDeg: 0.9,
    bloomPerShotDeg: 0.6,
    maxBloomDeg: 6,
    bloomRecoveryDegPerSec: 14,
    movingSpreadDeg: 1.6,
    evenPelletSpread: false,
    rangePx: 1300,
    falloffStartPx: 650,
    minDamageMult: 0.6,
    moveSpeedMult: 0.95,
    swapSec: 0.3,
    fx: {
      tracerColor: 0x9fffb0,
      tracerWidth: 2,
      tracerSpeed: 6200,
      muzzleScale: 0.85,
      recoilKickPx: 3,
      shake: 0.7,
      laserSight: false,
      category: "rifle",
      recoilRotDeg: 1.3,
    },
    sound: { body: 120, pitch: 1.1, decay: 0.14, noise: 0.8, crack: 0.6, gain: 0.55 },
  },
  battlerifle: {
    id: "battlerifle",
    index: 8,
    name: "Vanguard BR",
    blurb: "Semi-automatic heavy assault rifle. Hard-hitting, rewards every shot.",
    slotKind: "loot",
    fireMode: "semi",
    damage: 34,
    pellets: 1,
    rpm: 330,
    magSize: 20,
    reserveAmmo: 80,
    reloadSec: 2,
    spreadDeg: 0.5,
    bloomPerShotDeg: 1.2,
    maxBloomDeg: 5,
    bloomRecoveryDegPerSec: 10,
    movingSpreadDeg: 2.5,
    evenPelletSpread: false,
    rangePx: 1700,
    falloffStartPx: 1000,
    minDamageMult: 0.75,
    moveSpeedMult: 0.9,
    swapSec: 0.36,
    fx: {
      tracerColor: 0xffe08a,
      tracerWidth: 2.4,
      tracerSpeed: 7000,
      muzzleScale: 1.1,
      recoilKickPx: 6,
      shake: 1.3,
      laserSight: false,
      category: "rifle",
      recoilRotDeg: 3.5,
    },
    sound: { body: 85, pitch: 0.85, decay: 0.22, noise: 0.85, crack: 0.8, gain: 0.7 },
  },
  minigun: {
    id: "minigun",
    index: 9,
    name: "Grinder minigun",
    blurb: "A wall of bullets. Huge drum, slow to carry, slow to reload.",
    slotKind: "loot",
    fireMode: "auto",
    damage: 11,
    pellets: 1,
    rpm: 1300,
    magSize: 150,
    reserveAmmo: 150,
    reloadSec: 4.2,
    spreadDeg: 2.4,
    bloomPerShotDeg: 0.25,
    maxBloomDeg: 6,
    bloomRecoveryDegPerSec: 8,
    movingSpreadDeg: 3,
    evenPelletSpread: false,
    rangePx: 1250,
    falloffStartPx: 600,
    minDamageMult: 0.55,
    moveSpeedMult: 0.72,
    swapSec: 0.9,
    fx: {
      tracerColor: 0xffb347,
      tracerWidth: 2,
      tracerSpeed: 6500,
      muzzleScale: 1.2,
      recoilKickPx: 2,
      shake: 0.9,
      laserSight: false,
      category: "mounted",
      recoilRotDeg: 0.8,
    },
    sound: { body: 95, pitch: 0.9, decay: 0.12, noise: 0.95, crack: 0.5, gain: 0.55 },
  },
  rpg: {
    id: "rpg",
    index: 10,
    name: "Hammer RPG",
    blurb: "Rocket launcher. Explodes on impact: area damage, one rocket per reload.",
    slotKind: "loot",
    fireMode: "semi",
    damage: 0,
    pellets: 1,
    rpm: 60,
    magSize: 1,
    reserveAmmo: 4,
    reloadSec: 2.4,
    spreadDeg: 0.6,
    bloomPerShotDeg: 0,
    maxBloomDeg: 0,
    bloomRecoveryDegPerSec: 0,
    movingSpreadDeg: 4,
    evenPelletSpread: false,
    rangePx: 1500,
    falloffStartPx: 1500,
    minDamageMult: 1,
    moveSpeedMult: 0.82,
    swapSec: 0.7,
    splash: { radius: 130, damage: 110 },
    fx: {
      tracerColor: 0xff7a2e,
      tracerWidth: 5,
      tracerSpeed: 1800,
      muzzleScale: 1.6,
      recoilKickPx: 9,
      shake: 2.4,
      laserSight: false,
      category: "mounted",
      recoilRotDeg: 6,
    },
    sound: { body: 55, pitch: 0.5, decay: 0.5, noise: 1, crack: 0.4, gain: 0.85 },
  },
  // ----- mounted (vehicle) weapons: used from a gunner seat, infinite reserve, reload = cooldown
  mg: {
    id: "mg",
    index: 5,
    name: "Bulwark MG",
    blurb: "Turret machine gun of the light armored vehicle.",
    slotKind: "mounted",
    fireMode: "auto",
    damage: 15,
    pellets: 1,
    rpm: 720,
    magSize: 60,
    reserveAmmo: -1,
    reloadSec: 2.4,
    spreadDeg: 1.6,
    bloomPerShotDeg: 0.4,
    maxBloomDeg: 5,
    bloomRecoveryDegPerSec: 10,
    movingSpreadDeg: 1,
    evenPelletSpread: false,
    rangePx: 1450,
    falloffStartPx: 800,
    minDamageMult: 0.6,
    moveSpeedMult: 1,
    swapSec: 0.4,
    fx: {
      tracerColor: 0xffb347,
      tracerWidth: 2.5,
      tracerSpeed: 6500,
      muzzleScale: 1.1,
      recoilKickPx: 3,
      shake: 0.9,
      laserSight: false,
      category: "mounted",
      recoilRotDeg: 1,
    },
    sound: { body: 95, pitch: 0.85, decay: 0.18, noise: 0.9, crack: 0.7, gain: 0.65 },
  },
  doorgun: {
    id: "doorgun",
    index: 6,
    name: "Kestrel chin gun",
    blurb: "Helicopter nose gun, controlled by the gunner.",
    slotKind: "mounted",
    fireMode: "auto",
    damage: 14,
    pellets: 1,
    rpm: 780,
    magSize: 80,
    reserveAmmo: -1,
    reloadSec: 2.8,
    spreadDeg: 2,
    bloomPerShotDeg: 0.35,
    maxBloomDeg: 5,
    bloomRecoveryDegPerSec: 9,
    movingSpreadDeg: 1,
    evenPelletSpread: false,
    rangePx: 1400,
    falloffStartPx: 750,
    minDamageMult: 0.6,
    moveSpeedMult: 1,
    swapSec: 0.4,
    fx: {
      tracerColor: 0x9fe7ff,
      tracerWidth: 2.5,
      tracerSpeed: 6500,
      muzzleScale: 1,
      recoilKickPx: 2,
      shake: 0.7,
      laserSight: false,
      category: "mounted",
      recoilRotDeg: 0.8,
    },
    sound: { body: 100, pitch: 0.95, decay: 0.15, noise: 0.85, crack: 0.6, gain: 0.6 },
  },
};

export const WEAPON_LIST: readonly WeaponDef[] = Object.values(WEAPONS).sort((a, b) => a.index - b.index);

export const PRIMARY_WEAPONS: readonly WeaponId[] = WEAPON_LIST.filter((w) => w.slotKind === "primary").map(
  (w) => w.id,
);

export const DEFAULT_PRIMARY: WeaponId = "rifle";
export const SECONDARY_WEAPON: WeaponId = "pistol";

/** Sentinel for an empty weapon slot on the wire. */
export const NO_WEAPON = 255;

export function weaponByIndex(index: number): WeaponDef | undefined {
  return WEAPON_LIST[index];
}

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === "string" && value in WEAPONS;
}

/** Weapons a chest can give, with relative weights (loot weapons are chest-only). */
export const CHEST_WEAPONS: readonly { id: WeaponId; weight: number }[] = [
  { id: "carbine", weight: 5 },
  { id: "battlerifle", weight: 4 },
  { id: "shotgun", weight: 3 },
  { id: "smg", weight: 3 },
  { id: "sniper", weight: 2 },
  { id: "minigun", weight: 2 },
  { id: "rpg", weight: 1 },
];

/** Picks a chest weapon from a random number in [0, 1). */
export function rollChestWeapon(r: number): WeaponId {
  const total = CHEST_WEAPONS.reduce((s, w) => s + w.weight, 0);
  let x = r * total;
  for (const w of CHEST_WEAPONS) {
    x -= w.weight;
    if (x < 0) return w.id;
  }
  return CHEST_WEAPONS[0]!.id;
}

/** Shields (Fortnite style): absorb damage before health. A chest gives `perChest`, up to `max`. */
export const SHIELD = { max: 100, perChest: 50 } as const;

/** Chests: opened with interact, then closed for this long. */
export const CHEST_RESPAWN_SEC = 40;

export function fireIntervalSec(w: WeaponDef): number {
  return 60 / w.rpm;
}

/** Damage for one pellet travelling `distance` pixels. */
export function damageAtDistance(w: WeaponDef, distance: number): number {
  if (distance <= w.falloffStartPx) return w.damage;
  const span = Math.max(1, w.rangePx - w.falloffStartPx);
  const t = Math.min(1, (distance - w.falloffStartPx) / span);
  return w.damage * (1 - t * (1 - w.minDamageMult));
}
