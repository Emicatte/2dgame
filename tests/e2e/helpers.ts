import { type Browser, chromium, expect, type Page } from "@playwright/test";

/** Test hooks exposed by ArenaScene in dev/E2E builds (`window.__scrapline`). */
export interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  players(): {
    id: string;
    x: number;
    y: number;
    alive: boolean;
    hp: number;
    kills: number;
    deaths: number;
  }[];
  rendered(id: string): { x: number; y: number; visible: boolean } | null;
  toScreen(x: number, y: number): { x: number; y: number };
  createDebugRoom(
    spawns: { x: number; y: number }[],
    map?: string,
    vehicles?: { kind: string; x: number; y: number; angle: number }[],
  ): Promise<void>;
  net(): NetSnapshot;
  vehicles(): {
    id: string;
    kind: string;
    x: number;
    y: number;
    angle: number;
    alt: number;
    hp: number;
    status: number;
    seats: string[];
  }[];
  mount(): { vehicle: string; seat: number } | null;
  enterTarget(): string | null;
  objectives(): {
    id: string;
    kind: string;
    team: number;
    x: number;
    y: number;
    carrier: string;
    home: boolean;
  }[];
  flagStand(team: 1 | 2): { x: number; y: number };
  renderedVehicle(id: string): { x: number; y: number; angle: number; alt: number } | null;
}

export interface NetSnapshot {
  generated: number;
  sent: number;
  acked: number;
  pending: number;
  pendingP95: number;
  pendingMax: number;
  pendingMaxEver: number;
  ackAgeMs: number;
  ackAgeMaxMs: number;
  corrections: number;
  snaps: number;
  correctionMax: number;
  staleAcks: number;
  resyncs: number;
  stallEvents: number;
  stallMs: number;
  starvedFrames: number;
  seq: number;
  fps: number;
  frameP95Ms: number;
  frameMaxMs: number;
  stalled: boolean;
}

export interface ServerInputStats {
  messages: number;
  received: number;
  accepted: number;
  duplicate: number;
  overflow: number;
  trimmed: number;
  processed: number;
  queueMax: number;
}

export const SERVER = "http://localhost:2600";
export const PROXY = "http://localhost:2610";
export const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
export const NET_LATENCY = Number(process.env.E2E_LATENCY_MS ?? 0);
export const NET_JITTER = Number(process.env.E2E_JITTER_MS ?? 0);
export const NET_SPIKES = Number(process.env.E2E_SPIKE_RATE ?? 0) > 0;
// Open, wall-free lane of Industrial Arena (verified by the server simulation tests).
export const DUEL_SPAWNS = [
  { x: 1000, y: 1180 },
  { x: 1400, y: 1180 },
];

export function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
}

export async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  try {
    await expect(page.getByTestId("quick-match")).toBeVisible({ timeout: 10_000 });
  } catch (err) {
    console.log(
      `[onboard ${name}] page text: ${((await page.locator("body").textContent()) ?? "").slice(0, 400)}`,
    );
    throw err;
  }
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

/** Runs `fn` in the page with the game's test hooks as argument. */
export const hooks = <T>(page: Page, fn: (h: Hooks) => T | Promise<T>) =>
  page.evaluate((src) => {
    const h = (window as unknown as { __scrapline: unknown }).__scrapline;
    // Test-only bridge: runs a serialized callback in the page with the game hooks as argument.
    return new Function("h", `return (${src})(h);`)(h);
  }, fn.toString()) as Promise<T>;

export const net = (page: Page) => hooks(page, (h) => h.net());

