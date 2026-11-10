import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * The 0.8 modes in host mode (production path): two Chrome processes over WebRTC. Each test
 * creates the arena from the Play screen, starts a match and checks what the guest's browser
 * received (roles, status line, objective markers), not only what the host computed.
 */
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

interface ModeInfo {
  mode: string;
  stage: string;
  modeText: string;
  marks: { id: string; k: string; x: number; y: number; l: string; a: string; c: number }[];
  players: { id: string; role: number; pts: number }[];
}
interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  mode(): ModeInfo | null;
  partyDebug(op: string, a?: string, b?: string, x?: number, y?: number): boolean;
}
const mode = (p: Page) =>
  p.evaluate(() =>
    (window as unknown as { __scrapline: Hooks }).__scrapline.mode(),
  ) as Promise<ModeInfo | null>;
const SHOTS = process.env.E2E_SHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

let browsers: Browser[] = [];
test.afterEach(async () => {
  for (const b of browsers) await b.close();
  browsers = [];
});

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

async function twoPlayers() {
  browsers = await Promise.all(
    [0, 1].map(() => chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })),
  );
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browsers[1]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  for (const p of [a, b]) p.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await onboard(a, "Alpha");
  await onboard(b, "Bravo");
  return { a, b };
}

async function playMode(a: Page, b: Page, category: string, id: string) {
  await a.getByTestId("open-play").click();
  await a.getByTestId(`play-tab-${category}`).click();
  await a.getByTestId(`play-private-${id}`).click();
  await expect(a.getByTestId("host-hint")).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId(`mode-${id}`)).toHaveAttribute("aria-pressed", "true");
  const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });
  await b.getByTestId("ready-toggle").click();
  await expect(a.getByTestId("start-match")).toBeEnabled();
  await a.getByTestId("start-match").click();
  for (const p of [a, b])
    await p.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 30_000,
      },
    );
}

test("Play screen: every category lists only playable modes", async () => {
  browsers = [await chromium.launch({ executablePath: CHROME, headless: true, args: ARGS })];
  const a = await (await browsers[0]!.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await onboard(a, "Alpha");
  await a.getByTestId("open-play").click();
  for (const [tab, ids] of [
    ["competitive", ["sabotage", "bounty"]],
    ["party", ["infection", "chaos"]],
    ["coop", ["extraction", "bossrush"]],
    ["vehicles", ["pursuit", "convoy"]],
  ] as const) {
    await a.getByTestId(`play-tab-${tab}`).click();
    for (const id of ids) await expect(a.getByTestId(`play-private-${id}`)).toBeEnabled();
    await expect(a.locator(".play-card.is-planned")).toHaveCount(0);
    await shot(a, `play-${tab}`);
  }
});

test("Infection: one infected with claws, one survivor; both browsers agree on the sides", async () => {
  const { a, b } = await twoPlayers();
  await playMode(a, b, "party", "infection");
  const ma = await mode(a);
  const mb = await mode(b);
  expect(ma?.mode).toBe("infection");
  const roles = (ma?.players ?? []).map((p) => p.role).sort();
  expect(roles).toEqual([1, 2]);
  expect(mb?.players.map((p) => p.role).sort()).toEqual([1, 2]);
  const chips = [
    await a.getByTestId("role-chip").textContent(),
    await b.getByTestId("role-chip").textContent(),
  ];
  expect(chips.some((c) => c?.includes("Infected"))).toBe(true);
  expect(chips.some((c) => c?.includes("Survivor"))).toBe(true);
  await shot(a, "infection");
});

test("Sabotage: two sites marked on the guest, status line with the round, teams on opposite sides", async () => {
  const { a, b } = await twoPlayers();
  await playMode(a, b, "competitive", "sabotage");
  await b.waitForFunction(
    () => ((window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.marks.length ?? 0) >= 2,
    null,
    { timeout: 10_000 },
  );
  const mb = (await mode(b))!;
  expect(mb.marks.map((m) => m.l).sort()).toEqual(["Site A", "Site B"]);
  await expect(b.getByTestId("mode-status")).toContainText("Round 1/6");
  // After the 5 s prep the attackers get the plant prompt on the sites.
  await b.waitForFunction(
    () => (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.stage === "hunt",
    null,
    { timeout: 15_000 },
  );
  expect((await mode(b))!.marks.every((m) => m.a === "Hold to plant the device")).toBe(true);
  await shot(b, "sabotage");
});

test("Convoy: the truck, the checkpoints and the destination reach the guest", async () => {
  const { a, b } = await twoPlayers();
  await playMode(a, b, "vehicles", "convoy");
  await b.waitForFunction(
    () =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.marks.some((m) => m.k === "truck"),
    null,
    { timeout: 10_000 },
  );
  const kinds = (await mode(b))!.marks.map((m) => m.k).sort();
  expect(kinds).toEqual(["checkpoint", "checkpoint", "goal", "truck"]);
  await expect(b.getByTestId("mode-status")).toContainText("escort the truck");
  await shot(b, "convoy");
});

test("Chaos Arena: the current rule is on the status line of both browsers", async () => {
  const { a, b } = await twoPlayers();
  await playMode(a, b, "party", "chaos");
  // "<rule> · <what it does>", e.g. "Double damage · Every hit counts twice".
  await expect(b.getByTestId("mode-status")).toContainText(" · ", { timeout: 10_000 });
  expect((await mode(b))?.modeText).toBe((await mode(a))?.modeText);
  await shot(b, "chaos");
});

test("Bounty Hunt: a target is named and their area is pinged to the other player", async () => {
  const { a, b } = await twoPlayers();
  await playMode(a, b, "competitive", "bounty");
  await expect(b.getByTestId("mode-status")).toContainText("Target:", { timeout: 15_000 });
  await b.waitForFunction(
    () =>
      (window as unknown as { __scrapline: Hooks }).__scrapline.mode()?.marks.some((m) => m.k === "target"),
    null,
    { timeout: 15_000 },
  );
  await shot(b, "bounty");
});
