import { PLAYER, STEP_DT } from "../config/game.ts";
import {
  AIRBORNE_ALT,
  type SeatDef,
  VEHICLES,
  type VehicleDef,
  type VehicleKind,
} from "../config/vehicles.ts";
import { BTN, type InputFrame } from "../protocol/input.ts";
import { type CollisionWorld, circleIntersectsRect, querySolids, resolveCircle } from "./collision.ts";
import { approach2, clamp, wrapAngle } from "./math.ts";

/**
 * Deterministic vehicle model shared by the authoritative server and the predicting driver.
 *
 * Ground vehicles use an arcade "bicycle-less" model: velocity is split into a forward and a
 * lateral component; throttle and brake act on the forward part, tyre grip bleeds off the lateral
 * part (the handbrake lowers grip for a controlled drift) and the yaw rate grows with speed, so a
 * car cannot spin on the spot. The body collides as a few circles laid along its axis, which keeps
 * wall contacts smooth and exactly reproducible with the existing circle-vs-rectangle resolver.
 *
 * The helicopter flies in screen axes (WASD) and turns its nose towards the pilot's aim; the
 * dash key toggles take-off / landing. In the air it only collides with tall solids.
 */

export interface VehicleSim {
  x: number;
  y: number;
  /** Heading (rad): direction of the nose. */
  angle: number;
  vx: number;
  vy: number;
  /** Yaw rate (rad/s). */
  av: number;
  /** Helicopter altitude 0 (ground) … 1 (cruise). Always 0 for ground vehicles. */
  alt: number;
  /** Rotor speed 0 … 1. */
  rotor: number;
  /** Pilot's take-off request (toggled by the dash key). */
  lift: boolean;
  /** Dash key state on the previous step (edge detection, predicted like everything else). */
  liftHeld: boolean;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface VehicleStepContext {
  /** Full collision world (ground level). */
  world: CollisionWorld;
  /** Tall solids only (what a flying helicopter can hit). */
  airWorld: CollisionWorld;
  /** Other bodies this vehicle is pushed out of (other vehicles). */
  obstacles?: readonly Circle[];
}

export interface VehicleStepResult {
  /** Speed (px/s) into the hardest contact of this step: walls, map edge or obstacles. */
  impact: number;
  /** Speed into obstacles only (vehicle-vs-vehicle contacts). */
  obstacleImpact: number;
}

/** Bounce factor on contact (0 = dead stop along the normal). */
const RESTITUTION = 0.18;
/** Yaw rate response (1/s). */
const YAW_RESPONSE = 12;

export function createVehicleSim(x: number, y: number, angle: number): VehicleSim {
  return { x, y, angle, vx: 0, vy: 0, av: 0, alt: 0, rotor: 0, lift: false, liftHeld: false };
}

export function cloneVehicleSim(v: VehicleSim): VehicleSim {
  return { ...v };
}

export function vehicleDef(kind: VehicleKind): VehicleDef {
  return VEHICLES[kind];
}

export function isFlying(def: VehicleDef): boolean {
  return !!def.flight;
}

export function isAirborne(v: VehicleSim): boolean {
  return v.alt >= AIRBORNE_ALT;
}

export function vehicleSpeed(v: VehicleSim): number {
  return Math.hypot(v.vx, v.vy);
}

/** Forward speed along the nose (negative when reversing). */
export function forwardSpeed(v: VehicleSim): number {
  return v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
}

/** World position of a point given in the vehicle frame (+x nose, +y right side). */
export function localToWorld(
  v: { x: number; y: number; angle: number },
  lx: number,
  ly: number,
): { x: number; y: number } {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  return { x: v.x + c * lx - s * ly, y: v.y + s * lx + c * ly };
}

export function seatWorld(
  v: { x: number; y: number; angle: number },
  seat: Pick<SeatDef, "ox" | "oy">,
): { x: number; y: number } {
  return localToWorld(v, seat.ox, seat.oy);
}

/** Collision circles of the body, in world space. */
export function vehicleCircles(v: { x: number; y: number; angle: number }, def: VehicleDef): Circle[] {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  return def.collisionOffsets.map((o) => ({ x: v.x + c * o, y: v.y + s * o, r: def.collisionRadius }));
}

/** True when the aim lies inside the seat's fire sector (vehicle heading `angle`). */
export function inSector(seat: SeatDef, angle: number, aim: number, tolerance = 0): boolean {
  if (seat.arc <= 0) return false;
  if (seat.arc >= Math.PI) return true;
  return Math.abs(wrapAngle(aim - angle - seat.sector)) <= seat.arc + tolerance;
}

/** Closest point of the oriented body box to (px, py), and the distance to it (0 inside). */
export function closestOnBody(
  v: { x: number; y: number; angle: number },
  def: VehicleDef,
  px: number,
  py: number,
): { x: number; y: number; dist: number; inside: boolean } {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  const dx = px - v.x;
  const dy = py - v.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const cx = clamp(lx, -def.halfLength, def.halfLength);
  const cy = clamp(ly, -def.halfWidth, def.halfWidth);
  const inside = cx === lx && cy === ly;
  const w = localToWorld(v, cx, cy);
  return { x: w.x, y: w.y, dist: inside ? 0 : Math.hypot(px - w.x, py - w.y), inside };
}

/**
 * Distance along a normalised ray to the oriented body box, or -1 if missed (slab method in the
 * vehicle frame). 0 when the origin is inside.
 */
export function raycastBody(
  v: { x: number; y: number; angle: number },
  def: VehicleDef,
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
): number {
  const c = Math.cos(v.angle);
  const s = Math.sin(v.angle);
  const rx = ox - v.x;
  const ry = oy - v.y;
  const lox = rx * c + ry * s;
  const loy = -rx * s + ry * c;
  const ldx = dirX * c + dirY * s;
  const ldy = -dirX * s + dirY * c;
  let tmin = Number.NEGATIVE_INFINITY;
  let tmax = Number.POSITIVE_INFINITY;
  const slabs: [number, number, number][] = [
    [lox, ldx, def.halfLength],
    [loy, ldy, def.halfWidth],
  ];
  for (const [o, d, h] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) return -1;
      continue;
    }
    const t1 = (-h - o) / d;
    const t2 = (h - o) / d;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < 0 || tmin > tmax) return -1;
  return Math.max(0, tmin);
}

