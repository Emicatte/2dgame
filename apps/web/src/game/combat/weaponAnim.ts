import { activeWeapon, type PlayerSim, secToSteps, type WeaponDef } from "@scrapline/shared";
import { cycleOf, recoilRotDeg } from "./weaponFx.ts";

/**
 * Weapon sprite animation without Phaser: recoil (distance + rotation), the shotgun pump and the
 * sniper bolt after each shot, reload dip, draw (swap) raise and a slight sway while moving.
 * Everything is cosmetic; timers come from the predicted sim (local player) or are estimated from
 * the interpolated `reloading` flag and weapon changes (remote players).
 */

export interface WeaponPose {
  /** Pull towards the body along the barrel axis, px (unscaled; positive = back). */
  back: number;
  /** Rotation about the grip, radians (positive = clockwise on screen). */
  rot: number;
  /** The manual action ejected a shell during this update. */
  eject: boolean;
}

export interface AnimInput {
  def: WeaponDef | undefined;
  /** Local player: reload progress 0..1 from the predicted timer, or null. Omit for remote players. */
  reload?: number | null;
  /** Remote players: the interpolated `reloading` flag. */
  reloading?: boolean;
  /** Local player: draw progress 0..1 from the predicted swap timer (1 = ready). Omit for remote. */
  swap?: number;
  /** Movement speed as a fraction of the max (0..1) and the walk cycle phase, for the sway. */
  moving: number;
  stepPhase: number;
}

/**
 * Reload / draw state passed to PlayerView. Local player: progress from the predicted timers
 * (`reload` 0..1 or null, `swap` 0..1 with 1 = ready). Remote players: the interpolated
 * `reloading` flag (progress is estimated); draws are detected from weapon changes.
 */
export interface WeaponAnimState {
  reload?: number | null;
  reloading?: boolean;
  swap?: number;
}

/** Animation state of the local player from the predicted simulation's step timers. */
export function localWeaponAnim(sim: PlayerSim, out: WeaponAnimState = {}): WeaponAnimState {
  const def = activeWeapon(sim);
  out.reload = def && sim.reload > 0 ? Math.max(0, 1 - sim.reload / secToSteps(def.reloadSec)) : null;
  out.swap = def && sim.swap > 0 ? Math.max(0, 1 - sim.swap / secToSteps(def.swapSec)) : 1;
  out.reloading = undefined;
  return out;
}

const DEG = Math.PI / 180;
export const KICK_MAX_PX = 14;
/** Linear recovery of the distance kick, px per second. */
export const KICK_RECOVERY_PX_S = 90;
export const ROT_KICK_MAX = 0.25;
export const ROT_TAU_MS = 70;
export const RELOAD_ROT = 0.62;
export const RELOAD_BACK = 5;
export const SWAP_ROT = 1.05;
export const SWAP_BACK = 9;

export const CYCLES = {
  pump: { delayMs: 140, durationMs: 320, back: 4.5, rot: 0.05, ejectAt: 0.5 },
  bolt: { delayMs: 220, durationMs: 520, back: 3, rot: 0.24, ejectAt: 0.45 },
} as const;

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** 0 → 1 dip during the first 20 % of a reload, held, back to 0 over the last 22 %. */
export function reloadEnvelope(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.2) return smooth(p / 0.2);
  if (p > 0.78) return smooth((1 - p) / 0.22);
  return 1;
}

/** Reload pose: dip and turn, with a short jolt when the new magazine goes in (≈ 55 %). */
export function reloadPose(p: number, out: { back: number; rot: number }): void {
  const env = reloadEnvelope(p);
  const jolt = Math.max(0, 1 - Math.abs(p - 0.55) / 0.07);
  out.back += RELOAD_BACK * env - 2.5 * jolt;
  out.rot += RELOAD_ROT * env - 0.1 * jolt;
}

/** Draw pose: the new weapon comes up from lowered (p = 0) to ready (p = 1). */
export function swapPose(p: number, out: { back: number; rot: number }): void {
  const k = 1 - smooth(p);
  out.back += SWAP_BACK * k;
  out.rot += SWAP_ROT * k;
}

/** Manual action at phase t (0..1): the weapon is worked back and forth. */
export function cyclePose(kind: "pump" | "bolt", t: number, out: { back: number; rot: number }): void {
  if (t <= 0 || t >= 1) return;
  const c = CYCLES[kind];
  const k = Math.sin(Math.PI * t);
  out.back += c.back * k;
  out.rot += c.rot * k;
}

