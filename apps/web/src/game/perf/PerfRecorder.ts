import Phaser from "phaser";
import { RollingStats } from "../net/metrics.ts";

/**
 * Frame-level performance recorder (diagnostics only; it never changes what is rendered).
 *
 * Per frame it measures, on the CPU side:
 * - frame interval: time between two game steps (what the player perceives as FPS);
 * - update: game step start to render start (input, simulation, scene logic, effects, HUD);
 * - render: render start to render end (WebGL command submission; GPU execution is asynchronous,
 *   so a GPU-bound frame shows up as a long frame interval with short update + render).
 * Also JS heap (Chromium only), estimated texture memory and object counts.
 */
export interface PerfSnapshot {
  frames: number;
  seconds: number;
  fpsAvg: number;
  frameMs: { p50: number; p95: number; p99: number; max: number };
  updateMs: { p50: number; p95: number; max: number };
  renderMs: { p50: number; p95: number; max: number };
  /** Frames longer than 1.5x and 3x a 60 Hz frame. */
  longFrames25: number;
  longFrames50: number;
  heapMB: number | null;
  heapMaxMB: number | null;
  textureMB: number;
  textures: number;
  objects: number;
  renderer: RendererInfo;
}

export interface RendererInfo {
  type: "webgl" | "canvas";
  vendor: string;
  renderer: string;
  /** True when WebGL runs in software (SwiftShader / llvmpipe): not representative of a GPU. */
  software: boolean;
  devicePixelRatio: number;
  canvas: { width: number; height: number };
}

const SIZE = 7200; // 2 minutes at 60 FPS

export class PerfRecorder {
  /** The recorder of the running game scene (read by the benchmark page). */
  static active: PerfRecorder | null = null;
  private readonly frame = new RollingStats(SIZE);
  private readonly update = new RollingStats(SIZE);
  private readonly render = new RollingStats(SIZE);
  private stepAt = 0;
  private renderAt = 0;
  private lastStepAt = 0;
  private startedAt = performance.now();
  private frames = 0;
  private long25 = 0;
  private long50 = 0;
  private heapMax = 0;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly game: Phaser.Game,
    private readonly countObjects: () => number = () => 0,
  ) {
    PerfRecorder.active = this;
    const ev = Phaser.Core.Events;
    const onPreStep = () => {
      const now = performance.now();
      if (this.lastStepAt > 0) {
        const dt = now - this.lastStepAt;
        this.frame.push(dt);
        this.frames++;
        if (dt > 25) this.long25++;
        if (dt > 50) this.long50++;
      }
      this.lastStepAt = now;
      this.stepAt = now;
    };
    const onPreRender = () => {
      this.renderAt = performance.now();
      if (this.stepAt > 0) this.update.push(this.renderAt - this.stepAt);
    };
    const onPostRender = () => {
      if (this.renderAt > 0) this.render.push(performance.now() - this.renderAt);
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (heap && heap > this.heapMax) this.heapMax = heap;
    };
    game.events.on(ev.PRE_STEP, onPreStep);
    game.events.on(ev.PRE_RENDER, onPreRender);
    game.events.on(ev.POST_RENDER, onPostRender);
    this.off.push(
      () => game.events.off(ev.PRE_STEP, onPreStep),
      () => game.events.off(ev.PRE_RENDER, onPreRender),
      () => game.events.off(ev.POST_RENDER, onPostRender),
    );
  }

  reset(): void {
    this.frame.clear();
    this.update.clear();
    this.render.clear();
    this.frames = 0;
    this.long25 = 0;
    this.long50 = 0;
    this.heapMax = 0;
    this.lastStepAt = 0;
    this.startedAt = performance.now();
  }

  destroy(): void {
    for (const f of this.off) f();
    if (PerfRecorder.active === this) PerfRecorder.active = null;
  }

  snapshot(): PerfSnapshot {
    const objects = this.countObjects();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const seconds = (performance.now() - this.startedAt) / 1000;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const tex = textureMemory(this.game);
    return {
      frames: this.frames,
      seconds: r2(seconds),
      fpsAvg: seconds > 0 ? r2(this.frames / seconds) : 0,
      frameMs: {
        p50: r2(this.frame.percentile(50)),
        p95: r2(this.frame.percentile(95)),
        p99: r2(this.frame.percentile(99)),
        max: r2(this.frame.max()),
      },
      updateMs: {
        p50: r2(this.update.percentile(50)),
        p95: r2(this.update.percentile(95)),
        max: r2(this.update.max()),
      },
      renderMs: {
        p50: r2(this.render.percentile(50)),
        p95: r2(this.render.percentile(95)),
        max: r2(this.render.max()),
      },
      longFrames25: this.long25,
      longFrames50: this.long50,
      heapMB: heap ? r2(heap / 1048576) : null,
      heapMaxMB: this.heapMax ? r2(this.heapMax / 1048576) : null,
      textureMB: r2(tex.bytes / 1048576),
      textures: tex.count,
      objects,
      renderer: rendererInfo(this.game),
    };
  }
}

function textureMemory(game: Phaser.Game): { bytes: number; count: number } {
  let bytes = 0;
  let count = 0;
  const list = (game.textures as unknown as { list: Record<string, Phaser.Textures.Texture> }).list;
  for (const [key, tex] of Object.entries(list)) {
    if (key.startsWith("__")) continue;
    count++;
    for (const src of tex.source) bytes += src.width * src.height * 4;
  }
  return { bytes, count };
}

export function rendererInfo(game: Phaser.Game): RendererInfo {
  const canvas = { width: game.canvas.width, height: game.canvas.height };
  if (game.renderer.type !== Phaser.WEBGL) {
    return {
      type: "canvas",
      vendor: "",
      renderer: "",
      software: true,
      devicePixelRatio: devicePixelRatio,
      canvas,
    };
  }
  const gl = (game.renderer as unknown as { gl: WebGLRenderingContext }).gl;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return {
    type: "webgl",
    vendor,
    renderer,
    software: /swiftshader|llvmpipe|software|basic render/i.test(renderer),
    devicePixelRatio,
    canvas,
  };
}
