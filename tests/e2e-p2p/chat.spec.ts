import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

/** Room chat in host mode: the lobby chat button opens a popup, T opens the chat during the match. */

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const ARGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

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

test("chat: lobby popup and T in the match", async () => {
  const a = await player("Alpha");
  await a.getByTestId("hero-play").click();
  const code = (await a.getByTestId("room-code").textContent({ timeout: 15_000 }))?.trim() ?? "";
  const b = await player("Bravo");
  await b.goto(`/?join=${code}`);
  await expect(b.getByTestId("room-code")).toHaveText(code, { timeout: 45_000 });

  // Lobby: guest writes, host sees the unread badge, opens the popup and replies.
  await b.getByTestId("chat-toggle").click();
  await b.getByTestId("chat-input").fill("hello from bravo");
  await b.getByTestId("chat-input").press("Enter");
  await expect(a.getByTestId("chat-toggle")).toContainText("1");
  await a.getByTestId("chat-toggle").click();
  await expect(a.getByTestId("chat")).toContainText("Bravo hello from bravo");
  await a.getByTestId("chat-input").fill("hi bravo");
  await a.getByTestId("chat-input").press("Enter");
  await expect(b.getByTestId("chat")).toContainText("Alpha hi bravo");

  // Match: T opens the chat, the letter is not typed, Enter sends and closes.
  await b.getByTestId("ready-toggle").click();
  await a.getByTestId("start-match").click();
  await expect(a.getByTestId("hud")).toBeVisible({ timeout: 20_000 });
  await expect(b.getByTestId("hud")).toBeVisible({ timeout: 20_000 });
  await a.locator("canvas").first().click();
  await a.keyboard.press("t");
  await expect(a.getByTestId("chat-input")).toBeFocused();
  await expect(a.getByTestId("chat-input")).toHaveValue("");
  await a.keyboard.type("gg wasd");
  await a.keyboard.press("Enter");
  await expect(a.getByTestId("chat-input")).toHaveCount(0);
  await expect(b.getByTestId("chat")).toContainText("Alpha gg wasd");
});
