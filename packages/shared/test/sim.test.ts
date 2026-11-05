import { describe, expect, it } from "vitest";
import { PLAYER, STEP_DT } from "../src/config/game.ts";
import { WEAPONS } from "../src/config/weapons.ts";
import { BTN, decodeInput, encodeInput, type InputFrame, quantizeInput } from "../src/protocol/input.ts";
import { buildCollisionWorld, raycastCircle, raycastSolids, resolveCircle } from "../src/sim/collision.ts";
import { tracePellet } from "../src/sim/hitscan.ts";
import {
  clonePlayerSim,
  createPlayerSim,
  fireIntervalSteps,
  giveWeapon,
  type PlayerSim,
  refillAmmo,
  type SimEvent,
  SLOT_PICKUP,
  secToSteps,
  stepPlayer,
} from "../src/sim/player.ts";

const world = buildCollisionWorld(1000, 1000, [{ x: 400, y: 0, w: 50, h: 1000 }]);

let seq = 0;
function input(partial: Partial<InputFrame> = {}): InputFrame {
  seq += 1;
  return quantizeInput({ seq, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick: 0, ...partial });
}

function run(s: PlayerSim, frames: InputFrame[], events?: SimEvent[]) {
  for (const f of frames)
    stepPlayer(s, f, { world, seed: 7, alive: true, emit: events ? (e) => events.push(e) : undefined });
}

const repeat = (n: number, f: () => InputFrame) => Array.from({ length: n }, f);

describe("movement", () => {
  it("accelerates up to max speed and decelerates to rest", () => {
    const s = createPlayerSim(100, 500, "smg");
    run(
      s,
      repeat(60, () => input({ mx: 1 })),
    );
    const speed = Math.hypot(s.vx, s.vy);
    expect(speed).toBeCloseTo(PLAYER.maxSpeed * WEAPONS.smg.moveSpeedMult, 3);
    run(
      s,
      repeat(30, () => input()),
    );
    expect(Math.hypot(s.vx, s.vy)).toBe(0);
  });

  it("normalises diagonal movement", () => {
    const s = createPlayerSim(100, 100, "pistol" as never);
    s.slots[0] = { id: WEAPONS.pistol.index, mag: 12, reserve: -1 };
    run(
      s,
      repeat(60, () => input({ mx: 1, my: 1 })),
    );
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(PLAYER.maxSpeed, 3);
  });

  it("stops at walls and never enters them", () => {
    const s = createPlayerSim(300, 500, "rifle");
    run(
      s,
      repeat(120, () => input({ mx: 1 })),
    );
    expect(s.x).toBeLessThanOrEqual(400 - PLAYER.radius + 1e-6);
    expect(s.vx).toBe(0);
  });

  it("dashes once per cooldown", () => {
    const s = createPlayerSim(100, 500, "rifle");
    const events: SimEvent[] = [];
    run(s, [input({ mx: 1, buttons: BTN.DASH })], events);
    expect(Math.hypot(s.vx, s.vy)).toBe(PLAYER.dashSpeed);
    // Holding the key does not re-trigger, and pressing again during cooldown does nothing
    run(
      s,
      repeat(10, () => input({ mx: 1, buttons: BTN.DASH })),
      events,
    );
    run(s, [input({ mx: 1 }), input({ mx: 1, buttons: BTN.DASH })], events);
    expect(events.filter((e) => e.kind === "dash")).toHaveLength(1);
    run(
      s,
      repeat(secToSteps(PLAYER.dashCooldown), () => input({ mx: 1 })),
    );
    run(s, [input({ mx: 1, buttons: BTN.DASH })], events);
    expect(events.filter((e) => e.kind === "dash")).toHaveLength(2);
  });
});

