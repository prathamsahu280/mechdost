CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"device_kind" text NOT NULL,
	"browser" text NOT NULL,
	"os" text NOT NULL,
	"country_code" text,
	"region" text,
	"city" text,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_key_hash_format" CHECK ("user_sessions"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "user_sessions_device_kind_valid" CHECK ("user_sessions"."device_kind" in ('mobile','tablet','desktop','other')),
	CONSTRAINT "user_sessions_browser_valid" CHECK ("user_sessions"."browser" in ('chrome','safari','firefox','edge','samsung','opera','other')),
	CONSTRAINT "user_sessions_os_valid" CHECK ("user_sessions"."os" in ('android','ios','windows','macos','linux','other')),
	CONSTRAINT "user_sessions_country_format" CHECK ("user_sessions"."country_code" is null or "user_sessions"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "user_sessions_revoked_reason_valid" CHECK ("user_sessions"."revoked_reason" is null or "user_sessions"."revoked_reason" in ('self_device','self_others','self_all','staff_role_removed','password_changed')),
	CONSTRAINT "user_sessions_revoked_pair" CHECK (("user_sessions"."revoked_at" is null) = ("user_sessions"."revoked_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_key_hash_uq" ON "user_sessions" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_active_idx" ON "user_sessions" USING btree ("user_id","last_active_at" DESC NULLS LAST) WHERE "user_sessions"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.user_sessions FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER user_sessions_bump_version BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER user_sessions_touch_updated_at BEFORE UPDATE ON public.user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