/** True when every collision circle of the body fits in `world` (used before touching down). */
export function bodyFits(
  world: CollisionWorld,
  v: { x: number; y: number; angle: number },
  def: VehicleDef,
): boolean {
  for (const c of vehicleCircles(v, def)) {
    if (c.x < c.r || c.y < c.r || c.x > world.width - c.r || c.y > world.height - c.r) return false;
    for (const idx of querySolids(world, c.x - c.r, c.y - c.r, c.x + c.r, c.y + c.r)) {
      if (circleIntersectsRect(c.x, c.y, c.r, world.solids[idx]!)) return false;
    }
  }
  return true;
}

/** Pushes a circle out of a set of circles (players against vehicles). */
export function pushOutOfCircles(
  x: number,
  y: number,
  r: number,
  obstacles: readonly Circle[],
): { x: number; y: number } {
  let px = x;
  let py = y;
  for (const o of obstacles) {
    const dx = px - o.x;
    const dy = py - o.y;
    const min = r + o.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      px += min;
      continue;
    }
    px = o.x + (dx / d) * min;
    py = o.y + (dy / d) * min;
  }
  return { x: px, y: py };
}

function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(target, v + maxDelta);
  return Math.max(target, v - maxDelta);
}

/**
 * Advances a vehicle by one fixed step. `frame` is the driver's (pilot's) input, or null for a
 * vehicle without a driver: it coasts to a stop (a helicopter lands where it can).
 */