describe("weapons", () => {
  it("respects fire rate for automatic weapons", () => {
    const s = createPlayerSim(100, 500, "rifle");
    const events: SimEvent[] = [];
    const steps = 60; // one second
    run(
      s,
      repeat(steps, () => input({ buttons: BTN.FIRE })),
      events,
    );
    const shots = events.filter((e) => e.kind === "shot").length;
    expect(shots).toBe(Math.ceil(steps / fireIntervalSteps(WEAPONS.rifle)));
    expect(s.slots[0]!.mag).toBe(WEAPONS.rifle.magSize - shots);
  });

  it("requires a new trigger pull for semi-automatic weapons", () => {
    const s = createPlayerSim(100, 500, "shotgun");
    const events: SimEvent[] = [];
    run(
      s,
      repeat(120, () => input({ buttons: BTN.FIRE })),
      events,
    );
    expect(events.filter((e) => e.kind === "shot")).toHaveLength(1);
  });

  it("fires one pellet per configured pellet", () => {
    const s = createPlayerSim(100, 500, "shotgun");
    const events: SimEvent[] = [];
    run(s, [input({ buttons: BTN.FIRE })], events);
    const shot = events.find((e) => e.kind === "shot");
    expect(shot?.kind === "shot" && shot.shot.angles.length).toBe(WEAPONS.shotgun.pellets);
  });

  it("auto-reloads an empty magazine and moves ammo from reserve", () => {
    const s = createPlayerSim(100, 500, "sniper");
    s.slots[0]!.mag = 0;
    const events: SimEvent[] = [];
    run(s, [input({ buttons: BTN.FIRE })], events);
    expect(events.some((e) => e.kind === "reloadStart")).toBe(true);
    run(
      s,
      repeat(secToSteps(WEAPONS.sniper.reloadSec), () => input()),
      events,
    );
    expect(s.slots[0]!.mag).toBe(WEAPONS.sniper.magSize);
    expect(s.slots[0]!.reserve).toBe(WEAPONS.sniper.reserveAmmo - WEAPONS.sniper.magSize);
  });

  it("cannot fire while reloading and swapping cancels the reload", () => {
    const s = createPlayerSim(100, 500, "rifle");
    s.slots[0]!.mag = 10;
    const events: SimEvent[] = [];
    run(s, [input({ buttons: BTN.RELOAD }), input({ buttons: BTN.FIRE })], events);
    expect(events.some((e) => e.kind === "shot")).toBe(false);
    run(s, [input({ slot: 1 })], events);
    expect(s.reload).toBe(0);
    expect(s.slot).toBe(1);
    expect(s.slots[0]!.mag).toBe(10);
  });

  it("pistol has infinite reserve", () => {
    const s = createPlayerSim(100, 500, "rifle");
    run(s, [input({ slot: 1 })]);
    s.slots[1]!.mag = 0;
    run(
      s,
      repeat(secToSteps(WEAPONS.pistol.swapSec) + 1, () => input()),
    );
    run(s, [input({ buttons: BTN.RELOAD })]);
    run(
      s,
      repeat(secToSteps(WEAPONS.pistol.reloadSec), () => input()),
    );
    expect(s.slots[1]!.mag).toBe(WEAPONS.pistol.magSize);
    expect(s.slots[1]!.reserve).toBe(-1);
  });

  it("weapon pickups fill the third slot and draw it; ammo pickups refill reserves", () => {
    const s = createPlayerSim(100, 500, "rifle");
    giveWeapon(s, "sniper");
    expect(s.slot).toBe(SLOT_PICKUP);
    expect(s.slots[SLOT_PICKUP]!.id).toBe(WEAPONS.sniper.index);
    s.slots[0]!.reserve = 0;
    expect(refillAmmo(s)).toBe(true);
    expect(s.slots[0]!.reserve).toBe(WEAPONS.rifle.reserveAmmo);
  });
});

describe("determinism", () => {
  it("replaying the same inputs from the same state gives identical results", () => {
    const frames: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      frames.push(
        input({
          mx: i % 50 < 25 ? 1 : -1,
          my: i % 30 < 10 ? 1 : 0,
          aim: (i * 0.05) % 3,
          buttons: (i % 7 === 0 ? BTN.FIRE : 0) | (i === 100 ? BTN.DASH : 0) | (i === 200 ? BTN.RELOAD : 0),
          slot: i === 150 ? 1 : -1,
        }),
      );
    }
    const a = createPlayerSim(200, 300, "smg");
    const b = clonePlayerSim(a);
    const evA: SimEvent[] = [];
    const evB: SimEvent[] = [];
    run(a, frames, evA);
    run(b, frames, evB);
    expect(b).toEqual(a);
    expect(evB).toEqual(evA);
  });

  it("encodes inputs exactly", () => {
    const f = quantizeInput({
      seq: 42,
      mx: -1,
      my: 1,
      aim: 1.23456789,
      buttons: 5,
      slot: 2,
      viewTick: 1234.567,
    });
    expect(decodeInput(encodeInput(f))).toEqual(f);
  });
});

describe("collision and hitscan", () => {
  it("pushes a circle out of a rectangle", () => {
    const r = resolveCircle(world, 405, 500, PLAYER.radius);
    expect(r.x <= 400 - PLAYER.radius || r.x >= 450 + PLAYER.radius).toBe(true);
  });

  it("raycasts to the first wall and the map edge", () => {
    expect(raycastSolids(world, 100, 500, 1, 0, 2000)).toBeCloseTo(300, 6);
    expect(raycastSolids(world, 100, 500, -1, 0, 2000)).toBeCloseTo(100, 6);
    expect(raycastSolids(world, 100, 500, 0, 1, 2000)).toBeCloseTo(500, 6);
  });

  it("hits the nearest target in front of the wall only", () => {
    expect(raycastCircle(0, 0, 1, 0, 100, 0, 10)).toBeCloseTo(90, 6);
    const targets = [
      { id: "near", x: 300, y: 500, r: PLAYER.radius },
      { id: "behind-wall", x: 600, y: 500, r: PLAYER.radius },
    ];
    expect(tracePellet(world, 100, 500, 0, 2000, targets, "me").targetId).toBe("near");
    expect(tracePellet(world, 100, 500, 0, 2000, targets.slice(1), "me")).toMatchObject({
      targetId: null,
      hitWall: true,
    });
    expect(
      tracePellet(world, 100, 500, 0, 2000, [{ id: "me", x: 150, y: 500, r: 18 }], "me").targetId,
    ).toBeNull();
  });

  it("uses the fixed step consistently", () => {
    expect(STEP_DT).toBeCloseTo(1 / 60, 10);
  });
});
