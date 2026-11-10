import { type Browser, expect, type Page, test } from "@playwright/test";
import { type Hooks, hooks, launch, onboard } from "./helpers.ts";

/**
 * Objective modes with two independent browsers on the real server: Capture the Flag (take the
 * enemy flag, carry it home, score) and Domination (capture a point, it scores over time). Both
 * screens must show the same objective state and score.
 */

async function room(a: Page, b: Page, mode: string, spawns: { x: number; y: number }[]) {
  await a.evaluate(
    ([s]) =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(
        s as { x: number; y: number }[],
        "airbase",
        [{ kind: "car", x: 3000, y: 120, angle: 0 }],
      ),
    [spawns] as const,
  );
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  await a.getByTestId("change-mode").click();
  await a.getByTestId(`mode-${mode}`).click();
  await expect(a.getByTestId("mode-blurb")).toBeVisible();
  await b.getByTestId("nav-rooms").click();
  await b.getByTestId("room-code-input").fill(code);
  await b.getByTestId("join-submit").click();
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 30_000 });
  // A on Alpha, B on Bravo.
  if (!((await a.getByTestId("team-1").textContent()) ?? "").includes("Alpha")) {
    await a.getByTestId("join-team-1").click();
  }
  await expect(a.getByTestId("team-1")).toContainText("Alpha");
  await expect(a.getByTestId("team-2")).toContainText("Bravo");
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  for (const p of [a, b]) {
    await p.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 25_000,
      },
    );
  }
}

/** Steers the local player towards (x, y) with WASD until within `tol` px. */
async function walkTo(page: Page, x: number, y: number, tol = 24, timeoutMs = 30_000) {
  const held = new Set<string>();
  const set = async (key: string, on: boolean) => {
    if (on && !held.has(key)) {
      await page.keyboard.down(key);
      held.add(key);
    } else if (!on && held.has(key)) {
      await page.keyboard.up(key);
      held.delete(key);
    }
  };
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const me = await hooks(page, (h) => h.players().find((p) => p.id === h.selfId())!);
      const dx = x - me.x;
      const dy = y - me.y;
      if (Math.hypot(dx, dy) <= tol) return true;
      await set("d", dx > 8);
      await set("a", dx < -8);
      await set("s", dy > 8);
      await set("w", dy < -8);
      await page.waitForTimeout(80);
    }
    return false;
  } finally {
    for (const k of [...held]) await set(k, false);
  }
}

const objectives = (p: Page) => hooks(p, (h) => h.objectives());

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

test("Capture the Flag: take the enemy flag, carry it home, score on both screens", async ({ baseURL }) => {
  browsers = [await launch(), await launch()];
  const a = await browsers[0]!.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
  const b = await browsers[1]!.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
  await onboard(a, "Alpha");
  await onboard(b, "Bravo");
  // Alpha spawns on the runway near Bravo's flag; Bravo far away (it never interferes).
  await room(a, b, "ctf", [
    { x: 2480, y: 1000 },
    { x: 1500, y: 1500 },
  ]);
  await expect(a.getByTestId("flag-1")).toContainText("Home");
  const enemy = await hooks(a, (h) => h.flagStand(2));
  const home = await hooks(a, (h) => h.flagStand(1));
  await a.waitForTimeout(1600);
  expect(await walkTo(a, enemy.x, enemy.y)).toBe(true);
  await expect.poll(async () => (await objectives(b)).find((o) => o.id === "2")?.carrier).not.toBe("");
  await expect(a.getByTestId("flag-2")).toContainText("You carry it");
  await expect(b.getByTestId("flag-2")).toContainText("Taken by Alpha");
  // Back along the runway centre line (clear of the sandbag rows), then onto the stand.
  for (const [x, y] of [
    [2400, 1024],
    [600, 1024],
  ] as const) {
    expect(await walkTo(a, x, y, 40)).toBe(true);
  }
  expect(await walkTo(a, home.x, home.y)).toBe(true);
  await expect(a.getByTestId("team-score-1")).toHaveText("1/3", { timeout: 10_000 });
  await expect(b.getByTestId("team-score-1")).toHaveText("1/3");
  await expect(b.getByTestId("flag-2")).toContainText("Home");
});

test("Domination: capture a point, both screens see it owned and scoring", async ({ baseURL }) => {
  browsers = [await launch(), await launch()];
  const a = await browsers[0]!.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
  const b = await browsers[1]!.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
  await onboard(a, "Alpha");
  await onboard(b, "Bravo");
  await room(a, b, "dom", [
    { x: 500, y: 1000 },
    { x: 2600, y: 1000 },
  ]);
  const pa = (await objectives(a)).find((o) => o.id === "A")!;
  expect(await walkTo(a, pa.x, pa.y, 40)).toBe(true);
  await expect(a.getByTestId("objective-A")).toContainText("Alpha", { timeout: 15_000 });
  await expect(b.getByTestId("objective-A")).toContainText("Alpha");
  // Owned points score every few seconds.
  await expect
    .poll(async () => Number(((await b.getByTestId("team-score-1").textContent()) ?? "0").split("/")[0]), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});
