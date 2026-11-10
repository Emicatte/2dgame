import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Every platform experience added after the home overhaul opens a lobby from its card; the solo
 * ones start and run (Parkour, Free Roam, Racing).
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const SHOTS = process.env.E2E_SHOTS;

let browser: Browser | null = null;
test.afterEach(async () => {
  await browser?.close();
  browser = null;
});

async function open(): Promise<Page> {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/");
  await page.fill("#nick", "Alpha");
  await page.click("button[type=submit]");
  await expect(page.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  return page;
}

async function lobbyFor(page: Page, id: string, mode: string) {
  await page.getByTestId("nav-discover").click();
  await page.getByTestId("discover-all").click();
  await page.getByTestId(`xp-${id}`).click();
  await page.getByTestId("xp-create").click();
  await expect(page.getByTestId("lobby-mode")).toContainText(mode, { timeout: 15_000 });
}

const playing = (page: Page) =>
  page.waitForFunction(
    () => (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() === "playing",
    null,
    { timeout: 30_000 },
  );

test("new experiences open their lobby; group ones ask for players", async () => {
  const page = await open();
  for (const [id, mode, needs] of [
    ["escape", "Escape Room", 2],
    ["haunted", "Escape Room", 2],
    ["nighthunt", "Night Hunt", 2],
    ["hotpotato", "Hot Potato", 2],
  ] as const) {
    await lobbyFor(page, id, mode);
    await expect(page.getByTestId("start-match")).toContainText(`Needs ${needs} players`);
    if (id === "haunted") await expect(page.getByTestId("variant-badge")).toHaveText("Haunted");
    await page.getByTestId("leave-arena").click();
    await expect(page.getByTestId("nav-discover")).toBeVisible({ timeout: 10_000 });
  }
});

test("Parkour, Free Roam and Racing start solo", async () => {
  const page = await open();
  for (const [id, mode, status] of [
    ["parkour", "Parkour Challenge", "finished"],
    ["freeroam", "Free Roam", "no damage"],
    ["racing", "Vehicle Racing", "3 laps"],
  ] as const) {
    await lobbyFor(page, id, mode);
    await page.getByTestId("start-match").click();
    await playing(page);
    await expect(page.getByTestId("mode-status")).toContainText(status, { timeout: 10_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${id}.png` });
    await page.keyboard.press("Escape");
    await page.getByTestId("leave-arena").click();
    await expect(page.getByTestId("nav-discover")).toBeVisible({ timeout: 10_000 });
  }
});
