import { NET, PLAYER, STEP_DT } from "../config/game.ts";
import { NO_WEAPON, WEAPONS, type WeaponDef, type WeaponId, weaponByIndex } from "../config/weapons.ts";
import { DOWNED } from "../config/zombies.ts";
import { BTN, type InputFrame } from "../protocol/input.ts";
import { type CollisionWorld, resolveCircle } from "./collision.ts";
import { approach2, DEG } from "./math.ts";
import { rand01 } from "./rng.ts";
import { type Circle, pushOutOfCircles } from "./vehicle.ts";

/**
 * Deterministic per-player simulation shared by client prediction and the authoritative server.
 * Given the same starting state and the same InputFrame sequence it produces the same result,
 * which is what makes reconciliation converge without visible snapping.
 *
 * Every timer that gates a discrete decision (firing, reloading, swapping, dashing) counts whole
 * input steps, so float rounding on the wire can never make client and server disagree about
 * whether a shot happened.
 */

export const SLOT_COUNT = 3;
export const SLOT_PRIMARY = 0;
export const SLOT_SECONDARY = 1;
export const SLOT_PICKUP = 2;

export function secToSteps(sec: number): number {
  return Math.max(1, Math.round(sec * NET.inputRate));
}

export function fireIntervalSteps(w: WeaponDef): number {
  return secToSteps(60 / w.rpm);
}

const DASH_STEPS = secToSteps(PLAYER.dashDuration);
const DASH_COOLDOWN_STEPS = secToSteps(PLAYER.dashCooldown);

export interface WeaponSlotState {
  /** Weapon index or NO_WEAPON. */
  id: number;
  mag: number;
  /** -1 means infinite. */
  reserve: number;
}

export interface PlayerSim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  /** Remaining dash steps. */
  dash: number;
  dashCd: number;
  dashDx: number;
  dashDy: number;
  dashHeld: boolean;
  slot: number;
  slots: WeaponSlotState[];
  /** Steps until the next shot is allowed. */
  cooldown: number;
  /** Steps until the current reload completes (0 = not reloading). */
  reload: number;
  /** Steps until the weapon being drawn is ready. */
  swap: number;
  /** Extra spread in degrees from sustained fire. */
  bloom: number;
  trigger: boolean;
}

export interface ShotIntent {
  seq: number;
  weapon: number;
  ox: number;
  oy: number;
  angles: number[];
}

export type SimEvent =
  | { kind: "shot"; shot: ShotIntent }
  | { kind: "dry" }
  | { kind: "reloadStart"; weapon: number }
  | { kind: "reloadDone"; weapon: number }
  | { kind: "swap"; weapon: number }
  | { kind: "dash" };

export interface StepContext {
  world: CollisionWorld;
  /** Per-shooter seed so spread differs between players but matches between client and server. */
  seed: number;
  alive: boolean;
  /** Optional sink for gameplay events (sounds, tracers). Omitted during reconciliation replays. */
  emit?: (e: SimEvent) => void;
  /**
   * The player sits in a vehicle: no own movement or dash (the position is the seat's, set by the
   * caller); weapons work as usual.
   */
  mounted?: boolean;
  /** Bodies a walking player cannot pass through (vehicles). */
  obstacles?: readonly Circle[];
  /**
   * PvE: the player is downed. They crawl (slow, no dash) and cannot fire, reload or switch
   * weapons until revived. Synchronized (PlayerState.downed) so the prediction applies it too.
   */
  downed?: boolean;
}

export function emptySlot(): WeaponSlotState {
  return { id: NO_WEAPON, mag: 0, reserve: 0 };
}

export function fullSlot(weaponId: WeaponId): WeaponSlotState {
  const def = WEAPONS[weaponId];
  return { id: def.index, mag: def.magSize, reserve: def.reserveAmmo };
}

export function createPlayerSim(x: number, y: number, primary: WeaponId): PlayerSim {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    aim: 0,
    dash: 0,
    dashCd: 0,
    dashDx: 0,
    dashDy: 0,
    dashHeld: false,
    slot: SLOT_PRIMARY,
    slots: [fullSlot(primary), fullSlot("pistol"), emptySlot()],
    cooldown: 0,
    reload: 0,
    swap: 0,
    bloom: 0,
    trigger: false,
  };
}

export function clonePlayerSim(s: PlayerSim): PlayerSim {
  return { ...s, slots: s.slots.map((sl) => ({ ...sl })) };
}

