CREATE TABLE "match_players" (
	"match_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"kills" integer NOT NULL,
	"deaths" integer NOT NULL,
	"placement" integer NOT NULL,
	"xp_gained" integer NOT NULL,
	"completed" boolean NOT NULL,
	CONSTRAINT "match_players_match_id_player_id_pk" PRIMARY KEY("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" varchar(64) NOT NULL,
	"map_id" varchar(32) NOT NULL,
	"mode" varchar(32) NOT NULL,
	"room_kind" varchar(16) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"winner_player_id" uuid,
	"end_reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nickname" varchar(32) NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"shots_fired" integer DEFAULT 0 NOT NULL,
	"shots_hit" integer DEFAULT 0 NOT NULL,
	"playtime_sec" integer DEFAULT 0 NOT NULL,
	"skin" varchar(32) DEFAULT 'foundry' NOT NULL,
	"primary_weapon" varchar(16) DEFAULT 'rifle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "players_kills_idx" ON "players" USING btree ("kills");--> statement-breakpoint
CREATE INDEX "players_xp_idx" ON "players" USING btree ("xp");