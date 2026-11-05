import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@scrapline/shared";
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  handleHttp,
  handleSignal,
  iceServersFromEnv,
  MAILBOX_TTL_SEC,
  MemoryStore,
  ROOM_TTL_SEC,
  type SignalStore,
  UpstashStore,
  upstashFromEnv,
} from "../src/p2p/signalServer.ts";

const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n";

function setup() {
  let t = 1_000_000;
  const now = () => t;
  const store = new MemoryStore(now);
  const call = (op: string, body: Record<string, unknown> = {}, ip = "1.2.3.4") =>
    handleSignal({ op, body, ip }, { store, now });
  return { store, call, advance: (ms: number) => (t += ms) };
}

describe("host-mode signaling", () => {
  it("uses the same room code alphabet as the dedicated server", () => {
    expect(CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET);
    expect(CODE_LENGTH).toBe(ROOM_CODE_LENGTH);
  });

  it("introduces a guest to the host: create, join, poll, answer, wait", async () => {
    const { call } = setup();
    const created = await call("create");
    expect(created.status).toBe(200);
    const { code, hostKey } = created.body as { code: string; hostKey: string };
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`));

    const joined = await call("join", { code, sdp: SDP });
    expect(joined.status).toBe(200);
    const { guestId } = joined.body as { guestId: string };

    expect((await call("wait", { guestId })).body).toEqual({ answer: null });

    const polled = await call("poll", { code, hostKey });
    expect(polled.body.offers).toEqual([{ guestId, sdp: SDP }]);
    // Offers are consumed once.
    expect((await call("poll", { code, hostKey })).body.offers).toEqual([]);

    expect((await call("answer", { code, hostKey, guestId, sdp: `${SDP}a=answer\r\n` })).status).toBe(200);
    expect((await call("wait", { guestId })).body).toEqual({ answer: { sdp: `${SDP}a=answer\r\n` } });
    // Answers are consumed once.
    expect((await call("wait", { guestId })).body).toEqual({ answer: null });
  });

  it("only the host key can read offers, answer or close", async () => {
    const { call } = setup();
    const { code } = (await call("create")).body as { code: string };
    const { hostKey: other } = (await call("create")).body as { hostKey: string };
    expect((await call("poll", { code, hostKey: other })).status).toBe(403);
    expect((await call("answer", { code, hostKey: other, guestId: "a".repeat(24), sdp: SDP })).status).toBe(
      403,
    );
    expect((await call("close", { code, hostKey: other })).status).toBe(403);
    expect((await call("poll", { code, hostKey: "short" })).status).toBe(400);
  });

  it("rejects unknown rooms, malformed codes and SDP, and unknown operations", async () => {
    const { call } = setup();
    expect((await call("join", { code: "ZZZZZ", sdp: SDP })).status).toBe(404);
    expect((await call("join", { code: "zz", sdp: SDP })).status).toBe(400);
    expect((await call("join", { code: "AAAAO", sdp: SDP })).status).toBe(400); // O is not in the alphabet
    const { code } = (await call("create")).body as { code: string };
    expect((await call("join", { code, sdp: "hello" })).status).toBe(400);
    expect((await call("join", { code, sdp: `v=0${"x".repeat(30_000)}` })).status).toBe(400);
    expect((await call("drop-tables")).status).toBe(404);
  });

  it("a closed or expired room cannot be joined", async () => {
    const { call, advance } = setup();
    const a = (await call("create")).body as { code: string; hostKey: string };
    expect((await call("close", a)).status).toBe(200);
    expect((await call("join", { code: a.code, sdp: SDP })).status).toBe(404);

    const b = (await call("create")).body as { code: string; hostKey: string };
    advance((ROOM_TTL_SEC - 5) * 1000);
    await call("poll", b); // each host poll renews the registration
    advance((ROOM_TTL_SEC - 5) * 1000);
    expect((await call("join", { code: b.code, sdp: SDP })).status).toBe(200);
    advance((ROOM_TTL_SEC + 1) * 1000);
    expect((await call("join", { code: b.code, sdp: SDP })).status).toBe(404);
  });

  it("pending offers and answers expire", async () => {
    const { call, advance } = setup();
    const reg = (await call("create")).body as { code: string; hostKey: string };
    await call("join", { code: reg.code, sdp: SDP });
    advance((MAILBOX_TTL_SEC + 1) * 1000);
    expect((await call("poll", reg)).body.offers).toEqual([]);
  });

  it("rate limits room creation per address and minute", async () => {
    const { call, advance } = setup();
    for (let i = 0; i < 30; i++) expect((await call("create")).status).toBe(200);
    expect((await call("create")).status).toBe(429);
    expect((await call("create", {}, "5.6.7.8")).status).toBe(200);
    advance(60_000);
    expect((await call("create")).status).toBe(200);
  });

  it("HTTP wrapper: POST for operations, GET health, size limit, 503 without storage", async () => {
    const store = new MemoryStore();
    const post = (body: string, op = "create") =>
      handleHttp(new Request(`http://x/api/p2p?op=${op}`, { method: "POST", body }), { store });
    expect((await post("{}")).status).toBe(200);
    expect((await post("not json")).status).toBe(400);
    expect((await post(" ".repeat(40_000))).status).toBe(413);
    expect((await handleHttp(new Request("http://x/api/p2p", { method: "PUT" }), { store })).status).toBe(
      405,
    );
    const health = await handleHttp(new Request("http://x/api/p2p"), { store: null });
    expect(await health.json()).toEqual({ service: "scrapline-signaling", storage: "missing" });
    const res = await handleHttp(new Request("http://x/api/p2p?op=create", { method: "POST" }), {
      store: null,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/Upstash/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("storage errors become 503 without leaking details", async () => {
    const broken = new Proxy(new MemoryStore(), {
      get: () => () => Promise.reject(new Error("ECONNREFUSED secret-host")),
    }) as SignalStore;
    const res = await handleHttp(new Request("http://x/api/p2p?op=create", { method: "POST", body: "{}" }), {
      store: broken,
    });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/secret-host/);
  });
});

describe("Upstash configuration", () => {
  it("finds the Vercel Storage variables, prefixed variables, Upstash names and the Redis URL", () => {
    expect(upstashFromEnv({ KV_REST_API_URL: "https://a.upstash.io/", KV_REST_API_TOKEN: "t1" })).toEqual({
      url: "https://a.upstash.io",
      token: "t1",
    });
    expect(
      upstashFromEnv({ STORAGE_KV_REST_API_URL: "https://b.upstash.io", STORAGE_KV_REST_API_TOKEN: "t2" }),
    ).toEqual({ url: "https://b.upstash.io", token: "t2" });
    expect(
      upstashFromEnv({ UPSTASH_REDIS_REST_URL: "https://c.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t3" }),
    ).toEqual({ url: "https://c.upstash.io", token: "t3" });
    expect(upstashFromEnv({ REDIS_URL: "rediss://default:t4@d.upstash.io:6379" })).toEqual({
      url: "https://d.upstash.io",
      token: "t4",
    });
    expect(upstashFromEnv({ REDIS_URL: "redis://user:pw@localhost:6379" })).toBeNull();
    expect(upstashFromEnv({})).toBeNull();
  });

  it("speaks the REST pipeline protocol", async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[][];
      calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
      const results = body.map((cmd) => {
        if (cmd[0] === "SET") return { result: "OK" };
        if (cmd[0] === "LPOP") return { result: ["x", "y"] };
        return { result: 1 };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    }) as unknown as typeof fetch;
    const store = new UpstashStore("https://e.upstash.io", "tok", fake);
    expect(await store.setNx("k", "v", 10)).toBe(true);
    expect(await store.popAndRenew("l", 5, "r", 120)).toEqual(["x", "y"]);
    expect(calls[0]).toEqual({
      url: "https://e.upstash.io/pipeline",
      body: [["SET", "k", "v", "EX", 10, "NX"]],
      auth: "Bearer tok",
    });
    expect(calls[1]?.body).toEqual([
      ["LPOP", "l", 5],
      ["EXPIRE", "r", 120],
    ]);
  });
});

describe("ICE servers", () => {
  it("STUN by default, static TURN, Cloudflare TURN credentials", async () => {
    expect(await iceServersFromEnv({})).toHaveLength(1);
    const withTurn = await iceServersFromEnv({
      TURN_URLS: "turn:t.example:3478, turns:t.example:443",
      TURN_USERNAME: "u",
      TURN_CREDENTIAL: "p",
    });
    expect(withTurn[1]).toEqual({
      urls: ["turn:t.example:3478", "turns:t.example:443"],
      username: "u",
      credential: "p",
    });

    const cf = (async () =>
      new Response(
        JSON.stringify({
          iceServers: [
            { urls: ["stun:stun.cloudflare.com:3478"] },
            {
              urls: [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
              ],
              username: "cu",
              credential: "cc",
            },
          ],
        }),
      )) as unknown as typeof fetch;
    const servers = await iceServersFromEnv(
      { CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" },
      cf,
    );
    expect(servers).toHaveLength(2);
    expect(servers[1]?.username).toBe("cu");
    // A failing TURN provider still yields STUN.
    const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(
      await iceServersFromEnv({ CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" }, down),
    ).toHaveLength(1);
  });
});

describe("deployed function (api/p2p.js)", () => {
  it("is up to date with src/p2p/signalServer.ts", async () => {
    // @ts-expect-error: plain ESM build script without type declarations
    const { buildApi, TARGET } = (await import("../scripts/build-api.mjs")) as {
      buildApi(): Promise<string>;
      TARGET: string;
    };
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(TARGET, "utf8")).toBe(await buildApi());
  });

  it("runs as plain JavaScript: health without storage, 503 for operations", async () => {
    // @ts-expect-error: generated JavaScript, typed by its TypeScript source
    const mod = (await import("../api/p2p.js")) as { default: { fetch(r: Request): Promise<Response> } };
    const health = await mod.default.fetch(new Request("https://x/api/p2p"));
    expect(await health.json()).toEqual({ service: "scrapline-signaling", storage: "missing" });
    const op = await mod.default.fetch(
      new Request("https://x/api/p2p?op=create", { method: "POST", body: "{}" }),
    );
    expect(op.status).toBe(503);
  });
});