export class WeaponAnimator {
  kick = 0;
  rotKick = 0;
  private weapon = Number.NaN;
  private rotSign = 1;
  private cycleKind: "pump" | "bolt" | null = null;
  /** Time since the last shot of a manual-action weapon, ms (-1 = no cycle running). */
  private cycleMs = -1;
  private ejected = true;
  private swapP = 1;
  private swapMs = 0;
  /** Remote reload estimate (progress), -1 when not reloading. */
  private remoteReload = -1;
  private readonly pose: WeaponPose = { back: 0, rot: 0, eject: false };

  fire(def: WeaponDef): void {
    this.kick = Math.min(KICK_MAX_PX, this.kick + def.fx.recoilKickPx);
    // Automatic fire wobbles from side to side; single shots always climb the same way.
    this.rotSign = def.fireMode === "auto" ? -this.rotSign : 1;
    const r = this.rotKick + this.rotSign * recoilRotDeg(def) * DEG;
    this.rotKick = Math.max(-ROT_KICK_MAX, Math.min(ROT_KICK_MAX, r));
    const cycle = cycleOf(def);
    if (cycle) {
      this.cycleKind = cycle;
      this.cycleMs = 0;
      this.ejected = false;
    }
  }

  /** Death / respawn: no animation carries over. */
  reset(): void {
    this.kick = 0;
    this.rotKick = 0;
    this.cycleMs = -1;
    this.ejected = true;
    this.swapP = 1;
    this.remoteReload = -1;
  }

  update(dtMs: number, weaponIndex: number, i: AnimInput): WeaponPose {
    const dt = Math.max(0, dtMs);
    const def = i.def;
    const pose = this.pose;
    pose.back = 0;
    pose.rot = 0;
    pose.eject = false;

    if (weaponIndex !== this.weapon) {
      // A weapon change (not the first weapon seen) starts the draw animation.
      if (!Number.isNaN(this.weapon) && def) {
        this.swapP = 0;
        this.swapMs = Math.max(1, def.swapSec * 1000);
      }
      this.weapon = weaponIndex;
      this.cycleMs = -1;
      this.ejected = true;
      this.remoteReload = -1;
    }

    this.kick = Math.max(0, this.kick - (dt / 1000) * KICK_RECOVERY_PX_S);
    this.rotKick *= Math.exp(-dt / ROT_TAU_MS);
    if (Math.abs(this.rotKick) < 1e-4) this.rotKick = 0;
    pose.back += this.kick;
    pose.rot += this.rotKick;

    if (this.cycleMs >= 0 && this.cycleKind) {
      this.cycleMs += dt;
      const c = CYCLES[this.cycleKind];
      const t = (this.cycleMs - c.delayMs) / c.durationMs;
      if (t >= 1) this.cycleMs = -1;
      else cyclePose(this.cycleKind, t, pose);
      if (!this.ejected && t >= c.ejectAt) {
        this.ejected = true;
        pose.eject = true;
      }
    }

    let reload: number | null = null;
    if (i.reload !== undefined) {
      reload = i.reload;
    } else if (def) {
      const dur = Math.max(1, def.reloadSec * 1000);
      if (i.reloading) {
        // Hold just before the raise until the flag drops (the exact end is unknown here).
        this.remoteReload = Math.min(0.9, Math.max(0, this.remoteReload) + dt / dur);
      } else if (this.remoteReload >= 0) {
        this.remoteReload = Math.max(this.remoteReload, 0.78) + (2 * dt) / dur;
        if (this.remoteReload >= 1) this.remoteReload = -1;
      }
      reload = this.remoteReload >= 0 ? this.remoteReload : null;
    }
    if (reload !== null) reloadPose(reload, pose);

    if (i.swap !== undefined) this.swapP = i.swap;
    else if (this.swapP < 1) this.swapP = Math.min(1, this.swapP + dt / this.swapMs);
    if (this.swapP < 1) swapPose(this.swapP, pose);

    // Sway along the barrel and a hair of rotation (< 1 px at the muzzle).
    const m = Math.max(0, Math.min(1, i.moving));
    pose.back += 1.1 * m * Math.sin(i.stepPhase);
    pose.rot += 0.012 * m * Math.cos(i.stepPhase);
    return pose;
  }
}
