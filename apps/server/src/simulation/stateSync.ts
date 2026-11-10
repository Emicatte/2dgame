import {
  ATTACK_KINDS,
  DropState,
  formatIdList,
  HazardState,
  type MatchState,
  NO_WEAPON,
  ObjectiveState,
  type PlayerState,
  PropState,
  VehicleState,
  WEAPONS,
  ZombieState,
} from "@scrapline/shared";
import type { ZombieWorld } from "../pve/ZombieWorld.ts";
import type { GameSimulation, ServerPlayer } from "./GameSimulation.ts";

/**
 * Mirrors one simulated player into its synchronized schema object. Shared by ArenaRoom and the
 * offline client benchmark host (apps/web/src/bench), so both publish exactly the same state.
 */
export function syncPlayerState(ps: PlayerState, p: ServerPlayer, tick: number, sim?: GameSimulation): void {
  const s = p.sim;
  ps.alive = p.alive;
  // Hidden-information modes: a masked player's public pose is the last one the other side was
  // allowed to see; the real one travels in MatchState.allies to their own side only.
  const pub = sim?.ctl?.publicPose(p) ?? null;
  ps.masked = pub !== null;
  ps.x = pub ? pub.x : s.x;
  ps.y = pub ? pub.y : s.y;
  ps.aim = pub ? pub.aim : s.aim;
  ps.hp = p.hp;
  ps.shield = p.shield;
  ps.cells = p.cells;
  ps.away = p.away;
  ps.kills = p.stats.kills;
  ps.deaths = p.stats.deaths;
  ps.streak = p.stats.streak;
  const slot = s.slots[s.slot];
  ps.weapon = slot?.id ?? NO_WEAPON;
  ps.reloading = s.reload > 0;
  ps.protected = p.alive && p.protectedUntil > tick;
  ps.respawnTick = p.alive ? 0 : p.respawnTick;
  ps.vehicle = p.vehicle ?? "";
  ps.seat = p.vehicle ? p.seat : -1;

  ps.ack = p.lastProcessedSeq;
  ps.vx = s.vx;
  ps.vy = s.vy;
  ps.dash = s.dash;
  ps.dashCd = s.dashCd;
  ps.dashDx = s.dashDx;
  ps.dashDy = s.dashDy;
  ps.dashHeld = s.dashHeld;
  ps.slot = s.slot;
  const [a, b, c] = s.slots;
  ps.w0 = a!.id;
  ps.m0 = a!.mag;
  ps.r0 = a!.reserve;
  ps.w1 = b!.id;
  ps.m1 = b!.mag;
  ps.r1 = b!.reserve;
  ps.w2 = c!.id;
  ps.m2 = c!.mag;
  ps.r2 = c!.reserve;
  ps.cooldown = s.cooldown;
  ps.reload = s.reload;
  ps.swap = s.swap;
  ps.bloom = s.bloom;
  ps.trigger = s.trigger;
}

/** Mirrors the items on the ground (they never move: created and removed only). */
export function syncDrops(state: MatchState, sim: GameSimulation): void {
  for (const id of [...state.drops.keys()]) if (!sim.drops.has(id)) state.drops.delete(id);
  for (const [id, d] of sim.drops) {
    if (state.drops.has(id)) continue;
    const ds = new DropState();
    ds.kind = d.kind;
    ds.w = d.weapon ? WEAPONS[d.weapon].index : 0;
    ds.x = d.x;
    ds.y = d.y;
    state.drops.set(id, ds);
  }
}

/**
 * Mirrors the simulated vehicles into the synchronized map (created on first use and after a map
 * change). Shared by ArenaRoom and the host-mode room.
 */
