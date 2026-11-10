import {
  bodyFits,
  objectivesFor,
  PURSUIT,
  VEHICLES,
  type Vec2,
  type VehicleSpawnDef,
} from "@scrapline/shared";
import { type GameSimulation, VEHICLE_READY } from "../simulation/GameSimulation.ts";
import type { MarkData } from "./ModeController.ts";
import { TeamRoundMode } from "./TeamRounds.ts";

/**
 * Vehicle Pursuit and Convoy. The attacking team (runners / escorts) crosses the map from its own
 * side: the centre, then the far side's point, then the destination by the other team's base.
 * Pursuit: any runner reaching each checkpoint in turn (on foot or driving) moves the route on;
 * reaching the destination wins the round. Convoy: the same route, but only the armored truck
 * (parked on the escorts' side) counts, and the interceptors win by wrecking it. The interceptors
 * also win when the round clock runs out. Respawns after 4 s; sides swap every round.
 */
export class PursuitMode extends TeamRoundMode {
  override readonly vehicles = true;
  protected readonly prepSec = PURSUIT.prepSec;
  protected readonly liveSec: number;
  protected readonly breakSec = PURSUIT.breakSec;
  protected readonly swapEveryRound = true;
  protected readonly attackVerb: string;
  checkpoints: Vec2[] = [];
  goal: Vec2 = { x: 0, y: 0 };
  next = 0;
  /** Convoy: id of the escorted vehicle this round. */
  truckId: string | null = null;
  private truckKind: VehicleSpawnDef["kind"] = "armored";

  constructor(
    sim: GameSimulation,
    readonly mode: "pursuit" | "convoy",
  ) {
    super(sim);
    this.liveSec = mode === "convoy" ? PURSUIT.convoyRoundSec : PURSUIT.roundSec;
    this.attackVerb = mode === "convoy" ? "escort the truck" : "run";
  }

  override reset(): void {
    super.reset();
    // Round 1's truck replaces a parked vehicle: rebuild the vehicles now that it is chosen.
    this.sim.resetVehicles();
  }

  override respawnDelay(): number {
    return PURSUIT.respawnSec;
  }

  protected override onRoundStart(): void {
    const o = objectivesFor(this.sim.map);
    const by = (id: string) => o.points.find((p) => p.id === id) ?? o.points[1]!;
    const far = this.attackTeam === 1 ? by("C") : by("A");
    this.checkpoints = [by("B"), far].map((p) => ({ x: p.x, y: p.y }));
    this.goal = { ...o.flags[this.defendTeam] };
    this.next = 0;
    this.truckId = null;
    if (this.mode === "convoy") this.chooseTruck(o.flags[this.attackTeam]);
  }

  /** The parked ground vehicle nearest to the escorts' base becomes the (armored) truck. */
  private chooseTruck(start: Vec2): void {
    const ground = (this.sim.map.vehicleSpawns ?? []).filter((v) => v.kind !== "heli");
    let best: VehicleSpawnDef | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const v of ground) {
      const d = (v.x - start.x) ** 2 + (v.y - start.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    this.truckId = best.id;
    this.truckKind = bodyFits(this.sim.world, best, VEHICLES.armored) ? "armored" : best.kind;
  }

  override vehicleSpawns(): readonly VehicleSpawnDef[] | null {
    const list = this.sim.map.vehicleSpawns ?? [];
    if (this.mode !== "convoy" || !this.truckId) return null;
    return list.map((v) => (v.id === this.truckId ? { ...v, kind: this.truckKind } : v));
  }

  private target(): Vec2 {
    return this.next < this.checkpoints.length ? this.checkpoints[this.next]! : this.goal;
  }

  protected liveTick(): void {
    const target = this.target();
    const atGoal = this.next >= this.checkpoints.length;
    const r = atGoal ? PURSUIT.goalRadius : PURSUIT.checkpointRadius;
    let carriers: Vec2[];
    if (this.mode === "convoy") {
      const truck = this.truckId ? this.sim.vehicles.get(this.truckId) : undefined;
      if (!truck || truck.status !== VEHICLE_READY) {
        this.endRound(this.defendTeam, "The truck was wrecked");
        return;
      }
      carriers = [{ x: truck.sim.x, y: truck.sim.y }];
    } else carriers = this.teamPlayers(this.attackTeam).map((p) => ({ x: p.sim.x, y: p.sim.y }));
    if (carriers.some((c) => (c.x - target.x) ** 2 + (c.y - target.y) ** 2 <= r * r)) {
      if (atGoal) {
        this.endRound(
          this.attackTeam,
          this.mode === "convoy" ? "The truck got through" : "Destination reached",
        );
        return;
      }
      this.next++;
      this.emit({
        t: "announce",
        s: `Checkpoint ${this.next}/${this.checkpoints.length}`,
        d: "",
        w: this.attackTeam,
      });
    }
    if (this.sim.tick >= this.stageEnd) this.endRound(this.defendTeam, "Time ran out");
  }

  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    if (this.stage === "") return out;
    this.checkpoints.forEach((c, i) => {
      if (i < this.next) return;
      out.set(`cp-${i}`, {
        k: "checkpoint",
        x: c.x,
        y: c.y,
        r: PURSUIT.checkpointRadius,
        c: this.attackTeam,
        p: i === this.next ? 100 : 0,
        l: `Checkpoint ${i + 1}`,
        a: "",
      });
    });
    out.set("goal", {
      k: "goal",
      x: this.goal.x,
      y: this.goal.y,
      r: PURSUIT.goalRadius,
      c: this.attackTeam,
      p: this.next >= this.checkpoints.length ? 100 : 0,
      l: "Destination",
      a: "",
    });
    const truck = this.truckId ? this.sim.vehicles.get(this.truckId) : undefined;
    if (truck && truck.status === VEHICLE_READY)
      out.set("truck", {
        k: "truck",
        x: truck.sim.x,
        y: truck.sim.y,
        r: 70,
        c: this.attackTeam,
        p: (truck.hp / truck.def.maxHp) * 100,
        l: "Convoy truck",
        a: "",
      });
    return out;
  }

  override statusText(): string {
    const head = this.roundLine();
    if (this.stage !== "hunt") return head;
    const n = this.checkpoints.length;
    return this.next >= n ? `${head} · to the destination` : `${head} · checkpoint ${this.next + 1}/${n}`;
  }
}