export function stepVehicle(
  v: VehicleSim,
  def: VehicleDef,
  frame: InputFrame | null,
  ctx: VehicleStepContext,
): VehicleStepResult {
  const dt = STEP_DT;
  if (def.flight) stepFlight(v, def, frame, ctx, dt);
  else stepGround(v, def, frame, dt);

  const airborne = isAirborne(v);
  v.x += v.vx * dt;
  v.y += v.vy * dt;
  v.angle = wrapAngle(v.angle + v.av * dt);
  return resolveBody(v, def, airborne ? ctx.airWorld : ctx.world, airborne ? undefined : ctx.obstacles);
}

function stepGround(v: VehicleSim, def: VehicleDef, frame: InputFrame | null, dt: number): void {
  const throttle = frame ? -frame.my : 0;
  const steer = frame ? frame.mx : 0;
  const handbrake = frame ? (frame.buttons & BTN.DASH) !== 0 : true;

  // Yaw rate grows with speed up to turnSpeedRef; reversing flips the steering like a real car.
  const fwd0 = v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
  const speedFactor = clamp(fwd0 / def.turnSpeedRef, -1, 1);
  const targetAv = steer * def.turnRate * speedFactor * (handbrake ? 1.3 : 1);
  v.av = approach(v.av, targetAv, YAW_RESPONSE * def.turnRate * dt);

  // The body turns first and the velocity stays in world space: what no longer points along the
  // nose becomes lateral slip, which tyre grip bleeds off (slowly with the handbrake: a drift).
  const na = v.angle + v.av * dt;
  const c = Math.cos(na);
  const s = Math.sin(na);
  let fwd = v.vx * c + v.vy * s;
  let lat = -v.vx * s + v.vy * c;

  if (throttle > 0) {
    fwd = fwd < -1 ? approach(fwd, 0, def.brake * dt) : approach(fwd, def.maxSpeed, def.accel * dt);
  } else if (throttle < 0) {
    fwd =
      fwd > 1 ? approach(fwd, 0, def.brake * dt) : approach(fwd, -def.reverseSpeed, def.accel * 0.75 * dt);
  } else {
    fwd = approach(fwd, 0, def.coastDrag * dt);
  }
  if (handbrake) fwd = approach(fwd, 0, def.coastDrag * 1.6 * dt);
  lat = approach(lat, 0, (handbrake ? def.handbrakeGrip : def.grip) * dt);

  v.vx = c * fwd - s * lat;
  v.vy = s * fwd + c * lat;
}

function stepFlight(
  v: VehicleSim,
  def: VehicleDef,
  frame: InputFrame | null,
  ctx: VehicleStepContext,
  dt: number,
): void {
  const f = def.flight!;
  const liftPressed = frame ? (frame.buttons & BTN.DASH) !== 0 : false;
  if (frame) {
    if (liftPressed && !v.liftHeld) v.lift = !v.lift;
  } else {
    v.lift = false;
  }
  v.liftHeld = liftPressed;

  const spinTarget = v.lift || v.alt > 0 ? 1 : 0;
  v.rotor = approach(v.rotor, spinTarget, dt / (spinTarget > v.rotor ? f.spinUpSec : f.spinUpSec * 2));

  if (v.lift) {
    if (v.rotor >= 1) v.alt = Math.min(1, v.alt + dt / f.climbSec);
  } else if (v.alt > 0) {
    const next = Math.max(0, v.alt - dt / f.climbSec);
    // Touching down needs a clear footprint: over walls, crates or another vehicle it hovers.
    const blocked =
      next < AIRBORNE_ALT &&
      v.alt >= AIRBORNE_ALT &&
      (!bodyFits(ctx.world, v, def) || overlapsAny(v, def, ctx.obstacles));
    v.alt = blocked ? v.alt : next;
  }

  // Thrust needs altitude: on the ground the skids hold the airframe still.
  const power = clamp((v.alt - 0.15) / 0.5, 0, 1);
  let mx = frame ? frame.mx : 0;
  let my = frame ? frame.my : 0;
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx /= len;
    my /= len;
  }
  if (power > 0) {
    const max = f.maxSpeed * power;
    const rate = len > 0 ? f.accel : f.accel * 0.6;
    [v.vx, v.vy] = approach2(v.vx, v.vy, mx * max, my * max, rate * dt);
  } else {
    [v.vx, v.vy] = approach2(v.vx, v.vy, 0, 0, 1400 * dt);
  }

  // Nose follows the pilot's aim once the rotor is turning.
  if (frame && v.rotor > 0.5) {
    const diff = wrapAngle(frame.aim - v.angle);
    const maxTurn = f.turnRate * dt;
    v.av = clamp(diff, -maxTurn, maxTurn) / dt;
  } else {
    v.av = 0;
  }
}

