import type { WeaponDef, WeaponFxCategory } from "@scrapline/shared";

/**
 * Visual profiles per weapon family: how tracers, muzzle flashes, the crosshair kick and the
 * weapon animations look. Pure data (no Phaser), shared by Effects, PlayerView and the crosshair.
 * Gameplay never reads any of it.
 */

export type MuzzleVariant = "cone" | "star" | "wide" | "brake";

export interface FxProfile {
  tracer: {
    /** Length of the bright streak travelling along the shot (0 = full beam, see `beam`). */
    streakPx: number;
    /** Multiplier on `fx.tracerWidth`. */
    widthMul: number;
    /** Fade-out once the head reaches the impact, ms. */
    fadeMs: number;
    /** Sniper: a beam stays along the whole path and fades instead of a short streak. */
    beam: boolean;
    /** Alpha of a wide additive glow under the streak (0 = none). */
    glow: number;
  };
  muzzle: {
    variant: MuzzleVariant;
    scaleMul: number;
    lifeMs: number;
    /** Short light on the floor around the muzzle. */
    lightRadius: number;
    lightMs: number;
    lightColor: number;
    lightAlpha: number;
  };
  /** Smoke puffs at the muzzle per shot (High quality, budgeted). */
  smokePuffs: number;
  /** Shell casing: on every shot, mid-way through the manual action, or never. */
  shell: "shot" | "cycle" | "none";
  /** Cosmetic crosshair expansion per shot (px, screen), added on top of the true spread. */
  crosshairKickPx: number;
  /** Rotational kick per shot when the definition has no `fx.recoilRotDeg`. */
  recoilRotDeg: number;
  /** Manual action after each shot (pump / bolt), when the definition has no `fx.cycle`. */
  cycle: "pump" | "bolt" | null;
}

export const FX_PROFILES: Readonly<Record<WeaponFxCategory, FxProfile>> = {
  pistol: {
    tracer: { streakPx: 90, widthMul: 1, fadeMs: 60, beam: false, glow: 0 },
    muzzle: {
      variant: "star",
      scaleMul: 1,
      lifeMs: 45,
      lightRadius: 150,
      lightMs: 60,
      lightColor: 0xffc27a,
      lightAlpha: 0.45,
    },
    smokePuffs: 1,
    shell: "shot",
    crosshairKickPx: 6,
    recoilRotDeg: 4,
    cycle: null,
  },
  rifle: {
    tracer: { streakPx: 150, widthMul: 1, fadeMs: 60, beam: false, glow: 0 },
    muzzle: {
      variant: "cone",
      scaleMul: 1,
      lifeMs: 55,
      lightRadius: 220,
      lightMs: 70,
      lightColor: 0xffb36b,
      lightAlpha: 0.5,
    },
    smokePuffs: 1,
    shell: "shot",
    crosshairKickPx: 3.5,
    recoilRotDeg: 1.6,
    cycle: null,
  },
  smg: {
    tracer: { streakPx: 80, widthMul: 0.9, fadeMs: 45, beam: false, glow: 0 },
    muzzle: {
      variant: "star",
      scaleMul: 0.9,
      lifeMs: 40,
      lightRadius: 170,
      lightMs: 50,
      lightColor: 0xffd08a,
      lightAlpha: 0.42,
    },
    smokePuffs: 0,
    shell: "shot",
    crosshairKickPx: 2.5,
    recoilRotDeg: 1.2,
    cycle: null,
  },
  shotgun: {
    tracer: { streakPx: 55, widthMul: 1, fadeMs: 40, beam: false, glow: 0 },
    muzzle: {
      variant: "wide",
      scaleMul: 1,
      lifeMs: 70,
      lightRadius: 300,
      lightMs: 90,
      lightColor: 0xffa04d,
      lightAlpha: 0.6,
    },
    smokePuffs: 2,
    shell: "cycle",
    crosshairKickPx: 11,
    recoilRotDeg: 6,
    cycle: "pump",
  },
  sniper: {
    tracer: { streakPx: 0, widthMul: 1, fadeMs: 260, beam: true, glow: 0.35 },
    muzzle: {
      variant: "brake",
      scaleMul: 1,
      lifeMs: 70,
      lightRadius: 320,
      lightMs: 100,
      lightColor: 0xfff0d0,
      lightAlpha: 0.6,
    },
    smokePuffs: 2,
    shell: "cycle",
    crosshairKickPx: 14,
    recoilRotDeg: 7,
    cycle: "bolt",
  },
  mounted: {
    tracer: { streakPx: 190, widthMul: 1.1, fadeMs: 70, beam: false, glow: 0.25 },
    muzzle: {
      variant: "cone",
      scaleMul: 1.15,
      lifeMs: 50,
      lightRadius: 260,
      lightMs: 60,
      lightColor: 0xffa850,
      lightAlpha: 0.55,
    },
    smokePuffs: 1,
    shell: "shot",
    crosshairKickPx: 3,
    recoilRotDeg: 1,
    cycle: null,
  },
};

/** Visual family of a weapon: the definition's own, or one derived from its gameplay shape. */
export function weaponCategory(def: WeaponDef): WeaponFxCategory {
  if (def.fx.category) return def.fx.category;
  if (def.slotKind === "mounted") return "mounted";
  if (def.pellets > 1) return "shotgun";
  if (def.fx.laserSight || def.rpm < 60) return "sniper";
  if (def.slotKind === "secondary") return "pistol";
  return def.rpm >= 800 ? "smg" : "rifle";
}

export function profileFor(def: WeaponDef): FxProfile {
  return FX_PROFILES[weaponCategory(def)];
}

export function recoilRotDeg(def: WeaponDef): number {
  return def.fx.recoilRotDeg ?? profileFor(def).recoilRotDeg;
}

export function cycleOf(def: WeaponDef): "pump" | "bolt" | null {
  return def.fx.cycle ?? profileFor(def).cycle;
}

// ------------------------------------------------------------------ sprite geometry

/** Weapon sprite outline in world px (drawn facing +x), shared with the texture generator. */
export const WEAPON_SHAPES: Readonly<Record<string, { len: number; h: number }>> = {
  pistol: { len: 16, h: 6 },
  rifle: { len: 34, h: 7 },
  smg: { len: 24, h: 7 },
  shotgun: { len: 32, h: 8 },
  sniper: { len: 46, h: 7 },
  mg: { len: 40, h: 9 },
  doorgun: { len: 32, h: 8 },
  carbine: { len: 30, h: 7 },
  battlerifle: { len: 38, h: 7 },
  minigun: { len: 40, h: 10 },
  rpg: { len: 44, h: 8 },
};

export function weaponShape(def: Pick<WeaponDef, "id">): { len: number; h: number } {
  return WEAPON_SHAPES[def.id] ?? { len: 24, h: 7 };
}

/**
 * Texture layout (see textures.ts drawWeapon): the canvas is `len + 4` wide, the grip starts at
 * x = 2 and the barrel ends at x = len + 2; the sprite's origin sits at 10% of the width, on the
 * barrel axis.
 */
export const WEAPON_ORIGIN_X = 0.1;
/** Distance from the body centre to the weapon sprite's origin at rest (px, unscaled). */
export const WEAPON_HOLD_PX = 8;

/** Distance from the sprite origin to the barrel tip along the barrel axis (px, unscaled). */
export function barrelTipFromOrigin(def: Pick<WeaponDef, "id">): number {
  const { len } = weaponShape(def);
  return len + 2 - WEAPON_ORIGIN_X * (len + 4);
}