export function activeWeapon(s: PlayerSim): WeaponDef | undefined {
  const slot = s.slots[s.slot];
  return slot && slot.id !== NO_WEAPON ? weaponByIndex(slot.id) : undefined;
}

/** Current spread half-angle in degrees (used by the crosshair and by firing). */
export function currentSpreadDeg(s: PlayerSim, w: WeaponDef): number {
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  const moving = Math.min(1, speed / PLAYER.maxSpeed);
  return w.spreadDeg + s.bloom + w.movingSpreadDeg * moving;
}

export function stepPlayer(s: PlayerSim, input: InputFrame, ctx: StepContext): void {
  s.aim = input.aim;
  if (ctx.downed) {
    // Crawl: movement only, at a fraction of the speed; weapons hold still.
    const crawl: InputFrame = { ...input, buttons: 0, slot: -1 };
    s.dash = 0;
    stepMovement(s, crawl, ctx, STEP_DT, DOWNED.speedMult);
    if (s.cooldown > 0) s.cooldown -= 1;
    if (s.swap > 0) s.swap -= 1;
    s.reload = 0;
    s.trigger = false;
    return;
  }
  stepMovement(s, input, ctx, STEP_DT);
  stepWeapons(s, input, ctx, STEP_DT);
}

function stepMovement(s: PlayerSim, input: InputFrame, ctx: StepContext, dt: number, speedMult = 1): void {
  let mx = input.mx;
  let my = input.my;
  const len = Math.sqrt(mx * mx + my * my);
  if (len > 0) {
    mx /= len;
    my /= len;
  }
  const dashPressed = (input.buttons & BTN.DASH) !== 0;
  if (ctx.mounted) {
    s.vx = 0;
    s.vy = 0;
    s.dash = 0;
    s.dashHeld = dashPressed;
    if (s.dashCd > 0) s.dashCd -= 1;
    return;
  }
  if (ctx.alive && dashPressed && !s.dashHeld && s.dashCd === 0 && s.dash === 0) {
    if (len > 0) {
      s.dashDx = mx;
      s.dashDy = my;
    } else {
      s.dashDx = Math.cos(s.aim);
      s.dashDy = Math.sin(s.aim);
    }
    s.dash = DASH_STEPS;
    s.dashCd = DASH_COOLDOWN_STEPS;
    ctx.emit?.({ kind: "dash" });
  }
  s.dashHeld = dashPressed;

  if (!ctx.alive) {
    s.vx = 0;
    s.vy = 0;
    s.dash = 0;
  } else if (s.dash > 0) {
    s.vx = s.dashDx * PLAYER.dashSpeed;
    s.vy = s.dashDy * PLAYER.dashSpeed;
    s.dash -= 1;
  } else {
    const w = activeWeapon(s);
    const maxSpeed = PLAYER.maxSpeed * (w?.moveSpeedMult ?? 1) * speedMult;
    const rate = len > 0 ? PLAYER.acceleration : PLAYER.deceleration;
    [s.vx, s.vy] = approach2(s.vx, s.vy, mx * maxSpeed, my * maxSpeed, rate * dt);
  }
  if (s.dashCd > 0) s.dashCd -= 1;

  if (s.vx !== 0 || s.vy !== 0) {
    const r = resolveCircle(ctx.world, s.x + s.vx * dt, s.y + s.vy * dt, PLAYER.radius);
    s.x = r.x;
    s.y = r.y;
    if (r.hitX) s.vx = 0;
    if (r.hitY) s.vy = 0;
  }
  if (ctx.obstacles && ctx.obstacles.length > 0) {
    const out = pushOutOfCircles(s.x, s.y, PLAYER.radius, ctx.obstacles);
    if (out.x !== s.x || out.y !== s.y) {
      // Slide along the body: drop the velocity component pointing into it.
      const nx = out.x - s.x;
      const ny = out.y - s.y;
      const len = Math.hypot(nx, ny);
      const vn = (s.vx * nx + s.vy * ny) / len;
      if (vn < 0) {
        s.vx -= (nx / len) * vn;
        s.vy -= (ny / len) * vn;
      }
      const r = resolveCircle(ctx.world, out.x, out.y, PLAYER.radius);
      s.x = r.x;
      s.y = r.y;
    }
  }
}

function finishReload(slot: WeaponSlotState, w: WeaponDef): void {
  const need = w.magSize - slot.mag;
  const take = slot.reserve < 0 ? need : Math.min(need, slot.reserve);
  slot.mag += take;
  if (slot.reserve >= 0) slot.reserve -= take;
}

