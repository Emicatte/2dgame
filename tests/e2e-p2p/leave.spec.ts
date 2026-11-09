import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Two Chrome processes over WebRTC: "Leave match" only leaves the running match (the player waits
 * in the arena for the next one), "Leave arena" leaves the room.
 */
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface Hooks {
  phase(): string | null;
  players(): { id: string }[];
}
const players = (p: Page) =>
  p.evaluate(() => (window as unknown as { __scrapline: Hooks }).__scrapline.players().length);
const phaseIs = (page: Page, phase: string, timeout = 20_000) =>
  page.waitForFunction(
    (ph) => (window as unknown as { __scrapline?: Hooks }).__scrapline?.phase() === ph,
    phase,
    { timeout },
  );

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("leave match keeps you in the arena; leave arena leaves it", async () => {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Alpha");
  await onboard(b, "Bravo");

  await a.getByTestId("create-room").click();
  await a.getByTestId("create-submit").click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  await phaseIs(a, "playing");
  await phaseIs(b, "playing");

  // B: Esc → Leave match. Back in the arena's lobby (same code), the host keeps playing.
  await b.keyboard.press("Escape");
  await b.getByTestId("leave-match").click();
  await expect(b.getByTestId("away-banner")).toBeVisible({ timeout: 5_000 });
  await expect(b.getByTestId("room-code")).toHaveText(code);
  await expect(b.getByTestId("ready-toggle")).toHaveCount(0);
  expect(await players(b)).toBe(2);
  await expect(a.getByTestId("away-banner")).toHaveCount(0);
  expect(await a.evaluate(() => (window as unknown as { __scrapline: Hooks }).__scrapline.phase())).toBe(
    "playing",
  );
  if (process.env.E2E_SHOTS_DIR) await b.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/left-match.png` });

  // B: Leave arena → main menu; the host sees B gone.
  await b.getByTestId("leave-arena").click();
  await expect(b.getByTestId("create-room")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => players(a), { timeout: 10_000 }).toBeLessThan(2);

  // The host leaves the match too: nobody human is playing, the match ends (results, still in the arena).
  await a.keyboard.press("Escape");
  await a.getByTestId("leave-match").click();
  await phaseIs(a, "results", 10_000);
  await expect(a.getByTestId("create-room")).toHaveCount(0);
});