function overlapsAny(v: VehicleSim, def: VehicleDef, obstacles: readonly Circle[] | undefined): boolean {
  if (!obstacles || obstacles.length === 0) return false;
  for (const c of vehicleCircles(v, def)) {
    for (const o of obstacles) {
      const min = c.r + o.r;
      if ((c.x - o.x) ** 2 + (c.y - o.y) ** 2 < min * min) return true;
    }
  }
  return false;
}

function resolveBody(
  v: VehicleSim,
  def: VehicleDef,
  world: CollisionWorld,
  obstacles: readonly Circle[] | undefined,
): VehicleStepResult {
  let impact = 0;
  let obstacleImpact = 0;
  const r = def.collisionRadius;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    const c = Math.cos(v.angle);
    const s = Math.sin(v.angle);
    for (const o of def.collisionOffsets) {
      const cx = v.x + c * o;
      const cy = v.y + s * o;
      const res = resolveCircle(world, cx, cy, r);
      let dx = res.x - cx;
      let dy = res.y - cy;
      let fromObstacle = false;
      if (obstacles) {
        const px = cx + dx;
        const py = cy + dy;
        const out = pushOutOfCircles(px, py, r, obstacles);
        if (out.x !== px || out.y !== py) {
          fromObstacle = true;
          dx += out.x - px;
          dy += out.y - py;
        }
      }
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      moved = true;
      v.x += dx;
      v.y += dy;
      const nx = dx / len;
      const ny = dy / len;
      const vn = v.vx * nx + v.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        if (fromObstacle) obstacleImpact = Math.max(obstacleImpact, -vn);
        v.vx -= nx * vn * (1 + RESTITUTION);
        v.vy -= ny * vn * (1 + RESTITUTION);
        // A glancing hit at the nose or tail twists the body away from the wall.
        const tangential = (-s * nx + c * ny) * Math.sign(o);
        v.av = v.av * 0.5 + clamp(tangential * (-vn / 400), -1.5, 1.5);
      }
    }
    if (!moved) break;
  }
  return { impact, obstacleImpact };
}

/**
 * Where an occupant can step out: beside their seat (seat side first), then behind and in front
 * of the body. Returns null when every spot is blocked.
 */
export function findExitSpot(
  v: { x: number; y: number; angle: number },
  def: VehicleDef,
  seat: SeatDef,
  world: CollisionWorld,
  blockers: readonly Circle[],
): { x: number; y: number } | null {
  const gap = PLAYER.radius + 6;
  const side = seat.oy >= 0 ? 1 : -1;
  const candidates: [number, number][] = [
    [seat.ox, side * (def.halfWidth + gap)],
    [seat.ox, -side * (def.halfWidth + gap)],
    [-(def.halfLength + gap), 0],
    [def.halfLength + gap, 0],
    [-(def.halfLength + gap), side * (def.halfWidth + gap)],
    [def.halfLength + gap, side * (def.halfWidth + gap)],
  ];
  for (const [lx, ly] of candidates) {
    const p = localToWorld(v, lx, ly);
    const r = PLAYER.radius;
    if (p.x < r || p.y < r || p.x > world.width - r || p.y > world.height - r) continue;
    let free = true;
    for (const idx of querySolids(world, p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (circleIntersectsRect(p.x, p.y, r, world.solids[idx]!)) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    if (blockers.some((b) => (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (b.r + r) ** 2)) continue;
    return p;
  }
  return null;
}
