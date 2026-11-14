-- In-app bell and web push (2026-11-15, design 2026-11-15-bell-push-design.md): `notifications` gains category, kind,
-- entity and a dedupe key (one write per business change); `push_devices` holds browser push tokens (personal data:
-- RLS on, client roles revoked). The notifications table was never written before, so no backfill is needed.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" text DEFAULT 'web' NOT NULL,
	"ua_family" text DEFAULT 'other' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "push_devices_platform_valid" CHECK ("push_devices"."platform" in ('web','android','ios')),
	CONSTRAINT "push_devices_locale_valid" CHECK ("push_devices"."locale" in ('en','hi')),
	CONSTRAINT "push_devices_ua_valid" CHECK ("push_devices"."ua_family" in ('chrome','firefox','safari','edge','other')),
	CONSTRAINT "push_devices_token_len" CHECK (char_length("push_devices"."fcm_token") between 20 and 4096)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" text DEFAULT 'transactional' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_token_uq" ON "push_devices" USING btree ("fcm_token");--> statement-breakpoint
CREATE INDEX "push_devices_user_live_idx" ON "push_devices" USING btree ("user_id") WHERE "push_devices"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_category_valid" CHECK ("notifications"."category" in ('transactional','promotional','reminders'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_valid" CHECK ("notifications"."entity_type" is null or "notifications"."entity_type" in ('order','service_request','quote','ticket','refund','shop','application','account'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_link_local" CHECK ("notifications"."link" is null or "notifications"."link" ~ '^/[^/\\]');--> statement-breakpoint
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.push_devices FROM anon, authenticated;
