#!/usr/bin/env node
/**
 * Runs the offline client benchmark (apps/web/bench.html) in Chrome and saves the JSON report.
 *
 *   pnpm --filter @scrapline/web build && pnpm --filter @scrapline/web preview &
 *   node tests/perf/run-bench.mjs --url http://localhost:4173/bench.html --out bench.json \
 *        [--gpu] [--width 1920 --height 1080] [--query "players=8&quality=high&seconds=30"]
 *
 * Without --gpu Chrome is forced onto SwiftShader (software WebGL), which is what headless CI has:
 * those numbers measure CPU-side cost only and say nothing about a real GPU. With --gpu the
 * browser's default GPU path is used (run it on a machine with a display/GPU). The report always
 * records the WebGL renderer string, so the two can never be confused.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const url = `${arg("url", "http://localhost:4173/bench.html")}${arg("query", "") ? `?${arg("query", "")}` : ""}`;
const out = arg("out", "bench-report.json");
const width = Number(arg("width", 1366));
const height = Number(arg("height", 768));
const chrome = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const args = has("gpu")
  ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
  : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const browser = await chromium.launch({ executablePath: chrome, headless: !has("headed"), args });
const page = await browser.newPage({ viewport: { width, height } });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url);
const t0 = Date.now();
const timer = setInterval(async () => {
  const phase = await page
    .locator("[data-testid=bench-phase]")
    .first()
    .textContent()
    .catch(() => "");
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${phase}`);
}, 10_000);
await page.waitForFunction(() => window.__bench?.done === true, null, { timeout: 20 * 60_000 });
clearInterval(timer);
const report = await page.evaluate(() => window.__bench.report);
writeFileSync(out, JSON.stringify(report, null, 2));
const r = report.runs[0]?.perf.renderer;
console.log(
  `renderer: ${r?.renderer} (software: ${r?.software}) canvas ${r?.canvas.width}x${r?.canvas.height}`,
);
for (const run of report.runs) {
  const p = run.perf;
  console.log(
    `${run.quality.padEnd(4)} ${String(run.players).padStart(2)}p  fps ${String(p.fpsAvg).padStart(6)}  frame p50/p95/p99 ${p.frameMs.p50}/${p.frameMs.p95}/${p.frameMs.p99} ms  update p95 ${p.updateMs.p95}  render p95 ${p.renderMs.p95}  >25ms ${p.longFrames25}  heap ${p.heapMaxMB} MB  tex ${p.textureMB} MB  objs ${p.objects}  sim ${run.localSimTickMs.avg}/${run.localSimTickMs.max} ms`,
  );
}
await browser.close();
