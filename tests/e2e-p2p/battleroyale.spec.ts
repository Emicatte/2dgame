import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Battle Royale in host mode, the host alone with the three practice bots: the island, the bus,
 * SPACE to jump, freefall and parachute (predicted), landing, the storm on the status line.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const SHOTS = process.env.E2E_SHOTS;

interface P {
  id: string;
  alive: boolean;
  alt: number;
  frozen: boolean;
  x: number;
  y: number;
}
const players = (page: Page) =>
  page.evaluate(() => (window as unknown as { __scrapline: { players(): P[] } }).__scrapline.players());
const selfId = (page: Page) =>
  page.evaluate(() => (window as unknown as { __scrapline: { selfId(): string } }).__scrapline.selfId());

let browser: Browser | null = null;
test.afterEach(async () => {
  await browser?.close();
  browser = null;
});

test("Battle Royale: bus, jump with SPACE, parachute, landing, storm", async () => {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  a.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await a.goto("/");
  await a.fill("#nick", "Alpha");
  await a.click("button[type=submit]");
  await expect(a.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  await a.getByTestId("nav-discover").click();
  await a.getByTestId("xp-battleroyale").click();
  await a.getByTestId("xp-create").click();
  await expect(a.getByTestId("lobby-mode")).toContainText("Battle Royale", { timeout: 15_000 });
  await expect(a.getByTestId("map-island")).toHaveAttribute("aria-pressed", "true");
  await a.getByTestId("start-match").click();
  await a.waitForFunction(
    () =>
      (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() === "playing",
    null,
    { timeout: 30_000 },
  );
  const me = await selfId(a);
  const mine = async () => (await players(a)).find((p) => p.id === me)!;
  await expect.poll(async () => (await mine()).frozen, { timeout: 10_000 }).toBe(true);
  expect((await mine()).alt).toBeGreaterThan(900);
  await expect(a.getByTestId("mode-status")).toContainText("alive");
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/br-bus.png` });

  // Jump once the bus is over the island (a few seconds in), with SPACE.
  await a.waitForTimeout(4000);
  await a.keyboard.down("Space");
  await expect.poll(async () => (await mine()).frozen, { timeout: 5_000 }).toBe(false);
  await a.keyboard.up("Space");
  await a.keyboard.down("KeyD");
  await a.waitForTimeout(1500);
  const falling = await mine();
  expect(falling.alt).toBeGreaterThan(0);
  expect(falling.alt).toBeLessThan(1000);
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/br-freefall.png` });
  await a.keyboard.up("KeyD");
  await a.keyboard.press("Space");
  await a.waitForTimeout(1500);
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/br-chute.png` });
  await expect.poll(async () => (await mine()).alt, { timeout: 25_000 }).toBe(0);
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/br-landed.png` });
  // Bots jumped too, nobody is still aboard at the end of the line.
  await expect
    .poll(async () => (await players(a)).filter((p) => p.frozen).length, { timeout: 20_000 })
    .toBe(0);
  await expect(a.getByTestId("mode-status")).toContainText(/storm (moves in|closing)/);
});