export function syncVehicles(state: MatchState, sim: GameSimulation): void {
  for (const id of [...state.vehicles.keys()]) if (!sim.vehicles.has(id)) state.vehicles.delete(id);
  for (const [id, v] of sim.vehicles) {
    let vs = state.vehicles.get(id);
    if (!vs) {
      vs = new VehicleState();
      state.vehicles.set(id, vs);
    }
    vs.kind = v.def.kind;
    const s = v.sim;
    vs.x = s.x;
    vs.y = s.y;
    vs.angle = s.angle;
    vs.vx = s.vx;
    vs.vy = s.vy;
    vs.av = s.av;
    vs.alt = s.alt;
    vs.rotor = s.rotor;
    vs.lift = s.lift;
    vs.liftHeld = s.liftHeld;
    vs.hp = v.hp;
    vs.status = v.status;
    vs.s0 = v.seats[0] ?? "";
    vs.s1 = v.seats[1] ?? "";
    vs.s2 = v.seats[2] ?? "";
    vs.s3 = v.seats[3] ?? "";
  }
}

/** Mirrors Domination points and CTF flags into the synchronized map. */
export function syncObjectives(state: MatchState, sim: GameSimulation): void {
  const keys = new Set<string>([...sim.points.map((p) => p.id), ...sim.flags.map((f) => String(f.team))]);
  for (const id of [...state.objectives.keys()]) if (!keys.has(id)) state.objectives.delete(id);
  const get = (id: string) => {
    let o = state.objectives.get(id);
    if (!o) {
      o = new ObjectiveState();
      state.objectives.set(id, o);
    }
    return o;
  };
  for (const p of sim.points) {
    const o = get(p.id);
    o.kind = "point";
    o.team = p.owner;
    o.progress = p.progress;
    o.x = p.x;
    o.y = p.y;
  }
  for (const f of sim.flags) {
    const o = get(String(f.team));
    o.kind = "flag";
    o.team = f.team;
    o.x = f.x;
    o.y = f.y;
    o.carrier = f.carrier ?? "";
    o.home = f.home;
  }
}

/**
 * Mirrors the PvE runtime (enemies, hazards, props, loot, mission progress) into the synchronized
 * state. Shared by ArenaRoom and the host-mode room. Positions are whole pixels and the facing
 * angle a byte: dozens of enemies move every tick, so every field is kept small.
 */
