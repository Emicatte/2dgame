import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/**
 * Two fully independent browser processes connect to the same real game server, meet in a
 * private room through its invite code, and fight. Nothing about the multiplayer path is mocked.
 */

interface Hooks {
  selfId(): string | null;
  phase(): string | null;
  players(): {
    id: string;
    x: number;
    y: number;
    alive: boolean;
    hp: number;
    kills: number;
    deaths: number;
  }[];
  rendered(id: string): { x: number; y: number; visible: boolean } | null;
  toScreen(x: number, y: number): { x: number; y: number };
  createDebugRoom(spawns: { x: number; y: number }[]): Promise<void>;
}

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
// Open, wall-free lane of Industrial Arena (verified by the server simulation tests).
const DUEL_SPAWNS = [
  { x: 1000, y: 1180 },
  { x: 1400, y: 1180 },
];

async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ARGS });
}

async function onboard(page: Page, name: string) {
  await page.goto("/");
  await page.fill("#nick", name);
  await page.click("button[type=submit]");
  await expect(page.getByTestId("quick-match")).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __scrapline?: unknown }).__scrapline);
}

/** Runs `fn` in the page with the game's test hooks as argument. */
const hooks = <T>(page: Page, fn: (h: Hooks) => T | Promise<T>) =>
  page.evaluate((src) => {
    const h = (window as unknown as { __scrapline: unknown }).__scrapline;
    // Test-only bridge: runs a serialized callback in the page with the game hooks as argument.
    return new Function("h", `return (${src})(h);`)(h);
  }, fn.toString()) as Promise<T>;

test("two independent browsers play a real deathmatch exchange", async ({ baseURL }) => {
  const browserA = await launch();
  const browserB = await launch();
  try {
    const a = await browserA.newPage({ viewport: { width: 1366, height: 768 }, baseURL });
    const b = await browserB.newPage({ viewport: { width: 1366, height: 768 }, baseURL });

    await onboard(a, "Alpha");
    await onboard(b, "Bravo");

    // A hosts a private room; B joins through the code shown in A's lobby.
    await a.evaluate(
      (spawns) => (window as unknown as { __scrapline: Hooks }).__scrapline.createDebugRoom(spawns),
      DUEL_SPAWNS,
    );
    const code = (await a.getByTestId("room-code").textContent())?.trim() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{5}$/);

    await b.getByTestId("join-room").click();
    await b.getByTestId("room-code-input").fill(code);
    await b.getByTestId("join-submit").click();
    await expect(b.getByTestId("room-code")).toHaveText(code);
    await expect(a.getByTestId("lobby-players")).toContainText("Bravo");
    await expect(b.getByTestId("lobby-players")).toContainText("Alpha");

    // Lobby state is synchronized in real time: B readies up, A sees it and starts.
    await b.getByTestId("ready-toggle").click();
    await expect(a.getByTestId("start-match")).toBeEnabled();
    await a.getByTestId("start-match").click();

    await expect(a.getByTestId("hud")).toBeVisible();
    await expect(b.getByTestId("hud")).toBeVisible();
    await a.waitForFunction(
      () => (window as unknown as { __scrapline: Hooks }).__scrapline.phase() === "playing",
      null,
      {
        timeout: 15_000,
      },
    );

    const ids = await hooks(a, (h) => ({ self: h.selfId(), all: h.players().map((p) => p.id) }));
    expect(ids.all).toHaveLength(2);
    const bId = ids.all.find((id) => id !== ids.self)!;

    // Movement made in browser B is seen by browser A (authoritative sync + interpolation).
    const before = await hooks(a, (h) => h.players());
    const bBefore = before.find((p) => p.id !== h_self(before, ids.self))!;
    const fps = await b.evaluate(
      () => (window as unknown as { __game?: { loop: { actualFps: number } } }).__game?.loop.actualFps ?? 0,
    );
    console.log(`browser B fps: ${fps.toFixed(1)}`);
    await b.keyboard.down("KeyS");
    await b.waitForTimeout(700);
    await b.keyboard.up("KeyS");

    await expect
      .poll(async () => {
        const now = await a.evaluate(
          (id) => (window as unknown as { __scrapline: Hooks }).__scrapline.rendered(id),
          bId,
        );
        return now ? Math.round(now.y - bBefore.y) : 0;
      })
      .toBeGreaterThan(20);
    // B walks back into the lane.
    await b.keyboard.down("KeyW");
    await b.waitForTimeout(700);
    await b.keyboard.up("KeyW");

    // Spawn protection lasts 1.5 s; then A aims at where it sees B and holds the trigger.
    await a.waitForTimeout(1200);
    const deadline = Date.now() + 15_000;
    let killed = false;
    while (Date.now() < deadline && !killed) {
      const target = await a.evaluate((id) => {
        const h = (window as unknown as { __scrapline: Hooks }).__scrapline;
        const r = h.rendered(id);
        return r ? h.toScreen(r.x, r.y) : null;
      }, bId);
      if (target) await a.mouse.move(target.x, target.y);
      await a.mouse.down();
      await a.waitForTimeout(300);
      await a.mouse.up();
      const state = await hooks(b, (h) => h.players());
      killed = state.some((p) => p.kills >= 1);
    }

    // The server decided the kill; both browsers agree on the outcome.
    expect(killed).toBe(true);
    await expect(b.getByTestId("hud")).toContainText(/Eliminated|Redeploying/);
    const fromA = await hooks(a, (h) => h.players());
    const fromB = await hooks(b, (h) => h.players());
    const shooterA = fromA.find((p) => p.id === ids.self)!;
    const shooterB = fromB.find((p) => p.id === ids.self)!;
    expect(shooterA.kills).toBe(1);
    expect(shooterB.kills).toBe(1);
    expect(fromB.find((p) => p.id === bId)!.deaths).toBe(1);
    await expect(a.getByTestId("hud-kills")).toHaveText("1");

    // B respawns after the respawn delay.
    await expect
      .poll(async () => (await hooks(b, (h) => h.players())).find((p) => p.id === bId)?.alive, {
        timeout: 8000,
      })
      .toBe(true);
  } finally {
    await browserA.close();
    await browserB.close();
  }
});

function h_self(players: { id: string }[], self: string | null): string {
  return players.find((p) => p.id === self)?.id ?? "";
}
