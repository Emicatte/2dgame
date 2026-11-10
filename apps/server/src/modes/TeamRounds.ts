import { type MatchState, teamName } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode } from "./ModeController.ts";

type Team = 1 | 2;

/**
 * Rounds between the lobby teams (Sabotage, Vehicle Pursuit, Convoy): one team attacks (plants,
 * runs, escorts), the other defends; the attacking side swaps at half time or every round. A
 * round goes prep (everybody frozen) → hunt (the objective) → break (result banner). Rounds won
 * are the team score (MatchState.scoreA / scoreB). The match ends after the round count, or as
 * soon as a team has won more than half of the rounds.
 */
export abstract class TeamRoundMode extends BaseMode {
  rounds = 4;
  round = 0;
  stage: "" | "prep" | "hunt" | "break" = "";
  stageEnd = 0;
  attackTeam: Team = 1;
  readonly wins: [number, number, number] = [0, 0, 0];
  lastWinner = 0;
  protected matchDone = false;
  protected abstract readonly prepSec: number;
  protected abstract readonly liveSec: number;
  protected abstract readonly breakSec: number;
  /** The attacking side swaps every round (otherwise at half time). */
  protected abstract readonly swapEveryRound: boolean;
  /** Verb of the attacking side in the status line ("attack", "run", "escort the truck"). */
  protected abstract readonly attackVerb: string;

  get defendTeam(): Team {
    return this.attackTeam === 1 ? 2 : 1;
  }

  override configure(opts: { rounds: number; variant: string }): void {
    this.rounds = Math.max(1, Math.min(8, Math.round(opts.rounds)));
  }

  protected teamPlayers(team: number, aliveOnly = true): ServerPlayer[] {
    return this.players().filter((p) => p.team === team && (!aliveOnly || p.alive));
  }

  protected tickOf(sec: number): number {
    return this.sim.secToTicks(sec);
  }

  override reset(): void {
    this.wins[1] = 0;
    this.wins[2] = 0;
    this.sim.teamScores[1] = 0;
    this.sim.teamScores[2] = 0;
    this.round = 1;
    this.attackTeam = 1;
    this.matchDone = false;
    this.lastWinner = 0;
    this.stage = "prep";
    this.stageEnd = 0;
    this.onRoundStart();
  }

  /** New round state (objectives, route); players are (re)spawned by the caller. */
  protected onRoundStart(): void {}
  /** Every tick of the hunt stage: objectives and the win conditions (call endRound). */
  protected abstract liveTick(): void;

  private attackerOf(round: number): Team {
    if (this.swapEveryRound) return round % 2 === 1 ? 1 : 2;
    return round <= Math.ceil(this.rounds / 2) ? 1 : 2;
  }

  protected startRound(n: number): void {
    this.round = n;
    this.attackTeam = this.attackerOf(n);
    this.onRoundStart();
    for (const p of this.players()) {
      this.sim.leaveVehicle(p, true);
      p.alive = false;
      p.respawnTick = 0;
    }
    this.sim.resetVehicles();
    for (const p of this.players()) this.sim.spawn(p, true);
    this.stage = "prep";
    this.stageEnd = this.sim.tick + this.tickOf(this.prepSec);
    if (this.round === Math.ceil(this.rounds / 2) + 1 && !this.swapEveryRound)
      this.emit({ t: "announce", s: "Half time", d: "Sides swap" });
  }

  protected endRound(winner: Team, why: string): void {
    if (this.stage !== "hunt") return;
    this.wins[winner]++;
    this.sim.teamScores[winner] = this.wins[winner];
    this.lastWinner = winner;
    this.emit({ t: "announce", s: `${teamName(winner)} win the round`, d: why, w: winner });
    this.stage = "break";
    this.stageEnd = this.sim.tick + this.tickOf(this.breakSec);
  }

  override step(): void {
    const tick = this.sim.tick;
    if (this.stageEnd === 0 && this.stage === "prep") this.stageEnd = tick + this.tickOf(this.prepSec);
    switch (this.stage) {
      case "prep":
        if (tick >= this.stageEnd) {
          this.stage = "hunt";
          this.stageEnd = tick + this.tickOf(this.liveSec);
        }
        break;
      case "hunt":
        this.liveTick();
        break;
      case "break":
        if (tick >= this.stageEnd) {
          const half = this.rounds / 2;
          if (this.round >= this.rounds || this.wins[1] > half || this.wins[2] > half) {
            this.matchDone = true;
            this.stage = "";
          } else this.startRound(this.round + 1);
        }
        break;
    }
  }

  override frozen(_p: ServerPlayer): boolean {
    return this.stage === "prep" || this.stage === "break";
  }

  override over(): string | null {
    if (this.matchDone) return "rounds";
    if (this.teamPlayers(1, false).length === 0 || this.teamPlayers(2, false).length === 0)
      return "opponents-left";
    return null;
  }

  override leaderScore(): number {
    return Math.max(this.wins[1], this.wins[2]);
  }

  override winningTeam(): number {
    return this.wins[1] > this.wins[2] ? 1 : this.wins[2] > this.wins[1] ? 2 : 0;
  }

  /** Round line of the status ("Round 2/6 · Alpha attack"), the mode adds its objective. */
  protected roundLine(): string {
    if (this.stage === "") return "";
    const head = `Round ${this.round}/${this.rounds} · ${teamName(this.attackTeam)} ${this.attackVerb}`;
    return this.stage === "prep" ? `${head} · get ready` : head;
  }

  override sync(state: MatchState): void {
    const r = state.round;
    if (r.stage !== this.stage) r.stage = this.stage;
    if (r.end !== this.stageEnd) r.end = this.stageEnd;
    if (r.num !== this.round) r.num = this.round;
    if (r.of !== this.rounds) r.of = this.rounds;
    if (r.winner !== this.lastWinner) r.winner = this.lastWinner;
    for (const [id, p] of this.sim.players) {
      const ps = state.players.get(id);
      if (!ps) continue;
      const frozen = this.frozen(p);
      if (ps.frozen !== frozen) ps.frozen = frozen;
    }
  }
}
