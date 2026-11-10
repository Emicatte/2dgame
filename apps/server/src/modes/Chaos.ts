import {
  CHAOS,
  type ChaosRule,
  emptySlot,
  fullSlot,
  type PickupKind,
  PLAYER,
  SECONDARY_WEAPON,
  type WeaponSlotState,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode } from "./ModeController.ts";

/**
 * Chaos Arena: a free-for-all (score limit in eliminations) whose rule changes every 30–45 s.
 * A rule may scale damage, hand everybody the same weapon, heal on hit, regenerate health or give
 * shields. When a weapon rule ends, everybody gets back what they carried before it.
 */
export class ChaosMode extends BaseMode {
  readonly mode = "chaos" as const;
  override readonly usesScoreLimit = true;
  rule: ChaosRule | null = null;
  ruleEnd = 0;
  private lastRule = -1;
  /** Weapons carried when a weapon rule started, given back when it ends. */
  private readonly saved = new Map<string, { slots: WeaponSlotState[]; slot: number }>();

  override reset(): void {
    this.rule = null;
    this.ruleEnd = 0;
    this.lastRule = -1;
    this.saved.clear();
  }

  override pickupAllowed(kind: PickupKind): boolean {
    // While everybody holds the same weapon, nothing on the map replaces it.
    return !(this.rule?.weapon && (kind === "weapon" || kind === "chest"));
  }

  override onSpawn(p: ServerPlayer): void {
    if (this.rule?.weapon) this.equipRule(p, this.rule);
    if (this.rule?.shield) p.shield = this.rule.shield;
  }

  override damageScale(_attacker: ServerPlayer | null, _target: ServerPlayer): number {
    return this.rule?.damage ?? 1;
  }

  override onDamage(target: ServerPlayer, attacker: ServerPlayer | null, dmg: number): void {
    const share = this.rule?.vampire;
    if (!share || !attacker || attacker === target || !attacker.alive) return;
    attacker.hp = Math.min(PLAYER.maxHealth, attacker.hp + Math.round(dmg * share));
  }

  override step(): void {
    const tick = this.sim.tick;
    if (this.ruleEnd === 0 || tick >= this.ruleEnd) this.nextRule();
    const regen = this.rule?.regen;
    if (regen && tick % this.sim.tickRateHz === 0)
      for (const p of this.players())
        if (p.alive && p.hp < PLAYER.maxHealth) p.hp = Math.min(PLAYER.maxHealth, p.hp + regen);
  }

  private nextRule(): void {
    const rules = CHAOS.rules;
    let i = Math.floor(this.sim.rng() * rules.length);
    if (i === this.lastRule) i = (i + 1) % rules.length;
    this.lastRule = i;
    const prev = this.rule;
    const next = rules[i]!;
    this.rule = next;
    const len = CHAOS.minSec + this.sim.rng() * (CHAOS.maxSec - CHAOS.minSec);
    this.ruleEnd = this.sim.tick + this.sim.secToTicks(len);
    for (const p of this.players()) {
      if (!p.alive) continue;
      if (prev?.weapon && !next.weapon) this.restore(p);
      if (next.weapon) {
        if (!prev?.weapon)
          this.saved.set(p.id, { slots: p.sim.slots.map((s) => ({ ...s })), slot: p.sim.slot });
        this.equipRule(p, next);
      }
      if (next.shield) p.shield = Math.max(p.shield, next.shield);
    }
    if (!next.weapon) this.saved.clear();
    this.emit({ t: "announce", s: next.name, d: next.sub });
  }

  private equipRule(p: ServerPlayer, rule: ChaosRule): void {
    if (!rule.weapon) return;
    const slot = fullSlot(rule.weapon);
    slot.reserve = -1;
    p.sim.slots = [slot, emptySlot(), emptySlot()];
    p.sim.slot = 0;
    p.sim.reload = 0;
    p.sim.swap = 0;
  }

  /** Back to what the player carried before the weapon rule (or the loadout if they respawned). */
  private restore(p: ServerPlayer): void {
    const s = this.saved.get(p.id);
    p.sim.slots = s
      ? s.slots.map((x) => ({ ...x }))
      : [fullSlot(p.primary), fullSlot(SECONDARY_WEAPON), emptySlot()];
    p.sim.slot = s?.slot ?? 0;
    p.sim.reload = 0;
    p.sim.swap = 0;
  }

  override leaderScore(): number {
    let max = 0;
    for (const p of this.players()) max = Math.max(max, p.stats.kills);
    return max;
  }

  override statusText(): string {
    return this.rule ? `${this.rule.name} · ${this.rule.sub}` : "";
  }
}
