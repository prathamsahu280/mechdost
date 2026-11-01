CREATE TABLE "live_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "live_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer NOT NULL,
	"event" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_outbox_topic_format" CHECK ("live_outbox"."topic" ~ '^(order|shop|workshop|user|staff_city|quote):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "live_outbox_kind_valid" CHECK ("live_outbox"."kind" in ('order','assignment','shop','workshop','request','quote','coins')),
	CONSTRAINT "live_outbox_event_format" CHECK ("live_outbox"."event" ~ '^[a-z_]+[.][a-z_]+$'),
	CONSTRAINT "live_outbox_version_positive" CHECK ("live_outbox"."entity_version" >= 1),
	CONSTRAINT "live_outbox_attempts_nonneg" CHECK ("live_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "live_outbox_pending_idx" ON "live_outbox" USING btree ("id") WHERE "live_outbox"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "live_outbox_sent_idx" ON "live_outbox" USING btree ("sent_at") WHERE "live_outbox"."sent_at" is not null;