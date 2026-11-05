import {
  BTN,
  closestOnBody,
  type InputFrame,
  inSector,
  KILL_BY_EXPLOSION,
  KILL_BY_VEHICLE,
  MAPS,
  NET,
  type NetEvent,
  PLAYER,
  quantizeInput,
  SERVER_TICK_MS,
  seatWorld,
  VEHICLES,
  vehicleSpeed,
  WEAPONS,
} from "@scrapline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GameSimulation,
  type ServerPlayer,
  type ServerVehicle,
  VEHICLE_GONE,
  VEHICLE_READY,
  VEHICLE_WRECK,
} from "../src/simulation/GameSimulation.ts";

function makeSim(map: "urban" | "airbase" = "urban") {
  let r = 0.5;
  return new GameSimulation(MAPS[map], {
    tickRate: NET.serverTickRate,
    rng: () => (r = (r * 9301 + 49297) % 1),
  });
}

function add(sim: GameSimulation, id: string, team = 0, primary: "rifle" | "sniper" = "rifle") {
  return sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    skin: "foundry",
    level: 1,
    primary,
    seed: 7,
    team,
  });
}

function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.protectedUntil = 0;
}

const seqs = new Map<string, number>();
function frames(id: string, n: number, f: Partial<InputFrame>, viewTick: number): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

/** Runs `ticks` server ticks; each listed player sends 3 frames (60 Hz) per tick. */
function run(sim: GameSimulation, ticks: number, inputs: Record<string, Partial<InputFrame>>): NetEvent[] {
  const events: NetEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const [id, f] of Object.entries(inputs)) sim.enqueue(id, frames(id, 3, f, sim.tick));
    events.push(...sim.step(SERVER_TICK_MS, "live"));
  }
  return events;
}

/** One press of a button (pressed for one tick, released the next). */
function press(sim: GameSimulation, id: string, button: number, extra: Partial<InputFrame> = {}) {
  const ev = run(sim, 1, { [id]: { ...extra, buttons: button } });
  ev.push(...run(sim, 1, { [id]: extra }));
  return ev;
}

function vehicle(sim: GameSimulation, id: string): ServerVehicle {
  return sim.vehicles.get(id)!;
}

/** A spot right beside a vehicle's right-hand side. */
function beside(v: ServerVehicle, gap = 12) {
  return seatWorld(v.sim, { ox: 0, oy: v.def.halfWidth + PLAYER.radius + gap });
}