export function syncPve(state: MatchState, sim: GameSimulation): void {
  const pve = sim.pve;
  if (!pve) {
    const own = sim.ctl?.zombieWorld() ?? null;
    if (own) syncZombies(state, own, sim.tickRateHz);
    else if (state.zombies.size > 0) state.zombies.clear();
    if (state.hazards.size > 0) state.hazards.clear();
    if (state.props.size > 0) state.props.clear();
    // The downed flag drives client prediction in every mode: never let it outlive the run.
    for (const s of state.players.values()) {
      if (s.downed) s.downed = false;
      if (s.bleed !== 0) s.bleed = 0;
      if (s.revive !== 0) s.revive = 0;
      if (s.revives !== 0) s.revives = 0;
    }
    return;
  }
  syncZombies(state, pve.zw, sim.tickRateHz);
  const hs = state.hazards;
  for (const id of [...hs.keys()]) if (!pve.zw.hazards.has(id)) hs.delete(id);
  for (const h of pve.zw.hazards.values()) {
    if (hs.has(h.id)) continue;
    const s = new HazardState();
    s.x = Math.round(h.x);
    s.y = Math.round(h.y);
    s.r = Math.min(255, Math.round(h.r));
    s.until = h.until;
    hs.set(h.id, s);
  }
  const ps = state.props;
  const live = new Set<string>([...pve.props.keys(), ...pve.loot.keys()]);
  for (const id of [...ps.keys()]) if (!live.has(id)) ps.delete(id);
  for (const pr of pve.props.values()) {
    let s = ps.get(pr.def.id);
    if (!s) {
      s = new PropState();
      s.kind = pr.def.kind;
      ps.set(pr.def.id, s);
    }
    // Attached props move with their vehicle.
    const px = Math.round(pr.x);
    const py = Math.round(pr.y);
    if (s.x !== px) s.x = px;
    if (s.y !== py) s.y = py;
    const usable = pr.active && !pr.used && (!pr.def.requires || pve.flags.has(pr.def.requires));
    if (s.active !== usable) s.active = usable;
    if (s.used !== pr.used) s.used = pr.used;
    const prog = Math.round(pr.prog * 100) / 100;
    if (s.prog !== prog) s.prog = prog;
    if (s.by !== pr.by) s.by = pr.by;
  }
  for (const l of pve.loot.values()) {
    let s = ps.get(l.id);
    if (!s) {
      s = new PropState();
      s.kind = l.kind;
      s.x = Math.round(l.x);
      s.y = Math.round(l.y);
      s.active = true;
      ps.set(l.id, s);
    }
    const used = l.kind === "supply" ? l.takenBy.size > 0 : false;
    if (s.used !== used) s.used = used;
  }
  const st = state.pve;
  st.mission = pve.mission?.id ?? "";
  st.difficulty = pve.difficultyId;
  st.step = pve.stepIndex;
  const prog = Math.round(pve.stepProg * 100) / 100;
  if (st.prog !== prog) st.prog = prog;
  st.count = pve.count;
  st.countMax = pve.countMax;
  st.wave = pve.waveNumber;
  st.left = Math.min(65535, pve.waves.run ? pve.waves.remaining : 0);
  st.nextWave = pve.nextWaveTick;
  st.status = pve.status;
  st.power = pve.power;
  st.alarm = pve.alarm;
  st.vents = pve.ventStart;
  st.deadline = pve.deadline;
  const doors = pve.doorList;
  if (st.doors !== doors) st.doors = doors;
  const flags = formatIdList(pve.flags);
  if (st.flags !== flags) st.flags = flags;
  st.selfRevives = pve.selfRevives;
  st.kills = Math.min(65535, pve.kills);
  st.startTick = pve.startTick;
  st.boss = pve.bossId;
  for (const [id, p] of sim.players) {
    const s = state.players.get(id);
    if (!s) continue;
    if (s.downed !== p.pve.downed) s.downed = p.pve.downed;
    const bleed = p.pve.downed
      ? Math.max(0, Math.round(((p.pve.bleedUntil - sim.tick) / sim.tickRateHz) * 10))
      : 0;
    if (s.bleed !== bleed) s.bleed = Math.min(65535, bleed);
    const rv = Math.round(p.pve.reviveProg * 100) / 100;
    if (s.revive !== rv) s.revive = rv;
    if (s.revives !== p.pve.revives) s.revives = Math.min(255, p.pve.revives);
  }
}

/** Enemies of a zombie world into the synchronized state (Outbreak, Survival, Horror Maze). */
function syncZombies(state: MatchState, zw: ZombieWorld, tickRateHz: number): void {
  const zs = state.zombies;
  for (const id of [...zs.keys()]) {
    const z = zw.zombies.get(id);
    if (!z || z.dead) zs.delete(id);
  }
  for (const z of zw.zombies.values()) {
    if (z.dead) continue;
    let s = zs.get(z.id);
    if (!s) {
      s = new ZombieState();
      s.k = z.def.index;
      s.mhp = Math.min(65535, z.maxHp);
      zs.set(z.id, s);
    }
    const x = Math.round(z.x);
    const y = Math.round(z.y);
    if (s.x !== x) s.x = x;
    if (s.y !== y) s.y = y;
    const a = ((Math.round((z.angle / (Math.PI * 2)) * 256) % 256) + 256) % 256;
    if (s.a !== a) s.a = a;
    if (s.hp !== z.hp) s.hp = Math.min(65535, z.hp);
    if (s.st !== z.state) s.st = z.state;
    if (s.act !== z.act || s.at !== z.actTick) {
      s.act = z.act;
      s.at = z.actTick;
      s.tx = Math.round(z.actX);
      s.ty = Math.round(z.actY);
      const cur = z.cur ?? z.def.attack;
      s.ak = Math.max(0, ATTACK_KINDS.indexOf(cur.kind));
      s.aw = Math.min(65535, Math.max(1, Math.round(cur.windupSec * tickRateHz)));
      s.ar = Math.min(255, Math.round(cur.radius ?? 0));
    }
  }
}
