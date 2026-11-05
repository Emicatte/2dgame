import {
  BTN,
  C2S,
  decodeInput,
  type InputFrame,
  MAPS,
  type MapId,
  MatchState,
  NET,
  type NetEvent,
  PickupState,
  PlayerState,
  PRIMARY_WEAPONS,
  S2C,
  SERVER_TICK_MS,
  type WireInput,
} from "@scrapline/shared";
// The real server simulation and state mirroring, so the benchmark renders exactly what a match
// produces (shots, hits, kills, respawns, pickups), without a network.
import { GameSimulation } from "../../../server/src/simulation/GameSimulation.ts";
import { syncPlayerState } from "../../../server/src/simulation/stateSync.ts";
import { signal } from "../net/signal.ts";

export interface LocalRoomOptions {
  /** Total players including the local one (1, 2 or 8 in the benchmark). */
  players: number;
  map: MapId;
}

/**
 * In-browser stand-in for a Colyseus room: runs GameSimulation at the server tick rate, mirrors it
 * into a MatchState exactly like ArenaRoom, and drives N-1 scripted opponents. It implements the
 * subset of the SDK Room API the client uses, so the game scene and HUD run unmodified.
 */
export class LocalRoom {
  readonly roomId = "local-bench";
  readonly sessionId = "you";
  readonly reconnectionToken = "local-bench:offline";
  readonly state = new MatchState();
  readonly connection = { isOpen: true, transport: {} as { ws?: WebSocket } };
  readonly onStateChange = signal<[MatchState]>();
  readonly onReconnect = signal<[]>();
  readonly onDrop = signal<[number?, string?]>();
  readonly onLeave = signal<[number]>();
  readonly onError = signal<[number, string?]>();
  private readonly handlers = new Map<string, Set<(m: unknown) => void>>();
  private readonly sim: GameSimulation;
  private readonly views = new Map<string, PlayerState>();
  private readonly bots: string[] = [];
  private botSeq = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private running = false;
  private nextTickAt = 0;
  private lastTimerAt = 0;
  /** Server-side tick cost of the local simulation (it shares the main thread with rendering). */
  readonly tickCost = { total: 0, count: 0, max: 0 };
  /**
   * Scheduling diagnostics. Embedded viewers can throttle timers while still rendering frames;
   * ticks are then driven from animation frames instead (counted in `byFrame`).
   */
  readonly schedule = { byTimer: 0, byFrame: 0, timerMaxGapMs: 0 };

  constructor(opts: LocalRoomOptions) {
    const map = MAPS[opts.map];
    this.sim = new GameSimulation(map, { tickRate: NET.serverTickRate });
    Object.assign(this.state, {
      phase: "playing",
      mode: "deathmatch",
      roomKind: "private",
      code: "BENCH",
      mapId: opts.map,
      durationSec: 20 * 60,
      killLimit: 100,
      maxPlayers: 8,
      tickRate: NET.serverTickRate,
      hostId: this.sessionId,
    });
    for (const id of this.sim.pickups.keys()) this.state.pickups.set(id, new PickupState());
    const ids = [this.sessionId, ...Array.from({ length: opts.players - 1 }, (_, i) => `bot${i + 1}`)];
    ids.forEach((id, i) => {
      const primary = i === 0 ? "rifle" : PRIMARY_WEAPONS[i % PRIMARY_WEAPONS.length]!;
      this.sim.addPlayer({
        id,
        playerId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        name: i === 0 ? "You" : `Bot ${i}`,
        skin: "foundry",
        level: 1,
        primary,
        seed: 1000 + i * 7919,
      });
      const ps = new PlayerState();
      Object.assign(ps, {
        name: i === 0 ? "You" : `Bot ${i}`,
        skin: "foundry",
        level: 1,
        primary,
        connected: true,
      });
      this.state.players.set(id, ps);
      this.views.set(id, ps);
      if (i > 0) this.bots.push(id);
    });
    this.sim.resetForMatch();
    this.state.phaseEndTick = this.sim.tick + 20 * 60 * NET.serverTickRate;
    this.sync();
  }

