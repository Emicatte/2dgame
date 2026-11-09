import {
  ACT,
  AI,
  BTN,
  type Difficulty,
  type InputFrame,
  MAPS,
  type MapDef,
  type MissionDef,
  mulberry32,
  NET,
  PLAYER,
  quantizeInput,
} from "@scrapline/shared";
import type { PveController } from "../src/pve/PveController.ts";
import type { Zombie } from "../src/pve/ZombieWorld.ts";
import { GameSimulation, type ServerPlayer } from "../src/simulation/GameSimulation.ts";

/** Shared by the Black Site and Final Breach tests: players, inputs, ticks, a scripted fighter. */

export const TICK_MS = 1000 / NET.serverTickRate;
export function makeSim(map: MapDef, seed = 21) {
  return new GameSimulation(map, { tickRate: NET.serverTickRate, rng: mulberry32(seed) });
}

export function addPlayer(sim: GameSimulation, id: string): ServerPlayer {
  const p = sim.addPlayer({
    id,
    playerId: `pid-${id}`,
    name: id,
    team: 1,
    skin: "foundry",
    level: 1,
    primary: "rifle",
    seed: id.length * 97,
  });
  sim.rules = { teams: true, friendlyFire: false };
  return p;
}

export function place(p: ServerPlayer, x: number, y: number) {
  p.alive = true;
  p.hp = PLAYER.maxHealth;
  p.sim.x = x;
  p.sim.y = y;
  p.sim.vx = 0;
  p.sim.vy = 0;
  p.pve.downed = false;
}

const seqs = new Map<string, number>();
export function frames(id: string, n: number, f: Partial<InputFrame>, viewTick = 0): InputFrame[] {
  return Array.from({ length: n }, () => {
    const s = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, s);
    return quantizeInput({ seq: s, mx: 0, my: 0, aim: 0, buttons: 0, slot: -1, viewTick, ...f });
  });
}

export function tick(sim: GameSimulation, input: Record<string, Partial<InputFrame>> = {}) {
  for (const p of sim.players.values()) sim.enqueue(p.id, frames(p.id, 3, input[p.id] ?? {}, sim.tick));
  return sim.step(TICK_MS, "live");
}

/** Test access to the controller's script hooks (the mission normally drives these). */
export type Script = { setPower(on: boolean): void; applyTriggers(t: unknown[]): void };
export const script = (pve: PveController) => pve as unknown as Script;

export function start(mission: MissionDef, players = ["alpha"], difficulty: Difficulty = "veteran") {
  const sim = makeSim(MAPS[mission.map]);
  sim.setPve({ mode: "outbreak", mission, difficulty });
  sim.resetForMatch();
  const ps = players.map((id) => addPlayer(sim, id));
  sim.resetForMatch();
  return { sim, pve: sim.pve!, ps };
}

/** Removes every enemy (placed groups, ambient) so a test sees only what it sets up. */
export function clearEnemies(pve: PveController) {
  for (const z of pve.zw.zombies.values()) pve.zw.remove(z);
}

/**
 * Test fighter: aims at the Warden and fires. "tank" circles in front of it at the edge of sweep
 * reach and steps out of telegraphed cones and charge lanes; "flank" keeps to its back, out of the
 * tail's reach; "beside" stays next to the tank (both in front, nobody flanking).
 */
export function fighter(
  boss: Zombie,
  p: ServerPlayer,
  role: "tank" | "beside" | "flank",
  buddy: ServerPlayer,
): Partial<InputFrame> {
  const dx = p.sim.x - boss.x;
  const dy = p.sim.y - boss.y;
  const d = Math.hypot(dx, dy) || 1;
  const aim = Math.atan2(-dy, -dx);
  let mx = 0;
  let my = 0;
  const winding = boss.state === AI.ATTACK && boss.act === ACT.WINDUP ? boss.cur : null;
  if (role === "flank") {
    const back = boss.angle + Math.PI;
    const gx = boss.x + Math.cos(back) * 300;
    const gy = boss.y + Math.sin(back) * 300;
    mx = gx - p.sim.x;
    my = gy - p.sim.y;
  } else if (role === "beside") {
    const ang = Math.atan2(buddy.sim.y - boss.y, buddy.sim.x - boss.x) + 0.4;
    mx = boss.x + Math.cos(ang) * 260 - p.sim.x;
    my = boss.y + Math.sin(ang) * 260 - p.sim.y;
  } else {
    // Holds its ground at ~200 px (close enough to draw sweeps, far enough to step out of them),
    // backing off and drifting a little sideways.
    const radial = (200 - d) / 60;
    mx = (dx / d) * radial - (dy / d) * 0.35;
    my = (dy / d) * radial + (dx / d) * 0.35;
  }
  if (winding?.kind === "sweep" || winding?.kind === "vent") {
    // Out of the circle / cone: straight away from it.
    const reach = (winding.radius ?? 180) + PLAYER.radius + 30;
    if (d < reach) {
      mx = dx / d;
      my = dy / d;
    }
  } else if (winding?.kind === "charge") {
    // Sideways out of the lane.
    const ang = Math.atan2(boss.actY - boss.y, boss.actX - boss.x);
    const side = Math.sin(Math.atan2(dy, dx) - ang) >= 0 ? 1 : -1;
    mx = -Math.sin(ang) * side;
    my = Math.cos(ang) * side;
  }
  // Stay inside the hall.
  if (p.sim.x < 3780) mx = Math.max(mx, 0.6);
  if (p.sim.x > 4240) mx = Math.min(mx, -0.6);
  if (p.sim.y < 800) my = Math.max(my, 0.6);
  if (p.sim.y > 1880) my = Math.min(my, -0.6);
  const l = Math.hypot(mx, my);
  if (l > 1) {
    mx /= l;
    my /= l;
  }
  return { mx, my, aim, buttons: BTN.FIRE };
}
