#!/usr/bin/env node
/**
 * Network-conditions proxy for netcode testing ("netem" for WebSockets).
 *
 *   node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2600 \
 *        --latency 120 --jitter 40 --spike-rate 0.02 --spike 250 --seed 1
 *
 * HTTP requests (matchmaking, API) and WebSocket frames are forwarded with one-way delay =
 * latency/2 + uniform random jitter in [0, jitter]. TCP never reorders, so frames keep their order;
 * "packet loss" on a TCP connection shows up as retransmission stalls, modelled here as occasional
 * delay spikes. Randomness is seeded, so a run can be repeated.
 *
 * Runtime control (same port, never forwarded):
 *   GET  /__netem                       current settings and counters
 *   POST /__netem        {latency?, jitter?, spikeRate?, spike?}
 *   POST /__netem/stall  {ms, dir?: "up" | "down" | "both"}   hold traffic, then release in order
 *   POST /__netem/drop                  abruptly terminate every proxied WebSocket (both sides)
 *
 * --tls-cert/--tls-key serve HTTPS/WSS (TLS terminated here, like a PaaS load balancer) and
 * --forwarded appends X-Forwarded-For / X-Forwarded-Proto as a real reverse proxy does.
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

/** Small seeded PRNG (mulberry32) so jitter sequences are repeatable. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startNetemProxy(opts) {
  const target = new URL(opts.target ?? "http://localhost:2600");
  const cfg = {
    latency: Number(opts.latency ?? 0),
    jitter: Number(opts.jitter ?? 0),
    spikeRate: Number(opts.spikeRate ?? 0),
    spike: Number(opts.spike ?? 200),
  };
  const random = rng(Number(opts.seed ?? 1));
  const stallUntil = { up: 0, down: 0 };
  const stats = { connections: 0, open: 0, framesUp: 0, framesDown: 0, stalls: 0, drops: 0 };
  const sockets = new Set();

  const oneWay = () => cfg.latency / 2 + random() * cfg.jitter + (random() < cfg.spikeRate ? cfg.spike : 0);

  /**
   * Delays tasks while preserving their order (like a TCP stream). A single FIFO drained by one
   * timer: separate setTimeout calls with different durations but the same deadline are not
   * guaranteed to fire in registration order, which would reorder frames.
   */
  function orderedDelay(dir) {
    const queue = [];
    let last = 0;
    let timer = null;
    const pump = () => {
      timer = null;
      const now = Date.now();
      while (queue.length > 0 && queue[0].at <= now) queue.shift().fn();
      if (queue.length > 0) timer = setTimeout(pump, queue[0].at - now);
    };
    return (fn) => {
      const at = Math.max(Date.now() + oneWay(), last, stallUntil[dir]);
      last = at;
      queue.push({ at, fn });
      if (timer === null) timer = setTimeout(pump, Math.max(0, at - Date.now()));
    };
  }

  function control(req, res, body) {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    let data = {};
    try {
      data = body.length ? JSON.parse(body.toString()) : {};
    } catch {
      return send(400, { error: "invalid json" });
    }
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/__netem") return send(200, { cfg, stats });
    if (req.method === "POST" && path === "/__netem") {
      for (const k of Object.keys(cfg)) if (typeof data[k] === "number") cfg[k] = data[k];
      return send(200, { cfg });
    }
    if (req.method === "POST" && path === "/__netem/stall") {
      const ms = Number(data.ms ?? 0);
      const dir = data.dir ?? "both";
      const until = Date.now() + ms;
      if (dir === "up" || dir === "both") stallUntil.up = Math.max(stallUntil.up, until);
      if (dir === "down" || dir === "both") stallUntil.down = Math.max(stallUntil.down, until);
      stats.stalls++;
      return send(200, { stalledUntil: until, dir });
    }
    if (req.method === "POST" && path === "/__netem/drop") {
      const n = sockets.size;
      for (const s of sockets) {
        s.client.terminate();
        s.upstream.terminate();
      }
      sockets.clear();
      stats.drops += n;
      return send(200, { dropped: n });
    }
    return send(404, { error: "unknown control path" });
  }

  const forwardedHeaders = (req) => {
    if (!opts.forwarded) return {};
    const prior = req.headers["x-forwarded-for"];
    const peer = req.socket.remoteAddress ?? "";
    return {
      "x-forwarded-for": prior ? `${prior}, ${peer}` : peer,
      "x-forwarded-proto": opts.tls ? "https" : "http",
    };
  };

  const handler = (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if ((req.url ?? "").startsWith("/__netem")) return control(req, res, body);
      setTimeout(async () => {
        try {
          const upstream = await fetch(new URL(req.url ?? "/", target), {
            method: req.method,
            headers: {
              ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "host")),
              ...forwardedHeaders(req),
            },
            body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body,
          });
          const payload = Buffer.from(await upstream.arrayBuffer());
          setTimeout(() => {
            const headers = Object.fromEntries(upstream.headers.entries());
            delete headers["content-encoding"];
            delete headers["content-length"];
            res.writeHead(upstream.status, headers);
            res.end(payload);
          }, oneWay());
        } catch (err) {
          res.writeHead(502).end(String(err));
        }
      }, oneWay());
    });
  };
  const server = opts.tls ? https.createServer(opts.tls, handler) : http.createServer(handler);

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (client) => {
      const url = new URL(req.url ?? "/", target);
      url.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      const upstream = new WebSocket(url, {
        headers: { origin: req.headers.origin ?? "", ...forwardedHeaders(req) },
      });
      upstream.binaryType = "nodebuffer";
      const pair = { client, upstream };
      sockets.add(pair);
      stats.connections++;
      stats.open++;
      const toServer = orderedDelay("up");
      const toClient = orderedDelay("down");
      const pending = [];
      upstream.on("open", () => {
        for (const m of pending.splice(0)) upstream.send(m.data, { binary: m.binary });
      });
      client.on("message", (data, binary) =>
        toServer(() => {
          stats.framesUp++;
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
          else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, binary });
        }),
      );
      upstream.on("message", (data, binary) =>
        toClient(() => {
          stats.framesDown++;
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
        }),
      );
      let closed = false;
      const closeBoth = (code, reason) => {
        if (!closed) {
          closed = true;
          stats.open--;
          sockets.delete(pair);
        }
        const safe = typeof code === "number" && code >= 1000 && code !== 1005 && code !== 1006 ? code : 1000;
        if (client.readyState === WebSocket.OPEN) client.close(safe, reason);
        if (upstream.readyState === WebSocket.OPEN) upstream.close(safe, reason);
      };
      client.on("close", (c, r) => toServer(() => closeBoth(c, r)));
      upstream.on("close", (c, r) => toClient(() => closeBoth(c, r)));
      upstream.on("error", () => closeBoth(1011));
      client.on("error", () => closeBoth(1011));
    });
  });

  return new Promise((resolve) => {
    server.listen(Number(opts.listen ?? 2610), () =>
      resolve({
        cfg,
        stats,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) {
              s.client.terminate();
              s.upstream.terminate();
            }
            server.close(() => r());
          }),
      }),
    );
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
  const opts = {
    listen: args.listen,
    target: args.target,
    latency: args.latency ?? 100,
    jitter: args.jitter,
    spikeRate: args["spike-rate"],
    spike: args.spike,
    seed: args.seed,
    forwarded: argv.includes("--forwarded"),
    tls: args["tls-cert"]
      ? { cert: readFileSync(args["tls-cert"]), key: readFileSync(args["tls-key"]) }
      : undefined,
  };
  startNetemProxy(opts).then(({ cfg }) =>
    console.log(
      `netem proxy :${opts.listen ?? 2610} -> ${opts.target ?? "http://localhost:2600"} latency=${cfg.latency}ms jitter=${cfg.jitter}ms spikes=${cfg.spikeRate * 100}%x${cfg.spike}ms`,
    ),
  );
}
