/**
 * Aim geometry shared by the crosshair, the weapon sprite and the tracers.
 *
 * The truth: a shot is a hitscan ray from the predicted simulation position (`sim.x/y`, the
 * fixed-step position the server replays) along `aim = atan2(pointer.world - sim)`, quantised to
 * 1/10000 rad on the wire (< 0.1 px at any range on screen). The crosshair centre is the cursor,
 * i.e. the world point that aim was taken towards, so the ray passes through it by construction.
 *
 * The rendered body is NOT exactly at `sim`: it is interpolated between the last two fixed steps
 * (smooth motion on any refresh rate) and carries the decaying reconciliation offset. Standing
 * still both coincide (difference 0 once the offset has decayed); while moving they differ by at
 * most one fixed step of motion (PLAYER.maxSpeed / NET.inputRate, about 4.4 px at full speed) plus
 * any correction still being smoothed out. Moving the body onto the ray would reintroduce
 * step judder, so instead:
 *  - the body and weapon of the local player face `visualAim` (from the drawn body to the
 *    cursor's world point), so the drawn barrel points through the crosshair;
 *  - tracers start at `projectOntoRay(drawn barrel tip)`, so every tracer lies exactly on the real
 *    ray (through the crosshair) and leaves the barrel within that sub-step distance.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Closest point to (px, py) on the ray starting at (ox, oy) along `angle`; never behind the
 * origin. Writes into `out` when given (allocation-free).
 */
export function projectOntoRay(
  ox: number,
  oy: number,
  angle: number,
  px: number,
  py: number,
  out: Point = { x: 0, y: 0 },
): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const t = Math.max(0, (px - ox) * dx + (py - oy) * dy);
  out.x = ox + dx * t;
  out.y = oy + dy * t;
  return out;
}

/** Signed perpendicular distance of a point from the line through (ox, oy) along `angle`. */
export function distanceFromRay(ox: number, oy: number, angle: number, px: number, py: number): number {
  return -(px - ox) * Math.sin(angle) + (py - oy) * Math.cos(angle);
}

/**
 * Direction the drawn body should face to point at the cursor's world point. Falls back to the
 * true aim when the cursor sits (almost) on the body, where the direction is meaningless.
 */
export function visualAim(bodyX: number, bodyY: number, targetX: number, targetY: number, trueAim: number) {
  const dx = targetX - bodyX;
  const dy = targetY - bodyY;
  if (dx * dx + dy * dy < 24 * 24) return trueAim;
  return Math.atan2(dy, dx);
}