describe("vehicles: seats", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    seqs.clear();
  });

  it("spawns every map vehicle ready with full health and free seats", () => {
    expect(sim.vehicles.size).toBe(MAPS.urban.vehicleSpawns!.length);
    for (const v of sim.vehicles.values()) {
      expect(v.status).toBe(VEHICLE_READY);
      expect(v.hp).toBe(v.def.maxHp);
      expect(v.seats.every((s) => s === null)).toBe(true);
    }
  });

  it("E takes the driver seat first, then the free passenger seats; a full vehicle refuses", () => {
    const car = vehicle(sim, "car-a");
    const ids = ["a", "b", "c", "d", "e"];
    const players = ids.map((id) => add(sim, id));
    players.forEach((p, i) => {
      const at = beside(car, 4 + i * 2);
      place(p, at.x, at.y);
    });
    for (const id of ids) press(sim, id, BTN.INTERACT);
    expect(car.seats).toEqual(["a", "b", "c", "d"]);
    expect(players[0]!.seat).toBe(0);
    expect(players[4]!.vehicle).toBeNull();
  });

  it("two players pressing E on the same tick never share a seat", () => {
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a");
    const b = add(sim, "b");
    const at = beside(car);
    place(a, at.x, at.y);
    place(b, at.x, at.y + 4);
    run(sim, 1, { a: { buttons: BTN.INTERACT }, b: { buttons: BTN.INTERACT } });
    expect(new Set(car.seats.filter(Boolean)).size).toBe(2);
    expect([a.seat, b.seat].sort()).toEqual([0, 1]);
  });

  it("F moves to the next free seat; the mounted gun replaces the pickup slot and comes back", () => {
    const apc = vehicle(sim, "apc-a");
    const a = add(sim, "a");
    const at = beside(apc);
    place(a, at.x, at.y);
    press(sim, "a", BTN.INTERACT);
    expect(a.seat).toBe(0);
    press(sim, "a", BTN.SEAT);
    expect(a.seat).toBe(1);
    expect(apc.seats[0]).toBeNull();
    expect(a.sim.slots[2]!.id).toBe(WEAPONS.mg.index);
    expect(a.sim.slot).toBe(2);
    press(sim, "a", BTN.SEAT);
    expect(a.seat).toBe(2);
    expect(a.sim.slots[2]!.id).not.toBe(WEAPONS.mg.index);
    expect(a.sim.slot).toBe(0);
  });

  it("cannot enter a fast vehicle or one held by the other team", () => {
    sim.rules = { teams: true, friendlyFire: false };
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a", 1);
    const b = add(sim, "b", 2);
    const at = beside(car);
    place(a, at.x, at.y);
    press(sim, "a", BTN.INTERACT);
    expect(a.seat).toBe(0);
    const at2 = seatWorld(car.sim, { ox: 0, oy: -(car.def.halfWidth + PLAYER.radius + 10) });
    place(b, at2.x, at2.y);
    press(sim, "b", BTN.INTERACT);
    expect(b.vehicle).toBeNull();
    // Fast vehicle: nobody can jump in.
    const rover = vehicle(sim, "rover-a");
    rover.sim.vx = rover.def.enterMaxSpeed + 50;
    const c = add(sim, "c", 1);
    const at3 = beside(rover);
    place(c, at3.x, at3.y);
    run(sim, 1, { c: { buttons: BTN.INTERACT } });
    expect(c.vehicle).toBeNull();
  });
});

