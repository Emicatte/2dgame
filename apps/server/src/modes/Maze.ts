import {
  emptySlot,
  formatIdList,
  MAZE_TRAP,
  type MatchState,
  type MazeDef,
  type MazeGate,
  PLAYER,
  pveWorlds,
} from "@scrapline/shared";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { BaseMode, type MarkData, type ModeFacts } from "./ModeController.ts";

const REACH = 70;

/**
 * Classic Maze: no weapons, fastest to the exit wins. The maze (walls, gates, openers, traps) comes
 * from the map id (seeded generation, maps/maze.ts); this controller keeps what changes during
 * the match, through the shared interaction pieces:
 * - gates are map doors: closed ones are solids for movement (same open list on every machine,
 *   PveState.doors, so prediction stays exact);
 * - a key is picked up by walking over it and opens its gate when its carrier reaches it;
 * - a switch opens its gate on interact (E);
 * - checkpoints save where a player comes back after a floor trap;
 * - floor traps run a fixed cycle from the match start, so every client can show them in time.
 * The match ends when every player in it has reached the exit, or when the clock runs out.
 */
export class MazeMode extends BaseMode {
  readonly mode = "maze" as const;
  private open = new Set<string>();
  /** Key carriers by gate id. */
  private carrier = new Map<string, string>();
  private checkpoint = new Map<string, number>();
  /** Finish time (ticks since the start) per player. */
  private finished = new Map<string, number>();
  private startTick = 0;

  /** Ticks per second. */
  private get rate(): number {
    return this.sim.secToTicks(1);
  }

  private get maze(): MazeDef | undefined {
    return this.sim.map.maze;
  }

  override pickupAllowed(): boolean {
    return false;
  }

  override reset(): void {
    this.open.clear();
    this.carrier.clear();
    this.checkpoint.clear();
    this.finished.clear();
    this.startTick = this.sim.tick;
    this.applyWorld();
  }

  private applyWorld(): void {
    const maze = this.maze;
    if (!maze) return;
    const w = pveWorlds(this.sim.map, maze.gates, this.open);
    this.sim.world = w.world;
    this.sim.shotWorld = w.shotWorld;
  }

  override spawnPoint(p: ServerPlayer): { x: number; y: number } | null {
    const maze = this.maze;
    if (!maze) return null;
    const cp = this.checkpoint.get(p.id) ?? 0;
    if (cp === 0) {
      const spawns = this.sim.map.spawns;
      const i = [...this.sim.players.keys()].indexOf(p.id);
      return { ...spawns[Math.max(0, i) % spawns.length]! };
    }
    return { ...maze.checkpoints[cp]! };
  }

  override onSpawn(p: ServerPlayer): void {
    p.sim.slots = [emptySlot(), emptySlot(), emptySlot()];
    p.sim.slot = 0;
  }

  override respawnDelay(): number {
    return 1;
  }

  override frozen(p: ServerPlayer): boolean {
    return this.finished.has(p.id);
  }

  override playerTargetable(): boolean {
    return false;
  }

  /** Whether trap `phase` is live at the current tick. */
  trapLive(phase: number): boolean {
    const period = MAZE_TRAP.offSec + MAZE_TRAP.onSec;
    const t = ((this.sim.tick - this.startTick) / this.rate + phase) % period;
    return t >= MAZE_TRAP.offSec;
  }

  override step(): void {
    const maze = this.maze;
    if (!maze) return;
    for (const p of this.players()) {
      if (!p.alive || this.finished.has(p.id)) continue;
      const { x, y } = p.sim;
      const near = (q: { x: number; y: number }, r: number) => (q.x - x) ** 2 + (q.y - y) ** 2 <= r * r;

      for (const g of maze.gates) {
        if (this.open.has(g.id)) continue;
        if (g.opener.kind === "key") {
          const holder = this.carrier.get(g.id);
          if (!holder && near(g.opener, REACH)) {
            this.carrier.set(g.id, p.id);
            this.emit({ t: "announce", s: `${p.name} has the ${keyName(g)}`, d: "", w: 0 });
          }
          if (this.carrier.get(g.id) === p.id && near(gateCenter(g), REACH + 30))
            this.openGate(g, `${p.name} opened the ${g.label.toLowerCase()}`);
        } else if (p.interact && near(g.opener, REACH)) {
          p.interactPress = false;
          this.openGate(g, `${p.name} hit the switch: ${g.label.toLowerCase()} open`);
        }
      }

      // Checkpoints only move forward.
      const cp = this.checkpoint.get(p.id) ?? 0;
      for (let i = maze.checkpoints.length - 1; i > cp; i--) {
        if (near(maze.checkpoints[i]!, 80)) {
          this.checkpoint.set(p.id, i);
          break;
        }
      }

      for (const t of maze.traps) {
        if (!this.trapLive(t.phase)) continue;
        const cx = Math.max(t.x, Math.min(x, t.x + t.w));
        const cy = Math.max(t.y, Math.min(y, t.y + t.h));
        if ((cx - x) ** 2 + (cy - y) ** 2 > PLAYER.radius ** 2) continue;
        // A key carrier drops it: the key goes back to its place.
        for (const [gate, holder] of this.carrier) if (holder === p.id) this.carrier.delete(gate);
        this.emit({ t: "announce", s: `${p.name} hit a trap`, d: "", w: 0 });
        this.sim.spawn(p, false);
        break;
      }

      if (near(maze.exit, maze.exit.r)) {
        const ticks = this.sim.tick - this.startTick;
        this.finished.set(p.id, ticks);
        this.emit({
          t: "announce",
          s: `${p.name} escaped · ${formatTime(ticks / this.rate)}`,
          d: this.finished.size === 1 ? "First out" : "",
          w: 0,
        });
      }
    }
    // A carrier who left the match takes nothing with them.
    for (const [gate, holder] of this.carrier) {
      const p = this.sim.players.get(holder);
      if (!p || p.away) this.carrier.delete(gate);
    }
  }

