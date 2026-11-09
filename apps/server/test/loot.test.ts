import {
  BTN,
  CHEST_WEAPONS,
  MAPS,
  NET,
  NO_WEAPON,
  PLAYER,
  PRIMARY_WEAPONS,
  quantizeInput,
  rollChestWeapon,
  SERVER_TICK_MS,
  SHIELD,
  WEAPONS,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

function setup() {
  const sim = new GameSimulation(MAPS.industrial, { tickRate: NET.serverTickRate, rng: () => 0.42 });
  const add = (id: string) => {
    const p = sim.addPlayer({
      id,
      playerId: id,
      name: id,
      skin: "foundry",
      level: 1,
      primary: "rifle",
      seed: 1,
    });
    sim.spawn(p, true);
    p.protectedUntil = 0;
    return p;
  };
  return { sim, a: add("a"), b: add("b") };
}

let seq = 0;
function frame(sim: GameSimulation, p: ServerPlayer, buttons: number, aim = 0, slot = -1) {
  sim.enqueue(p.id, [quantizeInput({ seq: ++seq, mx: 0, my: 0, aim, buttons, slot, viewTick: sim.tick })]);
  sim.step(SERVER_TICK_MS, "live");
}

describe("loot: chests, shields, new weapons", () => {
  it("loot weapons are chest-only (never in loadouts); every chest roll is a real weapon", () => {
    for (const id of ["carbine", "battlerifle", "minigun", "rpg"] as const) {
      expect(PRIMARY_WEAPONS).not.toContain(id);
      expect(WEAPONS[id].slotKind).toBe("loot");
    }
    for (let r = 0; r < 1; r += 0.01) expect(CHEST_WEAPONS.map((w) => w.id)).toContain(rollChestWeapon(r));
  });

  it("every PvP map has chests; opening one drops a weapon, a shield cell and ammo on the ground", () => {
    for (const id of ["industrial", "urban", "depot"] as const)
      expect(MAPS[id].pickups.filter((p) => p.kind === "chest").length).toBeGreaterThanOrEqual(4);
    const { sim, a } = setup();
    const chest = MAPS.industrial.pickups.find((p) => p.kind === "chest")!;
    a.sim.x = chest.x + 20;
    a.sim.y = chest.y;
    frame(sim, a, BTN.INTERACT);
    expect(sim.pickups.get(chest.id)!.active).toBe(false);
    const kinds = [...sim.drops.values()].map((d) => d.kind).sort();
    expect(kinds).toEqual(["ammo", "shield", "weapon"]);
    // Nothing is given automatically: the weapon stays on the ground until picked.
    expect(a.sim.slots[2]!.id).toBe(NO_WEAPON);
    expect(a.shield).toBe(0);
  });

  it("picking a weapon from the ground takes the free slot, then swaps the held one, which stays on the ground", () => {
    const { sim, a } = setup();
    const drop = (weapon: "minigun" | "carbine") => {
      sim.drops.clear();
      (sim as unknown as { addDrop(d: object): void }).addDrop({
        kind: "weapon",
        weapon,
        mag: -1,
        reserve: -1,
        x: a.sim.x + 10,
        y: a.sim.y,
      });
    };
    drop("minigun");
    frame(sim, a, 0);
    frame(sim, a, BTN.INTERACT);
    expect(a.sim.slots[2]!.id).toBe(WEAPONS.minigun.index);
    expect(sim.drops.size).toBe(0);
    // Holding interact does not pick up again; a new press on another weapon swaps the held one.
    drop("carbine");
    frame(sim, a, BTN.INTERACT);
    expect(a.sim.slots[2]!.id).toBe(WEAPONS.minigun.index);
    frame(sim, a, 0);
    frame(sim, a, BTN.INTERACT);
    expect(a.sim.slots[2]!.id).toBe(WEAPONS.carbine.index);
    const left = [...sim.drops.values()];
    expect(left).toHaveLength(1);
    expect(left[0]!.weapon).toBe("minigun");
    // Holding the primary: that one is swapped (the sidearm never is).
    frame(sim, a, 0, 0, 0);
    for (let i = 0; i < 30; i++) frame(sim, a, 0);
    sim.drops.clear();
    drop("minigun");
    frame(sim, a, BTN.INTERACT);
    expect(a.sim.slots[0]!.id).toBe(WEAPONS.minigun.index);
    expect(a.sim.slots[1]!.id).toBe(WEAPONS.pistol.index);
    expect([...sim.drops.values()][0]!.weapon).toBe("rifle");
  });

  it("shield cells are carried (up to the cap) and used on demand", () => {
    const { sim, a } = setup();
    const add = (sim as unknown as { addDrop(d: object): void }).addDrop.bind(sim);
    for (let i = 0; i < SHIELD.maxCells + 1; i++)
      add({ kind: "shield", weapon: null, mag: 0, reserve: 0, x: a.sim.x, y: a.sim.y });
    frame(sim, a, 0);
    expect(a.cells).toBe(SHIELD.maxCells);
    expect(a.shield).toBe(0);
    expect(sim.drops.size).toBe(1); // full: the extra cell stays on the ground
    sim.drops.clear();
    frame(sim, a, BTN.SHIELD);
    expect(a.shield).toBe(SHIELD.perCell);
    expect(a.cells).toBe(SHIELD.maxCells - 1);
    frame(sim, a, BTN.SHIELD); // held: no second use
    expect(a.cells).toBe(SHIELD.maxCells - 1);
    frame(sim, a, 0);
    frame(sim, a, BTN.SHIELD);
    expect(a.shield).toBe(SHIELD.max);
    frame(sim, a, 0);
    frame(sim, a, BTN.SHIELD); // full shield: the cell is kept
    expect(a.cells).toBe(SHIELD.maxCells - 2);
  });

  it("the shield takes damage before health", () => {
    const { sim, a, b } = setup();
    b.shield = 30;
    sim.damageFromMode(b, 50, a, WEAPONS.rifle.index, b.sim.x, b.sim.y);
    expect(b.shield).toBe(0);
    expect(b.hp).toBe(PLAYER.maxHealth - 20);
  });

  it("an RPG rocket explodes on impact: area damage to the target, never to the shooter", () => {
    const { sim, a, b } = setup();
    a.sim.x = 1100;
    a.sim.y = 480;
    b.sim.x = 1100;
    b.sim.y = 640;
    a.sim.slots[2] = { id: WEAPONS.rpg.index, mag: 1, reserve: 4 };
    frame(sim, a, 0, 0, 2);
    for (let i = 0; i < 60; i++) frame(sim, a, 0, Math.PI / 2);
    const events: string[] = [];
    sim.enqueue(a.id, [
      quantizeInput({
        seq: ++seq,
        mx: 0,
        my: 0,
        aim: Math.PI / 2,
        buttons: BTN.FIRE,
        slot: -1,
        viewTick: sim.tick,
      }),
    ]);
    for (const e of sim.step(SERVER_TICK_MS, "live")) events.push(e.t);
    expect(events).toContain("boom");
    expect(b.hp).toBeLessThan(PLAYER.maxHealth - 50);
    expect(a.hp).toBe(PLAYER.maxHealth);
  });
});