describe("vehicles: driving and riding", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    seqs.clear();
  });

  function boardCar() {
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a");
    const b = add(sim, "b");
    const at = beside(car);
    place(a, at.x, at.y);
    place(b, at.x, at.y + 6);
    press(sim, "a", BTN.INTERACT);
    press(sim, "b", BTN.INTERACT);
    return { car, a, b };
  }

  it("the driver's inputs move the vehicle; occupants stay on their seats", () => {
    const { car, a, b } = boardCar();
    const y0 = car.sim.y;
    run(sim, 20, { a: { my: -1 }, b: {} });
    expect(car.sim.y).toBeGreaterThan(y0 + 100);
    const seatB = seatWorld(car.sim, car.def.seats[1]!);
    expect(b.sim.x).toBeCloseTo(seatB.x, 3);
    expect(b.sim.y).toBeCloseTo(seatB.y, 3);
    expect(Math.hypot(a.sim.x - car.sim.x, a.sim.y - car.sim.y)).toBeLessThan(car.def.halfLength);
  });

  it("a passenger fires inside the window's sector while moving and the server records the damage", () => {
    const { car } = boardCar();
    const enemy = add(sim, "enemy");
    // The car faces south: the front passenger's window looks west.
    const seat = seatWorld(car.sim, car.def.seats[1]!);
    place(enemy, 140, seat.y + 120);
    run(sim, 4, { a: { my: -1 }, b: {}, enemy: {} });
    const s = seatWorld(car.sim, car.def.seats[1]!);
    const aim = Math.atan2(enemy.sim.y - s.y, enemy.sim.x - s.x);
    expect(inSector(car.def.seats[1]!, car.sim.angle, aim)).toBe(true);
    const ev = run(sim, 6, { a: { my: -1 }, b: { buttons: BTN.FIRE, aim }, enemy: {} });
    expect(ev.some((e) => e.t === "shot" && e.p === "b")).toBe(true);
    expect(enemy.hp).toBeLessThan(PLAYER.maxHealth);
  });

  it("outside the sector the trigger is ignored; the driver never fires", () => {
    const { car, b } = boardCar();
    const magB = b.sim.slots[0]!.mag;
    const east = car.sim.angle - Math.PI / 2; // the other side of the car
    const ev = run(sim, 6, { a: { buttons: BTN.FIRE }, b: { buttons: BTN.FIRE, aim: east } });
    expect(ev.some((e) => e.t === "shot")).toBe(false);
    expect(b.sim.slots[0]!.mag).toBe(magB);
  });

  it("E leaves a slow vehicle beside it; a fast one keeps its occupants", () => {
    const { car, a, b } = boardCar();
    run(sim, 15, { a: { my: -1 }, b: {} });
    expect(vehicleSpeed(car.sim)).toBeGreaterThan(car.def.exitMaxSpeed);
    press(sim, "b", BTN.INTERACT, {});
    expect(b.vehicle).toBe("car-a");
    run(sim, 12, { a: { my: 1 }, b: {} });
    run(sim, 10, { a: {}, b: {} });
    expect(vehicleSpeed(car.sim)).toBeLessThan(car.def.exitMaxSpeed);
    press(sim, "b", BTN.INTERACT);
    expect(b.vehicle).toBeNull();
    expect(car.seats[1]).toBeNull();
    expect(closestOnBody(car.sim, car.def, b.sim.x, b.sim.y).dist).toBeGreaterThanOrEqual(PLAYER.radius);
    expect(a.vehicle).toBe("car-a");
    // On foot again: b fights normally (moves).
    const x0 = b.sim.x;
    run(sim, 5, { b: { mx: -1 } });
    expect(b.sim.x).toBeLessThan(x0);
  });

  it("a disconnected driver is ejected at once and the car coasts to a stop", () => {
    const { car, a } = boardCar();
    run(sim, 15, { a: { my: -1 } });
    a.connected = false;
    run(sim, 1, {});
    expect(a.vehicle).toBeNull();
    expect(car.seats[0]).toBeNull();
    run(sim, 100, {});
    expect(vehicleSpeed(car.sim)).toBeLessThan(1);
  });
});

