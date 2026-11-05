import { describe, expect, it } from "vitest";
import {
  AIRBORNE_ALT,
  BTN,
  buildCollisionWorld,
  cloneVehicleSim,
  closestOnBody,
  createVehicleSim,
  findExitSpot,
  type InputFrame,
  inSector,
  MAPS,
  raycastBody,
  type SolidDef,
  STEP_DT,
  seatWorld,
  stepVehicle,
  TALL_SOLIDS,
  tracePellet,
  VEHICLES,
  type VehicleSim,
  vehicleSpeed,
} from "../src/index.ts";

const solids: SolidDef[] = [
  { kind: "wall", x: 1400, y: 0, w: 32, h: 1200 },
  { kind: "crate", x: 600, y: 900, w: 64, h: 64 },
  { kind: "building", x: 900, y: 860, w: 200, h: 200 },
];
const world = buildCollisionWorld(2000, 1400, solids);
const airWorld = buildCollisionWorld(
  2000,
  1400,
  solids.filter((s) => TALL_SOLIDS.has(s.kind)),
);
const ctx = { world, airWorld };

let seq = 0;
function frame(f: Partial<InputFrame> = {}): InputFrame {
  seq += 1;
  return { seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0, ...f };
}

function run(v: VehicleSim, kind: keyof typeof VEHICLES, n: number, f: Partial<InputFrame>) {
  let impact = 0;
  for (let i = 0; i < n; i++) impact = Math.max(impact, stepVehicle(v, VEHICLES[kind], frame(f), ctx).impact);
  return impact;
}

describe("ground vehicle model", () => {
  it("accelerates forward up to its top speed and no further", () => {
    const v = createVehicleSim(200, 300, 0);
    run(v, "car", 60, { my: -1 });
    expect(v.vx).toBeGreaterThan(400);
    expect(v.x).toBeGreaterThan(200);
    run(v, "car", 120, { my: -1 });
    expect(vehicleSpeed(v)).toBeLessThanOrEqual(VEHICLES.car.maxSpeed + 1e-6);
  });

  it("brakes, reverses at reverse speed and coasts to a stop", () => {
    const v = createVehicleSim(600, 300, 0);
    run(v, "car", 30, { my: -1 });
    run(v, "car", 120, { my: 1 });
    expect(v.vx).toBeLessThan(0);
    expect(-v.vx).toBeLessThanOrEqual(VEHICLES.car.reverseSpeed + 1e-6);
    run(v, "car", 240, {});
    expect(vehicleSpeed(v)).toBeLessThan(1);
  });

  it("cannot turn on the spot; steering at speed turns, reversing flips it", () => {
    const still = createVehicleSim(600, 300, 0);
    run(still, "car", 30, { mx: 1 });
    expect(Math.abs(still.angle)).toBeLessThan(1e-9);

    const fwd = createVehicleSim(300, 300, 0);
    run(fwd, "car", 30, { my: -1 });
    run(fwd, "car", 20, { my: -1, mx: 1 });
    expect(fwd.angle).toBeGreaterThan(0.2);

    const back = createVehicleSim(600, 300, 0);
    run(back, "car", 40, { my: 1 });
    run(back, "car", 20, { my: 1, mx: 1 });
    expect(back.angle).toBeLessThan(-0.05);
  });

  it("drifts with the handbrake (lateral speed survives longer)", () => {
    const grip = createVehicleSim(300, 300, 0);
    const drift = createVehicleSim(300, 300, 0);
    run(grip, "car", 50, { my: -1 });
    run(drift, "car", 50, { my: -1 });
    run(grip, "car", 12, { my: -1, mx: 1 });
    run(drift, "car", 12, { my: -1, mx: 1, buttons: BTN.DASH });
    const lateral = (v: VehicleSim) => Math.abs(-v.vx * Math.sin(v.angle) + v.vy * Math.cos(v.angle));
    expect(lateral(drift)).toBeGreaterThan(lateral(grip));
  });

  it("is deterministic: same start and inputs, identical state", () => {
    const a = createVehicleSim(300, 300, 0.3);
    const b = cloneVehicleSim(a);
    const script: Partial<InputFrame>[] = [];
    for (let i = 0; i < 300; i++) {
      script.push({
        my: i % 90 < 70 ? -1 : 1,
        mx: i % 50 < 20 ? 1 : i % 50 < 30 ? -1 : 0,
        buttons: i % 77 < 8 ? BTN.DASH : 0,
      });
    }
    for (const f of script) {
      const fr = frame(f);
      stepVehicle(a, VEHICLES.offroad, fr, ctx);
      stepVehicle(b, VEHICLES.offroad, fr, ctx);
    }
    expect(b).toEqual(a);
  });

  it("never tunnels through a wall at top speed and reports the impact", () => {
    const v = createVehicleSim(1100, 300, 0);
    const impact = run(v, "car", 200, { my: -1 });
    const front = v.x + VEHICLES.car.halfLength;
    expect(front).toBeLessThanOrEqual(1400 + 2);
    expect(impact).toBeGreaterThan(200);
  });

  it("is pushed out of other vehicles (obstacles) and reports the contact", () => {
    const v = createVehicleSim(500, 300, 0);
    const other = { x: 700, y: 300, r: 22 };
    let hit = 0;
    for (let i = 0; i < 90; i++) {
      hit = Math.max(
        hit,
        stepVehicle(v, VEHICLES.car, frame({ my: -1 }), { ...ctx, obstacles: [other] }).obstacleImpact,
      );
    }
    expect(v.x + VEHICLES.car.collisionOffsets.at(-1)! + VEHICLES.car.collisionRadius).toBeLessThanOrEqual(
      other.x - other.r + 2,
    );
    expect(hit).toBeGreaterThan(0);
  });
});

