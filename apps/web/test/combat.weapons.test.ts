import {
  createPlayerSim,
  fullSlot,
  secToSteps,
  WEAPON_LIST,
  WEAPONS,
  type WeaponDef,
} from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import { distanceFromRay, projectOntoRay, visualAim } from "../src/game/combat/aim.ts";
import {
  CYCLES,
  cyclePose,
  KICK_MAX_PX,
  localWeaponAnim,
  RELOAD_BACK,
  RELOAD_ROT,
  reloadEnvelope,
  reloadPose,
  SWAP_BACK,
  SWAP_ROT,
  swapPose,
  WeaponAnimator,
} from "../src/game/combat/weaponAnim.ts";
import {
  barrelTipFromOrigin,
  cycleOf,
  FX_PROFILES,
  profileFor,
  recoilRotDeg,
  WEAPON_HOLD_PX,
  WEAPON_ORIGIN_X,
  weaponCategory,
  weaponShape,
} from "../src/game/combat/weaponFx.ts";

describe("weapon visual families", () => {
  it("every weapon has a category, a profile and no gameplay change", () => {
    const expected: Record<string, string> = {
      pistol: "pistol",
      rifle: "rifle",
      smg: "smg",
      shotgun: "shotgun",
      sniper: "sniper",
      mg: "mounted",
      doorgun: "mounted",
    };
    for (const w of WEAPON_LIST) {
      expect(weaponCategory(w)).toBe(expected[w.id]);
      expect(FX_PROFILES[weaponCategory(w)]).toBe(profileFor(w));
    }
    expect(cycleOf(WEAPONS.shotgun)).toBe("pump");
    expect(cycleOf(WEAPONS.sniper)).toBe("bolt");
    expect(cycleOf(WEAPONS.rifle)).toBeNull();
    expect(profileFor(WEAPONS.sniper).tracer.beam).toBe(true);
  });

  it("derives a family for definitions without one (e.g. future PvE weapons)", () => {
    const bare = (over: Partial<WeaponDef>, fx: Partial<WeaponDef["fx"]> = {}): WeaponDef => ({
      ...WEAPONS.rifle,
      ...over,
      fx: { ...WEAPONS.rifle.fx, category: undefined, recoilRotDeg: undefined, cycle: undefined, ...fx },
    });
    expect(weaponCategory(bare({ slotKind: "mounted" }))).toBe("mounted");
    expect(weaponCategory(bare({ pellets: 6 }))).toBe("shotgun");
    expect(weaponCategory(bare({}, { laserSight: true }))).toBe("sniper");
    expect(weaponCategory(bare({ slotKind: "secondary" }))).toBe("pistol");
    expect(weaponCategory(bare({ rpm: 950 }))).toBe("smg");
    expect(weaponCategory(bare({}))).toBe("rifle");
    expect(recoilRotDeg(bare({ pellets: 6 }))).toBe(FX_PROFILES.shotgun.recoilRotDeg);
    expect(cycleOf(bare({ pellets: 6 }))).toBe("pump");
  });

  it("barrel tip matches the texture layout (canvas len+4 wide, barrel ends at len+2)", () => {
    for (const w of WEAPON_LIST) {
      const { len } = weaponShape(w);
      const width = len + 4;
      expect(barrelTipFromOrigin(w)).toBeCloseTo(len + 2 - WEAPON_ORIGIN_X * width, 9);
      expect(barrelTipFromOrigin(w)).toBeGreaterThan(10);
    }
    // Rifle muzzle sits ~40 px in front of the body centre at rest.
    expect(WEAPON_HOLD_PX + barrelTipFromOrigin(WEAPONS.rifle)).toBeCloseTo(40.2, 6);
  });
});

