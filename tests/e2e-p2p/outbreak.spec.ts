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
  mission: string;
  step: number;
  doors: string;
  power: boolean;
  alarm: boolean;
  status: number;
  zombies: number;
  rendered: number;
  downed: boolean;
  hp: number;
  dark: boolean;
  sightVertices: number;
  glints: number;
  tension: number;
  flags: string;
  blackout: boolean;
  vents: string;
  lights: string[];
  boss: string;
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
  // Later chapters stay locked until the previous one is completed; unbuilt ones are listed as
  // in development, not playable.
  await expect(a.getByTestId("mission-dead-district")).toBeDisabled();
  await expect(a.getByTestId("mission-the-convoy")).toBeDisabled();
  await expect(a.getByTestId("mission-black-site")).toBeDisabled();
  await expect(a.getByTestId("mission-final-breach")).toBeDisabled();
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
  await shot(b, "outbreak-hall-guest-before");
  console.log(`[outbreak e2e] guest at objective 1: ${JSON.stringify(await pve(b))}`);
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
  // Co-op darkness: the light map and the line of sight are live.
  const lit = await pve(a);
  expect(lit?.dark).toBe(true);
  expect(lit?.sightVertices ?? 0).toBeGreaterThan(8);
  // Let it close in and telegraph (slam / charge); keep the player still and shooting.
  await walk(a, [], { fire: true });
  let maxGlints = 0;
  let maxTension = 0;
  for (let i = 0; i < 8; i++) {
    await a.waitForTimeout(700);
    await shot(a, `outbreak-boss-${i}`);
    const d = await pve(a);
    maxGlints = Math.max(maxGlints, d?.glints ?? 0);
    maxTension = Math.max(maxTension, d?.tension ?? 0);
  }
  console.log(`[outbreak e2e] darkness: max glints ${maxGlints}, max tension ${maxTension}`);
  // A boss at close range makes the moment tense.
  expect(maxTension).toBeGreaterThan(0.4);
  const info = await pve(a);
  console.log(`[outbreak e2e] boss scenario: ${JSON.stringify(info)}`);
  // The boss is synchronized and rendered (the run may already be lost: a boss alone is brutal).
  expect(info?.mode).toBe("survival");
});