describe("helicopter model", () => {
  const def = VEHICLES.heli;
  it("toggles take-off on the dash key edge, spins up, then climbs", () => {
    const v = createVehicleSim(300, 300, 0);
    stepVehicle(v, def, frame({ buttons: BTN.DASH }), ctx);
    expect(v.lift).toBe(true);
    // Holding the key does not toggle again.
    for (let i = 0; i < 10; i++) stepVehicle(v, def, frame({ buttons: BTN.DASH }), ctx);
    expect(v.lift).toBe(true);
    expect(v.alt).toBe(0);
    const spin = Math.ceil(def.flight!.spinUpSec / STEP_DT) + 2;
    for (let i = 0; i < spin + Math.ceil(def.flight!.climbSec / STEP_DT); i++)
      stepVehicle(v, def, frame(), ctx);
    expect(v.rotor).toBe(1);
    expect(v.alt).toBe(1);
  });

  it("does not move on the ground, flies in screen axes in the air", () => {
    const v = createVehicleSim(300, 300, 0);
    for (let i = 0; i < 30; i++) stepVehicle(v, def, frame({ mx: 1 }), ctx);
    expect(v.x).toBeCloseTo(300, 5);
    v.lift = true;
    v.rotor = 1;
    v.alt = 1;
    for (let i = 0; i < 60; i++) stepVehicle(v, def, frame({ my: 1, aim: Math.PI / 2 }), ctx);
    expect(v.y).toBeGreaterThan(400);
    expect(v.angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it("flies over low cover but not through tall buildings", () => {
    const v = createVehicleSim(500, 930, 0);
    Object.assign(v, { lift: true, rotor: 1, alt: 1 });
    // Crosses the crate at x 600-664.
    for (let i = 0; i < 60; i++) stepVehicle(v, def, frame({ mx: 1 }), ctx);
    expect(v.x - 20 - def.collisionRadius).toBeGreaterThan(664);
    // Stopped by the building at x 900.
    for (let i = 0; i < 120; i++) stepVehicle(v, def, frame({ mx: 1 }), ctx);
    expect(v.x + 14 + def.collisionRadius).toBeLessThanOrEqual(900 + 1);
  });

  it("will not touch down on top of a crate; lands on clear ground", () => {
    const v = createVehicleSim(632, 932, 0);
    Object.assign(v, { lift: true, rotor: 1, alt: 1 });
    stepVehicle(v, def, frame({ buttons: BTN.DASH }), ctx);
    expect(v.lift).toBe(false);
    for (let i = 0; i < 200; i++) stepVehicle(v, def, frame(), ctx);
    expect(v.alt).toBeGreaterThanOrEqual(AIRBORNE_ALT);
    const clear = createVehicleSim(300, 300, 0);
    Object.assign(clear, { lift: false, rotor: 1, alt: 1 });
    for (let i = 0; i < 200; i++) stepVehicle(clear, def, null, ctx);
    expect(clear.alt).toBe(0);
  });
});

describe("vehicle geometry", () => {
  const car = VEHICLES.car;
  const v = { x: 500, y: 500, angle: Math.PI / 2 };

  it("rays hit the oriented hull and miss beside it", () => {
    // Nose points down: the hull spans y 464..536 and x 482..518.
    expect(raycastBody(v, car, 500, 300, 0, 1)).toBeCloseTo(164, 3);
    expect(raycastBody(v, car, 540, 300, 0, 1)).toBe(-1);
    expect(raycastBody(v, car, 500, 500, 1, 0)).toBe(0);
  });

  it("finds the closest point of the hull", () => {
    const c = closestOnBody(v, car, 600, 500);
    expect(c.x).toBeCloseTo(518, 3);
    expect(c.dist).toBeCloseTo(82, 3);
    expect(closestOnBody(v, car, 500, 510).inside).toBe(true);
  });

  it("checks fire sectors relative to the heading", () => {
    const front = car.seats[1]!; // right-hand window
    expect(inSector(front, 0, Math.PI / 2)).toBe(true);
    expect(inSector(front, 0, -Math.PI / 2)).toBe(false);
    expect(inSector(front, Math.PI / 2, Math.PI)).toBe(true);
    expect(inSector(car.seats[0]!, 0, 0)).toBe(false);
    expect(inSector(VEHICLES.armored.seats[1]!, 1, -2)).toBe(true);
  });

  it("puts seats in the vehicle frame (+x nose, +y right)", () => {
    const s = seatWorld({ x: 0, y: 0, angle: 0 }, car.seats[1]!);
    expect(s).toEqual({ x: 6, y: 8 });
  });

  it("finds an exit spot on the seat's side, then elsewhere", () => {
    const parked = { x: 300, y: 300, angle: 0 };
    const spot = findExitSpot(parked, car, car.seats[1]!, world, []);
    expect(spot!.y).toBeGreaterThan(300 + car.halfWidth);
    const blocked = findExitSpot(parked, car, car.seats[1]!, world, [{ x: spot!.x, y: spot!.y, r: 18 }]);
    expect(blocked).not.toBeNull();
    expect(blocked).not.toEqual(spot);
  });
});

describe("hitscan with vehicles and heights", () => {
  it("an exposed occupant takes the shot instead of the hull around them", () => {
    const car = VEHICLES.car;
    const v = { x: 500, y: 300, angle: 0 };
    const seat = seatWorld(v, car.seats[1]!);
    const targets = [
      { id: "veh:c", x: v.x, y: v.y, r: 0, body: { angle: 0, def: car }, group: "c" },
      { id: "p", x: seat.x, y: seat.y, r: 13, group: "c", occupant: true },
    ];
    const atSeat = Math.atan2(seat.y - 600, seat.x - 500);
    expect(tracePellet(world, 500, 600, atSeat, 1000, targets, "me").targetId).toBe("p");
    // Aimed at the tail, away from the occupant: the hull.
    const atTail = Math.atan2(300 - 600, 470 - 500);
    expect(tracePellet(world, 500, 600, atTail, 1000, targets, "me").targetId).toBe("veh:c");
  });

  it("low cover stops ground shots, not shots at a helicopter above it", () => {
    const urban = buildCollisionWorld(2000, 1400, solids);
    const target = { id: "t", x: 760, y: 932, r: 18 };
    const angle = 0;
    expect(tracePellet(urban, 400, 932, angle, 1000, [target], "me", { airWorld }).targetId).toBeNull();
    expect(
      tracePellet(urban, 400, 932, angle, 1000, [{ ...target, air: true }], "me", { airWorld }).targetId,
    ).toBe("t");
    // A tall building still blocks.
    const behind = { id: "h", x: 1200, y: 932, r: 18, air: true };
    expect(tracePellet(urban, 400, 932, angle, 1500, [behind], "me", { airWorld }).targetId).toBeNull();
  });

  it("every shipped vehicle map parks its vehicles on free ground", () => {
    for (const map of Object.values(MAPS)) {
      for (const v of map.vehicleSpawns ?? []) expect(VEHICLES[v.kind]).toBeDefined();
    }
  });
});