describe("aim geometry", () => {
  it("projects onto the ray, never behind the origin", () => {
    const p = projectOntoRay(0, 0, 0, 30, 5);
    expect(p).toEqual({ x: 30, y: 0 });
    expect(projectOntoRay(0, 0, 0, -10, 5)).toEqual({ x: 0, y: 0 });
    const a = Math.PI / 3;
    const q = projectOntoRay(10, 20, a, 50, -7);
    expect(distanceFromRay(10, 20, a, q.x, q.y)).toBeCloseTo(0, 9);
    const out = { x: 0, y: 0 };
    expect(projectOntoRay(0, 0, 0, 1, 1, out)).toBe(out);
  });

  it("a tracer from the projected muzzle to the impact passes through the crosshair", () => {
    // Predicted origin, drawn body 3.5 px off (moving), cursor 300 px away.
    const sim = { x: 500, y: 500 };
    const cursor = { x: 780, y: 610 };
    const aim = Math.atan2(cursor.y - sim.y, cursor.x - sim.x);
    const body = { x: sim.x - 2.5, y: sim.y + 2.5 };
    const shown = visualAim(body.x, body.y, cursor.x, cursor.y, aim);
    const tip = { x: body.x + Math.cos(shown) * 40, y: body.y + Math.sin(shown) * 40 };
    // The drawn barrel points through the crosshair...
    expect(distanceFromRay(body.x, body.y, shown, cursor.x, cursor.y)).toBeCloseTo(0, 9);
    const m = projectOntoRay(sim.x, sim.y, aim, tip.x, tip.y);
    const end = { x: sim.x + Math.cos(aim) * 900, y: sim.y + Math.sin(aim) * 900 };
    // ...the tracer lies on the real ray, through the crosshair...
    expect(distanceFromRay(m.x, m.y, Math.atan2(end.y - m.y, end.x - m.x), cursor.x, cursor.y)).toBeCloseTo(
      0,
      6,
    );
    // ...and starts within the body/sim offset of the drawn tip.
    expect(Math.hypot(m.x - tip.x, m.y - tip.y)).toBeLessThanOrEqual(Math.hypot(2.5, 2.5) + 1e-9);
  });

  it("visual aim falls back to the true aim with the cursor on the body", () => {
    expect(visualAim(0, 0, 3, 4, 1.25)).toBe(1.25);
    expect(visualAim(0, 0, 100, 0, 1.25)).toBe(0);
  });
});

