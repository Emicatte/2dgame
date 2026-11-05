import {
  type CollisionWorld,
  createPlayerSim,
  type InputFrame,
  type PlayerSim,
  type PlayerState,
  type SimEvent,
  stepPlayer,
} from "@scrapline/shared";

/**
 * Client-side prediction with server reconciliation for the local player.
 *
 * Every fixed step the client applies its own input immediately (no waiting for the network)
 * and remembers it. When an authoritative snapshot acknowledges input N, the client rewinds to the
 * server's state for N and re-applies inputs N+1… With the shared deterministic simulation the
 * result normally equals the prediction exactly; any residual error is blended out visually.
 */
export class Predictor {
  sim: PlayerSim;
  private pending: InputFrame[] = [];
  private seq = 0;
  private lastAck = -1;
  /** Visual correction offset (px), decays to zero. */
  offsetX = 0;
  offsetY = 0;
  /** Diagnostics */
  lastCorrection = 0;
  corrections = 0;

  constructor(
    private world: CollisionWorld,
    private readonly seed: number,
  ) {
    this.sim = createPlayerSim(0, 0, "rifle");
  }

  setWorld(world: CollisionWorld): void {
    this.world = world;
  }

  nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  predict(frame: InputFrame, alive: boolean, emit: (e: SimEvent) => void): void {
    stepPlayer(this.sim, frame, { world: this.world, seed: this.seed, alive, emit });
    this.pending.push(frame);
    if (this.pending.length > 240) this.pending.shift();
  }

  /** Applies an authoritative snapshot of the local player (owner-only fields included). */
  reconcile(ps: PlayerState, alive: boolean): void {
    const ack = ps.ack;
    if (ack < this.lastAck) return;
    this.lastAck = ack;
    while (this.pending.length > 0 && this.pending[0]!.seq <= ack) this.pending.shift();

    const before = { x: this.sim.x, y: this.sim.y };
    const s = this.sim;
    s.x = ps.x;
    s.y = ps.y;
    s.vx = ps.vx;
    s.vy = ps.vy;
    s.aim = ps.aim;
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

    for (const f of this.pending) stepPlayer(s, f, { world: this.world, seed: this.seed, alive });

    const dx = before.x - s.x;
    const dy = before.y - s.y;
    const err = Math.hypot(dx, dy);
    this.lastCorrection = err;
    if (err > 0.01) this.corrections++;
    if (err > 96) {
      // Teleport-sized difference (respawn, large desync): snap.
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      this.offsetX += dx;
      this.offsetY += dy;
    }
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
  }
}
