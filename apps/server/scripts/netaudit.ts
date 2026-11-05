/**
 * Netcode audit: two headless clients run the real client netcode (Predictor, ServerClock,
 * NetMetrics from apps/web) against a real server process through the netem proxy, under a matrix
 * of latency, jitter, frame-rate, stall and reconnection scenarios, and check explicit acceptance
 * criteria for the input pipeline.
 *
 *   # terminal 1: server with debug routes (fixed spawns + /api/debug/rooms)
 *   ENABLE_DEBUG_ROUTES=true PORT=2600 pnpm --filter @scrapline/server start
 *   # terminal 2: proxy
 *   node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2600 --latency 0
 *   # terminal 3
 *   pnpm --filter @scrapline/server netaudit -- --server http://localhost:2600 \
 *        --proxy http://localhost:2610 [--only rtt120] [--out report.json]
 *
 * Exit code 1 when any acceptance criterion fails. Nothing here is simulated: frames really go
 * through sockets, the proxy and the server's tick loop.
 */
import { writeFileSync } from "node:fs";
import { Client, type Room } from "@colyseus/sdk";
import {
  BTN,
  C2S,
  collisionWorldFor,
  encodeInput,
  type InputFrame,
  MAPS,
  type MatchState,
  MatchState as MatchStateSchema,
  NET,
  type NetEvent,
  quantizeInput,
  ROOM_NAME,
  S2C,
  SERVER_TICK_MS,
  STEP_DT,
} from "@scrapline/shared";
import { ServerClock } from "../../web/src/game/net/clock.ts";
import { NetMetrics, RollingStats } from "../../web/src/game/net/metrics.ts";
import { Predictor } from "../../web/src/game/net/Predictor.ts";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
};
const SERVER = arg("server", "http://localhost:2600");
const PROXY = arg("proxy", "http://localhost:2610");
const ONLY = arg("only", "");
const OUT = arg("out", "");
const STEP_MS = STEP_DT * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ------------------------------------------------------------------------------------- bots

interface ServerPlayerDebug {
  id: string;
  queue: number;
  credit: number;
  lastQueuedSeq: number;
  lastProcessedSeq: number;
  inputs: Record<string, number>;
}

