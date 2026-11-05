import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Host mode end to end: two separate Chrome processes, real WebRTC DataChannel between them, the
 * signaling endpoint of the dev server. A creates the arena (and runs the match in its tab), B joins
 * with the code, they play, B reloads mid-match and takes its seat back, then the host closes.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  // Headless containers cannot resolve mDNS host candidates: expose plain addresses instead.
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  players(): { id: string; x: number; y: number; alive: boolean }[];
  net(): {
    stalled: boolean;
    pendingMaxEver: number;
    staleAcks: number;
    corrections: number;
    snaps: number;
    fps: number;
  };
}

const hooks = <T>(page: Page, fn: (h: Hooks) => T) =>
  page.evaluate((src) => {
    const h = (window as unknown as { __scrapline: unknown }).__scrapline;
    return new Function("h", `return (${src})(h);`)(h);
  }, fn.toString()) as Promise<T>;

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("quick-match")).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

const phaseIs = (page: Page, phase: string, timeout = 20_000) =>
  page.waitForFunction(
    (p) => (window as unknown as { __scrapline?: Hooks }).__scrapline?.phase() === p,
    phase,
    { timeout },
  );

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("host mode: create, join by code, play, reload and resume, host closes", async () => {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

  await onboard(a, "Alpha");
  await onboard(b, "Bravo");

  // A creates an arena hosted in its own tab.
  await a.getByTestId("create-room").click();
  await a.getByTestId("create-submit").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  // B joins with the code over WebRTC.
  const t0 = Date.now();
  await b.getByTestId("join-room").click();
  await b.getByTestId("room-code-input").fill(code);
  await b.getByTestId("join-submit").click();
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  console.log(`[hostmode] join took ${Date.now() - t0} ms`);
  await expect(a.getByTestId("lobby-players")).toContainText("Bravo");
  await expect(b.getByTestId("lobby-players")).toContainText("Alpha");
  await expect(b.getByTestId("host-hint")).toHaveCount(0);

  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await phaseIs(b, "playing");

  const bId = (await hooks(b, (h) => h.selfId()))!;
  const aId = (await hooks(a, (h) => h.selfId()))!;
  expect(bId).not.toBe(aId);

  // B moves; the host's authoritative state and B's own view agree.
  const before = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
  await b.keyboard.down("KeyS");
  await b.waitForTimeout(1200);
  await b.keyboard.up("KeyS");
  await b.waitForTimeout(800);
  const onHost = (await hooks(a, (h) => h.players())).find((p) => p.id === bId)!;
  const onGuest = (await hooks(b, (h) => h.players())).find((p) => p.id === bId)!;
  expect(Math.abs(onHost.y - before.y)).toBeGreaterThan(50);
  expect(Math.abs(onGuest.y - onHost.y)).toBeLessThan(1);
  expect(Math.abs(onGuest.x - onHost.x)).toBeLessThan(1);
  // A (host) moves too, and B sees it.
  const aBefore = (await hooks(b, (h) => h.players())).find((p) => p.id === aId)!;
  await a.keyboard.down("KeyW");
  await a.waitForTimeout(1000);
  await a.keyboard.up("KeyW");
  await a.waitForTimeout(800);
  const aAfter = (await hooks(b, (h) => h.players())).find((p) => p.id === aId)!;
  expect(Math.abs(aAfter.y - aBefore.y)).toBeGreaterThan(50);

  const nb = await hooks(b, (h) => h.net());
  console.log(`[hostmode] guest netcode: ${JSON.stringify(nb)}`);
  expect(nb.stalled).toBe(false);
  expect(nb.staleAcks).toBe(0);
  expect(nb.corrections - nb.snaps).toBeLessThanOrEqual(2);

  // B reloads mid-match: the stored seat token takes the same seat back.
  await b.reload();
  await phaseIs(b, "playing", 45_000);
  expect(await hooks(b, (h) => h.selfId())).toBe(bId);
  expect((await hooks(a, (h) => h.players())).filter((p) => p.id === bId)).toHaveLength(1);

  // The host leaves: B is told and returns to the menu.
  await a.close();
  await expect(b.getByText("The host closed the arena.")).toBeVisible({ timeout: 15_000 });
  await expect(b.getByTestId("join-room")).toBeVisible();
});
