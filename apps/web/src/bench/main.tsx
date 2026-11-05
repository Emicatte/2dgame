import type { Room } from "@colyseus/sdk";
import { BTN, type MapId, type MatchState } from "@scrapline/shared";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GameCanvas } from "../components/GameCanvas.tsx";
import { autopilot } from "../game/bench/autopilot.ts";
import { PerfRecorder, type PerfSnapshot } from "../game/perf/PerfRecorder.ts";
import { type GraphicsQuality, settingsStore } from "../lib/settings.ts";
import { session } from "../net/session.ts";
import { InGame } from "../screens/InGame.tsx";
import { LocalRoom } from "./LocalRoom.ts";
import "../styles/global.css";
import "../styles/screens.css";
import "./bench.css";

/**
 * Offline, repeatable client benchmark: the real game scene and HUD render a real match simulation
 * (bench/LocalRoom.ts) with 1, 2 or 8 players at High and Low quality, driven by a scripted local
 * player. No server or network is involved, so results depend only on the device and browser.
 *
 *   /bench.html                      full matrix (players 1,2,8 x quality high,low)
 *   /bench.html?players=8&quality=low&seconds=30&warmup=5
 */
export interface BenchRun {
  players: number;
  quality: GraphicsQuality;
  map: MapId;
  perf: PerfSnapshot;
  /** Simulation cost on the main thread (on the real server in a match, not in the client). */
  localSimTickMs: { avg: number; max: number };
  /** How the 20 Hz simulation was scheduled (timer vs animation frames) and the worst timer gap. */
  schedule: { byTimer: number; byFrame: number; timerMaxGapMs: number };
}

export interface BenchReport {
  version: 1;
  startedAt: string;
  userAgent: string;
  hardwareConcurrency: number;
  deviceMemoryGB: number | null;
  viewport: { width: number; height: number; devicePixelRatio: number };
  runs: BenchRun[];
}

const params = new URLSearchParams(location.search);
const list = <T extends string>(key: string, def: T[]): T[] =>
  (params.get(key)?.split(",").filter(Boolean) as T[] | undefined) ?? def;
const PLAYERS = list("players", ["1", "2", "8"]).map(Number);
const QUALITIES = list<GraphicsQuality>("quality", ["high", "low"]);
const SECONDS = Number(params.get("seconds") ?? 15);
const WARMUP = Number(params.get("warmup") ?? 4);
const MAP = (params.get("map") ?? "industrial") as MapId;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Live sampling for automation (heap/leak checks): the current run's recorder.
(window as unknown as { __perf?: () => PerfSnapshot | undefined }).__perf = () =>
  PerfRecorder.active?.snapshot();

/** Scripted local player: wanders, aims at the nearest opponent, fires in bursts, dashes. */
function installAutopilot(room: LocalRoom) {
  autopilot.set((step, self) => {
    const seg = Math.floor(step / 90) % 9;
    const a = (seg * Math.PI) / 4;
    let aim = a;
    let best = Number.POSITIVE_INFINITY;
    room.state.players.forEach((p, id) => {
      if (id === room.sessionId || !p.alive) return;
      const d = (p.x - self.x) ** 2 + (p.y - self.y) ** 2;
      if (d < best) {
        best = d;
        aim = Math.atan2(p.y - self.y, p.x - self.x);
      }
    });
    let buttons = 0;
    if (step % 60 < 30 && step % 2 === 0) buttons |= BTN.FIRE;
    if (step % 240 === 120) buttons |= BTN.DASH;
    return {
      mx: seg === 8 ? 0 : Math.round(Math.cos(a)),
      my: seg === 8 ? 0 : Math.round(Math.sin(a)),
      aim,
      buttons,
    };
  });
}

async function runOne(
  players: number,
  quality: GraphicsQuality,
  onPhase: (s: string) => void,
): Promise<BenchRun> {
  settingsStore.patch({ quality, showDebug: false });
  const room = new LocalRoom({ players, map: MAP });
  installAutopilot(room);
  session.attachLocal(room as unknown as Room<unknown, MatchState>);
  room.start();
  onPhase(`warm-up ${WARMUP}s`);
  await sleep(WARMUP * 1000);
  PerfRecorder.active?.reset();
  room.resetDiagnostics();
  onPhase(`measuring ${SECONDS}s`);
  await sleep(SECONDS * 1000);
  const perf = PerfRecorder.active?.snapshot();
  if (!perf) throw new Error("game scene not running");
  const tc = room.tickCost;
  const schedule = { ...room.schedule, timerMaxGapMs: Math.round(room.schedule.timerMaxGapMs) };
  await session.leave();
  autopilot.set(null);
  await sleep(500);
  return {
    players,
    quality,
    map: MAP,
    perf,
    localSimTickMs: {
      avg: tc.count ? Math.round((tc.total / tc.count) * 1000) / 1000 : 0,
      max: Math.round(tc.max * 1000) / 1000,
    },
    schedule,
  };
}

function BenchApp() {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("loading the game engine");
  const [report, setReport] = useState<BenchReport | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const rep: BenchReport = {
        version: 1,
        startedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        runs: [],
      };
      setRunning(true);
      for (const q of QUALITIES) {
        for (const n of PLAYERS) {
          if (cancelled) return;
          rep.runs.push(await runOne(n, q, (s) => setPhase(`${n} player(s), ${q}: ${s}`)));
        }
      }
      setRunning(false);
      setPhase("done");
      setReport(rep);
      (window as unknown as { __bench?: unknown }).__bench = { done: true, report: rep };
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  return (
    <>
      <GameCanvas onReady={() => setReady(true)} />
      {running && <InGame onSettings={() => undefined} />}
      <div className="bench-panel" data-testid="bench-panel">
        <strong>SCRAPLINE benchmark</strong>
        <span>
          Automated measurement: the player is driven by a script (keyboard and mouse are ignored). This is
          not the playable game.
        </span>
        <span data-testid="bench-phase">{phase}</span>
        {report && <Results report={report} />}
      </div>
    </>
  );
}

function Results({ report }: { report: BenchReport }) {
  const r0 = report.runs[0]?.perf.renderer;
  return (
    <div className="bench-results">
      <div>
        {r0?.renderer} {r0?.software ? "(SOFTWARE RENDERING: not representative of a GPU)" : ""}
      </div>
      <div>
        canvas {r0?.canvas.width}x{r0?.canvas.height}, DPR {report.viewport.devicePixelRatio},{" "}
        {report.hardwareConcurrency} threads
      </div>
      <table>
        <thead>
          <tr>
            <th>quality</th>
            <th>players</th>
            <th>FPS avg</th>
            <th>frame p50/p95/p99 ms</th>
            <th>update p95</th>
            <th>render p95</th>
            <th>&gt;25ms</th>
            <th>heap MB</th>
          </tr>
        </thead>
        <tbody>
          {report.runs.map((r) => (
            <tr key={`${r.quality}-${r.players}`}>
              <td>{r.quality}</td>
              <td>{r.players}</td>
              <td>{r.perf.fpsAvg}</td>
              <td>
                {r.perf.frameMs.p50}/{r.perf.frameMs.p95}/{r.perf.frameMs.p99}
              </td>
              <td>{r.perf.updateMs.p95}</td>
              <td>{r.perf.renderMs.p95}</td>
              <td>{r.perf.longFrames25}</td>
              <td>{r.perf.heapMaxMB ?? "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <textarea readOnly value={JSON.stringify(report, null, 2)} data-testid="bench-json" rows={6} />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <BenchApp />
  </StrictMode>,
);