class Bot {
  room!: Room<unknown, MatchState>;
  predictor!: Predictor;
  metrics = new NetMetrics();
  clock = new ServerClock();
  outbox: InputFrame[] = [];
  acc = 0;
  lastFrameAt = 0;
  step = 0;
  /** Input pattern on/off: when false the bot sends neutral inputs (keys released). */
  active = true;
  alive = false;
  aliveChanges = 0;
  predictedShots = 0;
  serverShots = 0;
  lostStepMs = 0;
  drops = 0;
  reconnects = 0;
  leftCode: number | null = null;
  ackRegressions: { from: number; to: number; at: number }[] = [];
  private prevAck = -1;
  latestState: MatchState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly name: string,
    readonly aimDir: number,
    public fps: number,
  ) {}

  attach(room: Room<unknown, MatchState>, freshPredictor: boolean) {
    this.room = room;
    if (freshPredictor || !this.predictor) {
      this.predictor = new Predictor(collisionWorldFor(MAPS.industrial), hashString(room.sessionId));
      this.metrics = new NetMetrics();
    }
    this.prevAck = -1;
    room.onStateChange((s) => this.onState(s));
    room.onMessage(S2C.EVENTS, (events: NetEvent[]) => {
      for (const e of events) if (e.t === "shot" && e.p === room.sessionId) this.serverShots++;
    });
    room.onMessage("*", () => {});
    room.onDrop(() => {
      this.drops++;
    });
    room.onLeave((code) => {
      this.leftCode = code;
    });
    room.onReconnect(() => {
      this.reconnects++;
      this.prevAck = -1;
      this.predictor.resetStream();
      this.metrics.resetStream();
      this.clock.reset();
    });
  }

  private onState(state: MatchState) {
    this.latestState = state;
    const phase = state.phase;
    const inMatch = phase === "countdown" || phase === "playing";
    if (!inMatch) return;
    this.clock.onSnapshot(state.tick);
    const me = state.players.get(this.room.sessionId);
    if (!me) return;
    const alive = me.alive && phase === "playing";
    if (alive !== this.alive) this.aliveChanges++;
    this.alive = alive;
    if (me.ack < this.prevAck)
      this.ackRegressions.push({ from: this.prevAck, to: me.ack, at: Math.round(performance.now()) });
    this.prevAck = me.ack;
    this.predictor.reconcile(me, alive);
    this.metrics.onPatch(me.ack, this.predictor.pendingCount, performance.now());
  }

  start() {
    this.lastFrameAt = performance.now();
    const loop = () => {
      this.frame();
      this.timer = setTimeout(loop, Math.max(0, 1000 / this.fps - 0.5));
    };
    loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Stops generating inputs (as if the tab were frozen) so the ack can catch up exactly. */
  async settle(timeoutMs: number): Promise<boolean> {
    this.stop();
    this.acc = 0;
    const t = performance.now();
    while (performance.now() - t < timeoutMs) {
      if ((this.serverSelf()?.ack ?? -1) === this.predictor.lastSeq) return true;
      await sleep(20);
    }
    return false;
  }

  /** Mirrors ArenaScene.update(): real elapsed time, fixed 60 Hz steps, one flush per frame. */
  private frame() {
    const now = performance.now();
    const dt = Math.min(now - this.lastFrameAt, 250);
    this.lastFrameAt = now;
    const phase = this.latestState?.phase;
    if (!(phase === "countdown" || phase === "playing") || !this.clock.ready) return;
    const guard = (NET as { inputStallMs?: number }).inputStallMs;
    const stalled =
      guard !== undefined && this.metrics.updateStall(now, this.predictor.pendingCount, guard, dt);
    if (stalled || (guard !== undefined && this.drops > this.reconnects)) {
      this.acc = 0;
    } else {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < 15) {
        this.acc -= STEP_MS;
        steps++;
        this.fixedStep();
      }
      if (steps >= 15) {
        this.lostStepMs += this.acc;
        this.metrics.lostStepMs += this.acc;
        this.acc = 0;
      }
    }
    while (this.outbox.length > 0) {
      const batch = this.outbox.splice(0, NET.maxInputsPerMessage).map(encodeInput);
      this.room.send(C2S.INPUT, { i: batch });
      this.metrics.sent += batch.length;
      this.metrics.messages++;
    }
    this.metrics.onFrame(now);
  }

  private fixedStep() {
    const k = this.step++;
    let mx = 0;
    let my = 0;
    let buttons = 0;
    let slot = -1;
    if (this.active) {
      // Deterministic pattern: 8 directions, pauses, periodic dash and bursts of fire.
      const seg = Math.floor(k / 40) % 10;
      if (seg < 8) {
        const a = (seg * Math.PI) / 4;
        mx = Math.round(Math.cos(a));
        my = Math.round(Math.sin(a));
      }
      if (k % 150 === 75) buttons |= BTN.DASH;
      if (k % 120 < 18) buttons |= BTN.FIRE;
      // Fall back to the pistol (unlimited reserve) when the primary runs dry, so every scenario
      // keeps exercising the shot/ammo consistency check.
      const sim = this.predictor.sim;
      const cur = sim.slots[sim.slot]!;
      if (sim.slot !== 1 && cur.mag + cur.reserve === 0 && k % 30 === 0) slot = 1;
    }
    const frame = quantizeInput({
      seq: this.predictor.nextSeq(),
      mx,
      my,
      aim: this.aimDir,
      buttons,
      slot,
      viewTick: Math.max(0, this.clock.renderTick()),
    });
    this.predictor.predict(frame, this.alive, (e) => {
      if (e.kind === "shot") this.predictedShots++;
    });
    this.outbox.push(frame);
    this.metrics.generated++;
  }

  serverSelf() {
    return this.latestState?.players.get(this.room.sessionId);
  }
}

// ------------------------------------------------------------------------------------- setup

