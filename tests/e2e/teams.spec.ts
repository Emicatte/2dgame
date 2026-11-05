import { expect, type Page, test } from "@playwright/test";
import { type Hooks, hooks, launch, onboard } from "./helpers.ts";

/**
 * Team Deathmatch with two independent browsers on the real server: the host switches the room to
 * TDM, the friend joins through an "invite to my team" link and lands on the host's team, moves
 * to the other team, the match starts with team spawns, a kill scores for the shooter's team on
 * both screens.
 */
const TEAM_SPAWNS = [
  // Alpha (first half of the debug list), then Bravo, on one open lane of Industrial Arena.
  { x: 1000, y: 1180 },
  { x: 1000, y: 1180 },
  { x: 1400, y: 1180 },
  { x: 1400, y: 1180 },
];

async function teamOf(page: Page, name: string): Promise<1 | 2> {
  if (((await page.getByTestId("team-1").textContent()) ?? "").includes(name)) return 1;
  if (((await page.getByTestId("team-2").textContent()) ?? "").includes(name)) return 2;
  throw new Error(`${name} is in no team`);
}

test("Team Deathmatch: invite to my team, switch teams, team score on both screens", async ({ baseURL }) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    await onboard(a, "Alpha");
    await onboard(b, "Bravo");

    await a.evaluate(
      (spawns) => (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(spawns),
      TEAM_SPAWNS,
    );
    const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{5}$/);
    await a.getByTestId("mode-tdm").click();
    await expect(a.getByTestId("match-rules")).toContainText("Team Deathmatch");
    await expect(a.getByTestId("match-rules")).toContainText("2v2");
    await expect(a.getByTestId("match-rules")).toContainText("5:00");
    await expect(a.getByTestId("match-rules")).toContainText("15 team points");
    const hostTeam = await teamOf(a, "Alpha");
    const otherTeam = hostTeam === 1 ? 2 : 1;

    // The friend opens the "invite to my team" link (same as the lobby button copies).
    await b.goto(`/?join=${code}&team=${hostTeam}`);
    await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 15_000 });
    await expect(a.getByTestId(`team-${hostTeam}`)).toContainText("Bravo");
    await expect(b.getByTestId(`team-${hostTeam}`)).toContainText("Alpha");

    // Then moves to the other team to make it a duel.
    await b.getByTestId(`join-team-${otherTeam}`).click();
    await expect(a.getByTestId(`team-${otherTeam}`)).toContainText("Bravo");
    await expect(a.getByTestId(`team-${hostTeam}`)).not.toContainText("Bravo");

    await b.getByTestId("ready-toggle").click();
    await expect(a.getByTestId("start-match")).toBeEnabled();
    await a.getByTestId("start-match").click();
    await expect(a.getByTestId("team-scores")).toBeVisible();
    await expect(b.getByTestId("team-scores")).toBeVisible();
    await a.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 15_000,
      },
    );
    const aId = (await hooks(a, (h) => h.selfId()))!;
    const bId = (await hooks(b, (h) => h.selfId()))!;

    // A shoots B until the server records the kill.
    await a.waitForTimeout(1600); // spawn protection
    const deadline = Date.now() + 35_000;
    let killed = false;
    while (Date.now() < deadline && !killed) {
      const target = await a.evaluate((id) => {
        const h = (
          window as unknown as {
            __scrapline: {
              rendered(id: string): { x: number; y: number } | null;
              toScreen(x: number, y: number): { x: number; y: number };
            };
          }
        ).__scrapline;
        const r = h.rendered(id);
        return r ? h.toScreen(r.x, r.y) : null;
      }, bId);
      if (target) await a.mouse.move(target.x, target.y);
      await a.mouse.down();
      await a.waitForTimeout(300);
      await a.mouse.up();
      killed = (await hooks(b, (h) => h.players())).some((p) => p.id === aId && p.kills >= 1);
    }
    if (!killed) {
      // Diagnostics for a failed run: positions, health and ammo as each side sees them.
      console.log(
        "[teams] no kill:",
        JSON.stringify({
          a: await hooks(a, (h) => ({ players: h.players(), net: h.net() })),
          b: await hooks(b, (h) => h.players()),
          aId,
          bId,
        }),
      );
    }
    expect(killed).toBe(true);

    // The team score went up for the shooter's team, on both screens.
    await expect(a.getByTestId(`team-score-${hostTeam}`)).toHaveText("1/15");
    await expect(b.getByTestId(`team-score-${hostTeam}`)).toHaveText("1/15");
    await expect(b.getByTestId(`team-score-${otherTeam}`)).toHaveText("0/15");
    await expect(b.getByTestId("hud")).toContainText(/Eliminated|Redeploying/);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});
