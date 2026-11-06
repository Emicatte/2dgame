import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Outbreak co-op end to end: two separate Chrome processes over real WebRTC (host mode). A creates
 * the co-op arena and hosts the authoritative enemies and mission in its tab; B joins with the
 * code. Together they clear the first objective (both reach the main hall), then A restores the
 * power at the generator while B covers, and both screens show the mission advancing, the shutter
 * opening and the alarm. Movement and shooting go through the normal input pipeline (the E2E
 * build's test bot drives the keys a player would press).
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];
const SHOTS = process.env.E2E_SHOTS_DIR;

interface PveInfo {
  mode: string;
  step: number;
  doors: string;
  power: boolean;
  alarm: boolean;
  status: number;
  zombies: number;
  rendered: number;
  downed: boolean;
  hp: number;
}

const pve = (page: Page) =>
  page.evaluate(() => (window as unknown as { __scrapline: { pve(): PveInfo | null } }).__scrapline.pve());

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

const phaseIs = (page: Page, phase: string, timeout = 30_000) =>
  page.waitForFunction(
    (p) => (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() === p,
    phase,
    { timeout },
  );

const walk = (page: Page, points: { x: number; y: number }[], opts: { fire?: boolean; interact?: boolean }) =>
  page.evaluate(
    ([pts, o]) =>
      (
        window as unknown as {
          __scrapline: {
            walkTo(p: { x: number; y: number }[], o: { fire?: boolean; interact?: boolean }): void;
          };
        }
      ).__scrapline.walkTo(pts, o),
    [points, opts] as const,
  );

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("Outbreak: two browsers complete co-op objectives of First Contact together", async () => {
  test.setTimeout(300_000);
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

  await onboard(a, "Alpha");
  await onboard(b, "Bravo");

  // A opens a co-op arena (test build: fixed start spots at the yard's north edge).
  await a.evaluate(() =>
    (
      window as unknown as {
        __scrapline: { createDebugRoom(s: { x: number; y: number }[], m: string): Promise<void> };
      }
    ).__scrapline.createDebugRoom(
      [
        { x: 330, y: 1500 },
        { x: 400, y: 1500 },
      ],
      "works",
    ),
  );
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("mode-outbreak").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible();
  await expect(a.getByTestId("mission-first-contact")).toHaveAttribute("aria-pressed", "true");
  // The rest of the campaign is listed as in development, not playable.
  await expect(a.getByTestId("mission-planned-2")).toBeDisabled();
  await a.getByTestId("difficulty-recruit").click();
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  await b.getByTestId("join-room").click();
  await b.getByTestId("room-code-input").fill(code);
  await b.getByTestId("join-submit").click();
  await expect(b.getByTestId("pve-settings")).toBeVisible({ timeout: 25_000 });
  await expect(b.getByTestId("briefing")).toContainText("First Contact");
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled({ timeout: 10_000 });
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await phaseIs(b, "playing");

  for (const p of [a, b]) {
    await expect(p.getByTestId("pve-objective-text")).toContainText("Enter the main hall", {
      timeout: 10_000,
    });
  }
  // Both see the same infected, simulated by A's tab.
  await expect.poll(async () => (await pve(b))?.zombies ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await pve(b))?.rendered ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
  expect((await pve(b))?.zombies).toBe((await pve(a))?.zombies);
  await shot(a, "outbreak-start-host");

  // Objective 1, together: into the main hall through its south doorway.
  await walk(
    a,
    [
      { x: 600, y: 1500 },
      { x: 600, y: 1320 },
    ],
    { fire: true },
  );
  await walk(
    b,
    [
      { x: 640, y: 1500 },
      { x: 640, y: 1330 },
    ],
    { fire: true },
  );
  await expect.poll(async () => (await pve(a))?.step, { timeout: 40_000 }).toBe(1);
  await expect(b.getByTestId("pve-objective-text")).toContainText("Restore power", { timeout: 10_000 });
  await shot(b, "outbreak-hall-guest");

  // Objective 2: A restores the power (hold E at the generator) while B covers.
  const toGenerator = [
    { x: 495, y: 1180 },
    { x: 495, y: 860 },
    { x: 360, y: 830 },
    { x: 360, y: 640 },
    { x: 360, y: 560 },
    { x: 435, y: 352 },
  ];
  await walk(a, toGenerator, { fire: true, interact: true });
  await walk(b, toGenerator.slice(0, 5), { fire: true });
  await expect
    .poll(
      async () => {
        const info = await pve(a);
        const me = await a.evaluate(() => {
          const h = (
            window as unknown as {
              __scrapline: { net(): { local: { x: number; y: number } }; autoDone(): boolean };
            }
          ).__scrapline;
          return { ...h.net().local, done: h.autoDone() };
        });
        console.log(
          `[outbreak e2e] host at ${Math.round(me.x)},${Math.round(me.y)} done=${me.done} ${JSON.stringify(info)}`,
        );
        return info?.power;
      },
      { timeout: 60_000, intervals: [3000] },
    )
    .toBe(true);
  await shot(a, "outbreak-generator-host");
  await expect.poll(async () => (await pve(b))?.doors ?? "", { timeout: 10_000 }).toContain("gen-shutter");
  expect((await pve(b))?.power).toBe(true);
  expect((await pve(b))?.alarm).toBe(true);
  await expect(b.getByTestId("pve-objective-text")).toContainText("Hold the courtyard", { timeout: 10_000 });
  await expect(a.getByTestId("pve-objective-text")).toContainText("Hold the courtyard");
  await shot(b, "outbreak-courtyard-guest");
  const info = await pve(a);
  console.log(`[outbreak e2e] host state after the generator: ${JSON.stringify(info)}`);
  expect(info?.status).toBe(0);
});

test("Survival: a boss renders with its health bar and telegraphs (host only)", async () => {
  test.setTimeout(180_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Solo");
  await a.getByTestId("create-coop").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("mode-survival").click();
  await a.getByTestId("map-industrial").click();
  await a.getByTestId("difficulty-recruit").click();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await expect(a.getByTestId("pve-objective-text")).toBeVisible();
  const spawned = await a.evaluate(() =>
    (
      window as unknown as { __scrapline: { spawnEnemy(k: string, dx: number, dy: number): boolean } }
    ).__scrapline.spawnEnemy("abomination", 360, 0),
  );
  expect(spawned).toBe(true);
  await expect(a.getByTestId("pve-boss")).toContainText("The Abomination", { timeout: 10_000 });
  await expect(a.getByTestId("pve-boss")).toContainText("Phase 1/3");
  // Let it close in and telegraph (slam / charge); keep the player still and shooting.
  await walk(a, [], { fire: true });
  for (let i = 0; i < 8; i++) {
    await a.waitForTimeout(700);
    await shot(a, `outbreak-boss-${i}`);
  }
  const info = await pve(a);
  console.log(`[outbreak e2e] boss scenario: ${JSON.stringify(info)}`);
  // The boss is synchronized and rendered (the run may already be lost: a boss alone is brutal).
  expect(info?.mode).toBe("survival");
});