async function guest(name: string): Promise<string> {
  const res = await fetch(`${SERVER}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: name }),
  });
  if (!res.ok) throw new Error(`guest failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

async function netem(path: string, body?: unknown) {
  const res = await fetch(`${PROXY}/__netem${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

async function serverPlayers(roomId: string): Promise<Map<string, ServerPlayerDebug>> {
  const rooms = (await (await fetch(`${SERVER}/api/debug/rooms`)).json()) as {
    roomId: string;
    players: ServerPlayerDebug[];
  }[];
  const r = rooms.find((x) => x.roomId === roomId);
  return new Map((r?.players ?? []).map((p) => [p.id, p]));
}

// ------------------------------------------------------------------------------------- scenarios

interface Scenario {
  name: string;
  latency: number;
  jitter: number;
  spikeRate?: number;
  spike?: number;
  fps: number;
  seconds: number;
  /** One-shot stall injected `atSec` into the run. */
  stall?: { atSec: number; ms: number; dir: "up" | "down" | "both" };
  /** Connection drop (proxy terminates the sockets) `atSec` into the run; SDK auto-reconnects. */
  drop?: { atSec: number };
  /** Page reload: bot B opens a new connection with its reconnection token and a fresh predictor. */
  reload?: { atSec: number };
}

const SCENARIOS: Scenario[] = [
  { name: "rtt0-60fps", latency: 0, jitter: 0, fps: 60, seconds: 12 },
  { name: "rtt40-j10-60fps", latency: 40, jitter: 10, fps: 60, seconds: 12 },
  {
    name: "rtt120-j30-spikes-60fps",
    latency: 120,
    jitter: 30,
    spikeRate: 0.01,
    spike: 150,
    fps: 60,
    seconds: 15,
  },
  { name: "rtt250-j50-60fps", latency: 250, jitter: 50, fps: 60, seconds: 15 },
  { name: "rtt0-13fps", latency: 0, jitter: 0, fps: 13, seconds: 12 },
  { name: "rtt120-j30-13fps", latency: 120, jitter: 30, fps: 13, seconds: 15 },
  { name: "rtt250-j50-13fps", latency: 250, jitter: 50, fps: 13, seconds: 15 },
  {
    name: "stall-up-400ms",
    latency: 40,
    jitter: 10,
    fps: 60,
    seconds: 12,
    stall: { atSec: 4, ms: 400, dir: "up" },
  },
  {
    name: "stall-up-1000ms",
    latency: 40,
    jitter: 10,
    fps: 60,
    seconds: 14,
    stall: { atSec: 4, ms: 1000, dir: "up" },
  },
  {
    name: "stall-down-1000ms",
    latency: 40,
    jitter: 10,
    fps: 60,
    seconds: 12,
    stall: { atSec: 4, ms: 1000, dir: "down" },
  },
  { name: "drop-reconnect", latency: 40, jitter: 10, fps: 60, seconds: 16, drop: { atSec: 4 } },
  { name: "reload-reconnect", latency: 40, jitter: 10, fps: 60, seconds: 16, reload: { atSec: 4 } },
  {
    name: "stall-up-1500ms-rtt250",
    latency: 250,
    jitter: 50,
    fps: 60,
    seconds: 16,
    stall: { atSec: 4, ms: 1500, dir: "up" },
  },
  // Destructive in v0.1.0 (the post-stall burst exceeded the message rate limit): run last.
  {
    name: "stall-both-1500ms",
    latency: 40,
    jitter: 10,
    fps: 60,
    seconds: 14,
    stall: { atSec: 4, ms: 1500, dir: "both" },
  },
  {
    name: "stall-up-2500ms",
    latency: 40,
    jitter: 10,
    fps: 60,
    seconds: 16,
    stall: { atSec: 4, ms: 2500, dir: "up" },
  },
];

/**
 * Upper bound for unacknowledged inputs in steady state, in frames: an input waits up to one
 * frame before it is sent, crosses the network (RTT + jitter both ways), waits up to one server
 * tick in the queue (plus one more when a client frame delivers more inputs than one tick
 * consumes), and its ack waits up to one more frame before the client reads it.
 */
function pendingBound(s: Scenario): number {
  const frameMs = 1000 / s.fps;
  const ms = s.latency + 2 * s.jitter + 2 * SERVER_TICK_MS + 2 * frameMs;
  return Math.ceil(ms / STEP_MS) + 2;
}

interface BotResult {
  bot: string;
  client: ReturnType<NetMetrics["snapshot"]>;
  server: {
    received: number;
    accepted: number;
    duplicate: number;
    overflow: number;
    trimmed: number;
    processed: number;
    queueP95: number;
    queueMax: number;
    queueAfterRecovery: number;
  };
  converged: { errPx: number; ackBehind: number; ammoMatch: boolean };
  shots: { predicted: number; server: number };
  aliveChanges: number;
  lostStepMs: number;
  recoveryMs: number | null;
  drops: number;
  reconnects: number;
  leftCode: number | null;
  ackRegressions: { from: number; to: number; at: number }[];
}

interface ScenarioResult {
  scenario: Scenario;
  pendingBound: number;
  bots: BotResult[];
  failures: string[];
}

async function runScenario(
  s: Scenario,
  bots: Bot[],
  roomId: string,
  reloadBot: () => Promise<void>,
): Promise<ScenarioResult> {
  await netem("", { latency: s.latency, jitter: s.jitter, spikeRate: s.spikeRate ?? 0, spike: s.spike ?? 0 });
  for (const b of bots) {
    b.fps = s.fps;
    b.metrics = new NetMetrics();
    b.predictedShots = 0;
    b.serverShots = 0;
    b.aliveChanges = 0;
    b.lostStepMs = 0;
    b.active = true;
  }
  // Let the new conditions settle before measuring (latency changes shift the clock offset).
  await sleep(1500);
  for (const b of bots) {
    b.metrics = new NetMetrics();
    b.predictor.resetStats();
  }
  const before = await serverPlayers(roomId);
  const queueSamples = new Map(bots.map((b) => [b.name, new RollingStats(2000)]));
  const queueAfter = new Map(bots.map((b) => [b.name, new RollingStats(30)]));
  const pendingTrace = new Map<string, { t: number; pending: number }[]>(bots.map((b) => [b.name, []]));

  const t0 = performance.now();
  let disturbedAt: number | null = null;
  let disturbanceEnd: number | null = null;
  const tasks: Promise<unknown>[] = [];
  if (s.stall) {
    tasks.push(
      sleep(s.stall.atSec * 1000).then(async () => {
        disturbedAt = performance.now();
        disturbanceEnd = disturbedAt + s.stall!.ms;
        await netem("/stall", { ms: s.stall!.ms, dir: s.stall!.dir });
      }),
    );
  }
  if (s.drop) {
    tasks.push(
      sleep(s.drop.atSec * 1000).then(async () => {
        disturbedAt = performance.now();
        await netem("/drop", {});
      }),
    );
  }
  if (s.reload) {
    tasks.push(
      sleep(s.reload.atSec * 1000).then(async () => {
        disturbedAt = performance.now();
        await reloadBot();
        disturbanceEnd = performance.now();
      }),
    );
  }

  const end = t0 + s.seconds * 1000;
  while (performance.now() < end) {
    const now = performance.now();
    const sp = await serverPlayers(roomId).catch(() => null);
    for (const b of bots) {
      pendingTrace.get(b.name)!.push({ t: now - t0, pending: b.predictor.pendingCount });
      const p = sp?.get(b.room.sessionId);
      if (p) {
        queueSamples.get(b.name)!.push(p.queue);
        if (now > end - 3000) queueAfter.get(b.name)!.push(p.queue);
      }
    }
    await sleep(100);
  }
  await Promise.all(tasks);
  // Release the keys and let everything settle: the ack must catch up and the prediction must
  // equal the authoritative state exactly.
  for (const b of bots) b.active = false;
  await sleep(1000);
  await Promise.all(bots.map((b) => b.settle(5000 + s.latency * 4)));
  const after = await serverPlayers(roomId);

  const bound = pendingBound(s);
  const failures: string[] = [];
  const results: BotResult[] = bots.map((b) => {
    const sid = b.room.sessionId;
    const a = after.get(sid);
    const bf = before.get(sid);
    const d = (k: string) => (a?.inputs?.[k] ?? 0) - (bf?.inputs?.[k] ?? 0);
    const me = b.serverSelf();
    const errPx = me ? Math.hypot(me.x - b.predictor.sim.x, me.y - b.predictor.sim.y) : -1;
    const sim = b.predictor.sim;
    const ammoMatch =
      !!me &&
      sim.slots[0]!.mag === me.m0 &&
      sim.slots[0]!.reserve === me.r0 &&
      sim.slots[1]!.mag === me.m1 &&
      sim.slots[1]!.reserve === me.r1;
    const client = b.metrics.snapshot(performance.now(), b.predictor);
    // Recovery: first time after the disturbance from which pending stays within the bound.
    let recoveryMs: number | null = null;
    if (disturbedAt !== null) {
      const startRel = (disturbanceEnd ?? disturbedAt) - t0;
      const trace = pendingTrace.get(b.name)!.filter((x) => x.t >= startRel);
      let lastBad = -1;
      for (let j = 0; j < trace.length; j++) if (trace[j]!.pending > bound) lastBad = j;
      recoveryMs =
        lastBad === -1 ? 0 : lastBad + 1 < trace.length ? Math.round(trace[lastBad + 1]!.t - startRel) : null;
    }
    return {
      bot: b.name,
      client,
      server: {
        received: d("received"),
        accepted: d("accepted"),
        duplicate: d("duplicate"),
        overflow: d("overflow"),
        trimmed: d("trimmed"),
        processed: d("processed"),
        queueP95: queueSamples.get(b.name)!.percentile(95),
        queueMax: queueSamples.get(b.name)!.max(),
        queueAfterRecovery: queueAfter.get(b.name)!.percentile(50),
      },
      converged: {
        errPx: Math.round(errPx * 1000) / 1000,
        ackBehind: b.predictor.lastSeq - (me?.ack ?? 0),
        ammoMatch,
      },
      shots: { predicted: b.predictedShots, server: b.serverShots },
      aliveChanges: b.aliveChanges,
      lostStepMs: Math.round(b.lostStepMs),
      recoveryMs,
      drops: b.drops,
      reconnects: b.reconnects,
      leftCode: b.leftCode,
      ackRegressions: b.ackRegressions.splice(0),
    };
  });
  for (const b of bots) {
    b.drops = 0;
    b.reconnects = 0;
    b.start();
  }

  const disturbed = !!(s.stall || s.drop || s.reload);
  for (const r of results) {
    const f = (msg: string) => failures.push(`${r.bot}: ${msg}`);
    if (r.converged.ackBehind !== 0) f(`ack ${r.converged.ackBehind} frames behind after settling`);
    if (r.converged.errPx > 0.01)
      f(`prediction differs from server by ${r.converged.errPx}px after settling`);
    if (!r.converged.ammoMatch) f("predicted ammo differs from server ammo after settling");
    if (r.drops > r.reconnects) f(`dropped ${r.drops}x but reconnected ${r.reconnects}x`);
    if (r.leftCode !== null) f(`removed from the room (close code ${r.leftCode})`);
    if (r.client.staleAcks > 0) f(`${r.client.staleAcks} snapshots ignored as stale acks`);
    if (!disturbed) {
      if (r.server.overflow > 0) f(`${r.server.overflow} inputs dropped by the server (queue full)`);
      if (r.server.duplicate > 0) f(`${r.server.duplicate} duplicate inputs`);
      if (r.client.pendingP95 > bound) f(`pending p95 ${r.client.pendingP95} > bound ${bound}`);
      if (r.client.pendingMax > bound + (s.spikeRate ? Math.ceil((s.spike ?? 0) / STEP_MS) : 0))
        f(`pending max ${r.client.pendingMax} > bound ${bound}`);
      if (r.client.snaps > r.aliveChanges) f(`${r.client.snaps} snap corrections without respawn`);
      if (r.client.correctionMax > 1 && r.aliveChanges === 0)
        f(`correction up to ${r.client.correctionMax}px`);
      if (r.shots.predicted !== r.shots.server)
        f(`predicted ${r.shots.predicted} shots, server fired ${r.shots.server}`);
    } else {
      if (r.recoveryMs === null) f("pending never returned within the steady-state bound");
      if (r.server.queueAfterRecovery > Math.ceil(1000 / s.fps / STEP_MS) + 3)
        f(`standing server queue of ${r.server.queueAfterRecovery} frames after recovery`);
    }
  }
  return { scenario: s, pendingBound: bound, bots: results, failures };
}

// ------------------------------------------------------------------------------------- main

async function main() {
  const proxyClient = new Client(PROXY);
  const [tokA, tokB] = await Promise.all([guest("Audit A"), guest("Audit B")]);
  const a = new Bot("A", -Math.PI / 2, 60);
  const b = new Bot("B", Math.PI / 2, 60);

  const roomA = await proxyClient.create<MatchState>(
    ROOM_NAME,
    {
      token: tokA,
      kind: "private",
      primary: "rifle",
      map: "industrial",
      debugSpawns: [
        { x: 1000, y: 1180 },
        { x: 1400, y: 1180 },
      ],
    },
    MatchStateSchema,
  );
  a.attach(roomA, true);
  const roomB = await new Client(PROXY).joinById<MatchState>(
    roomA.roomId,
    { token: tokB, kind: "private", primary: "rifle" },
    MatchStateSchema,
  );
  b.attach(roomB, true);
  roomA.send(C2S.SETTINGS, { durationSec: 20 * 60, killLimit: 100 });
  roomB.send(C2S.READY, { ready: true });
  await sleep(500);
  roomA.send(C2S.START, {});
  const t = Date.now();
  while (roomA.state.phase !== "playing" && Date.now() - t < 15_000) await sleep(100);
  if (roomA.state.phase !== "playing") throw new Error(`match did not start (${roomA.state.phase})`);
  a.start();
  b.start();
  await sleep(1000);

  const reloadBot = async () => {
    // What a page reload does: the old socket disappears without a goodbye, a new page connects
    // with the stored reconnection token, and its client starts with a fresh predictor (seq 0).
    const token = b.room.reconnectionToken;
    b.stop();
    // The old page is gone: its SDK must not auto-reconnect (that would consume the token).
    (b.room as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    (b.room.connection as unknown as { transport: { ws: WebSocket } }).transport.ws.close(3001); // not 4000: that is CONSENTED (a deliberate leave)
    b.room.removeAllListeners();
    await sleep(300);
    const room = await new Client(PROXY).reconnect<MatchState>(token, MatchStateSchema);
    b.latestState = null;
    b.clock = new ServerClock();
    b.outbox = [];
    b.acc = 0;
    b.attach(room, true);
    b.start();
  };

  const results: ScenarioResult[] = [];
  for (const s of SCENARIOS) {
    if (ONLY && !s.name.includes(ONLY)) continue;
    let r: ScenarioResult;
    try {
      r = await runScenario(s, [a, b], roomA.roomId, reloadBot);
    } catch (err) {
      r = { scenario: s, pendingBound: pendingBound(s), bots: [], failures: [`error: ${String(err)}`] };
    }
    results.push(r);
    if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
    const row = r.bots
      .map(
        (x) =>
          `${x.bot}: pend p50/p95/max ${x.client.pendingP50}/${x.client.pendingP95}/${x.client.pendingMax} (ever ${x.client.pendingMaxEver}) ` +
          `ackAgeMax ${x.client.ackAgeMaxMs}ms srvQ p95/max ${x.server.queueP95}/${x.server.queueMax} ` +
          `afterQ ${x.server.queueAfterRecovery} ovf ${x.server.overflow} trim ${x.server.trimmed} dup ${x.server.duplicate} ` +
          `corr ${x.client.corrections} (max ${x.client.correctionMax}px, snaps ${x.client.snaps}) ` +
          `err ${x.converged.errPx}px shots ${x.shots.predicted}/${x.shots.server}` +
          (x.recoveryMs !== null ? ` recovery ${x.recoveryMs}ms` : "") +
          (x.drops || x.reconnects ? ` drops ${x.drops} reconnects ${x.reconnects}` : "") +
          (x.client.stallEvents ? ` guard ${x.client.stallEvents}x/${x.client.stallMs}ms` : "") +
          (x.leftCode !== null ? ` LEFT(${x.leftCode})` : "") +
          (x.ackRegressions.length ? ` ackRegressions ${JSON.stringify(x.ackRegressions.slice(0, 3))}` : ""),
      )
      .join("\n   ");
    console.log(`${r.failures.length ? "FAIL" : "ok  "} ${s.name} (bound ${r.pendingBound})\n   ${row}`);
    for (const f of r.failures) console.log(`     ✗ ${f}`);
  }
  a.stop();
  b.stop();
  await netem("", { latency: 0, jitter: 0, spikeRate: 0 });
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  await Promise.allSettled([a.room.leave(), b.room.leave()]);
  const failed = results.filter((r) => r.failures.length > 0).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