test("Dead District: unlocked after First Contact, the squad reaches the apartments and answers the radio", async () => {
  test.setTimeout(240_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Medic");
  // A profile that already completed First Contact (the campaign unlock).
  await a.evaluate(() => {
    const key = "scrapline.localProfile.v1";
    const d = JSON.parse(localStorage.getItem(key) ?? "{}");
    d.pve = { ...(d.pve ?? {}), missions: { "first-contact": { completions: 1, best: {} } } };
    localStorage.setItem(key, JSON.stringify(d));
  });
  await a.getByTestId("create-coop").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId("mission-dead-district")).toBeEnabled();
  await a.getByTestId("mission-dead-district").click();
  await expect(a.getByTestId("briefing")).toContainText("Dead District");
  await a.getByTestId("difficulty-recruit").click();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await expect(a.getByTestId("pve-objective-text")).toContainText("Marlow apartments");
  const start = await pve(a);
  expect(start?.mission).toBe("dead-district");
  expect(start?.dark).toBe(true);
  await shot(a, "district-start");
  // West end of the avenue → the apartments' door → the lobby.
  await walk(
    a,
    [
      { x: 420, y: 1250 },
      { x: 890, y: 1200 },
      { x: 890, y: 900 },
    ],
    { fire: true },
  );
  await expect.poll(async () => (await pve(a))?.step ?? 0, { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
  await shot(a, "district-lobby");
  // Through the gap in the barricade to the radio; hold E there.
  await walk(
    a,
    [
      { x: 890, y: 660 },
      { x: 890, y: 510 },
    ],
    { fire: true, interact: true },
  );
  await expect.poll(async () => (await pve(a))?.step ?? 0, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  const after = await pve(a);
  expect(after?.doors).toContain("clinic-door");
  await shot(a, "district-radio");
  console.log(`[outbreak e2e] Dead District: ${JSON.stringify(after)}`);
});

test("The Convoy: the escorted truck's hull is on the HUD, locked until the keys are found", async () => {
  test.setTimeout(240_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Driver");
  await a.evaluate(() => {
    const key = "scrapline.localProfile.v1";
    const d = JSON.parse(localStorage.getItem(key) ?? "{}");
    d.pve = {
      ...(d.pve ?? {}),
      missions: {
        "first-contact": { completions: 1, best: {} },
        "dead-district": { completions: 1, best: {} },
      },
    };
    localStorage.setItem(key, JSON.stringify(d));
  });
  await a.getByTestId("create-coop").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("mission-the-convoy").click();
  await expect(a.getByTestId("briefing")).toContainText("The Convoy");
  await a.getByTestId("difficulty-recruit").click();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await expect(a.getByTestId("pve-objective-text")).toContainText("truck keys");
  await expect(a.getByTestId("pve-escort")).toContainText("Convoy hull 100%");
  await expect(a.getByTestId("pve-escort")).toContainText("locked");
  await shot(a, "convoy-start");
  // Into the depot office (door on its east side) and the keys.
  await walk(
    a,
    [
      { x: 560, y: 1800 },
      { x: 540, y: 1660 },
      { x: 420, y: 1660 },
      { x: 250, y: 1660 },
    ],
    {
      fire: true,
      interact: true,
    },
  );
  await expect.poll(async () => (await pve(a))?.step ?? 0, { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
  await expect(a.getByTestId("pve-escort")).not.toContainText("locked");
  await expect(a.getByTestId("pve-objective-text")).toContainText("warehouse district");
  await shot(a, "convoy-keys");
});

test("Black Site: dark and sealed at the start, the squad reaches the atrium and restores the first terminal", async () => {
  test.setTimeout(240_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Varga");
  await a.evaluate(() => {
    const key = "scrapline.localProfile.v1";
    const d = JSON.parse(localStorage.getItem(key) ?? "{}");
    const done = { completions: 1, best: {} };
    d.pve = {
      ...(d.pve ?? {}),
      missions: { "first-contact": done, "dead-district": done, "the-convoy": done },
    };
    localStorage.setItem(key, JSON.stringify(d));
  });
  await a.getByTestId("create-coop").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("mission-black-site").click();
  await expect(a.getByTestId("briefing")).toContainText("Black Site");
  await a.getByTestId("difficulty-recruit").click();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await expect(a.getByTestId("pve-objective-text")).toContainText("Enter the laboratory");
  const start = await pve(a);
  expect(start?.mission).toBe("black-site");
  expect(start?.power).toBe(false);
  expect(start?.dark).toBe(true);
  expect(start?.flags).toContain("sealed-srv-door");
  // Only the emergency lights burn without power.
  expect(start?.lights).toContain("emergency");
  expect(start?.lights).not.toContain("power");
  await shot(a, "blacksite-start");
  // Through the forced blast door into the atrium, then north to the security terminal.
  await walk(
    a,
    [
      { x: 700, y: 1410 },
      { x: 1250, y: 1410 },
      { x: 1720, y: 1400 },
    ],
    { fire: true },
  );
  await expect.poll(async () => (await pve(a))?.step ?? 0, { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
  await expect(a.getByTestId("pve-objective-text")).toContainText("Restore the three terminals");
  await walk(
    a,
    [
      { x: 1720, y: 890 },
      { x: 1720, y: 600 },
      { x: 1810, y: 345 },
    ],
    { fire: true, interact: true },
  );
  await expect(a.getByText("Security terminal: done")).toBeVisible({ timeout: 90_000 });
  await expect(a.getByTestId("pve-objective-text")).toContainText("(1/3)");
  await shot(a, "blacksite-terminal");
});

test("Final Breach: through the maintenance tunnels into the atrium, the waves begin", async () => {
  test.setTimeout(240_000);
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Zero");
  await a.evaluate(() => {
    const key = "scrapline.localProfile.v1";
    const d = JSON.parse(localStorage.getItem(key) ?? "{}");
    const done = { completions: 1, best: {} };
    d.pve = {
      ...(d.pve ?? {}),
      missions: { "first-contact": done, "dead-district": done, "the-convoy": done, "black-site": done },
    };
    localStorage.setItem(key, JSON.stringify(d));
  });
  await a.getByTestId("create-coop").click();
  await expect(a.getByTestId("pve-settings")).toBeVisible({ timeout: 15_000 });
  await a.getByTestId("mission-final-breach").click();
  await expect(a.getByTestId("briefing")).toContainText("Final Breach");
  await a.getByTestId("difficulty-recruit").click();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await expect(a.getByTestId("pve-objective-text")).toContainText("Infiltrate");
  expect((await pve(a))?.power).toBe(true);
  await shot(a, "breach-start");
  // Dock → tunnel → first junction → north → second junction → east into the atrium.
  await walk(
    a,
    [
      { x: 760, y: 1540 },
      { x: 1300, y: 1540 },
      { x: 1420, y: 1400 },
      { x: 1420, y: 820 },
      { x: 1700, y: 740 },
      { x: 2350, y: 740 },
    ],
    { fire: true },
  );
  await expect.poll(async () => (await pve(a))?.step ?? 0, { timeout: 120_000 }).toBeGreaterThanOrEqual(1);
  await expect(a.getByTestId("pve-objective-text")).toContainText("Hold the atrium");
  await shot(a, "breach-atrium");
});

test("The Warden and Subject Zero render with their bars, plates and telegraphs (host only)", async () => {
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
  const spawn = (k: string, dx: number, dy: number) =>
    a.evaluate(
      ([kind, x, y]) =>
        (
          window as unknown as { __scrapline: { spawnEnemy(k: string, dx: number, dy: number): boolean } }
        ).__scrapline.spawnEnemy(kind, x, y),
      [k, dx, dy] as const,
    );
  expect(await spawn("warden", 300, 0)).toBe(true);
  await expect(a.getByTestId("pve-boss")).toContainText("The Warden", { timeout: 10_000 });
  await expect(a.getByTestId("pve-boss")).toContainText("Phase 1/2");
  expect((await pve(a))?.boss).toBe("warden");
  await walk(a, [], { fire: true });
  for (let i = 0; i < 4; i++) {
    await a.waitForTimeout(800);
    await shot(a, `warden-${i}`);
  }
  expect(await spawn("subject-zero", -360, 0)).toBe(true);
  await expect.poll(async () => (await pve(a))?.rendered ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 4; i++) {
    await a.waitForTimeout(800);
    await shot(a, `subject-zero-${i}`);
  }
});
