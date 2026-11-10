import { objectivesFor, SABOTAGE, type Vec2 } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import type { MarkData, ModeFacts } from "./ModeController.ts";
import { TeamRoundMode } from "./TeamRounds.ts";

interface Site extends Vec2 {
  label: string;
}

/**
 * Sabotage: rounds of attack and defence with no respawns inside a round. The attackers plant the
 * device on site A or B (hold interact for 3 s inside the site); the defenders defuse it (5 s) before
 * the 35 s fuse runs out, or hold the sites until the round clock ends. Eliminating the other team
 * also wins the round (once planted, the defenders must still defuse). Sides swap at half time.
 * The sites are the two side capture points of the map (Domination A and C).
 */
export class SabotageMode extends TeamRoundMode {
  readonly mode = "sabotage" as const;
  protected readonly prepSec = SABOTAGE.prepSec;
  protected readonly liveSec = SABOTAGE.liveSec;
  protected readonly breakSec = SABOTAGE.breakSec;
  protected readonly swapEveryRound = false;
  protected readonly attackVerb = "attack";
  sites: Site[] = [];
  device: (Site & { end: number }) | null = null;
  private readonly planting = new Map<string, { site: string; ticks: number }>();
  private readonly defusing = new Map<string, number>();
  private readonly plants = new Map<string, number>();
  private readonly defuses = new Map<string, number>();

  override reset(): void {
    const pts = objectivesFor(this.sim.map).points;
    const a = pts.find((p) => p.id === "A") ?? pts[0]!;
    const c = pts.find((p) => p.id === "C") ?? pts[pts.length - 1]!;
    this.sites = [
      { label: "A", x: a.x, y: a.y },
      { label: "B", x: c.x, y: c.y },
    ];
    this.plants.clear();
    this.defuses.clear();
    super.reset();
  }

  protected override onRoundStart(): void {
    this.device = null;
    this.planting.clear();
    this.defusing.clear();
  }

  /** Out until the next round. */
  override respawnDelay(): number | null {
    return null;
  }

  override allowJoinSpawn(_p: ServerPlayer): boolean {
    return this.stage === "prep";
  }

  private within(p: ServerPlayer, at: Vec2, r: number): boolean {
    return (p.sim.x - at.x) ** 2 + (p.sim.y - at.y) ** 2 <= r * r;
  }

  protected liveTick(): void {
    const tick = this.sim.tick;
    const attackers = this.teamPlayers(this.attackTeam);
    const defenders = this.teamPlayers(this.defendTeam);
    if (!this.device) {
      for (const p of attackers) {
        const site = this.sites.find((s) => this.within(p, s, SABOTAGE.siteRadius));
        if (!site || !p.interact || p.vehicle) {
          this.planting.delete(p.id);
          continue;
        }
        const cur = this.planting.get(p.id);
        const ticks = cur?.site === site.label ? cur.ticks + 1 : 1;
        this.planting.set(p.id, { site: site.label, ticks });
        if (ticks >= this.tickOf(SABOTAGE.plantSec)) {
          this.plant(site, p);
          return;
        }
      }
      if (attackers.length === 0) this.endRound(this.defendTeam, "Attackers eliminated");
      else if (defenders.length === 0) this.endRound(this.attackTeam, "Defenders eliminated");
      else if (tick >= this.stageEnd) this.endRound(this.defendTeam, "The sites held");
      return;
    }
    const device = this.device;
    for (const p of defenders) {
      if (!p.interact || p.vehicle || !this.within(p, device, SABOTAGE.siteRadius * 0.6)) {
        this.defusing.delete(p.id);
        continue;
      }
      const ticks = (this.defusing.get(p.id) ?? 0) + 1;
      this.defusing.set(p.id, ticks);
      if (ticks >= this.tickOf(SABOTAGE.defuseSec)) {
        this.defuses.set(p.id, (this.defuses.get(p.id) ?? 0) + 1);
        this.endRound(this.defendTeam, "Device defused");
        this.device = null;
        return;
      }
    }
    if (tick >= device.end) {
      this.emit({ t: "boom", x: Math.round(device.x), y: Math.round(device.y), r: SABOTAGE.siteRadius });
      this.endRound(this.attackTeam, `Site ${device.label} destroyed`);
      this.device = null;
    } else if (defenders.length === 0) this.endRound(this.attackTeam, "Defenders eliminated");
  }

  private plant(site: Site, by: ServerPlayer): void {
    this.device = {
      label: site.label,
      x: by.sim.x,
      y: by.sim.y,
      end: this.sim.tick + this.tickOf(SABOTAGE.fuseSec),
    };
    this.stageEnd = this.device.end;
    this.planting.clear();
    this.plants.set(by.id, (this.plants.get(by.id) ?? 0) + 1);
    this.emit({
      t: "announce",
      s: `Device planted at ${site.label}`,
      d: `${SABOTAGE.fuseSec} s to defuse it`,
      w: this.attackTeam,
    });
  }

  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    if (this.stage === "") return out;
    const plantTicks = this.tickOf(SABOTAGE.plantSec);
    for (const s of this.sites) {
      let best = 0;
      for (const v of this.planting.values()) if (v.site === s.label) best = Math.max(best, v.ticks);
      out.set(`site-${s.label}`, {
        k: "site",
        x: s.x,
        y: s.y,
        r: SABOTAGE.siteRadius,
        c: this.attackTeam,
        p: (best / plantTicks) * 100,
        l: `Site ${s.label}`,
        a: this.stage === "hunt" && !this.device ? "Hold to plant the device" : "",
      });
    }
    if (this.device) {
      let best = 0;
      for (const v of this.defusing.values()) best = Math.max(best, v);
      const left = Math.max(0, Math.ceil((this.device.end - this.sim.tick) / this.sim.tickRateHz));
      out.set("device", {
        k: "device",
        x: this.device.x,
        y: this.device.y,
        r: Math.round(SABOTAGE.siteRadius * 0.6),
        c: this.defendTeam,
        p: (best / this.tickOf(SABOTAGE.defuseSec)) * 100,
        l: `Device · ${left} s`,
        a: "Hold to defuse the device",
      });
    }
    return out;
  }

  override statusText(): string {
    const head = this.roundLine();
    if (this.stage !== "hunt") return head;
    return this.device ? `${head} · device planted at ${this.device.label}` : `${head} · sites A and B`;
  }

  override facts(p: ServerPlayer): ModeFacts {
    const extra: Record<string, number> = {};
    const pl = this.plants.get(p.id) ?? 0;
    const df = this.defuses.get(p.id) ?? 0;
    if (pl) extra.plants = pl;
    if (df) extra.defuses = df;
    return { points: this.wins[p.team] ?? 0, extra };
  }
}
