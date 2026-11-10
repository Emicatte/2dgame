import { chromium, expect, test } from "@playwright/test";

/**
 * A host alone (practice) opens a chest: the loot falls on the ground, the weapon is taken with E,
 * the shield cell by walking over it and used with X.
 */
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Hooks {
  selfId(): string;
  phase(): string;
  partyDebug(...a: unknown[]): boolean;
  drops(): { id: string; kind: string; x: number; y: number }[];
}

test("chest: loot drops on the ground, weapon taken with E, shield cell kept and used with X", async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto("/");
    await page.fill("#nick", "Looter");
    await page.click("button[type=submit]");
    await page.getByTestId("nav-rooms").click();
    await page.getByTestId("create-room").click();
    await expect(page.getByTestId("start-match")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("start-match").click();
    await page.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      { timeout: 30_000 },
    );
    const teleport = (x: number, y: number) =>
      page.evaluate(
        ([x, y]) => {
          const h = (window as unknown as { __scrapline: Hooks }).__scrapline;
          h.partyDebug("teleport", h.selfId(), "", x, y);
        },
        [x, y] as const,
      );
    const drops = () =>
      page.evaluate(() => (window as unknown as { __scrapline: Hooks }).__scrapline.drops());
    const press = async (key: string) => {
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
    };
    const prompt = () =>
      page
        .getByTestId("interact-prompt")
        .textContent({ timeout: 500 })
        .catch(() => "");
    // Teleport next to the first chest of Industrial Arena (authoritative sim, dev/E2E builds only)
    // and do the whole sequence. The practice bots may shoot the player meanwhile: retry.
    let done = false;
    for (let attempt = 0; attempt < 14 && !done; attempt++) {
      await teleport(185 * 1.375, 1408 * 1.375); // base chest position × ARENA_SCALE
      await page.waitForTimeout(500);
      if ((await drops()).length === 0) {
        if (!(await prompt())?.includes("Open chest")) continue;
        await press("KeyE");
        await page.waitForTimeout(400);
        if (process.env.E2E_SHOTS_DIR)
          await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/chest-open.png` });
      }
      const loot = await drops();
      const weapon = loot.find((d) => d.kind === "weapon");
      const cell = loot.find((d) => d.kind === "shield");
      if (!weapon || !cell) {
        // A bot killed us midway (loot partly used, chest closed for 40 s): wait for it to reopen.
        await page.waitForTimeout(6000);
        continue;
      }
      // Nothing was given automatically: the weapon waits on the ground.
      await teleport(weapon.x, weapon.y);
      await page.waitForTimeout(700);
      if (!(await prompt())?.includes("Take")) continue;
      await press("KeyE");
      const taken = await expect(page.locator(".slot").nth(2))
        .not.toContainText("—", { timeout: 3000 })
        .then(
          () => true,
          () => false,
        );
      if (!taken) continue;
      await teleport(cell.x, cell.y);
      if (
        !(await page
          .getByTestId("hud-cells")
          .waitFor({ timeout: 2000 })
          .then(
            () => true,
            () => false,
          ))
      )
        continue;
      await press("KeyX");
      done = await page
        .getByTestId("hud-shield")
        .waitFor({ timeout: 2000 })
        .then(
          () => true,
          () => false,
        );
    }
    expect(done).toBe(true);
    if (process.env.E2E_SHOTS_DIR)
      await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/chest-loot.png` });
  } finally {
    await browser.close();
  }
});
