import { chromium, expect, test } from "@playwright/test";

/** A host alone (practice) opens a chest: random weapon in slot 3, shield bar on the HUD. */
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

test("chest: opened with E, gives a weapon and a shield", async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto("/");
    await page.fill("#nick", "Looter");
    await page.click("button[type=submit]");
    await page.getByTestId("create-room").click();
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("start-match")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("start-match").click();
    await page.waitForFunction(
      () => (window as unknown as { __scrapline: { phase(): string } }).__scrapline.phase() === "playing",
      null,
      { timeout: 30_000 },
    );
    // Teleport next to the first chest of Industrial Arena (authoritative sim, dev/E2E builds only)
    // and open it. The practice bots may shoot the player meanwhile: try again after a respawn.
    let opened = false;
    for (let attempt = 0; attempt < 6 && !opened; attempt++) {
      await page.evaluate(() => {
        const h = (
          window as unknown as { __scrapline: { selfId(): string; partyDebug(...a: unknown[]): boolean } }
        ).__scrapline;
        h.partyDebug("teleport", h.selfId(), "", 185, 1408);
      });
      await page.waitForTimeout(500);
      if (
        !(
          await page
            .getByTestId("interact-prompt")
            .textContent()
            .catch(() => "")
        )?.includes("Open chest")
      )
        continue;
      await page.keyboard.down("KeyE");
      await page.waitForTimeout(250);
      await page.keyboard.up("KeyE");
      opened = await page
        .getByTestId("hud-shield")
        .waitFor({ timeout: 2000 })
        .then(() => true)
        .catch(() => false);
    }
    expect(opened).toBe(true);
    // The chest's weapon is in slot 3.
    await expect(page.locator(".slot").nth(2)).not.toContainText("—");
    if (process.env.E2E_SHOTS_DIR)
      await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/chest-opened.png` });
  } finally {
    await browser.close();
  }
});