  /**
   * Runs the simulation on a fixed 20 Hz schedule. Both a timer and the animation-frame loop pump
   * it, so a throttled timer (seen in an embedded artifact viewer: ticks about once a second, which
   * made the stall guard flicker) cannot slow the server clock down.
   */
  start(): void {
    this.running = true;
    this.nextTickAt = performance.now() + SERVER_TICK_MS;
    this.lastTimerAt = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      this.schedule.timerMaxGapMs = Math.max(this.schedule.timerMaxGapMs, now - this.lastTimerAt);
      this.lastTimerAt = now;
      this.pump("timer");
    }, SERVER_TICK_MS);
    const onFrame = () => {
      if (!this.running) return;
      this.pump("frame");
      this.frame = requestAnimationFrame(onFrame);
    };
    this.frame = requestAnimationFrame(onFrame);
    queueMicrotask(() => this.onStateChange.invoke(this.state));
  }

  resetDiagnostics(): void {
    this.tickCost.total = 0;
    this.tickCost.count = 0;
    this.tickCost.max = 0;
    this.schedule.byTimer = 0;
    this.schedule.byFrame = 0;
    this.schedule.timerMaxGapMs = 0;
    this.lastTimerAt = performance.now();
  }

  private pump(source: "timer" | "frame"): void {
    const now = performance.now();
    // After a long pause (hidden tab) resume instead of replaying the missed ticks.
    if (now - this.nextTickAt > 1000) this.nextTickAt = now;
    let n = 0;
    while (now >= this.nextTickAt && n < 4) {
      this.tick();
      this.nextTickAt += SERVER_TICK_MS;
      n++;
      if (source === "timer") this.schedule.byTimer++;
      else this.schedule.byFrame++;
    }
  }

  onMessage(type: string, cb: (m: unknown) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  send(type: string, payload?: unknown): void {
    if (type === C2S.INPUT) {
      const frames = (payload as { i: WireInput[] }).i.map(decodeInput);
      this.sim.enqueue(this.sessionId, frames);
    }
  }

  ping(cb: (ms: number) => void): void {
    cb(0);
  }

  async leave(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.frame);
    this.connection.isOpen = false;
    this.onLeave.invoke(1000);
  }

  removeAllListeners(): void {
    for (const s of [this.onStateChange, this.onReconnect, this.onDrop, this.onLeave, this.onError])
      s.clear();
    this.handlers.clear();
  }

  private tick(): void {
    const now = performance.now();
    this.driveBots();
    const events = this.sim.step(SERVER_TICK_MS, "live");
    this.state.tick = this.sim.tick;
    this.sync();
    const cost = performance.now() - now;
    this.tickCost.total += cost;
    this.tickCost.count++;
    this.tickCost.max = Math.max(this.tickCost.max, cost);
    if (events.length > 0) for (const h of this.handlers.get(S2C.EVENTS) ?? []) h(events as NetEvent[]);
    this.onStateChange.invoke(this.state);
  }

  private sync(): void {
    for (const [id, p] of this.sim.players) {
      const ps = this.views.get(id);
      if (ps) syncPlayerState(ps, p, this.sim.tick);
    }
    for (const [id, pk] of this.sim.pickups) {
      const st = this.state.pickups.get(id);
      if (st) st.active = pk.active;
    }
  }

  /**
   * Deterministic opponents: wander in 8 directions (changing every ~2 s), aim at the nearest
   * living player and fire in bursts, switching to the sidearm when the primary is empty.
   */
  private driveBots(): void {
    const tick = this.sim.tick;
    this.bots.forEach((id, k) => {
      const p = this.sim.players.get(id)!;
      let target: { x: number; y: number } | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const o of this.sim.players.values()) {
        if (o.id === id || !o.alive) continue;
        const d = (o.sim.x - p.sim.x) ** 2 + (o.sim.y - p.sim.y) ** 2;
        if (d < best) {
          best = d;
          target = { x: o.sim.x, y: o.sim.y };
        }
      }
      const seg = Math.floor((tick + k * 17) / 40) % 9;
      const a = (seg * Math.PI) / 4;
      const mx = seg === 8 ? 0 : Math.round(Math.cos(a));
      const my = seg === 8 ? 0 : Math.round(Math.sin(a));
      const aim = target ? Math.atan2(target.y - p.sim.y, target.x - p.sim.x) : a;
      const firing = (tick + k * 5) % 30 < 14 && best < 900 * 900;
      const cur = p.sim.slots[p.sim.slot]!;
      const slot = cur.mag + cur.reserve === 0 && p.sim.slot !== 1 ? 1 : -1;
      const frames: InputFrame[] = [0, 1, 2].map((j) => {
        const seq = (this.botSeq.get(id) ?? 0) + 1;
        this.botSeq.set(id, seq);
        return {
          seq,
          mx,
          my,
          aim,
          // Semi-automatic weapons need the trigger released between shots.
          buttons: firing && j !== 1 ? BTN.FIRE : 0,
          slot: j === 0 ? slot : -1,
          viewTick: tick,
        };
      });
      this.sim.enqueue(id, frames);
    });
  }
}