  private openGate(g: MazeGate, text: string): void {
    this.open.add(g.id);
    this.carrier.delete(g.id);
    this.applyWorld();
    this.emit({ t: "announce", s: text, d: "", w: 0 });
  }

  override onLeave(p: ServerPlayer): void {
    for (const [gate, holder] of this.carrier) if (holder === p.id) this.carrier.delete(gate);
  }

  override over(): string | null {
    const playing = this.players();
    return playing.length > 0 && playing.every((p) => this.finished.has(p.id)) ? "everyone-out" : null;
  }

  override standings(): ServerPlayer[] {
    const maze = this.maze;
    const exit = maze?.exit ?? { x: 0, y: 0 };
    const time = (p: ServerPlayer) => this.finished.get(p.id) ?? Number.POSITIVE_INFINITY;
    const progress = (p: ServerPlayer) => this.checkpoint.get(p.id) ?? 0;
    const left = (p: ServerPlayer) => (p.sim.x - exit.x) ** 2 + (p.sim.y - exit.y) ** 2;
    return [...this.sim.players.values()].sort(
      (a, b) => time(a) - time(b) || progress(b) - progress(a) || left(a) - left(b),
    );
  }

  override facts(p: ServerPlayer): ModeFacts {
    const t = this.finished.get(p.id);
    // Results show the finish time in tenths of a second (0 = did not finish).
    const tenths = t === undefined ? 0 : Math.max(1, Math.round((t / this.rate) * 10));
    return { points: tenths, extra: t === undefined ? {} : { mazeFinishes: 1 } };
  }

  override sync(state: MatchState): void {
    const doors = formatIdList(this.open);
    if (state.pve.doors !== doors) state.pve.doors = doors;
  }

  override markEntries(): Map<string, MarkData> {
    const out = new Map<string, MarkData>();
    const maze = this.maze;
    if (!maze) return out;
    out.set("exit", {
      k: "goal",
      x: maze.exit.x,
      y: maze.exit.y,
      r: maze.exit.r,
      c: 0,
      p: 100,
      l: "EXIT",
      a: "",
    });
    for (const g of maze.gates) {
      if (this.open.has(g.id)) continue;
      const c = gateCenter(g);
      const holder = this.carrier.get(g.id);
      const holderName = holder ? this.sim.players.get(holder)?.name : undefined;
      out.set(g.id, {
        k: "door",
        x: c.x,
        y: c.y,
        r: 40,
        c: 0,
        p: 0,
        l: g.opener.kind === "key" ? `${g.label} · key` : `${g.label} · switch`,
        a: "",
      });
      if (g.opener.kind === "key") {
        const at = holder ? this.sim.players.get(holder)?.sim : undefined;
        out.set(`${g.id}-key`, {
          k: "key",
          x: at ? at.x : g.opener.x,
          y: at ? at.y - 34 : g.opener.y,
          r: 26,
          c: 0,
          p: holder ? 100 : 0,
          l: holderName ? `${keyName(g)} · ${holderName}` : keyName(g),
          a: "",
        });
      } else {
        out.set(`${g.id}-switch`, {
          k: "switch",
          x: g.opener.x,
          y: g.opener.y,
          r: REACH,
          c: 0,
          p: 0,
          l: `${g.label} switch`,
          a: "Press E: open the gate",
        });
      }
    }
    maze.checkpoints.forEach((cp, i) => {
      if (i === 0) return;
      out.set(`cp-${i}`, {
        k: "checkpoint",
        x: cp.x,
        y: cp.y,
        r: 60,
        c: 0,
        p: 100,
        l: `Checkpoint ${i}`,
        a: "",
      });
    });
    for (const t of maze.traps)
      out.set(t.id, {
        k: "trap",
        x: t.x + t.w / 2,
        y: t.y + t.h / 2,
        r: t.w / 2,
        c: 0,
        p: this.trapLive(t.phase) ? 100 : 0,
        l: "",
        a: "",
      });
    return out;
  }

  override statusText(): string {
    const maze = this.maze;
    if (!maze) return "";
    const gates = maze.gates.filter((g) => !this.open.has(g.id)).length;
    const out = this.finished.size;
    const total = this.players().length;
    const gatesText = gates === 0 ? "gates open" : `${gates} gate${gates === 1 ? "" : "s"} shut`;
    return `${gatesText} · ${out}/${total} out`;
  }
}

function keyName(g: MazeGate): string {
  return `${g.label.split(" ")[0]} key`;
}

function gateCenter(g: MazeGate): { x: number; y: number } {
  return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
