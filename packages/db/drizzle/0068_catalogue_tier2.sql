-- Catalogue and storefront next tier, items 4, 6, 7 (design 2026-11-15): recommendation rules, co-purchase counts,
-- data export requests, PIN waitlist ("notify me").
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "copurchase_pairs" (
	"a_product_id" uuid NOT NULL,
	"b_product_id" uuid NOT NULL,
	"pair_count" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copurchase_pairs_a_product_id_b_product_id_pk" PRIMARY KEY("a_product_id","b_product_id"),
	CONSTRAINT "copurchase_pairs_distinct" CHECK ("copurchase_pairs"."a_product_id" <> "copurchase_pairs"."b_product_id"),
	CONSTRAINT "copurchase_pairs_count_positive" CHECK ("copurchase_pairs"."pair_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "data_export_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"payload" jsonb,
	"payload_bytes" integer,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone,
	"error_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_status_valid" CHECK ("data_export_requests"."status" in ('requested','ready','expired','failed')),
	CONSTRAINT "data_export_ready_has_payload" CHECK (("data_export_requests"."status" = 'ready') = ("data_export_requests"."payload" is not null) and ("data_export_requests"."status" <> 'ready' or ("data_export_requests"."expires_at" is not null and "data_export_requests"."ready_at" is not null))),
	CONSTRAINT "data_export_size_bounded" CHECK ("data_export_requests"."payload_bytes" is null or "data_export_requests"."payload_bytes" between 1 and 2000000)
);
--> statement-breakpoint
CREATE TABLE "pincode_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"notified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pincode_waitlist_pin_format" CHECK ("pincode_waitlist"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "pincode_waitlist_status_valid" CHECK ("pincode_waitlist"."status" in ('waiting','notified','cancelled')),
	CONSTRAINT "pincode_waitlist_notified" CHECK (("pincode_waitlist"."status" = 'notified') = ("pincode_waitlist"."notified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "recommendation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_category_id" uuid NOT NULL,
	"suggest_category_id" uuid NOT NULL,
	"label" text NOT NULL,
	"label_hi" text NOT NULL,
	"priority" smallint DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_rules_distinct" CHECK ("recommendation_rules"."trigger_category_id" <> "recommendation_rules"."suggest_category_id"),
	CONSTRAINT "recommendation_rules_label_len" CHECK (char_length("recommendation_rules"."label") between 2 and 80 and char_length("recommendation_rules"."label_hi") between 2 and 80),
	CONSTRAINT "recommendation_rules_label_hi_script" CHECK ("recommendation_rules"."label_hi" ~ '[ऀ-ॿ]'),
	CONSTRAINT "recommendation_rules_priority_range" CHECK ("recommendation_rules"."priority" between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "copurchase_pairs" ADD CONSTRAINT "copurchase_pairs_a_product_id_products_id_fk" FOREIGN KEY ("a_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copurchase_pairs" ADD CONSTRAINT "copurchase_pairs_b_product_id_products_id_fk" FOREIGN KEY ("b_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pincode_waitlist" ADD CONSTRAINT "pincode_waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_trigger_category_id_categories_id_fk" FOREIGN KEY ("trigger_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_suggest_category_id_categories_id_fk" FOREIGN KEY ("suggest_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copurchase_pairs_a_count_idx" ON "copurchase_pairs" USING btree ("a_product_id","pair_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "copurchase_pairs_b_idx" ON "copurchase_pairs" USING btree ("b_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_export_one_active_uq" ON "data_export_requests" USING btree ("user_id") WHERE "data_export_requests"."status" in ('requested','ready');--> statement-breakpoint
CREATE INDEX "data_export_user_created_idx" ON "data_export_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "data_export_expiry_idx" ON "data_export_requests" USING btree ("expires_at") WHERE "data_export_requests"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "data_export_requested_idx" ON "data_export_requests" USING btree ("created_at") WHERE "data_export_requests"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "pincode_waitlist_user_pin_uq" ON "pincode_waitlist" USING btree ("user_id","pincode");--> statement-breakpoint
CREATE INDEX "pincode_waitlist_pin_status_idx" ON "pincode_waitlist" USING btree ("pincode","status");--> statement-breakpoint
CREATE INDEX "pincode_waitlist_waiting_idx" ON "pincode_waitlist" USING btree ("pincode") WHERE "pincode_waitlist"."status" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_rules_pair_uq" ON "recommendation_rules" USING btree ("trigger_category_id","suggest_category_id");--> statement-breakpoint
CREATE INDEX "recommendation_rules_suggest_idx" ON "recommendation_rules" USING btree ("suggest_category_id");--> statement-breakpoint
CREATE INDEX "recommendation_rules_created_by_idx" ON "recommendation_rules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "recommendation_rules_active_trigger_idx" ON "recommendation_rules" USING btree ("trigger_category_id","priority") WHERE active;--> statement-breakpoint
ALTER TABLE public.copurchase_pairs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pincode_waitlist ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.recommendation_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.copurchase_pairs FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.data_export_requests FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.pincode_waitlist FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.recommendation_rules FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER data_export_requests_bump_version BEFORE UPDATE ON public.data_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER data_export_requests_touch_updated_at BEFORE UPDATE ON public.data_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER pincode_waitlist_bump_version BEFORE UPDATE ON public.pincode_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER pincode_waitlist_touch_updated_at BEFORE UPDATE ON public.pincode_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER recommendation_rules_bump_version BEFORE UPDATE ON public.recommendation_rules
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER recommendation_rules_touch_updated_at BEFORE UPDATE ON public.recommendation_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();