function stepWeapons(s: PlayerSim, input: InputFrame, ctx: StepContext, dt: number): void {
  if (s.cooldown > 0) s.cooldown -= 1;
  if (s.swap > 0) s.swap -= 1;

  // Slot switching cancels a reload in progress.
  if (input.slot >= 0 && input.slot < SLOT_COUNT && input.slot !== s.slot) {
    const target = s.slots[input.slot];
    const def = target ? weaponByIndex(target.id) : undefined;
    if (target && def) {
      s.slot = input.slot;
      s.reload = 0;
      s.swap = secToSteps(def.swapSec);
      s.bloom = 0;
      ctx.emit?.({ kind: "swap", weapon: target.id });
    }
  }

  const slot = s.slots[s.slot];
  const w = activeWeapon(s);
  const fireHeld = (input.buttons & BTN.FIRE) !== 0;
  if (!slot || !w) {
    s.trigger = fireHeld;
    return;
  }

  s.bloom = Math.max(0, s.bloom - w.bloomRecoveryDegPerSec * dt);

  if (s.reload > 0) {
    s.reload -= 1;
    if (s.reload === 0) {
      finishReload(slot, w);
      ctx.emit?.({ kind: "reloadDone", weapon: w.index });
    }
  }

  const canStartReload = () => s.reload === 0 && slot.mag < w.magSize && slot.reserve !== 0;
  if (ctx.alive && (input.buttons & BTN.RELOAD) !== 0 && s.swap === 0 && canStartReload()) {
    s.reload = secToSteps(w.reloadSec);
    ctx.emit?.({ kind: "reloadStart", weapon: w.index });
  }

  const wantsFire = fireHeld && (w.fireMode === "auto" || !s.trigger);
  if (ctx.alive && wantsFire && s.swap === 0 && s.reload === 0 && s.cooldown === 0) {
    if (slot.mag > 0) {
      slot.mag -= 1;
      s.cooldown = fireIntervalSteps(w);
      const spread = currentSpreadDeg(s, w) * DEG;
      const angles: number[] = [];
      for (let k = 0; k < w.pellets; k++) {
        let offset: number;
        if (w.evenPelletSpread && w.pellets > 1) {
          const lane = -spread + (2 * spread * (k + 0.5)) / w.pellets;
          const jitter = (rand01(ctx.seed, input.seq, k + 101) * 2 - 1) * (spread / w.pellets) * 0.6;
          offset = lane + jitter;
        } else {
          offset = (rand01(ctx.seed, input.seq, k) * 2 - 1) * spread;
        }
        angles.push(s.aim + offset);
      }
      s.bloom = Math.min(w.maxBloomDeg, s.bloom + w.bloomPerShotDeg);
      ctx.emit?.({ kind: "shot", shot: { seq: input.seq, weapon: w.index, ox: s.x, oy: s.y, angles } });
    } else if (canStartReload()) {
      s.reload = secToSteps(w.reloadSec);
      ctx.emit?.({ kind: "reloadStart", weapon: w.index });
    } else if (!s.trigger) {
      ctx.emit?.({ kind: "dry" });
    }
  }
  s.trigger = fireHeld;
}

/** Puts a weapon in the pickup slot (or refills it if already carried) and draws it. Server-only. */
export function giveWeapon(s: PlayerSim, weaponId: WeaponId): void {
  const def = WEAPONS[weaponId];
  const existing = s.slots.findIndex((sl) => sl.id === def.index);
  if (existing >= 0) {
    const sl = s.slots[existing]!;
    sl.mag = def.magSize;
    sl.reserve = def.reserveAmmo;
    return;
  }
  s.slots[SLOT_PICKUP] = fullSlot(weaponId);
  s.slot = SLOT_PICKUP;
  s.reload = 0;
  s.swap = secToSteps(def.swapSec);
  s.bloom = 0;
}

/** Refills reserve ammo of every carried weapon. Returns true if anything changed. */
export function refillAmmo(s: PlayerSim): boolean {
  let changed = false;
  for (const sl of s.slots) {
    if (sl.id === NO_WEAPON) continue;
    const def = weaponByIndex(sl.id);
    if (!def || def.reserveAmmo < 0) continue;
    if (sl.reserve < def.reserveAmmo) {
      sl.reserve = def.reserveAmmo;
      changed = true;
    }
  }
  return changed;
}