/** A hosts a private duel room, B joins with the code shown in A's lobby, the match starts. */
export async function startDuel(a: Page, b: Page): Promise<{ aId: string; bId: string; roomId: string }> {
  await a.evaluate(
    (spawns) => (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(spawns),
    DUEL_SPAWNS,
  );
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await b.getByTestId("join-room").click();
  await b.getByTestId("room-code-input").fill(code);
  await b.getByTestId("join-submit").click();
  await expect(b.getByTestId("room-code")).toHaveText(code);
  await expect(a.getByTestId("lobby-players")).toContainText("Bravo");
  await expect(b.getByTestId("lobby-players")).toContainText("Alpha");
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  await expect(a.getByTestId("hud")).toBeVisible();
  await expect(b.getByTestId("hud")).toBeVisible();
  await a.waitForFunction(
    () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
    null,
    { timeout: 15_000 },
  );
  const ids = await hooks(a, (h) => ({ self: h.selfId(), all: h.players().map((p) => p.id) }));
  expect(ids.all).toHaveLength(2);
  const rooms = (await (await fetch(`${SERVER}/api/debug/rooms`)).json()) as {
    roomId: string;
    code: string;
  }[];
  const room = rooms.find((r) => r.code === code)!;
  return { aId: ids.self!, bId: ids.all.find((id) => id !== ids.self)!, roomId: room.roomId };
}

export async function serverInputs(
  roomId: string,
): Promise<Map<string, ServerInputStats & { queue: number }>> {
  const rooms = (await (await fetch(`${SERVER}/api/debug/rooms`)).json()) as {
    roomId: string;
    players: { id: string; queue: number; inputs: ServerInputStats }[];
  }[];
  const r = rooms.find((x) => x.roomId === roomId);
  return new Map((r?.players ?? []).map((p) => [p.id, { ...p.inputs, queue: p.queue }]));
}

export async function netem(path: string, body?: unknown) {
  const res = await fetch(`${PROXY}/__netem${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

/**
 * Upper bound for unacknowledged inputs in steady state (frames): an input waits up to one frame
 * before it is sent, crosses the network both ways (RTT + jitter each way), waits up to one server
 * tick (plus one more when a long client frame delivers more than a tick consumes), and its ack
 * waits up to one frame before it is read. `frameMs` is the browser's measured worst frame time.
 */
export function pendingBound(frameMs: number, extraMs = 0): number {
  const ms = NET_LATENCY + 2 * NET_JITTER + 2 * 50 + 2 * frameMs + extraMs;
  return Math.ceil(ms / (1000 / 60)) + 2;
}

/** Periodically records the client netcode metrics of a page while `run` executes. */
export async function sampleWhile<T>(page: Page, run: () => Promise<T>, everyMs = 250) {
  const samples: NetSnapshot[] = [];
  let done = false;
  const loop = (async () => {
    while (!done) {
      samples.push(await net(page));
      await page.waitForTimeout(everyMs);
    }
  })();
  try {
    return { result: await run(), samples };
  } finally {
    done = true;
    await loop;
  }
}

/** Prints the netcode metrics of a run (kept in the test log as evidence). */
export function report(
  label: string,
  clients: Record<string, NetSnapshot>,
  srv: Map<string, { duplicate: number; overflow: number; trimmed: number; queueMax: number }>,
  bound: number,
) {
  const rows = Object.entries(clients).map(
    ([k, n]) =>
      `${k}: fps ${n.fps} (frame p95 ${n.frameP95Ms} ms, max ${n.frameMaxMs} ms) pending now/p95/max ${n.pending}/${n.pendingP95}/${n.pendingMaxEver} ` +
      `ackAgeMax ${n.ackAgeMaxMs} ms corr ${n.corrections} (max ${n.correctionMax}px, snaps ${n.snaps}) ` +
      `stale ${n.staleAcks} guard ${n.stallEvents}x/${n.stallMs}ms starved ${n.starvedFrames}`,
  );
  const s = [...srv.values()].map(
    (v) => `dup ${v.duplicate} ovf ${v.overflow} trim ${v.trimmed} qmax ${v.queueMax}`,
  );
  console.log(`[netcode:${label}] bound ${bound}\n  ${rows.join("\n  ")}\n  server: ${s.join(" | ")}`);
}
