/**
 * Data-driven vehicle definitions. The shared vehicle model (sim/vehicle.ts) reads only these
 * values on both the server and the predicting client, so balancing never touches game code.
 *
 * Units: pixels, seconds, radians. Local vehicle frame: +x towards the nose, +y to the right side.
 */
import type { WeaponId } from "./weapons.ts";

export type VehicleKind = "car" | "offroad" | "armored" | "heli";
export const VEHICLE_KINDS: readonly VehicleKind[] = ["car", "offroad", "armored", "heli"];

export type SeatRole = "driver" | "pilot" | "gunner" | "passenger";

export interface SeatDef {
  role: SeatRole;
  /** Seat position in the vehicle frame. */
  ox: number;
  oy: number;
  /**
   * Fire sector: centre (vehicle-local angle) and half-width. `arc` 0 = cannot fire from this seat
   * (drivers, pilots, enclosed passengers); π = all around (turrets).
   */
  sector: number;
  arc: number;
  /**
   * Exposure: how much of the damage of a shot that hits this occupant gets through (an occupant
   * firing from a window can be shot). 0 = protected inside the vehicle, not a target.
   */
  exposure: number;
  /** Mounted weapon this seat operates instead of the occupant's own weapons. */
  mounted?: WeaponId;
}

export interface FlightDef {
  maxSpeed: number;
  accel: number;
  /** Seconds from ground to cruise altitude (and back). */
  climbSec: number;
  /** Seconds for the rotor to spin up before lift-off. */
  spinUpSec: number;
  /** Heading turn rate towards the pilot's aim (rad/s). */
  turnRate: number;
}

export interface VehicleDef {
  kind: VehicleKind;
  /** Stable wire index. */
  index: number;
  name: string;
  /** Half extents of the body (hit box and drawing). */
  halfLength: number;
  halfWidth: number;
  /** Radius of the collision circles laid along the body axis. */
  collisionRadius: number;
  /** Centres of the collision circles on the body axis (local x). */
  collisionOffsets: readonly number[];
  mass: number;
  maxHp: number;
  /** Damage multiplier for bullets (armor). */
  bulletArmor: number;
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  /** Deceleration with no throttle (rolling resistance), px/s². */
  coastDrag: number;
  /** Lateral grip (px/s²): how quickly sideways sliding is cancelled. Lower = more drift. */
  grip: number;
  /** Grip with the handbrake held (controlled drift). */
  handbrakeGrip: number;
  /** Max yaw rate at full steering (rad/s), reached at `turnSpeedRef` px/s. */
  turnRate: number;
  turnSpeedRef: number;
  /** Ramming: damage per px/s of closing speed above `ramMinSpeed`. */
  ramFactor: number;
  ramMinSpeed: number;
  /** Damage dealt to occupants when the vehicle is destroyed. */
  wreckDamage: number;
  /** Entering is allowed below this speed (px/s). */
  enterMaxSpeed: number;
  /** Exiting is allowed below this speed (px/s). */
  exitMaxSpeed: number;
  respawnSec: number;
  seats: readonly SeatDef[];
  flight?: FlightDef;
}

