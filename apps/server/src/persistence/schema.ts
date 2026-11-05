import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey(),
    nickname: varchar("nickname", { length: 32 }).notNull(),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    matchesPlayed: integer("matches_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    shotsFired: integer("shots_fired").notNull().default(0),
    shotsHit: integer("shots_hit").notNull().default(0),
    playtimeSec: integer("playtime_sec").notNull().default(0),
    skin: varchar("skin", { length: 32 }).notNull().default("foundry"),
    primaryWeapon: varchar("primary_weapon", { length: 16 }).notNull().default("rifle"),
    /** Per-mode stats, objective counters and daily challenges (CareerStats, validated on read). */
    career: jsonb("career").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("players_kills_idx").on(t.kills), index("players_xp_idx").on(t.xp)],
);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey(),
  roomId: varchar("room_id", { length: 64 }).notNull(),
  mapId: varchar("map_id", { length: 32 }).notNull(),
  mode: varchar("mode", { length: 32 }).notNull(),
  roomKind: varchar("room_kind", { length: 16 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  winnerPlayerId: uuid("winner_player_id"),
  endReason: text("end_reason").notNull(),
});

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kills: integer("kills").notNull(),
    deaths: integer("deaths").notNull(),
    placement: integer("placement").notNull(),
    xpGained: integer("xp_gained").notNull(),
    completed: boolean("completed").notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.playerId] })],
);
