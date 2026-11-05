// GENERATED from src/p2p/signalServer.ts by scripts/build-api.mjs. Do not edit: run
// `pnpm --filter @scrapline/web build:api`.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const ROOM_TTL_SEC = 120;
const MAILBOX_TTL_SEC = 60;
const MAX_PENDING_OFFERS = 16;
const MAX_SDP_CHARS = 24e3;
const MAX_BODY_CHARS = 32e3;
const OPERATIONS = ["create", "join", "poll", "answer", "wait", "close", "ice"];
const RATE_LIMITS = { create: 30, join: 120, ice: 120 };
class MemoryStore {
  constructor(now = Date.now) {
    this.now = now;
  }
  data = /* @__PURE__ */ new Map();
  live(key) {
    const e = this.data.get(key);
    if (!e) return void 0;
    if (e.exp <= this.now()) {
      this.data.delete(key);
      return void 0;
    }
    return e;
  }
  async setNx(key, value, ttlSec) {
    if (this.live(key)) return false;
    this.data.set(key, { v: value, exp: this.now() + ttlSec * 1e3 });
    return true;
  }
  async get(key) {
    const e = this.live(key);
    return typeof e?.v === "string" ? e.v : null;
  }
  async set(key, value, ttlSec) {
    this.data.set(key, { v: value, exp: this.now() + ttlSec * 1e3 });
  }
  async getDel(key) {
    const v = await this.get(key);
    this.data.delete(key);
    return v;
  }
  async del(...keys) {
    for (const k of keys) this.data.delete(k);
  }
  async expire(key, ttlSec) {
    const e = this.live(key);
    if (e) e.exp = this.now() + ttlSec * 1e3;
  }
  async push(key, value, max, ttlSec) {
    const e = this.live(key);
    const list = Array.isArray(e?.v) ? e.v : [];
    list.push(value);
    while (list.length > max) list.shift();
    this.data.set(key, { v: list, exp: this.now() + ttlSec * 1e3 });
    return list.length;
  }
  async popAndRenew(key, count, renewKey, ttlSec) {
    await this.expire(renewKey, ttlSec);
    const e = this.live(key);
    if (!e || !Array.isArray(e.v)) return [];
    const out = e.v.splice(0, count);
    if (e.v.length === 0) this.data.delete(key);
    return out;
  }
  async incr(key, ttlSec) {
    const e = this.live(key);
    const n = (typeof e?.v === "number" ? e.v : 0) + 1;
    this.data.set(key, { v: n, exp: e ? e.exp : this.now() + ttlSec * 1e3 });
    return n;
  }
}
class UpstashStore {
  constructor(url, token, fetchImpl = fetch) {
    this.url = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }
  async pipeline(commands) {
    const res = await this.fetchImpl(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands)
    });
    if (!res.ok) throw new StoreError(`redis http ${res.status}`);
    const out = await res.json();
    return out.map((r) => {
      if (r.error) throw new StoreError(`redis: ${r.error}`);
      return r.result;
    });
  }
  async setNx(key, value, ttlSec) {
    const [r] = await this.pipeline([["SET", key, value, "EX", ttlSec, "NX"]]);
    return r === "OK";
  }
  async get(key) {
    const [r] = await this.pipeline([["GET", key]]);
    return typeof r === "string" ? r : null;
  }
  async set(key, value, ttlSec) {
    await this.pipeline([["SET", key, value, "EX", ttlSec]]);
  }
  async getDel(key) {
    const [r] = await this.pipeline([["GETDEL", key]]);
    return typeof r === "string" ? r : null;
  }
  async del(...keys) {
    if (keys.length > 0) await this.pipeline([["DEL", ...keys]]);
  }
  async expire(key, ttlSec) {
    await this.pipeline([["EXPIRE", key, ttlSec]]);
  }
  async push(key, value, max, ttlSec) {
    const [n] = await this.pipeline([
      ["RPUSH", key, value],
      ["LTRIM", key, -max, -1],
      ["EXPIRE", key, ttlSec]
    ]);
    return Math.min(Number(n), max);
  }
  async popAndRenew(key, count, renewKey, ttlSec) {
    const [r] = await this.pipeline([
      ["LPOP", key, count],
      ["EXPIRE", renewKey, ttlSec]
    ]);
    return Array.isArray(r) ? r.filter((x) => typeof x === "string") : [];
  }
  async incr(key, ttlSec) {
    const [n] = await this.pipeline([
      ["INCR", key],
      ["EXPIRE", key, ttlSec]
    ]);
    return Number(n);
  }
}
class StoreError extends Error {
}
function upstashFromEnv(env) {
  const pairs = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
  ];
  for (const key of Object.keys(env).sort()) {
    for (const suffix of ["_KV_REST_API_URL", "_UPSTASH_REDIS_REST_URL"]) {
      if (key.endsWith(suffix) && key !== suffix.slice(1)) {
        pairs.push([key, key.replace(/_URL$/, "_TOKEN")]);
      }
    }
  }
  for (const [u, t] of pairs) {
    const url = env[u];
    const token = env[t];
    if (url && token) return { url: url.replace(/\/$/, ""), token };
  }
  for (const key of ["KV_URL", "REDIS_URL", "UPSTASH_REDIS_URL"]) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.hostname.endsWith(".upstash.io") && u.password) {
        return { url: `https://${u.hostname}`, token: decodeURIComponent(u.password) };
      }
    } catch {
    }
  }
  return null;
}
const DEFAULT_STUN = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }
];
async function iceServersFromEnv(env, fetchImpl = fetch) {
  const servers = [...DEFAULT_STUN];
  if (env.TURN_URLS) {
    servers.push({
      urls: env.TURN_URLS.split(",").map((s) => s.trim()).filter(Boolean),
      ...env.TURN_USERNAME ? { username: env.TURN_USERNAME } : {},
      ...env.TURN_CREDENTIAL ? { credential: env.TURN_CREDENTIAL } : {}
    });
  }
  if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
    try {
      const res = await fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ ttl: 6 * 3600 })
        }
      );
      if (res.ok) {
        const body = await res.json();
        const list = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
        for (const s of list) {
          const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => /^turns?:/.test(u));
          if (urls.length > 0) servers.push({ ...s, urls });
        }
      }
    } catch {
    }
  }
  return servers;
}
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });
function defaultRandom(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}
function randomCode(random) {
  const limit = 256 - 256 % CODE_ALPHABET.length;
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of random(16)) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}
const isCode = (v) => typeof v === "string" && v.length === CODE_LENGTH && [...v].every((c) => CODE_ALPHABET.includes(c));
const isToken = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);
const isSdp = (v) => typeof v === "string" && v.length > 10 && v.length <= MAX_SDP_CHARS && v.startsWith("v=0");
const roomKey = (code) => `p2p:room:${code}`;
const inboxKey = (code) => `p2p:in:${code}`;
const answerKey = (guestId) => `p2p:ans:${guestId}`;
async function handleSignal(req, deps) {
  const { store } = deps;
  const random = deps.random ?? defaultRandom;
  const now = deps.now ?? Date.now;
  if (!OPERATIONS.includes(req.op)) return fail(404, "unknown operation");
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const limit = RATE_LIMITS[req.op];
  if (limit !== void 0) {
    const minute = Math.floor(now() / 6e4);
    const hits = await store.incr(`p2p:rl:${req.op}:${req.ip}:${minute}`, 70);
    if (hits > limit) return fail(429, "too many requests, try again in a minute");
  }
  const verifyHost = async () => {
    if (!isCode(body.code) || !isToken(body.hostKey)) return fail(400, "invalid request");
    const raw = await store.get(roomKey(body.code));
    if (!raw) return fail(404, "room not found");
    const rec = JSON.parse(raw);
    if (rec.h !== await sha256(body.hostKey)) return fail(403, "not the host of this room");
    return rec;
  };
  switch (req.op) {
    case "create": {
      const hostKey = base64url(random(32));
      const record = { h: await sha256(hostKey), t: now() };
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode(random);
        if (await store.setNx(roomKey(code), JSON.stringify(record), ROOM_TTL_SEC)) {
          return ok({ code, hostKey, ttlSec: ROOM_TTL_SEC });
        }
      }
      return fail(503, "no free room code, try again");
    }
    case "join": {
      if (!isCode(body.code) || !isSdp(body.sdp)) return fail(400, "invalid request");
      if (body.resume !== void 0 && !isToken(body.resume)) return fail(400, "invalid request");
      if (!await store.get(roomKey(body.code))) return fail(404, "room not found");
      const guestId = base64url(random(18));
      const offer = { g: guestId, sdp: body.sdp, ...body.resume ? { r: body.resume } : {} };
      await store.push(inboxKey(body.code), JSON.stringify(offer), MAX_PENDING_OFFERS, MAILBOX_TTL_SEC);
      return ok({ guestId });
    }
    case "poll": {
      const v = await verifyHost();
      if ("status" in v) return v;
      const code = body.code;
      const raw = await store.popAndRenew(inboxKey(code), MAX_PENDING_OFFERS, roomKey(code), ROOM_TTL_SEC);
      const offers = raw.flatMap((s) => {
        try {
          const o = JSON.parse(s);
          return [{ guestId: o.g, sdp: o.sdp, ...o.r ? { resume: o.r } : {} }];
        } catch {
          return [];
        }
      });
      return ok({ offers, ttlSec: ROOM_TTL_SEC });
    }
    case "answer": {
      const v = await verifyHost();
      if ("status" in v) return v;
      if (!isToken(body.guestId)) return fail(400, "invalid request");
      const hasSdp = isSdp(body.sdp);
      const reason = typeof body.error === "string" ? body.error.slice(0, 200) : null;
      if (!hasSdp && !reason) return fail(400, "invalid request");
      const value = hasSdp ? { sdp: body.sdp } : { error: reason };
      await store.set(answerKey(body.guestId), JSON.stringify(value), MAILBOX_TTL_SEC);
      return ok({});
    }
    case "wait": {
      if (!isToken(body.guestId)) return fail(400, "invalid request");
      const raw = await store.getDel(answerKey(body.guestId));
      return ok({ answer: raw ? JSON.parse(raw) : null });
    }
    case "close": {
      const v = await verifyHost();
      if ("status" in v) return v;
      await store.del(roomKey(body.code), inboxKey(body.code));
      return ok({});
    }
    case "ice":
      return ok({ iceServers: await iceServersFromEnv(deps.env ?? {}, deps.fetchImpl) });
  }
  return fail(404, "unknown operation");
}
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
async function handleHttp(request, deps) {
  if (request.method === "GET") {
    let storage = "missing";
    if (deps.store) {
      try {
        await deps.store.get("p2p:health");
        storage = "connected";
      } catch {
        storage = "unreachable";
      }
    }
    return new Response(JSON.stringify({ service: "scrapline-signaling", storage }), {
      status: 200,
      headers: JSON_HEADERS
    });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS
    });
  }
  if (!deps.store) {
    return new Response(
      JSON.stringify({
        error: "Host mode is not configured: connect an Upstash Redis store to this Vercel project."
      }),
      { status: 503, headers: JSON_HEADERS }
    );
  }
  const op = new URL(request.url).searchParams.get("op") ?? "";
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) {
    return new Response(JSON.stringify({ error: "request too large" }), {
      status: 413,
      headers: JSON_HEADERS
    });
  }
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: JSON_HEADERS });
  }
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  try {
    const res = await handleSignal({ op, body, ip }, { ...deps, store: deps.store });
    return new Response(JSON.stringify(res.body), { status: res.status, headers: JSON_HEADERS });
  } catch (err) {
    console.error("signal error", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "signaling storage unavailable" }), {
      status: 503,
      headers: JSON_HEADERS
    });
  }
}
const processEnv = () => globalThis.process?.env ?? {};
let cachedStore;
var stdin_default = {
  async fetch(request) {
    const env = processEnv();
    if (cachedStore === void 0) {
      const creds = upstashFromEnv(env);
      cachedStore = creds ? new UpstashStore(creds.url, creds.token) : null;
    }
    return handleHttp(request, { store: cachedStore, env });
  }
};
export {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_STUN,
  MAILBOX_TTL_SEC,
  MemoryStore,
  OPERATIONS,
  RATE_LIMITS,
  ROOM_TTL_SEC,
  StoreError,
  UpstashStore,
  stdin_default as default,
  handleHttp,
  handleSignal,
  iceServersFromEnv,
  upstashFromEnv
};
