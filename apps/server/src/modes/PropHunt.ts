import {
  type AbilityMessage,
  type Circle,
  DEG,
  DISGUISES,
  type DisguiseDef,
  disguiseByName,
  disguiseDef,
  type HitTarget,
  isFreeSpot,
  type MatchState,
  type NetEvent,
  PingState,
  PLAYER,
  PROP_HUNT,
  ROLE,
  type RoleId,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import type { AllyData, ModeFacts, ObjectData, ObjectHit } from "./ModeController.ts";
import { RoundMode } from "./RoundMode.ts";

/** A Prop Hunt object: a real object of the map, a decoy, or a disguised player. */
export interface PropObject {
  id: string;
  k: number;
  x: number;
  y: number;
  rot: number;
  /** Player controlling it (null: a real object or a decoy). */
  owner: string | null;
  /** Decoys disappear at this tick (0: not a decoy). */
  decoyUntil: number;
}

interface Ping {
  x: number;
  y: number;
  r: number;
  until: number;
}

/**
 * Prop Hunt. Props turn into objects present on the map; hunters wait blindfolded, then search
 * with shotguns. Real objects and disguised players are the same kind of entity on the wire,
 * with random ids rebuilt (and reshuffled) when the hunt starts; a prop's player body is never
 * published. Hunters lose health for every shot that only hits innocent objects. Hints narrow
 * down the last props; a prop that stands still too long gets its own approximate ping.
 */
export class PropHuntMode extends RoundMode {
  readonly mode = "prophunt" as const;
  protected readonly timing = PROP_HUNT;
  protected readonly seekerShare = PROP_HUNT.playersPerHunter;
  protected readonly seekerWeapons = PROP_HUNT.hunterWeapons;
  protected readonly surviveBonus = PROP_HUNT.points.survive;
  protected readonly findPoints = PROP_HUNT.points.find;

  readonly objects = new Map<string, PropObject>();
  /** Player id → id of the object they control. */
  readonly disguise = new Map<string, string>();
  private readonly locked = new Set<string>();
  private readonly cdTransform = new Map<string, number>();
  private readonly cdTaunt = new Map<string, number>();
  private readonly cdDecoy = new Map<string, number>();
  private readonly lastMove = new Map<string, { x: number; y: number; tick: number }>();
  private readonly aliveTicks = new Map<string, number>();
  private readonly alivePaid = new Map<string, number>();
  private readonly pings = new Map<string, Ping>();
  private hintsDone = 0;
  private huntStart = 0;
  private pingSeq = 0;

  /** Kinds a prop may turn into: those present on this map. */
  get kinds(): DisguiseDef[] {
    const present = new Set((this.sim.map.party?.props ?? []).map((p) => p.kind));
    return DISGUISES.filter((d) => present.has(d.kind));
  }

  private randomId(): string {
    let id = "";
    do {
      id = Math.floor(this.sim.rng() * 36 ** 6)
        .toString(36)
        .padStart(6, "0");
    } while (this.objects.has(id));
    return id;
  }

  kindOf(p: ServerPlayer): DisguiseDef | undefined {
    const o = this.objectOf(p);
    return o ? disguiseDef(o.k) : undefined;
  }

  objectOf(p: ServerPlayer): PropObject | undefined {
    const id = this.disguise.get(p.id);
    return id ? this.objects.get(id) : undefined;
  }

  // ------------------------------------------------------------------ rounds

  override reset(): void {
    this.alivePaid.clear();
    this.aliveTicks.clear();
    super.reset();
  }

  protected override onRoundStart(): void {
    this.objects.clear();
    this.disguise.clear();
    this.locked.clear();
    this.cdTransform.clear();
    this.cdTaunt.clear();
    this.cdDecoy.clear();
    this.lastMove.clear();
    this.pings.clear();
    this.hintsDone = 0;
    // Most spots get a real object, slightly moved and turned: a round never looks exactly like
    // the map file, so an object "off its spot" is not proof of a player.
    for (const spot of this.sim.map.party?.props ?? []) {
      if (this.sim.rng() > PROP_HUNT.spotFill) continue;
      const def = disguiseByName(spot.kind);
      if (!def) continue;
      let x = spot.x + (this.sim.rng() * 2 - 1) * 12;
      let y = spot.y + (this.sim.rng() * 2 - 1) * 12;
      if (!isFreeSpot(this.sim.world, { x, y }, def.radius) || this.overlaps(x, y, def.radius, null)) {
        x = spot.x;
        y = spot.y;
      }
      const id = this.randomId();
      this.objects.set(id, {
        id,
        k: def.index,
        x,
        y,
        rot: (spot.rot ?? 0) * DEG + (this.sim.rng() * 2 - 1) * 0.35,
        owner: null,
        decoyUntil: 0,
      });
    }
  }

  protected override onHuntStart(): void {
    this.huntStart = this.sim.tick;
    // Nobody hunts a person: an undisguised prop becomes a random object it fits as.
    for (const p of this.aliveSide(ROLE.HIDER)) {
      if (this.disguise.has(p.id)) continue;
      const kinds = [...this.kinds].sort((a, b) => a.radius - b.radius);
      const pick = kinds[Math.floor(this.sim.rng() * kinds.length)] ?? kinds[0];
      if (pick && !this.setDisguise(p, pick, true)) {
        for (const k of kinds) if (this.setDisguise(p, k, true)) break;
      }
    }
    // Fresh ids in a shuffled order: hunters receive every object at once and nothing (not even
    // the order of the entries) tells the map's objects from the players.
    const all = [...this.objects.values()];
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(this.sim.rng() * (i + 1));
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    this.objects.clear();
    this.disguise.clear();
    for (const o of all) {
      const id = this.randomId();
      const fresh = { ...o, id };
      this.objects.set(id, fresh);
      if (o.owner) this.disguise.set(o.owner, id);
    }
  }

  // ------------------------------------------------------------------ bodies and movement

  override onSpawn(p: ServerPlayer): void {
    super.onSpawn(p);
    p.hp = PLAYER.maxHealth;
  }

  override frozen(p: ServerPlayer): boolean {
    return super.frozen(p) || this.locked.has(p.id);
  }

  override body(p: ServerPlayer): { radius: number; speed: number } | null {
    const def = this.kindOf(p);
    return def ? { radius: def.radius, speed: def.speed } : null;
  }

  /** Object bodies, rebuilt once per tick (every player's input frames share them). */
  private bodies: { tick: number; list: (Circle & { id: string })[] } = { tick: -1, list: [] };

  override obstacles(p: ServerPlayer): Circle[] {
    if (this.bodies.tick !== this.sim.tick) {
      const list: (Circle & { id: string })[] = [];
      for (const o of this.objects.values())
        list.push({ id: o.id, x: o.x, y: o.y, r: disguiseDef(o.k)?.radius ?? 16 });
      this.bodies = { tick: this.sim.tick, list };
    }
    const own = this.disguise.get(p.id);
    return own ? this.bodies.list.filter((b) => b.id !== own) : this.bodies.list;
  }

  private overlaps(x: number, y: number, r: number, except: string | null): boolean {
    for (const o of this.objects.values()) {
      if (o.id === except) continue;
      const rr = r + (disguiseDef(o.k)?.radius ?? 16);
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < rr * rr) return true;
    }
    return false;
  }

  /** Objects follow their players; decoys and pings expire; still props are tracked. */
  private updateObjects(): void {
    const tick = this.sim.tick;
    for (const [pid, oid] of [...this.disguise]) {
      const p = this.sim.players.get(pid);
      const o = this.objects.get(oid);
      if (!p || !o) {
        this.disguise.delete(pid);
        continue;
      }
      o.x = p.sim.x;
      o.y = p.sim.y;
      if (!this.locked.has(pid)) o.rot = p.sim.aim;
    }
    for (const o of [...this.objects.values()])
      if (o.decoyUntil > 0 && tick >= o.decoyUntil) this.objects.delete(o.id);
    for (const [id, ping] of [...this.pings]) if (tick >= ping.until) this.pings.delete(id);
  }

  override step(): void {
    super.step();
    this.updateObjects();
  }

  /**
   * Disguises `p` as `def` where they stand. Refused when the object would not fit there (a
   * vending machine cannot appear in a gap a chair fills).
   */
  private setDisguise(p: ServerPlayer, def: DisguiseDef, auto = false): boolean {
    const own = this.disguise.get(p.id) ?? null;
    if (!isFreeSpot(this.sim.world, { x: p.sim.x, y: p.sim.y }, def.radius)) return false;
    if (this.overlaps(p.sim.x, p.sim.y, def.radius, own)) return false;
    const prev = this.kindOf(p);
    const prevMax = prev?.health ?? PLAYER.maxHealth;
    p.hp = Math.max(1, Math.min(255, Math.round((p.hp / prevMax) * def.health)));
    if (own) {
      const o = this.objects.get(own)!;
      o.k = def.index;
    } else {
      const id = this.randomId();
      this.objects.set(id, {
        id,
        k: def.index,
        x: p.sim.x,
        y: p.sim.y,
        rot: p.sim.aim,
        owner: p.id,
        decoyUntil: 0,
      });
      this.disguise.set(p.id, id);
    }
    if (!auto) this.locked.delete(p.id);
    this.lastMove.set(p.id, { x: p.sim.x, y: p.sim.y, tick: this.sim.tick });
    this.bodies.tick = -1;
    return true;
  }

  private deny(p: ServerPlayer, s: string): void {
    this.emit({ t: "msg", p: p.id, s });
  }

  override ability(p: ServerPlayer, msg: AbilityMessage): void {
    const refused = this.useAbility(p, msg);
    if (refused) this.deny(p, refused);
  }

  /** Applies an ability; returns why it was refused (told to the player), or null. */
  private useAbility(p: ServerPlayer, msg: AbilityMessage): string | null {
    if (this.sideOf(p.id) !== ROLE.HIDER || !p.alive) return null;
    if (this.stage !== "prep" && this.stage !== "hunt") return null;
    const tick = this.sim.tick;
    const hunting = this.stage === "hunt";
    switch (msg.a) {
      case "transform": {
        let def: DisguiseDef | undefined;
        if (msg.k !== undefined) {
          def = this.kinds.find((k) => k.index === msg.k);
          if (!def) return "That object is not on this map";
        } else {
          def = this.objectInFront(p);
          if (!def) return "Look at an object to copy it";
        }
        if (this.kindOf(p)?.index === def.index) return null;
        if (hunting && this.disguise.has(p.id) && tick < (this.cdTransform.get(p.id) ?? 0))
          return "Quick transform is recharging";
        if (!this.setDisguise(p, def)) return `No room for a ${def.name.toLowerCase()} here`;
        if (hunting) this.cdTransform.set(p.id, tick + this.tickOf(PROP_HUNT.quickTransformCooldownSec));
        return null;
      }
      case "lock": {
        if (!this.disguise.has(p.id)) return "Transform first";
        if (this.locked.has(p.id)) this.locked.delete(p.id);
        else this.locked.add(p.id);
        return null;
      }
      case "taunt": {
        if (!hunting) return null;
        if (tick < (this.cdTaunt.get(p.id) ?? 0)) return "Taunt is recharging";
        this.cdTaunt.set(p.id, tick + this.tickOf(PROP_HUNT.tauntCooldownSec));
        this.emit({
          t: "taunt",
          x: Math.round(p.sim.x),
          y: Math.round(p.sim.y),
          v: Math.floor(this.sim.rng() * 4),
        });
        this.addPoints(p, PROP_HUNT.points.taunt);
        return null;
      }
      case "decoy": {
        if (!hunting) return null;
        const def = this.kindOf(p);
        if (!def) return "Transform first";
        if (tick < (this.cdDecoy.get(p.id) ?? 0)) return "Decoy is recharging";
        const spot = this.freeSpotNear(p, def.radius);
        if (!spot) return "No room for a decoy here";
        this.cdDecoy.set(p.id, tick + this.tickOf(PROP_HUNT.decoyCooldownSec));
        const id = this.randomId();
        this.objects.set(id, {
          id,
          k: def.index,
          x: spot.x,
          y: spot.y,
          rot: p.sim.aim,
          owner: null,
          decoyUntil: tick + this.tickOf(PROP_HUNT.decoySec),
        });
        return null;
      }
    }
    return null;
  }

  /** The object (real or not) the prop is looking at within reach: copy its kind. */
  private objectInFront(p: ServerPlayer): DisguiseDef | undefined {
    const own = this.disguise.get(p.id);
    let best: { d: number; k: number } | null = null;
    for (const o of this.objects.values()) {
      if (o.id === own) continue;
      const dx = o.x - p.sim.x;
      const dy = o.y - p.sim.y;
      const d = Math.hypot(dx, dy);
      if (d > PROP_HUNT.copyReach + (disguiseDef(o.k)?.radius ?? 0)) continue;
      const diff = Math.abs(
        Math.atan2(Math.sin(Math.atan2(dy, dx) - p.sim.aim), Math.cos(Math.atan2(dy, dx) - p.sim.aim)),
      );
      if (diff > 70 * DEG) continue;
      if (!best || d < best.d) best = { d, k: o.k };
    }
    const def = best ? disguiseDef(best.k) : undefined;
    return def && this.kinds.some((k) => k.index === def.index) ? def : undefined;
  }

  private freeSpotNear(p: ServerPlayer, r: number): { x: number; y: number } | null {
    const own = this.disguise.get(p.id) ?? null;
    const dist = r * 2 + 6;
    for (let i = 0; i < 8; i++) {
      const a = p.sim.aim + Math.PI + (i * Math.PI) / 4;
      const x = p.sim.x + Math.cos(a) * dist;
      const y = p.sim.y + Math.sin(a) * dist;
      if (!isFreeSpot(this.sim.world, { x, y }, r)) continue;
      if (this.overlaps(x, y, r, own)) continue;
      return { x, y };
    }
    return null;
  }

  // ------------------------------------------------------------------ shooting

  override playerTargetable(p: ServerPlayer): boolean {
    // A prop's body is never hit directly: shots meet its object (or, undisguised, nothing during
    // the prep, when hunters cannot fire anyway).
    return this.sideOf(p.id) !== ROLE.HIDER;
  }

  override shotTargets(_shooter: ServerPlayer, viewTick: number): HitTarget[] {
    const out: HitTarget[] = [];
    for (const o of this.objects.values()) {
      let x = o.x;
      let y = o.y;
      if (o.owner) {
        const seen = this.sim.playerPoseAt(o.owner, viewTick);
        if (seen?.alive) {
          x = seen.x;
          y = seen.y;
        }
      }
      out.push({ id: `d:${o.id}`, x, y, r: disguiseDef(o.k)?.radius ?? 16 });
    }
    return out;
  }

  override onObjectHits(shooter: ServerPlayer, hits: ObjectHit[]): void {
    const weapon = shooter.sim.slots[shooter.sim.slot]?.id ?? 0;
    let found = false;
    for (const h of hits) {
      const o = this.objects.get(h.id);
      if (!o) continue;
      this.emit({ t: "dhit", d: o.id, x: Math.round(h.x), y: Math.round(h.y) });
      const owner = o.owner ? this.sim.players.get(o.owner) : undefined;
      if (owner?.alive) {
        found = true;
        this.sim.damageFromMode(owner, h.dmg, shooter, weapon, h.x, h.y);
      }
    }
    if (!found && this.sideOf(shooter.id) === ROLE.SEEKER && shooter.alive) {
      this.emit({ t: "penalty", p: shooter.id, dmg: PROP_HUNT.innocentPenalty });
      this.sim.damageFromMode(shooter, PROP_HUNT.innocentPenalty, null, weapon, shooter.sim.x, shooter.sim.y);
    }
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    const wasProp = this.sideOf(victim.id) === ROLE.HIDER;
    super.onKill(victim, killer, weapon);
    if (!wasProp) return;
    const oid = this.disguise.get(victim.id);
    if (oid) this.objects.delete(oid);
    this.disguise.delete(victim.id);
    this.locked.delete(victim.id);
    if (killer?.alive && this.sideOf(killer.id) === ROLE.SEEKER)
      killer.hp = Math.min(PLAYER.maxHealth, killer.hp + PROP_HUNT.findHeal);
  }

  override onLeave(p: ServerPlayer): void {
    const oid = this.disguise.get(p.id);
    if (oid) this.objects.delete(oid);
    this.disguise.delete(p.id);
    this.locked.delete(p.id);
    super.onLeave(p);
  }

  // ------------------------------------------------------------------ hunt: points and hints

  protected override huntTick(): void {
    const tick = this.sim.tick;
    const every = this.tickOf(PROP_HUNT.points.aliveEverySec);
    for (const p of this.aliveSide(ROLE.HIDER)) {
      const t = (this.aliveTicks.get(p.id) ?? 0) + 1;
      this.aliveTicks.set(p.id, t);
      const units = Math.floor(t / every);
      const paid = this.alivePaid.get(p.id) ?? 0;
      if (units > paid) {
        this.addPoints(p, (units - paid) * PROP_HUNT.points.alive);
        this.alivePaid.set(p.id, units);
      }
      // Standing still: tracked from the last real move.
      const m = this.lastMove.get(p.id);
      if (!m || Math.hypot(p.sim.x - m.x, p.sim.y - m.y) > PROP_HUNT.stillPx) {
        this.lastMove.set(p.id, { x: p.sim.x, y: p.sim.y, tick });
      } else if (tick - m.tick >= this.tickOf(PROP_HUNT.stillSec)) {
        this.ping(p, PROP_HUNT.stillPingRadius);
        this.lastMove.set(p.id, { x: p.sim.x, y: p.sim.y, tick });
      }
    }
    const next = PROP_HUNT.hints[this.hintsDone];
    if (next && tick - this.huntStart >= this.tickOf(next.atSec)) {
      this.hintsDone++;
      for (const p of this.aliveSide(ROLE.HIDER)) this.ping(p, next.radius);
      this.emit({ t: "hint", n: this.hintsDone });
    }
  }

  /** An approximate area that contains the prop, never centred on it. */
  private ping(p: ServerPlayer, radius: number): void {
    const a = this.sim.rng() * Math.PI * 2;
    const off = radius * (0.25 + this.sim.rng() * 0.3);
    this.pings.set(`h${++this.pingSeq}`, {
      x: p.sim.x + Math.cos(a) * off,
      y: p.sim.y + Math.sin(a) * off,
      r: radius,
      until: this.sim.tick + this.tickOf(PROP_HUNT.hintSec),
    });
  }

  // ------------------------------------------------------------------ hidden information

  protected override exposable(_h: ServerPlayer): boolean {
    return false;
  }

  protected override alwaysGhost(p: ServerPlayer): boolean {
    return p.alive;
  }

  protected override allyData(p: ServerPlayer): AllyData {
    const o = this.objectOf(p);
    return {
      x: p.sim.x,
      y: p.sim.y,
      a: p.sim.aim,
      t: ROLE.HIDER,
      d: o?.id ?? "",
      k: o ? o.k : -1,
      lk: this.locked.has(p.id),
      cdT: this.stage === "hunt" ? (this.cdTransform.get(p.id) ?? 0) : 0,
      cdS: this.cdTaunt.get(p.id) ?? 0,
      cdD: this.cdDecoy.get(p.id) ?? 0,
    };
  }

  override canSeeObjects(viewerId: string): boolean {
    if (this.sideOf(viewerId) === ROLE.HIDER) return true;
    return this.stage !== "prep";
  }

  override eventVisible(viewerId: string, ev: NetEvent): boolean {
    if (ev.t === "hit") {
      // A hit on a prop tells who that object is: only the shooter and the prop's side learn it.
      const victim = this.sim.players.get(ev.v);
      if (victim && this.sideOf(victim.id) === ROLE.HIDER)
        return viewerId === ev.p || this.canSeeAlly(viewerId, ev.v);
      return true;
    }
    if (ev.t === "msg") return viewerId === ev.p;
    if (ev.t === "dhit" || ev.t === "taunt") return this.canSeeObjects(viewerId);
    return super.eventVisible(viewerId, ev);
  }

  override objectEntries(): Map<string, ObjectData> {
    const out = new Map<string, ObjectData>();
    for (const o of this.objects.values()) {
      const r = ((Math.round((o.rot / (Math.PI * 2)) * 256) % 256) + 256) % 256;
      out.set(o.id, { k: o.k, x: Math.round(o.x), y: Math.round(o.y), r });
    }
    return out;
  }

  protected override onRoundEnd(_winner: RoleId): void {
    this.locked.clear();
  }

  override facts(p: ServerPlayer): ModeFacts {
    const base = super.facts(p);
    const extra: Record<string, number> = {};
    if (base.roundsSurvived) extra.propRounds = base.roundsSurvived;
    if (base.finds) extra.propsFound = base.finds;
    if (this.standings()[0]?.id === p.id && this.players().length >= 2) extra.prophuntWins = 1;
    return { ...base, extra };
  }

  override sync(state: MatchState): void {
    super.sync(state);
    for (const id of [...state.pings.keys()]) if (!this.pings.has(id)) state.pings.delete(id);
    for (const [id, ping] of this.pings) {
      if (state.pings.has(id)) continue;
      const s = new PingState();
      s.x = Math.round(ping.x);
      s.y = Math.round(ping.y);
      s.r = Math.round(ping.r);
      s.until = ping.until;
      state.pings.set(id, s);
    }
  }
}