describe("weapon animation", () => {
  it("reload envelope: 0 at both ends, full dip in the middle, jolt at the magazine", () => {
    expect(reloadEnvelope(0)).toBe(0);
    expect(reloadEnvelope(1)).toBe(0);
    expect(reloadEnvelope(0.5)).toBe(1);
    expect(reloadEnvelope(0.1)).toBeGreaterThan(0);
    expect(reloadEnvelope(0.1)).toBeLessThan(1);
    const mid = { back: 0, rot: 0 };
    reloadPose(0.4, mid);
    expect(mid).toEqual({ back: RELOAD_BACK, rot: RELOAD_ROT });
    const jolt = { back: 0, rot: 0 };
    reloadPose(0.55, jolt);
    expect(jolt.back).toBeLessThan(RELOAD_BACK);
  });

  it("swap raises the weapon from lowered to ready", () => {
    const start = { back: 0, rot: 0 };
    swapPose(0, start);
    expect(start).toEqual({ back: SWAP_BACK, rot: SWAP_ROT });
    const end = { back: 0, rot: 0 };
    swapPose(1, end);
    expect(end).toEqual({ back: 0, rot: 0 });
  });

  it("recoil kicks back and rotates, then recovers", () => {
    const a = new WeaponAnimator();
    const rifle = WEAPONS.rifle;
    a.update(16, rifle.index, { def: rifle, moving: 0, stepPhase: 0 });
    a.fire(rifle);
    expect(a.kick).toBe(rifle.fx.recoilKickPx);
    expect(Math.abs(a.rotKick)).toBeCloseTo((rifle.fx.recoilRotDeg! * Math.PI) / 180, 9);
    for (let i = 0; i < 10; i++) a.fire(WEAPONS.sniper);
    expect(a.kick).toBe(KICK_MAX_PX);
    let pose = a.update(16, rifle.index, { def: rifle, moving: 0, stepPhase: 0 });
    expect(pose.back).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) pose = a.update(16, rifle.index, { def: rifle, moving: 0, stepPhase: 0 });
    expect(pose.back).toBeCloseTo(0, 6);
    expect(pose.rot).toBeCloseTo(0, 6);
  });

  for (const id of ["shotgun", "sniper"] as const) {
    it(`${id}: manual action cycles once per shot and ejects one shell`, () => {
      const def = WEAPONS[id];
      const c = CYCLES[cycleOf(def)!];
      const a = new WeaponAnimator();
      const input = { def, moving: 0, stepPhase: 0 };
      a.update(16, def.index, input);
      a.fire(def);
      let ejects = 0;
      let maxBack = 0;
      for (let t = 0; t < c.delayMs + c.durationMs + 200; t += 10) {
        const pose = a.update(10, def.index, input);
        if (pose.eject) ejects++;
        if (t > 200) maxBack = Math.max(maxBack, pose.back);
      }
      expect(ejects).toBe(1);
      expect(maxBack).toBeGreaterThan(0);
      const p = { back: 0, rot: 0 };
      cyclePose(cycleOf(def)!, 0.5, p);
      expect(p.back).toBeCloseTo(c.back, 9);
    });
  }

  it("automatic weapons never eject from a cycle (casings fly at the shot)", () => {
    const a = new WeaponAnimator();
    const def = WEAPONS.smg;
    a.update(16, def.index, { def, moving: 0, stepPhase: 0 });
    a.fire(def);
    for (let i = 0; i < 100; i++)
      expect(a.update(10, def.index, { def, moving: 0, stepPhase: 0 }).eject).toBe(false);
  });

  it("remote reload: estimated from the flag, held before the raise, then finished", () => {
    const def = WEAPONS.rifle;
    const a = new WeaponAnimator();
    const input = { def, reloading: true, moving: 0, stepPhase: 0 };
    a.update(16, def.index, { ...input, reloading: false });
    let pose = a.update(def.reloadSec * 400, def.index, input);
    expect(pose.rot).toBeCloseTo(RELOAD_ROT, 6);
    // Flag still set long after the expected end: held just before the raise.
    pose = a.update(def.reloadSec * 3000, def.index, input);
    expect(pose.rot).toBeGreaterThan(0);
    // Flag drops: the weapon comes back up and the animation ends.
    for (let i = 0; i < 100; i++) pose = a.update(16, def.index, { ...input, reloading: false });
    expect(pose.rot).toBeCloseTo(0, 6);
  });

  it("remote weapon change plays the draw animation over the swap time", () => {
    const a = new WeaponAnimator();
    const rifle = WEAPONS.rifle;
    const pistol = WEAPONS.pistol;
    expect(a.update(16, rifle.index, { def: rifle, moving: 0, stepPhase: 0 }).rot).toBe(0);
    const first = a.update(1, pistol.index, { def: pistol, moving: 0, stepPhase: 0 });
    expect(first.rot).toBeGreaterThan(SWAP_ROT * 0.9);
    const done = a.update(pistol.swapSec * 1000, pistol.index, { def: pistol, moving: 0, stepPhase: 0 });
    expect(done.rot).toBeCloseTo(0, 9);
  });

  it("local timers come straight from the predicted sim", () => {
    const sim = createPlayerSim(0, 0, "rifle");
    expect(localWeaponAnim(sim)).toEqual({ reload: null, swap: 1, reloading: undefined });
    const total = secToSteps(WEAPONS.rifle.reloadSec);
    sim.reload = total / 2;
    expect(localWeaponAnim(sim).reload).toBeCloseTo(0.5, 9);
    sim.reload = 0;
    sim.slots[2] = fullSlot("shotgun");
    sim.slot = 2;
    sim.swap = secToSteps(WEAPONS.shotgun.swapSec);
    expect(localWeaponAnim(sim).swap).toBe(0);
  });

  it("sway stays under a pixel at the muzzle", () => {
    const a = new WeaponAnimator();
    const def = WEAPONS.sniper;
    let maxRot = 0;
    for (let i = 0; i < 200; i++) {
      const pose = a.update(16, def.index, { def, moving: 1, stepPhase: i * 0.2 });
      maxRot = Math.max(maxRot, Math.abs(pose.rot));
    }
    expect(maxRot * (WEAPON_HOLD_PX + barrelTipFromOrigin(def))).toBeLessThan(1);
  });
});
