import {
  emptySlot,
  formatIdList,
  type GameMode,
  MAZE_TRAP,
  type MatchState,
  type MazeDef,
  type MazeGate,
  PLAYER,
  pveWorlds,
  sweeperAt,
} from "@scrapline/shared";
import type { ZombieWorld } from "../pve/ZombieWorld.ts";
import type { ServerPlayer } from "../simulation/GameSimulation.ts";
import { MazeMonster } from "./MazeMonster.ts";
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
  /** Escape Room: the progress of each code sequence (gate id → switches pressed right). */
  private seq = new Map<string, number>();
  /** Interact was held last tick (presses are edges). */
  private held = new Set<string>();
  /** Night Hunt: the monster and the survivors it caught. */
  hunter = "";
  private caughtBy = new Set<string>();

  constructor(
    sim: ConstructorParameters<typeof BaseMode>[0],
    readonly mode: GameMode = "maze",
  ) {
    super(sim);
  }
  private open = new Set<string>();
  /** Key carriers by gate id. */
  private carrier = new Map<string, string>();
  private checkpoint = new Map<string, number>();
  /** Finish time (ticks since the start) per player. */
  private finished = new Map<string, number>();
  private startTick = 0;
  private variant = "classic";
  /** Horror variant: the creature and its director. */
  monster: MazeMonster | null = null;

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

  override configure(opts: { rounds: number; variant: string }): void {
    // Night Hunt is always in the dark; its monster is a player, not the AI.
    this.variant = opts.variant === "horror" ? "horror" : "classic";
  }

  override reset(): void {
    this.open.clear();
    this.carrier.clear();
    this.checkpoint.clear();
    this.finished.clear();
    this.seq.clear();
    this.caughtBy.clear();
    this.startTick = this.sim.tick;
    this.applyWorld();
    const maze = this.maze;
    if (this.mode === "nighthunt") {
      const ids = this.players().map((p) => p.id);
      this.hunter = ids[Math.floor(this.sim.rng() * ids.length)] ?? "";
    }
    this.monster =
      maze && this.variant === "horror" && this.mode !== "nighthunt"
        ? new MazeMonster(
            this.sim,
            maze,
            () => this.players().filter((p) => !this.finished.has(p.id)),
            (p) => this.sendBack(p, `${p.name} was caught`),
          )
        : null;
    if (maze) this.monster?.spawn(maze.lair);
  }

  override zombieWorld(): ZombieWorld | null {
    return this.monster?.zw ?? null;
  }

  /** Back to the last checkpoint; a carried key goes back to its place. */
  private sendBack(p: ServerPlayer, text: string): void {
    for (const [gate, holder] of this.carrier) if (holder === p.id) this.carrier.delete(gate);
    this.emit({ t: "announce", s: text, d: "", w: 0 });
    this.sim.spawn(p, false);
    this.monster?.noise(p.sim.x, p.sim.y, 300);
  }

  private applyWorld(): void {
    const maze = this.maze;
    if (!maze) return;
    const w = pveWorlds(this.sim.map, maze.gates, this.open);
    this.sim.world = w.world;
    this.sim.shotWorld = w.shotWorld;
    this.monster?.wallsChanged();
  }

  override spawnPoint(p: ServerPlayer): { x: number; y: number } | null {
    const maze = this.maze;
    if (!maze) return null;
    // Night Hunt: the monster starts in the far lair.
    if (p.id === this.hunter) return { ...maze.lair };
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

  override frozen(p: ServerPlayer): boolean {
    // The monster waits 8 s before the hunt.
    if (p.id === this.hunter && this.sim.tick - this.startTick < 8 * this.rate) return true;
    return this.finished.has(p.id) || this.caughtBy.has(p.id);
  }

  /** Night Hunt: the monster is faster. */
  override body(p: ServerPlayer): { radius: number; speed: number } | null {
    return p.id === this.hunter ? { radius: PLAYER.radius, speed: 1.2 } : null;
  }

  override respawnDelay(): number | null {
    return 1;
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
    this.monster?.step();
    for (const p of this.players()) {
      if (!p.alive || this.finished.has(p.id)) continue;
      const { x, y } = p.sim;
      const near = (q: { x: number; y: number }, r: number) => (q.x - x) ** 2 + (q.y - y) ** 2 <= r * r;

      for (const g of maze.gates) {
        if (this.open.has(g.id) || p.id === this.hunter) continue;
        if (g.opener.kind === "key") {
          const holder = this.carrier.get(g.id);
          if (!holder && near(g.opener, REACH)) {
            this.carrier.set(g.id, p.id);
            this.emit({ t: "announce", s: `${p.name} has the ${keyName(g)}`, d: "", w: 0 });
          }
          if (this.carrier.get(g.id) === p.id && near(gateCenter(g), REACH + 30))
            this.openGate(g, `${p.name} opened the ${g.label.toLowerCase()}`);
        } else if (g.opener.kind === "switch" && p.interact && near(g.opener, REACH)) {
          p.interactPress = false;
          this.openGate(g, `${p.name} hit the switch: ${g.label.toLowerCase()} open`);
        } else if (g.opener.kind === "sequence" && p.interact && !this.held.has(p.id)) {
          const pts = g.opener.points ?? [];
          const order = g.opener.order ?? [];
          const j = pts.findIndex((q) => near(q, REACH));
          if (j >= 0) {
            const k = this.seq.get(g.id) ?? 0;
            if (order[k] === j) {
              this.seq.set(g.id, k + 1);
              if (k + 1 >= order.length)
                this.openGate(g, `${p.name} entered the code: ${g.label.toLowerCase()} open`);
            } else {
              this.seq.set(g.id, 0);
              this.emit({ t: "announce", s: "Wrong order: the code resets", d: "", w: 0 });
            }
          }
        }
      }
      if (p.interact) this.held.add(p.id);
      else this.held.delete(p.id);

      // Night Hunt: the monster catches survivors by touch.
      if (p.id === this.hunter) {
        if (this.frozen(p)) continue;
        for (const q of this.players()) {
          if (q.id === p.id || !q.alive || this.finished.has(q.id) || this.caughtBy.has(q.id)) continue;
          if (Math.hypot(q.sim.x - x, q.sim.y - y) < PLAYER.radius * 2.4) {
            this.caughtBy.add(q.id);
            this.emit({ t: "announce", s: `${q.name} was caught`, d: "", w: 0 });
          }
        }
        continue;
      }

      // Parkour: walking into a gap (not dashing over it) or touching a moving bar.
      const secs = (this.sim.tick - this.startTick) / this.rate;
      const inRect = (r: { x: number; y: number; w: number; h: number }, pad: number) =>
        x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad;
      if (p.sim.dash === 0 && (maze.pits ?? []).some((q) => inRect(q, -6))) {
        this.sendBack(p, `${p.name} fell`);
        continue;
      }
      if ((maze.sweepers ?? []).some((sw) => inRect(sweeperAt(sw, secs), PLAYER.radius - 4))) {
        this.sendBack(p, `${p.name} was swept away`);
        continue;
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
        this.monster?.noise(x, y, 650);
        this.sendBack(p, `${p.name} hit a trap`);
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
    // Pressure plates: every plate held by someone at the same moment.
    for (const g of maze.gates) {
      if (this.open.has(g.id) || g.opener.kind !== "plates") continue;
      const pts = g.opener.points ?? [];
      const live = this.players().filter((p) => p.alive);
      if (pts.length && pts.every((q) => live.some((p) => Math.hypot(p.sim.x - q.x, p.sim.y - q.y) < 46)))
        this.openGate(g, `${g.label} open: the plates are down`);
    }
    // A carrier who left the match takes nothing with them.
    for (const [gate, holder] of this.carrier) {
      const p = this.sim.players.get(holder);
      if (!p || p.away) this.carrier.delete(gate);
    }
  }

  private openGate(g: MazeGate, text: string): void {
    // Gates are loud: in the dark, everything nearby hears it.
    this.monster?.noise(g.x + g.w / 2, g.y + g.h / 2, 1200);
    this.open.add(g.id);
    this.carrier.delete(g.id);
    this.applyWorld();
    this.emit({ t: "announce", s: text, d: "", w: 0 });
  }

  override onLeave(p: ServerPlayer): void {
    for (const [gate, holder] of this.carrier) if (holder === p.id) this.carrier.delete(gate);
  }

  override over(): string | null {
    if (this.mode === "nighthunt") {
      const survivors = this.players().filter((p) => p.id !== this.hunter);
      if (survivors.length === 0) return null;
      if (survivors.every((p) => this.caughtBy.has(p.id))) return "all-caught";
      if (survivors.every((p) => this.caughtBy.has(p.id) || this.finished.has(p.id))) return "escaped";
      return null;
    }
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
    // Night Hunt: role 1 marks the monster (HUD); caught survivors stand still.
    for (const [id, ps] of state.players) {
      const role = id === this.hunter ? 1 : 0;
      if (ps.role !== role) ps.role = role;
      const frozen = this.caughtBy.has(id);
      if (ps.frozen !== frozen) ps.frozen = frozen;
    }
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
      } else if (g.opener.kind === "plates") {
        (g.opener.points ?? []).forEach((q, j) => {
          const held = this.players().some((p) => p.alive && Math.hypot(p.sim.x - q.x, p.sim.y - q.y) < 46);
          out.set(`${g.id}-p${j}`, {
            k: "plate",
            x: q.x,
            y: q.y,
            r: 40,
            c: 0,
            p: held ? 100 : 0,
            l: "Plate",
            a: "",
          });
        });
      } else if (g.opener.kind === "sequence") {
        const k = this.seq.get(g.id) ?? 0;
        (g.opener.points ?? []).forEach((q, j) => {
          const done = (g.opener.order ?? []).slice(0, k).includes(j);
          out.set(`${g.id}-s${j}`, {
            k: "switch",
            x: q.x,
            y: q.y,
            r: REACH,
            c: 0,
            p: done ? 100 : 0,
            l: `Switch ${"ABC"[j]}`,
            a: "Press the switch",
          });
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
          a: "Open the gate",
        });
      }
    }
    if (maze.clue)
      out.set("clue", {
        k: "terminal",
        x: maze.clue.x,
        y: maze.clue.y,
        r: 30,
        c: 0,
        p: 0,
        l: maze.clue.text,
        a: "",
      });
    for (const q of maze.pits ?? [])
      out.set(q.id, { k: "pit", x: q.x + q.w / 2, y: q.y + q.h / 2, r: q.w / 2, c: 0, p: 0, l: "", a: "" });
    const secs = (this.sim.tick - this.startTick) / this.rate;
    for (const sw of maze.sweepers ?? []) {
      const r = sweeperAt(sw, secs);
      out.set(sw.id, {
        k: "sweeper",
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
        r: r.h / 2,
        c: 0,
        p: 100,
        l: "",
        a: "",
      });
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
    if (this.mode === "nighthunt") {
      const caught = this.caughtBy.size;
      const name = this.sim.players.get(this.hunter)?.name ?? "?";
      return `Monster: ${name} · ${caught} caught · ${out} out`;
    }
    if (this.mode === "parkour") return `${out}/${total} finished`;
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
