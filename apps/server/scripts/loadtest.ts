/**
 * Load test: N headless bot clients (real SDK, real sockets) play a quick match against a running
 * server, then the script reports server tick cost and per-client bandwidth.
 *
 *   pnpm --filter @scrapline/server loadtest -- \
 *     --url http://localhost:2567 --bots 8 --seconds 30
 *
 * The server must run with ENABLE_DEBUG_ROUTES=true to expose tick statistics.
 */
import { Client, type Room } from "@colyseus/sdk";
import { BTN, C2S, encodeInput, MatchState, quantizeInput, ROOM_NAME } from "@scrapline/shared";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
};
const URL = arg("url", "http://localhost:2567");
const BOTS = Number(arg("bots", "8"));
const SECONDS = Number(arg("seconds", "30"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Bot {
  room: Room<unknown, MatchState>;
  bytesIn: number;
  messagesIn: number;
  seq: number;
}

async function guest(i: number): Promise<string> {
  const res = await fetch(`${URL}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i + 1}` },
    body: JSON.stringify({ nickname: `Bot ${i + 1}` }),
  });
  if (!res.ok) throw new Error(`guest failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

async function main() {
  const bots: Bot[] = [];
  for (let i = 0; i < BOTS; i++) {
    const token = await guest(i);
    const room = await new Client(URL).joinOrCreate(
      ROOM_NAME,
      { token, kind: "quick", primary: ["rifle", "smg", "shotgun", "sniper"][i % 4] },
      MatchState,
    );
    room.onMessage("*", () => {});
    const bot: Bot = { room, bytesIn: 0, messagesIn: 0, seq: 0 };
    const ws = (room.connection as unknown as { transport: { ws: WebSocket } }).transport.ws;
    ws.addEventListener("message", (ev: MessageEvent) => {
      const d = ev.data as ArrayBuffer | Buffer;
      bot.bytesIn += (d as ArrayBuffer).byteLength ?? (d as Buffer).length ?? 0;
      bot.messagesIn += 1;
    });
    bots.push(bot);
  }
  const roomIds = new Set(bots.map((b) => b.room.roomId));
  console.log(`${BOTS} bots joined ${roomIds.size} room(s)`);
  for (const b of bots) b.room.send(C2S.READY, { ready: true });

  const start = Date.now();
  while (bots[0]!.room.state.phase !== "playing") {
    if (Date.now() - start > 30_000) throw new Error("match did not start");
    await sleep(100);
  }
  console.log("match started; running load for", SECONDS, "s");
  for (const b of bots) {
    b.bytesIn = 0;
    b.messagesIn = 0;
  }
  const t0 = Date.now();
  const loop = setInterval(() => {
    for (const b of bots) {
      const t = (Date.now() - t0) / 1000;
      const frames = [0, 1, 2].map(() =>
        encodeInput(
          quantizeInput({
            seq: ++b.seq,
            mx: Math.round(Math.sin(t * 1.3 + b.seq * 0.001)),
            my: Math.round(Math.cos(t * 0.9 + bots.indexOf(b))),
            aim: (t * 2 + bots.indexOf(b)) % (Math.PI * 2) - Math.PI,
            buttons: (Math.sin(t * 3 + bots.indexOf(b)) > 0 ? BTN.FIRE : 0) | (b.seq % 600 === 0 ? BTN.RELOAD : 0),
            slot: -1,
            viewTick: Math.max(0, b.room.state.tick - 2),
          }),
        ),
      );
      b.room.send(C2S.INPUT, { i: frames });
    }
  }, 50);
  await sleep(SECONDS * 1000);
  clearInterval(loop);
  const elapsed = (Date.now() - t0) / 1000;

  const debug = (await (await fetch(`${URL}/api/debug/rooms`)).json()) as {
    roomId: string;
    tickCostMs?: { avg: number; max: number; maxIntervalMs: number };
    players?: { name: string; droppedInputs: number; queue: number }[];
  }[];
  const kbps = bots.map((b) => b.bytesIn / 1024 / elapsed);
  const kills = [...bots[0]!.room.state.players.values()].reduce((s, p) => s + p.kills, 0);
  console.log(
    JSON.stringify(
      {
        bots: BOTS,
        seconds: Math.round(elapsed),
        rooms: [...roomIds],
        downlinkPerClientKBps: {
          avg: Math.round((kbps.reduce((a, b) => a + b, 0) / kbps.length) * 10) / 10,
          max: Math.round(Math.max(...kbps) * 10) / 10,
        },
        messagesPerClientPerSec: Math.round(bots[0]!.messagesIn / elapsed),
        uplinkPerClientKBpsApprox: Math.round(((20 * (4 + 3 * 24)) / 1024) * 10) / 10,
        totalKills: kills,
        server: debug.filter((d) => roomIds.has(d.roomId)),
      },
      null,
      2,
    ),
  );
  await Promise.all(bots.map((b) => b.room.leave()));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
