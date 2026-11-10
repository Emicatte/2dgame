import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Classic Maze in host mode: picked from Discover (no weapons), the lobby shows the seed and draws
 * a new one, a guest joining gets the same maze, the match runs with gates, keys, switch, traps
 * and the exit as markers, and nobody is armed.
 */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];
const SHOTS = process.env.E2E_SHOTS;

interface ModeView {
  mode: string;
  mapId: string;
  doors: string;
  marks: { k: string; l: string; p: number }[];
}

const view = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __scrapline: { mode(): ModeView | null } }).__scrapline.mode(),
  ) as Promise<ModeView | null>;

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

async function player(name: string): Promise<Page> {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  browsers.push(b);
  const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on("pageerror", (e) => console.log(`[pageerror ${name}] ${e.message}`));
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("hero-play")).toBeVisible({ timeout: 10_000 });
  return page;
}

test("Classic Maze: seeded maze shared by host and guest, gates and traps, nobody armed", async () => {
  const a = await player("Alpha");
  await a.getByTestId("nav-discover").click();
  await a.getByTestId("discover-challenge").click();
  await expect(a.getByTestId("xp-maze")).toContainText("no combat");
  await a.getByTestId("xp-maze").click();
  await a.getByTestId("xp-create").click();
  await expect(a.getByTestId("lobby-mode")).toContainText("Classic Maze", { timeout: 15_000 });
  await expect(a.getByTestId("maze-seed")).toBeVisible();

  // "New maze" draws another seed; the lobby keeps one card per size.
  const seed0 = await a.getByTestId("maze-seed").locator(".mono").textContent();
  await a.getByTestId("new-maze").click();
  await expect(a.getByTestId("maze-seed").locator(".mono")).not.toHaveText(seed0 ?? "", { timeout: 5_000 });
  await expect(a.locator("[data-testid^='map-maze-'][aria-pressed='true']")).toHaveCount(1);

  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  const b = await player("Bravo");
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  await b.getByTestId("ready-toggle").click();
  await a.getByTestId("start-match").click();

  for (const p of [a, b])
    await p.waitForFunction(
      () =>
        (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() ===
        "playing",
      null,
      { timeout: 30_000 },
    );
  await expect.poll(async () => (await view(b))?.marks.length ?? 0, { timeout: 10_000 }).toBeGreaterThan(5);
  const [va, vb] = [await view(a), await view(b)];
  expect(vb?.mapId).toBe(va?.mapId);
  const kinds = new Set(vb?.marks.map((m) => m.k));
  for (const k of ["goal", "door", "key", "switch", "trap", "checkpoint"]) expect(kinds.has(k)).toBe(true);
  expect(vb?.doors).toBe("");
  await expect(b.getByTestId("mode-status")).toContainText("2 gates shut");
  // Traps cycle: within a few seconds at least one is live on the guest.
  await expect
    .poll(async () => (await view(b))?.marks.some((m) => m.k === "trap" && m.p === 100), { timeout: 8_000 })
    .toBe(true);
  if (SHOTS) {
    await a.screenshot({ path: `${SHOTS}/maze-host.png` });
    await b.screenshot({ path: `${SHOTS}/maze-guest.png` });
  }
});

test("Horror Maze: dark, one creature rendered from the PvE AI, picked from the Horror category", async () => {
  const a = await player("Alpha");
  await a.getByTestId("nav-discover").click();
  await a.getByTestId("discover-horror").click();
  await a.getByTestId("xp-horrormaze").click();
  await a.getByTestId("xp-create").click();
  await expect(a.getByTestId("lobby-mode")).toContainText("Classic Maze", { timeout: 15_000 });
  await expect(a.getByTestId("variant-badge")).toHaveText("Horror");
  await a.getByTestId("start-match").click();
  await a.waitForFunction(
    () =>
      (window as unknown as { __scrapline?: { phase(): string | null } }).__scrapline?.phase() === "playing",
    null,
    { timeout: 30_000 },
  );
  const pve = () =>
    a.evaluate(() =>
      (
        window as unknown as {
          __scrapline: { pve(): { zombies: number; rendered: number } | null };
        }
      ).__scrapline.pve(),
    );
  await expect.poll(async () => (await pve())?.zombies ?? 0, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await pve())?.rendered ?? 0, { timeout: 10_000 }).toBe(1);
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/horrormaze.png` });
  // Back home: the card is now the one to continue.
  await a.keyboard.press("Escape");
  await a.getByTestId("leave-arena").click();
  // Back on the page it was started from (Discover); Play now offers to continue it.
  await a.getByTestId("nav-play").click();
  await expect(a.locator("#hero-title")).toHaveText("Horror Maze", { timeout: 10_000 });
});