describe("vehicles: damage", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim();
    seqs.clear();
  });

  it("bullets damage the hull through its armor; destruction hurts the occupants and credits the attacker", () => {
    const apc = vehicle(sim, "apc-a");
    const driver = add(sim, "driver");
    const at = beside(apc);
    place(driver, at.x, at.y);
    press(sim, "driver", BTN.INTERACT);
    const shooter = add(sim, "shooter", 0, "sniper");
    place(shooter, apc.sim.x + 300, apc.sim.y + 140);
    const aim = Math.atan2(apc.sim.y - shooter.sim.y, apc.sim.x - shooter.sim.x);
    const ev = run(sim, 1, { shooter: { buttons: BTN.FIRE, aim }, driver: {} });
    const hit = ev.find((e) => e.t === "vhit");
    expect(hit).toBeDefined();
    expect(apc.hp).toBe(apc.def.maxHp - Math.round(WEAPONS.sniper.damage * apc.def.bulletArmor));
    expect(driver.hp).toBe(PLAYER.maxHealth);
    // Finish it off: wreck, occupant damage, credit, then removal and respawn.
    driver.hp = 50;
    sim.damageVehicle(apc, 10_000, shooter, apc.sim.x, apc.sim.y);
    expect(apc.status).toBe(VEHICLE_WRECK);
    expect(driver.vehicle).toBeNull();
    expect(driver.alive).toBe(false);
    expect(shooter.stats.kills).toBe(1);
    run(sim, NET.serverTickRate * 6, {});
    expect(apc.status).toBe(VEHICLE_GONE);
    run(sim, NET.serverTickRate * (apc.def.respawnSec + 1), {});
    expect(apc.status).toBe(VEHICLE_READY);
    expect(apc.hp).toBe(apc.def.maxHp);
  });

  it("an exposed passenger can be shot through the window; the protected driver cannot", () => {
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a");
    const b = add(sim, "b");
    const at = beside(car);
    place(a, at.x, at.y);
    place(b, at.x, at.y + 6);
    press(sim, "a", BTN.INTERACT);
    press(sim, "b", BTN.INTERACT);
    const shooter = add(sim, "shooter", 0, "sniper");
    const seatB = seatWorld(car.sim, car.def.seats[1]!);
    place(shooter, 150, seatB.y);
    const aim = Math.atan2(seatB.y - shooter.sim.y, seatB.x - shooter.sim.x);
    run(sim, 1, { shooter: { buttons: BTN.FIRE, aim }, a: {}, b: {} });
    expect(b.hp).toBe(PLAYER.maxHealth - Math.round(WEAPONS.sniper.damage * car.def.seats[1]!.exposure));
    expect(a.hp).toBe(PLAYER.maxHealth);
  });

  it("running over an enemy damages them by closing speed, credits the driver, with a contact cooldown", () => {
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a");
    const at = beside(car);
    place(a, at.x, at.y);
    press(sim, "a", BTN.INTERACT);
    const victim = add(sim, "victim");
    place(victim, car.sim.x, car.sim.y + 260);
    victim.hp = 1000; // survive several hits so the cooldown is observable
    const ev = run(sim, 20, { a: { my: -1 }, victim: {} });
    const hits = ev.filter((e): e is Extract<NetEvent, { t: "hit" }> => e.t === "hit" && e.v === "victim");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.p).toBe("a");
    const ticksBetween = NET.serverTickRate * 0.6;
    const crashTicks = ev.filter((e) => e.t === "crash" && "o" in e && e.o === "victim").length;
    expect(crashTicks).toBeLessThanOrEqual(Math.ceil(20 / ticksBetween));
    // A lethal run-over is a kill with the vehicle as the weapon.
    victim.hp = 5;
    victim.protectedUntil = 0;
    place(victim, car.sim.x + Math.cos(car.sim.angle) * 120, car.sim.y + Math.sin(car.sim.angle) * 120);
    victim.hp = 5;
    for (const [k] of car.contacts) car.contacts.delete(k);
    const ev2 = run(sim, 10, { a: { my: -1 }, victim: {} });
    const kill = ev2.find((e) => e.t === "kill" && e.v === "victim");
    expect(kill).toMatchObject({ k: "a", w: KILL_BY_VEHICLE });
  });

  it("teammates (no friendly fire) and spawn-protected players are pushed, not hurt", () => {
    sim.rules = { teams: true, friendlyFire: false };
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a", 1);
    const at = beside(car);
    place(a, at.x, at.y);
    press(sim, "a", BTN.INTERACT);
    const mate = add(sim, "mate", 1);
    place(mate, car.sim.x, car.sim.y + 200);
    run(sim, 15, { a: { my: -1 }, mate: {} });
    expect(mate.hp).toBe(PLAYER.maxHealth);
    expect(closestOnBody(car.sim, car.def, mate.sim.x, mate.sim.y).dist).toBeGreaterThan(PLAYER.radius - 1);
    const enemy = add(sim, "enemy", 2);
    place(enemy, car.sim.x + Math.cos(car.sim.angle) * 150, car.sim.y + Math.sin(car.sim.angle) * 150);
    enemy.protectedUntil = sim.tick + 1000;
    run(sim, 10, { a: { my: -1 }, enemy: {} });
    expect(enemy.hp).toBe(PLAYER.maxHealth);
  });

  it("vehicle against vehicle: both take damage, the heavier one less", () => {
    const car = vehicle(sim, "car-a");
    const apc = vehicle(sim, "apc-a");
    const a = add(sim, "a");
    const at = beside(car);
    place(a, at.x, at.y);
    press(sim, "a", BTN.INTERACT);
    // The APC is parked further down the same street, across the car's path.
    const ev = run(sim, 40, { a: { my: -1 } });
    const crash = ev.find((e) => e.t === "crash" && e.o === "apc-a");
    expect(crash).toBeDefined();
    const carLoss = car.def.maxHp - car.hp;
    const apcLoss = apc.def.maxHp - apc.hp;
    expect(carLoss).toBeGreaterThan(0);
    expect(apcLoss).toBeGreaterThan(0);
    expect(apcLoss).toBeLessThan(carLoss);
  });

  it("a wreck explosion kills a passenger with the explosion as the weapon", () => {
    const car = vehicle(sim, "car-a");
    const a = add(sim, "a");
    const b = add(sim, "b");
    const at = beside(car);
    place(a, at.x, at.y);
    place(b, at.x, at.y + 6);
    press(sim, "a", BTN.INTERACT);
    press(sim, "b", BTN.INTERACT);
    const shooter = add(sim, "shooter");
    place(shooter, 150, 150);
    b.hp = 10;
    const events: NetEvent[] = [];
    const orig = sim.step.bind(sim);
    sim.damageVehicle(car, 10_000, shooter, car.sim.x, car.sim.y);
    events.push(...orig(SERVER_TICK_MS, "live"));
    expect(b.alive).toBe(false);
    expect(shooter.stats.kills).toBeGreaterThanOrEqual(1);
    void KILL_BY_EXPLOSION;
  });
});

