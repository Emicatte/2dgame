import { MAZE_CELL, MAZE_WALL } from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { MazeMode } from "./Maze.ts";
import type { MarkData, ModeFacts } from "./ModeController.ts";

const LETTERS = ["A", "B", "C", "D"];
const REACH = 70;

/**
 * Puzzle Race: a maze with every gate open and four lettered switches at random cells. A code
 * (the order of the letters) is shown to everyone; each player presses the switches in that order
 * on their own (a wrong switch resets their code). The first to finish scores, then a new code and
 * new switch places follow. First to the lobby's puzzle count wins.
 */
export class PuzzleRaceMode extends MazeMode {
  private target = 3;
  private switches: { x: number; y: number }[] = [];
  private order: number[] = [];
  private progress = new Map<string, number>();
  private solved = new Map<string, number>();
  private pressed = new Set<string>();
  private winner = "";

  constructor(sim: ConstructorParameters<typeof MazeMode>[0]) {
    super(sim, "puzzlerace");
  }

  override configure(opts: { rounds: number; variant: string }): void {
    this.target = Math.max(1, Math.min(5, opts.rounds || 3));
  }

  override reset(): void {
    super.reset();
    for (const g of this.maze?.gates ?? []) this.open.add(g.id);
    this.applyWorld();
    this.solved.clear();
    this.winner = "";
    this.newPuzzle();
  }

  private newPuzzle(): void {
    const maze = this.maze;
    if (!maze) return;
    const cells = maze.cols * maze.rows;
    const picked = new Set<number>([0]);
    while (picked.size < LETTERS.length + 1 && picked.size < cells)
      picked.add(Math.floor(this.sim.rng() * cells));
    picked.delete(0);
    this.switches = [...picked].map((i) => ({
      x: (i % maze.cols) * MAZE_CELL + MAZE_WALL + (MAZE_CELL - MAZE_WALL) / 2,
      y: Math.floor(i / maze.cols) * MAZE_CELL + MAZE_WALL + (MAZE_CELL - MAZE_WALL) / 2,
    }));
    this.order = this.switches.map((_, j) => j).sort(() => this.sim.rng() - 0.5);
    this.progress.clear();
  }

  override step(): void {
    if (this.winner) return;
    for (const p of this.players()) {
      const press = p.alive && p.interact && !this.pressed.has(p.id);
      if (p.interact) this.pressed.add(p.id);
      else this.pressed.delete(p.id);
      if (!press) continue;
      const j = this.switches.findIndex((q) => (q.x - p.sim.x) ** 2 + (q.y - p.sim.y) ** 2 <= REACH * REACH);
      if (j < 0) continue;
      p.interactPress = false;
      const k = this.progress.get(p.id) ?? 0;
      if (this.order[k] !== j) {
        this.progress.set(p.id, 0);
        this.emit({ t: "msg", p: p.id, s: `Wrong switch: start the code again (${this.code()})` });
        continue;
      }
      this.progress.set(p.id, k + 1);
      if (k + 1 < this.order.length) {
        this.emit({ t: "msg", p: p.id, s: `${LETTERS[j]} ✓ · ${k + 1}/${this.order.length}` });
        continue;
      }
      const n = (this.solved.get(p.id) ?? 0) + 1;
      this.solved.set(p.id, n);
      this.emit({ t: "announce", s: `${p.name} solved the code`, d: `${n}/${this.target}`, w: 0 });
      if (n >= this.target) this.winner = p.id;
      else this.newPuzzle();
      return;
    }
  }

  private code(): string {
    return this.order.map((j) => LETTERS[j]).join(" · ");
  }

  override over(): string | null {
    return this.winner ? "solved" : null;
  }

  override standings(): ServerPlayer[] {
    const score = (p: ServerPlayer) => (this.solved.get(p.id) ?? 0) * 10 + (this.progress.get(p.id) ?? 0);
    return [...this.sim.players.values()].sort((a, b) => score(b) - score(a));
  }

  override facts(p: ServerPlayer): ModeFacts {
    return { points: this.solved.get(p.id) ?? 0, extra: {} };
  }

  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    this.switches.forEach((q, j) => {
      out.set(`pz-${j}`, {
        k: "target",
        x: Math.round(q.x),
        y: Math.round(q.y),
        r: 40,
        c: 0,
        p: 0,
        l: LETTERS[j]!,
        a: "",
      });
    });
    return out;
  }

  override statusText(): string {
    const best = Math.max(0, ...this.solved.values());
    return `Code: ${this.code()} · best ${best}/${this.target}`;
  }
}
