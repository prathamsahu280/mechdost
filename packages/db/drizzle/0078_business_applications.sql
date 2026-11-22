CREATE TABLE "business_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason_code" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_application_events_status_valid" CHECK ("business_application_events"."to_status" in ('new','in_review','approved','rejected','closed'))
);
--> statement-breakpoint
CREATE TABLE "business_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"user_id" uuid,
	"city_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text,
	"contact_email" "citext",
	"business_name" text NOT NULL,
	"business_type" text,
	"gstin" text,
	"spend_band" text,
	"categories" text[],
	"fleet2w" integer,
	"fleet3w" integer,
	"fleet4w" integer,
	"needs" text[],
	"note" text,
	"reason_code" text,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"consent_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_applications_code_unique" UNIQUE("code"),
	CONSTRAINT "business_applications_kind_valid" CHECK ("business_applications"."kind" in ('trade','fleet')),
	CONSTRAINT "business_applications_status_valid" CHECK ("business_applications"."status" in ('new','in_review','approved','rejected','closed')),
	CONSTRAINT "business_applications_pincode" CHECK ("business_applications"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "business_applications_phone" CHECK ("business_applications"."contact_phone" is null or "business_applications"."contact_phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "business_applications_gstin" CHECK ("business_applications"."gstin" is null or "business_applications"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "business_applications_trade_shape" CHECK ("business_applications"."kind" <> 'trade' or ("business_applications"."user_id" is not null and "business_applications"."business_type" is not null
        and "business_applications"."business_type" in ('mechanic','garage','parts_retailer','other') and "business_applications"."spend_band" is not null
        and "business_applications"."spend_band" in ('under_25k','25k_to_1l','1l_to_5l','over_5l') and "business_applications"."categories" is not null
        and cardinality("business_applications"."categories") between 1 and 30
        and "business_applications"."status" <> 'closed' and "business_applications"."fleet2w" is null and "business_applications"."needs" is null)),
	CONSTRAINT "business_applications_fleet_shape" CHECK ("business_applications"."kind" <> 'fleet' or ("business_applications"."contact_phone" is not null and "business_applications"."contact_email" is not null
        and "business_applications"."fleet2w" is not null and "business_applications"."fleet3w" is not null and "business_applications"."fleet4w" is not null
        and "business_applications"."fleet2w" >= 0 and "business_applications"."fleet3w" >= 0 and "business_applications"."fleet4w" >= 0
        and "business_applications"."fleet2w" + "business_applications"."fleet3w" + "business_applications"."fleet4w" > 0
        and "business_applications"."needs" is not null and cardinality("business_applications"."needs") >= 1
        and "business_applications"."needs" <@ array['scheduled_maintenance','priority_slots','pickup_drop','monthly_billing','bulk_parts','tyres_batteries']::text[]
        and "business_applications"."status" in ('new','in_review','closed') and "business_applications"."business_type" is null and "business_applications"."categories" is null)),
	CONSTRAINT "business_applications_reason_valid" CHECK (("business_applications"."status" = 'rejected') = ("business_applications"."reason_code" is not null)
        and ("business_applications"."reason_code" is null or "business_applications"."reason_code" in ('not_serviceable','documents_invalid','duplicate','not_a_business','other')))
);
--> statement-breakpoint
CREATE TABLE "trade_account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" text NOT NULL,
	"reason_code" text,
	"application_id" uuid,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_account_events_event_valid" CHECK ("trade_account_events"."event" in ('trade_account_verified','trade_account_revoked'))
);
--> statement-breakpoint
CREATE TABLE "trade_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"business_name" text NOT NULL,
	"business_type" text NOT NULL,
	"gstin" text,
	"application_id" uuid,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"reason_code" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_accounts_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "trade_accounts_status_valid" CHECK ("trade_accounts"."status" in ('verified','revoked')),
	CONSTRAINT "trade_accounts_type_valid" CHECK ("trade_accounts"."business_type" in ('mechanic','garage','parts_retailer','other')),
	CONSTRAINT "trade_accounts_gstin" CHECK ("trade_accounts"."gstin" is null or "trade_accounts"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "trade_accounts_reason_valid" CHECK (("trade_accounts"."status" = 'revoked') = ("trade_accounts"."reason_code" is not null)
        and ("trade_accounts"."reason_code" is null or "trade_accounts"."reason_code" in ('misuse','not_a_trade_business','documents_invalid','inactive','requested_by_user','other')))
);
--> statement-breakpoint
ALTER TABLE "business_application_events" ADD CONSTRAINT "business_application_events_application_id_business_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."business_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_application_events" ADD CONSTRAINT "business_application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_applications" ADD CONSTRAINT "business_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_applications" ADD CONSTRAINT "business_applications_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_applications" ADD CONSTRAINT "business_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_applications" ADD CONSTRAINT "business_applications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_account_events" ADD CONSTRAINT "trade_account_events_trade_account_id_trade_accounts_id_fk" FOREIGN KEY ("trade_account_id") REFERENCES "public"."trade_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_account_events" ADD CONSTRAINT "trade_account_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_account_events" ADD CONSTRAINT "trade_account_events_application_id_business_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."business_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_account_events" ADD CONSTRAINT "trade_account_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_application_id_business_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."business_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accounts" ADD CONSTRAINT "trade_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_application_events_application_id_created_at_index" ON "business_application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "business_application_events_actor_user_id_index" ON "business_application_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_applications_one_open_trade_uq" ON "business_applications" USING btree ("user_id") WHERE "business_applications"."kind" = 'trade' and "business_applications"."status" in ('new','in_review');--> statement-breakpoint
CREATE INDEX "business_applications_status_kind_created_at_id_index" ON "business_applications" USING btree ("status","kind","created_at","id");--> statement-breakpoint
CREATE INDEX "business_applications_city_id_created_at_id_index" ON "business_applications" USING btree ("city_id","created_at","id");--> statement-breakpoint
CREATE INDEX "business_applications_user_id_index" ON "business_applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "business_applications_reviewed_by_index" ON "business_applications" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "business_applications_created_by_index" ON "business_applications" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "trade_account_events_trade_account_id_created_at_index" ON "trade_account_events" USING btree ("trade_account_id","created_at");--> statement-breakpoint
CREATE INDEX "trade_account_events_user_id_index" ON "trade_account_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trade_account_events_application_id_index" ON "trade_account_events" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "trade_account_events_actor_user_id_index" ON "trade_account_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "trade_accounts_status_index" ON "trade_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trade_accounts_application_id_index" ON "trade_accounts" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "trade_accounts_created_by_index" ON "trade_accounts" USING btree ("created_by");--> statement-breakpoint
-- Audience entry design 2026-11-22, item 3. Deny-all for the Data API (anon/authenticated); only the API role reads
-- and writes these (spec 13). History tables are append-only.
ALTER TABLE public.business_applications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.business_application_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.trade_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.trade_account_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.business_applications, public.business_application_events, public.trade_accounts, public.trade_account_events FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER business_application_events_append_only BEFORE UPDATE OR DELETE ON public.business_application_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER trade_account_events_append_only BEFORE UPDATE OR DELETE ON public.trade_account_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER business_applications_bump_version BEFORE UPDATE ON public.business_applications
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER business_applications_touch_updated_at BEFORE UPDATE ON public.business_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER trade_accounts_bump_version BEFORE UPDATE ON public.trade_accounts
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER trade_accounts_touch_updated_at BEFORE UPDATE ON public.trade_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();