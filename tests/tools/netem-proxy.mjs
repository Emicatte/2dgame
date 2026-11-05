#!/usr/bin/env node
/**
 * Network-conditions proxy for netcode testing ("netem" for WebSockets).
 *
 *   node tests/tools/netem-proxy.mjs --listen 2610 --target http://localhost:2600 \
 *        --latency 120 --jitter 40 --spike-rate 0.02 --spike 250
 *
 * HTTP requests (matchmaking, API) and WebSocket frames are forwarded with one-way delay =
 * latency/2 + random jitter. TCP never reorders, so frames keep their order; "packet loss" on a
 * TCP connection shows up as retransmission stalls, modelled here as occasional delay spikes.
 */
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
const listen = Number(args.listen ?? 2610);
const target = new URL(args.target ?? "http://localhost:2600");
const latency = Number(args.latency ?? 100);
const jitter = Number(args.jitter ?? 0);
const spikeRate = Number(args["spike-rate"] ?? 0);
const spike = Number(args.spike ?? 200);

const oneWay = () => latency / 2 + Math.random() * jitter + (Math.random() < spikeRate ? spike : 0);

/** Delays tasks while preserving their order (like a TCP stream). */
function orderedDelay() {
  let last = 0;
  return (fn) => {
    const at = Math.max(Date.now() + oneWay(), last);
    last = at;
    setTimeout(fn, at - Date.now());
  };
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    setTimeout(async () => {
      try {
        const upstream = await fetch(new URL(req.url ?? "/", target), {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "host")),
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        setTimeout(() => {
          const headers = Object.fromEntries(upstream.headers.entries());
          delete headers["content-encoding"];
          delete headers["content-length"];
          res.writeHead(upstream.status, headers);
          res.end(body);
        }, oneWay());
      } catch (err) {
        res.writeHead(502).end(String(err));
      }
    }, oneWay());
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (client) => {
    const url = new URL(req.url ?? "/", target);
    url.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const upstream = new WebSocket(url, { headers: { origin: req.headers.origin ?? "" } });
    upstream.binaryType = "nodebuffer";
    const toServer = orderedDelay();
    const toClient = orderedDelay();
    const pending = [];
    upstream.on("open", () => {
      for (const m of pending.splice(0)) upstream.send(m.data, { binary: m.binary });
    });
    client.on("message", (data, binary) =>
      toServer(() => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else pending.push({ data, binary });
      }),
    );
    upstream.on("message", (data, binary) =>
      toClient(() => client.readyState === WebSocket.OPEN && client.send(data, { binary })),
    );
    const closeBoth = (code, reason) => {
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

server.listen(listen, () => {
  console.log(
    `netem proxy :${listen} -> ${target.href} latency=${latency}ms jitter=${jitter}ms spikes=${spikeRate * 100}%x${spike}ms`,
  );
});