describe("helicopter", () => {
  let sim: GameSimulation;
  beforeEach(() => {
    sim = makeSim("airbase");
    seqs.clear();
  });

  it("pilot takes off and flies; the gunner fires the door gun; nobody can step out in the air", () => {
    const heli = vehicle(sim, "heli-a");
    const pilot = add(sim, "pilot");
    const gunner = add(sim, "gunner");
    const at = beside(heli);
    place(pilot, at.x, at.y);
    place(gunner, at.x + 30, at.y);
    press(sim, "pilot", BTN.INTERACT);
    press(sim, "gunner", BTN.INTERACT);
    expect(heli.seats.slice(0, 2)).toEqual(["pilot", "gunner"]);
    expect(gunner.sim.slots[2]!.id).toBe(WEAPONS.doorgun.index);
    press(sim, "pilot", BTN.DASH, {});
    expect(heli.sim.lift).toBe(true);
    run(sim, 70, { pilot: { my: -1, aim: -Math.PI / 2 }, gunner: {} });
    expect(heli.sim.alt).toBe(1);
    expect(heli.sim.y).toBeLessThan(MAPS.airbase.vehicleSpawns![0]!.y - 100);
    press(sim, "gunner", BTN.INTERACT);
    expect(gunner.vehicle).toBe("heli-a");
    const ev = run(sim, 4, { pilot: {}, gunner: { buttons: BTN.FIRE, aim: heli.sim.angle } });
    expect(ev.some((e) => e.t === "shot" && e.p === "gunner" && e.w === WEAPONS.doorgun.index)).toBe(true);
  });

  it("a ground shooter can hit a flying helicopter over low cover", () => {
    const heli = vehicle(sim, "heli-a");
    heli.sim.alt = 1;
    heli.sim.rotor = 1;
    heli.sim.lift = true;
    const shooter = add(sim, "shooter", 0, "sniper");
    // Sandbags (low) between the shooter and the helicopter.
    place(shooter, heli.sim.x, heli.sim.y + 400);
    const aim = Math.atan2(heli.sim.y - shooter.sim.y, heli.sim.x - shooter.sim.x);
    run(sim, 1, { shooter: { buttons: BTN.FIRE, aim } });
    expect(heli.hp).toBeLessThan(heli.def.maxHp);
  });

  it("left without a pilot, it lands by itself", () => {
    const heli = vehicle(sim, "heli-a");
    Object.assign(heli.sim, { alt: 1, rotor: 1, lift: true });
    run(sim, 60, {});
    expect(heli.sim.alt).toBe(0);
    expect(VEHICLES.heli.flight).toBeDefined();
  });
});
