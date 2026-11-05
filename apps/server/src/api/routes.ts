import { randomUUID } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import {
  type GuestSessionResponse,
  isSkinUnlocked,
  isValidRoomCode,
  levelFromXp,
  nicknameSchema,
  normalizeRoomCode,
  PRIMARY_WEAPONS,
  type PublicProfile,
  ROOM_NAME,
  type RoomListing,
  type RoomMetadata,
  type WeaponId,
} from "@scrapline/shared";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { findRoomIdByCode } from "../matchmaking/roomCodes.ts";
import type { PlayerRecord } from "../persistence/repository.ts";
import { RateLimiter } from "../security/rateLimit.ts";
import { bearerToken, issueToken, verifyToken } from "../security/tokens.ts";
import type { Services } from "../services.ts";

export function toProfile(r: PlayerRecord): PublicProfile {
  const lp = levelFromXp(r.xp);
  return {
    id: r.id,
    nickname: r.nickname,
    level: lp.level,
    xp: r.xp,
    xpIntoLevel: lp.xpIntoLevel,
    xpForNext: lp.xpForNext,
    stats: r.stats,
    skin: r.skin,
    primary: r.primary,
    createdAt: r.createdAt.toISOString(),
  };
}

const guestSchema = z.object({ nickname: nicknameSchema });
const profilePatchSchema = z.object({
  nickname: nicknameSchema.optional(),
  skin: z.string().max(32).optional(),
  primary: z.enum(PRIMARY_WEAPONS as [WeaponId, ...WeaponId[]]).optional(),
});

function clientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function corsMiddleware(allowedOrigins: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function registerRoutes(app: express.Application, services: Services): void {
  const { cfg, repo, log } = services;
  const guestLimiter = new RateLimiter(10, 10 / 60);
  const apiLimiter = new RateLimiter(60, 2);

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(corsMiddleware(cfg.allowedOrigins));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", async (_req, res) => {
    const db = await repo.ping();
    res
      .status(db ? 200 : 503)
      .json({ status: db ? "ok" : "degraded", db: repo.kind, uptime: process.uptime() });
  });

  app.use("/api", (req, res, next) => {
    if (!apiLimiter.take(clientKey(req))) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  });

  const authed = async (req: Request, res: Response): Promise<PlayerRecord | null> => {
    const payload = verifyToken(bearerToken(req.headers.authorization), cfg.tokenSecret);
    if (!payload) {
      res.status(401).json({ error: "Invalid or missing identity token" });
      return null;
    }
    const rec = await repo.getPlayer(payload.sub);
    if (!rec) {
      res.status(401).json({ error: "Unknown player" });
      return null;
    }
    return rec;
  };

  app.post("/api/guest", async (req, res) => {
    if (!guestLimiter.take(clientKey(req))) {
      res.status(429).json({ error: "Too many new profiles from this address, try again later" });
      return;
    }
    const parsed = guestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid nickname" });
      return;
    }
    const rec = await repo.createPlayer(randomUUID(), parsed.data.nickname);
    const body: GuestSessionResponse = {
      token: issueToken(rec.id, cfg.tokenSecret),
      profile: toProfile(rec),
    };
    log.info({ playerId: rec.id }, "guest created");
    res.status(201).json(body);
  });

  app.get("/api/me", async (req, res) => {
    const rec = await authed(req, res);
    if (!rec) return;
    void repo.touch(rec.id);
    res.json(toProfile(rec));
  });

  app.patch("/api/me", async (req, res) => {
    const rec = await authed(req, res);
    if (!rec) return;
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" });
      return;
    }
    if (parsed.data.skin && !isSkinUnlocked(parsed.data.skin, levelFromXp(rec.xp).level)) {
      res.status(403).json({ error: "Skin not unlocked yet" });
      return;
    }
    const updated = await repo.updateProfile(rec.id, parsed.data);
    res.json(toProfile(updated ?? rec));
  });

  app.get("/api/rooms", async (_req, res) => {
    const rooms = await matchMaker.query({ name: ROOM_NAME });
    const list: RoomListing[] = rooms
      .filter((r) => !r.private && !r.locked)
      .map((r) => {
        const m = r.metadata as RoomMetadata | undefined;
        return {
          roomId: r.roomId,
          code: m?.code ?? "",
          map: m?.map ?? "",
          phase: m?.phase ?? "lobby",
          players: r.clients,
          maxPlayers: r.maxClients,
          hostName: m?.hostName ?? "",
        };
      });
    res.json(list);
  });

  app.get("/api/rooms/code/:code", async (req, res) => {
    const code = normalizeRoomCode(String(req.params.code ?? ""));
    if (!isValidRoomCode(code)) {
      res.status(400).json({ error: "Invalid room code" });
      return;
    }
    const roomId = await findRoomIdByCode(code);
    if (!roomId) {
      res.status(404).json({ error: "Room not found or already closed" });
      return;
    }
    res.json({ roomId });
  });

  app.get("/api/leaderboard", async (req, res) => {
    const sort = z.enum(["kills", "wins", "xp"]).catch("xp").parse(req.query.sort);
    res.json(await repo.leaderboard(sort, 50));
  });

  if (cfg.ENABLE_DEBUG_ROUTES) {
    app.get("/api/debug/rooms", async (_req, res) => {
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      res.json(
        rooms.map((r) => {
          const local = matchMaker.getLocalRoomById(r.roomId) as unknown as { debugSnapshot?: () => unknown };
          return local?.debugSnapshot?.() ?? { roomId: r.roomId, remote: true };
        }),
      );
    });
  }

  // Errors thrown by async handlers end up here instead of crashing the process.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err }, "http error");
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  });
}
