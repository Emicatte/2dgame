/**
 * Data-driven weapon definitions. The simulation (shared by client prediction and the server)
 * reads only these values, so balancing or adding a weapon never requires touching game code.
 *
 * Numeric `index` is what travels on the wire; keep indices stable once a release ships.
 */
export type WeaponId = "pistol" | "rifle" | "smg" | "shotgun" | "sniper" | "mg" | "doorgun";
export type FireMode = "semi" | "auto";
/** "mounted": vehicle weapons, only usable from their seat (never in loadouts or pickups). */
export type WeaponSlotKind = "primary" | "secondary" | "mounted";

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
    },
    sound: { body: 60, pitch: 0.6, decay: 0.45, noise: 0.9, crack: 1, gain: 0.85 },
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
