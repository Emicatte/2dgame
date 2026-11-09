import {
  emptySlot,
  fullSlot,
  GUN_GAME,
  gunGameWeapon,
  type MatchState,
  type PickupKind,
  secToSteps,
  WEAPONS,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode, type ModeFacts } from "./ModeController.ts";

/**
 * Gun Game: free-for-all on a weapon ladder. Every elimination moves the killer to the next weapon;
 * an elimination with the final weapon wins. Killed by somebody behind you on the ladder: back one
 * level. Vehicles and weapon pickups are off (they would let players skip the ladder).
 */
export class GunGameMode extends BaseMode {
  readonly mode = "gungame" as const;
  private readonly level = new Map<string, number>();
  private winner: string | null = null;
  private inOvertime = false;

  get finalLevel(): number {
    return GUN_GAME.ladder.length - 1;
  }

  levelOf(p: ServerPlayer): number {
    return this.level.get(p.id) ?? 0;
  }

  override pickupAllowed(kind: PickupKind): boolean {
    return kind === "health";
  }

  override reset(): void {
    this.level.clear();
    this.winner = null;
    this.inOvertime = false;
  }

  override onSpawn(p: ServerPlayer): void {
    if (!this.level.has(p.id)) this.level.set(p.id, 0);
    this.equip(p, false);
    p.protectedUntil = this.sim.tick + this.sim.secToTicks(GUN_GAME.spawnProtectionSec);
  }

  /** The ladder weapon only, with an endless reserve (no ammo hunting between levels). */
  private equip(p: ServerPlayer, draw: boolean): void {
    const def = WEAPONS[gunGameWeapon(this.levelOf(p))];
    const slot = fullSlot(def.id);
    slot.reserve = -1;
    const s = p.sim;
    s.slots = [slot, emptySlot(), emptySlot()];
    s.slot = 0;
    s.reload = 0;
    s.bloom = 0;
    s.swap = draw ? secToSteps(def.swapSec) : 0;
  }

  override respawnDelay(_victim: ServerPlayer, _killer: ServerPlayer | null): number {
    return GUN_GAME.respawnSec;
  }

  override onKill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    if (!killer || killer === victim || this.winner) return;
    const kl = this.levelOf(killer);
    // Only the ladder weapon advances (there is nothing else to hold, but stay strict).
    if (weapon !== WEAPONS[gunGameWeapon(kl)].index) return;
    const vl = this.levelOf(victim);
    if (kl >= this.finalLevel) {
      this.winner = killer.id;
      return;
    }
    this.level.set(killer.id, kl + 1);
    this.emit({ t: "gg", p: killer.id, l: kl + 1 });
    if (killer.alive) this.equip(killer, true);
    if (GUN_GAME.demoteOnLowerKiller && kl < vl) {
      this.level.set(victim.id, vl - 1);
      this.emit({ t: "gg", p: victim.id, l: vl - 1, d: 1 });
    }
    // Overtime: the first player to stand alone on the top level wins.
    if (this.inOvertime && kl + 1 > this.secondBest(killer.id)) this.winner = killer.id;
  }

  private secondBest(exceptId: string): number {
    let best = -1;
    for (const p of this.players()) if (p.id !== exceptId) best = Math.max(best, this.levelOf(p));
    return best;
  }

  override over(): string | null {
    return this.winner ? "ladder" : null;
  }

  override overtime(): number {
    if (this.inOvertime || this.winner) return 0;
    const sorted = this.players()
      .map((p) => this.levelOf(p))
      .sort((a, b) => b - a);
    if (sorted.length >= 2 && sorted[0] === sorted[1]) {
      this.inOvertime = true;
      return GUN_GAME.overtimeSec;
    }
    return 0;
  }

  get overtimeActive(): boolean {
    return this.inOvertime;
  }

  override standings(): ServerPlayer[] {
    return this.players().sort(
      (a, b) =>
        Number(b.id === this.winner) - Number(a.id === this.winner) ||
        this.levelOf(b) - this.levelOf(a) ||
        b.stats.kills - a.stats.kills ||
        a.stats.deaths - b.stats.deaths ||
        a.stats.lastKillTick - b.stats.lastKillTick ||
        a.joinedTick - b.joinedTick,
    );
  }

  override leaderScore(): number {
    let max = 0;
    for (const p of this.players()) max = Math.max(max, this.levelOf(p) + 1);
    return max;
  }

  override facts(p: ServerPlayer): ModeFacts {
    const level = this.levelOf(p);
    const won = this.standings()[0]?.id === p.id && this.players().length >= 2;
    return {
      points: level + 1,
      gunGameLevels: level,
      extra: { gungameLevels: level, ...(won ? { gungameWins: 1 } : {}) },
    };
  }

  override sync(state: MatchState): void {
    const stage = this.inOvertime ? "overtime" : "";
    if (state.round.stage !== stage) state.round.stage = stage;
    for (const [id, p] of this.sim.players) {
      const ps = state.players.get(id);
      if (!ps) continue;
      const l = this.levelOf(p);
      if (ps.gg !== l) ps.gg = l;
    }
  }
}