const SIDE = Math.PI / 2;

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  car: {
    kind: "car",
    index: 0,
    name: "Hatch",
    halfLength: 36,
    halfWidth: 18,
    collisionRadius: 18,
    collisionOffsets: [-18, 0, 18],
    mass: 1,
    maxHp: 320,
    bulletArmor: 1,
    maxSpeed: 560,
    reverseSpeed: 210,
    accel: 520,
    brake: 1000,
    coastDrag: 170,
    grip: 2200,
    handbrakeGrip: 420,
    turnRate: 2.7,
    turnSpeedRef: 170,
    ramFactor: 0.3,
    ramMinSpeed: 110,
    wreckDamage: 80,
    enterMaxSpeed: 150,
    exitMaxSpeed: 260,
    respawnSec: 25,
    seats: [
      { role: "driver", ox: 6, oy: -8, sector: 0, arc: 0, exposure: 0 },
      { role: "passenger", ox: 6, oy: 8, sector: SIDE, arc: 1.35, exposure: 0.65 },
      { role: "passenger", ox: -14, oy: -8, sector: -2.1, arc: 1.35, exposure: 0.65 },
      { role: "passenger", ox: -14, oy: 8, sector: 2.1, arc: 1.35, exposure: 0.65 },
    ],
  },
  offroad: {
    kind: "offroad",
    index: 1,
    name: "Rover",
    halfLength: 39,
    halfWidth: 20,
    collisionRadius: 20,
    collisionOffsets: [-19, 0, 19],
    mass: 1.3,
    maxHp: 400,
    bulletArmor: 0.9,
    maxSpeed: 500,
    reverseSpeed: 220,
    accel: 560,
    brake: 1000,
    coastDrag: 180,
    grip: 2700,
    handbrakeGrip: 560,
    turnRate: 2.5,
    turnSpeedRef: 160,
    ramFactor: 0.38,
    ramMinSpeed: 110,
    wreckDamage: 80,
    enterMaxSpeed: 150,
    exitMaxSpeed: 260,
    respawnSec: 25,
    seats: [
      { role: "driver", ox: 10, oy: -9, sector: 0, arc: 0, exposure: 0 },
      { role: "passenger", ox: 10, oy: 9, sector: SIDE, arc: 1.4, exposure: 0.65 },
      // Open cargo bed: wide arcs, more exposed.
      { role: "passenger", ox: -18, oy: -9, sector: -2.2, arc: 1.9, exposure: 0.8 },
      { role: "passenger", ox: -18, oy: 9, sector: 2.2, arc: 1.9, exposure: 0.8 },
    ],
  },
  armored: {
    kind: "armored",
    index: 2,
    name: "Bulwark APC",
    halfLength: 44,
    halfWidth: 24,
    collisionRadius: 24,
    collisionOffsets: [-22, 0, 22],
    mass: 2.4,
    maxHp: 900,
    bulletArmor: 0.4,
    maxSpeed: 330,
    reverseSpeed: 160,
    accel: 300,
    brake: 800,
    coastDrag: 150,
    grip: 3400,
    handbrakeGrip: 1000,
    turnRate: 1.9,
    turnSpeedRef: 120,
    ramFactor: 0.55,
    ramMinSpeed: 90,
    wreckDamage: 60,
    enterMaxSpeed: 120,
    exitMaxSpeed: 200,
    respawnSec: 40,
    seats: [
      { role: "driver", ox: 18, oy: -10, sector: 0, arc: 0, exposure: 0 },
      { role: "gunner", ox: -4, oy: 0, sector: 0, arc: Math.PI, exposure: 0.45, mounted: "mg" },
      { role: "passenger", ox: -26, oy: -12, sector: 0, arc: 0, exposure: 0 },
      { role: "passenger", ox: -26, oy: 12, sector: 0, arc: 0, exposure: 0 },
    ],
  },
  heli: {
    kind: "heli",
    index: 3,
    name: "Kestrel",
    halfLength: 46,
    halfWidth: 20,
    collisionRadius: 22,
    collisionOffsets: [-20, 14],
    mass: 1.6,
    maxHp: 600,
    bulletArmor: 0.75,
    maxSpeed: 430,
    reverseSpeed: 0,
    accel: 0,
    brake: 0,
    coastDrag: 0,
    grip: 0,
    handbrakeGrip: 0,
    turnRate: 2.2,
    turnSpeedRef: 1,
    ramFactor: 0,
    ramMinSpeed: 1e9,
    wreckDamage: 120,
    enterMaxSpeed: 40,
    exitMaxSpeed: 40,
    respawnSec: 45,
    flight: { maxSpeed: 430, accel: 420, climbSec: 1.6, spinUpSec: 1.4, turnRate: 2.2 },
    seats: [
      { role: "pilot", ox: 22, oy: -7, sector: 0, arc: 0, exposure: 0 },
      { role: "gunner", ox: 22, oy: 7, sector: 0, arc: 1.9, exposure: 0.4, mounted: "doorgun" },
      { role: "passenger", ox: 0, oy: -14, sector: -SIDE, arc: 1.3, exposure: 0.6 },
      { role: "passenger", ox: 0, oy: 14, sector: SIDE, arc: 1.3, exposure: 0.6 },
    ],
  },
};

export const VEHICLE_LIST: readonly VehicleDef[] = Object.values(VEHICLES).sort((a, b) => a.index - b.index);

export function isVehicleKind(v: unknown): v is VehicleKind {
  return typeof v === "string" && v in VEHICLES;
}

/** Seconds a vehicle keeps a disconnected driver's kill credit for ramming (last driver). */
export const RAM_CREDIT_SEC = 3;
/** A pair (vehicle, target) can take ramming damage at most this often (persistent contact). */
export const RAM_COOLDOWN_SEC = 0.6;
/** Players closer than this to a vehicle's body can enter it (px). */
export const ENTER_REACH = 34;
/** Altitude above which a helicopter counts as airborne (0 = ground, 1 = cruise). */
export const AIRBORNE_ALT = 0.35;
/** Weapon index reported in kill events for ramming and wreck explosions. */
export const KILL_BY_VEHICLE = 250;
export const KILL_BY_EXPLOSION = 251;
