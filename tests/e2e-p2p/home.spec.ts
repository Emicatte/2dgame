import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Home and navigation (host mode build): one entry per destination, the map is never chosen
 * before the lobby, the lobby owns mode / map / rules, sheets and dialogs go back where they came
 * from, and "Continue" comes from a match that really started.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const SHOTS = process.env.E2E_SHOTS;

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

async function open(): Promise<Page> {
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const page = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/");
  await page.fill("#nick", "Alpha");
  await page.click("button[type=submit]");
  await expect(page.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  return page;
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** No map picker anywhere outside a lobby. */
const noMapPicker = (page: Page) => expect(page.locator(".map-card, [data-testid^='map-']")).toHaveCount(0);

test("one entry per destination, no map choice before the lobby", async () => {
  const page = await open();
  await shot(page, "home-play");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button")).toHaveText(["Play", "Discover", "Rooms"]);
  await expect(page.getByTestId("nav-play")).toHaveAttribute("aria-current", "page");
  // Every top-bar destination appears once.
  for (const id of ["nav-play", "nav-discover", "nav-rooms", "nav-profile", "nav-settings"])
    await expect(page.getByTestId(id)).toHaveCount(1);
  await expect(page.getByTestId("hero-play")).toContainText("you host");
  await noMapPicker(page);

  // Discover: the whole catalog, the experience card has no map picker either.
  await page.evaluate(() => {
    const w = window as unknown as { __longest: number };
    w.__longest = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longest = Math.max(w.__longest, e.duration);
    }).observe({ type: "longtask" });
  });
  const t0 = Date.now();
  await page.getByTestId("nav-discover").click();
  await expect(page.getByTestId("nav-discover")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".xp-card")).not.toHaveCount(0);
  // Every playable card gets its real map image (rendered from game data after the first paint).
  await page.waitForFunction(() => document.querySelectorAll(".xp-card img").length >= 18);
  const longest = await page.evaluate(() => (window as unknown as { __longest: number }).__longest);
  console.log(
    `[home] Discover with all map images: ${Date.now() - t0} ms, longest main-thread task ${Math.round(longest)} ms`,
  );
  await page.getByTestId("xp-tdm").click();
  await expect(page.getByTestId("xp-dialog")).toContainText("You pick the map");
  await shot(page, "home-dialog");
  await noMapPicker(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("xp-dialog")).toHaveCount(0);
  await expect(page.getByTestId("xp-tdm")).toBeFocused();
  await shot(page, "home-discover");

  // Category tile on Play opens Discover filtered.
  await page.getByTestId("nav-play").click();
  await page.getByTestId("cat-racing").click();
  await expect(page.getByTestId("discover-racing")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("xp-pursuit")).toBeVisible();

  // Rooms: join with a code and one create button, no map.
  await page.getByTestId("nav-rooms").click();
  await expect(page.getByTestId("room-code-input")).toBeVisible();
  await expect(page.getByTestId("create-room")).toHaveCount(1);
  await noMapPicker(page);
  await shot(page, "home-rooms");

  // Sheets go back where they were opened from (Profile → Loadout → back to Profile → back to Play).
  await page.getByTestId("nav-profile").click();
  await expect(page.getByTestId("nav-profile")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("open-loadout").click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("open-loadout")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("open-loadout")).toHaveCount(0);
  await page.getByTestId("nav-settings").click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("hero-play")).toBeVisible();
});

test("Play opens a lobby in one click; the lobby owns mode and map; Continue follows a real match", async () => {
  const page = await open();
  await expect(page.locator(".hero")).toContainText("Featured");
  await expect(page.locator("#hero-title")).toHaveText("Deathmatch");

  await page.getByTestId("hero-play").click();
  await expect(page.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lobby-mode")).toContainText("Deathmatch");
  // The map is chosen here, once.
  await expect(page.getByTestId("lobby-maps").locator(".map-card")).not.toHaveCount(0);
  await page.getByTestId("map-neon").click();
  await expect(page.getByTestId("map-neon")).toHaveAttribute("aria-pressed", "true");
  // Switching mode in the lobby keeps one source of truth: the picker closes, the header follows.
  await page.getByTestId("change-mode").click();
  await page.getByTestId("mode-gungame").click();
  await expect(page.getByTestId("lobby-mode")).toContainText("Gun Game");
  await expect(page.getByTestId("mode-select")).not.toHaveAttribute("open", "");
  await shot(page, "lobby");

  await page.getByTestId("start-match").click();
  await page.waitForFunction(
    () =>
      (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() === "playing",
    null,
    { timeout: 20_000 },
  );
  await page.keyboard.press("Escape");
  await page.getByTestId("leave-arena").click();
  await expect(page.locator(".hero")).toContainText("Continue", { timeout: 10_000 });
  await expect(page.locator("#hero-title")).toHaveText("Gun Game");
});
