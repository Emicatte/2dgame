import {
  BTN,
  type Circle,
  type CollisionWorld,
  createPlayerSim,
  createVehicleSim,
  type InputFrame,
  isVehicleKind,
  type PlayerSim,
  type PlayerState,
  type SeatDef,
  type SimEvent,
  seatWorld,
  stepPlayer,
  stepVehicle,
  VEHICLE_STATUS,
  VEHICLES,
  type VehicleDef,
  type VehicleSim,
  type VehicleState,
} from "@scrapline/shared";
import { RollingStats } from "./metrics.ts";

/**
 * Client-side prediction with server reconciliation for the local player.
 *
 * Every fixed step the client applies its own input immediately (no waiting for the network)
 * and remembers it. When an authoritative snapshot acknowledges input N, the client rewinds to the
 * server's state for N and re-applies inputs N+1… With the shared deterministic simulation the
 * result normally equals the prediction exactly; any residual error is blended out visually.
 */
/** Where the local player sits, as last confirmed by the server. */
export interface Mount {
  vehicleId: string;
  seat: number;
  def: VehicleDef;
  seatDef: SeatDef;
}

/**
 * Per-frame environment of the prediction: vehicles as obstacles (interpolated), and the pose of
 * the vehicle a passenger rides (interpolated, i.e. the same timeline the server rewinds to).
 */
export interface PredictEnv {
  obstacles: readonly Circle[];
  /** Obstacles for the driven vehicle (every other ground vehicle). */
  vehicleObstacles: readonly Circle[];
  /** Passenger: pose of the vehicle as currently rendered. */
  ridePose: { x: number; y: number; angle: number } | null;
}

const NO_ENV: PredictEnv = { obstacles: [], vehicleObstacles: [], ridePose: null };

/** Frame as a seated player applies it: no own movement, fire only where the client allowed it. */
export function mountedFrame(frame: InputFrame, seat: SeatDef): InputFrame {
  return {
    ...frame,
    mx: 0,
    my: 0,
    buttons: frame.buttons & (BTN.FIRE | BTN.RELOAD),
    slot: seat.mounted ? -1 : frame.slot,
  };
}

export class Predictor {
  sim: PlayerSim;
  /** Predicted vehicle while the local player drives (null otherwise). */
  vehicle: VehicleSim | null = null;
  mount: Mount | null = null;
  /** PvE: the local player is downed (crawls, cannot fire), as last confirmed by the server. */
  downed = false;
  /** Prop Hunt: the object the local player moves as (radius, speed), as last confirmed. */
  body: { radius: number; speed: number } | null = null;
  private airWorld: CollisionWorld;
  private pending: InputFrame[] = [];
  private seq = 0;
  private lastAck = -1;
  /** Visual correction offset (px), decays to zero. */
  offsetX = 0;
  offsetY = 0;
  /** Diagnostics */
  lastCorrection = 0;
  corrections = 0;
  private acked = 0;
  private snaps = 0;
  private staleAcks = 0;
  private resyncs = 0;
  private correctionMax = 0;
  private readonly correctionSizes = new RollingStats(200);

  constructor(
    private world: CollisionWorld,
    private readonly seed: number,
    airWorld?: CollisionWorld,
  ) {
    this.sim = createPlayerSim(0, 0, "rifle");
    this.airWorld = airWorld ?? world;
  }

  setWorld(world: CollisionWorld, airWorld?: CollisionWorld): void {
    this.world = world;
    this.airWorld = airWorld ?? world;
  }

  get driving(): boolean {
    return this.mount?.seat === 0 && this.vehicle !== null;
  }

  /** One fixed step of the local player (and of the vehicle they drive). */
  private stepOnce(frame: InputFrame, alive: boolean, env: PredictEnv, emit?: (e: SimEvent) => void): void {
    const m = this.mount;
    if (!m) {
      stepPlayer(this.sim, frame, {
        world: this.world,
        seed: this.seed,
        alive,
        emit,
        obstacles: env.obstacles,
        downed: this.downed,
        body: this.body,
      });
      return;
    }
    if (m.seat === 0 && this.vehicle && alive) {
      stepVehicle(this.vehicle, m.def, frame, {
        world: this.world,
        airWorld: this.airWorld,
        obstacles: env.vehicleObstacles,
      });
    }
    const pose = m.seat === 0 && this.vehicle ? this.vehicle : env.ridePose;
    if (pose) {
      const at = seatWorld(pose, m.seatDef);
      this.sim.x = at.x;
      this.sim.y = at.y;
    }
    stepPlayer(this.sim, mountedFrame(frame, m.seatDef), {
      world: this.world,
      seed: this.seed,
      alive,
      emit,
      mounted: true,
    });
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /** Sequence number of the newest generated input. */
  get lastSeq(): number {
    return this.seq;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  predict(frame: InputFrame, alive: boolean, emit: (e: SimEvent) => void, env: PredictEnv = NO_ENV): void {
    this.stepOnce(frame, alive, env, emit);
    // Never discard unacknowledged inputs: replaying from the ack with a gap would guarantee a
    // misprediction. The pending list is bounded by the stall guard in the scene instead
    // (NET.inputStallMs without an ack stops input generation).
    this.pending.push(frame);
  }

  get stats() {
    return {
      acked: this.acked,
      corrections: this.corrections,
      snaps: this.snaps,
      staleAcks: this.staleAcks,
      resyncs: this.resyncs,
      correctionP95: this.correctionSizes.percentile(95),
      correctionMax: this.correctionMax,
    };
  }

  /** Clears the diagnostic counters (not the prediction state). */
  resetStats(): void {
    this.acked = 0;
    this.corrections = 0;
    this.snaps = 0;
    this.staleAcks = 0;
    this.resyncs = 0;
    this.correctionMax = 0;
    this.correctionSizes.clear();
  }

  /**
   * Applies an authoritative snapshot of the local player (owner-only fields included) and, while
   * the local player drives, of their vehicle: the vehicle only advances on the driver's inputs, so
   * its synchronized state is the state after the acknowledged input, and the same replay of the
   * pending inputs rebuilds the prediction.
   */
  /**
   * `pose`: the player's real pose when their public one is masked (round modes: it comes from
   * their own ghost in MatchState.allies).
   */
  reconcile(
    ps: PlayerState,
    alive: boolean,
    vs?: VehicleState,
    env: PredictEnv = NO_ENV,
    pose?: { x: number; y: number; aim: number } | null,
  ): void {
    const ack = ps.ack;
    if (ack < this.lastAck) {
      this.staleAcks++;
      return;
    }
    // The first snapshot of a stream (join, reconnect) is a synchronisation, not a correction.
    const firstOfStream = this.lastAck === -1;
    this.lastAck = ack;
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) {
      this.pending.shift();
      this.acked++;
    }

    // Entering, leaving or changing seat is a server decision: a teleport, not a misprediction.
    const prevMount = this.mount;
    this.mount = this.mountFrom(ps, vs);
    const mountChanged =
      (prevMount?.vehicleId ?? "") !== (this.mount?.vehicleId ?? "") || prevMount?.seat !== this.mount?.seat;
    const drivingNow = this.mount?.seat === 0 && !!vs;
    const tracked = drivingNow ? this.vehicle : this.mount ? null : this.sim;
    const before = tracked ? { x: tracked.x, y: tracked.y } : null;

    const s = this.sim;
    s.x = pose ? pose.x : ps.x;
    s.y = pose ? pose.y : ps.y;
    s.vx = ps.vx;
    s.vy = ps.vy;
    s.aim = pose ? pose.aim : ps.aim;
    s.dash = ps.dash;
    s.dashCd = ps.dashCd;
    s.dashDx = ps.dashDx;
    s.dashDy = ps.dashDy;
    s.dashHeld = ps.dashHeld;
    s.slot = ps.slot;
    s.slots[0] = { id: ps.w0, mag: ps.m0, reserve: ps.r0 };
    s.slots[1] = { id: ps.w1, mag: ps.m1, reserve: ps.r1 };
    s.slots[2] = { id: ps.w2, mag: ps.m2, reserve: ps.r2 };
    s.cooldown = ps.cooldown;
    s.reload = ps.reload;
    s.swap = ps.swap;
    s.bloom = ps.bloom;
    s.trigger = ps.trigger;

    if (drivingNow && vs) {
      const v = this.vehicle ?? createVehicleSim(vs.x, vs.y, vs.angle);
      v.x = vs.x;
      v.y = vs.y;
      v.angle = vs.angle;
      v.vx = vs.vx;
      v.vy = vs.vy;
      v.av = vs.av;
      v.alt = vs.alt;
      v.rotor = vs.rotor;
      v.lift = vs.lift;
      v.liftHeld = vs.liftHeld;
      this.vehicle = v;
    } else {
      this.vehicle = null;
    }

    for (const f of this.pending) this.stepOnce(f, alive, env);

    const after = drivingNow ? this.vehicle : this.mount ? null : this.sim;
    if (!before || !after || mountChanged) {
      this.lastCorrection = 0;
      if (firstOfStream) this.resyncs++;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    const dx = before.x - after.x;
    const dy = before.y - after.y;
    const err = Math.hypot(dx, dy);
    this.lastCorrection = err;
    if (firstOfStream) {
      this.resyncs++;
    } else if (err > 0.01) {
      this.corrections++;
      this.correctionSizes.push(err);
      this.correctionMax = Math.max(this.correctionMax, err);
    }
    if (err > 96) {
      if (!firstOfStream) this.snaps++;
      // Teleport-sized difference (respawn, large desync, entering a vehicle): snap.
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      this.offsetX += dx;
      this.offsetY += dy;
    }
  }

  private mountFrom(ps: PlayerState, vs?: VehicleState): Mount | null {
    if (!ps.vehicle || ps.seat < 0 || !vs || vs.status !== VEHICLE_STATUS.READY || !isVehicleKind(vs.kind)) {
      return null;
    }
    const def = VEHICLES[vs.kind];
    const seatDef = def.seats[ps.seat];
    if (!seatDef) return null;
    return { vehicleId: ps.vehicle, seat: ps.seat, def, seatDef };
  }

  /** Decays the visual correction; call once per rendered frame. */
  decay(dtSec: number): void {
    const k = Math.exp(-dtSec * 14);
    this.offsetX *= k;
    this.offsetY *= k;
    if (Math.abs(this.offsetX) < 0.01) this.offsetX = 0;
    if (Math.abs(this.offsetY) < 0.01) this.offsetY = 0;
  }

  resetStream(): void {
    this.pending = [];
    this.lastAck = -1;
    this.vehicle = null;
    this.mount = null;
  }
}
