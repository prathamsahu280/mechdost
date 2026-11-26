-- Shopping personalisation phases 2 and 3 (design 2026-11-25, founder approval 2026-11-26). Numbered 0102: another
-- stream may take 0101 (lead's brief); rechain the snapshot at merge if it does (learning L-B5).
-- (1) consent purpose `personalisation`; (2) `recently_viewed` (signed-in customers with that consent only);
-- (3) "goes well with" rules gain product triggers/suggestions and the workshop fitting link; (4) an equality index
-- for "Similar options" on variant sizes.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "recently_viewed" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"city_code" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recently_viewed_user_id_product_id_pk" PRIMARY KEY("user_id","product_id"),
	CONSTRAINT "recently_viewed_city_code" CHECK ("recently_viewed"."city_code" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_purpose_valid";--> statement-breakpoint
ALTER TABLE "recommendation_rules" DROP CONSTRAINT "recommendation_rules_distinct";--> statement-breakpoint
DROP INDEX "recommendation_rules_pair_uq";--> statement-breakpoint
ALTER TABLE "recommendation_rules" ALTER COLUMN "trigger_category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ALTER COLUMN "suggest_category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD COLUMN "trigger_product_id" uuid;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD COLUMN "suggest_kind" text DEFAULT 'category' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD COLUMN "suggest_product_id" uuid;--> statement-breakpoint
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recently_viewed" ADD CONSTRAINT "recently_viewed_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recently_viewed_user_viewed_idx" ON "recently_viewed" USING btree ("user_id","viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recently_viewed_product_idx" ON "recently_viewed" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_trigger_product_id_products_id_fk" FOREIGN KEY ("trigger_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_suggest_product_id_products_id_fk" FOREIGN KEY ("suggest_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_rules_suggest_product_idx" ON "recommendation_rules" USING btree ("suggest_product_id");--> statement-breakpoint
CREATE INDEX "recommendation_rules_active_trigger_product_idx" ON "recommendation_rules" USING btree ("trigger_product_id","priority") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_rules_pair_uq" ON "recommendation_rules" USING btree (coalesce("trigger_category_id", "trigger_product_id"),"suggest_kind",coalesce("suggest_category_id", "suggest_product_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_purpose_valid" CHECK ("consents"."purpose" in ('account','marketing','analytics','personalisation','location','share_with_partner','whatsapp','ustaad_profile','ustaad_directory','ustaad_training','ustaad_offers','ustaad_location_verify','ustaad_zone_count','ustaad_exact_pin','ustaad_voice','ustaad_correction','ustaad_ml_training'));--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_distinct_product" CHECK ("recommendation_rules"."trigger_product_id" is distinct from "recommendation_rules"."suggest_product_id" or "recommendation_rules"."trigger_product_id" is null);--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_one_trigger" CHECK (("recommendation_rules"."trigger_category_id" is null) <> ("recommendation_rules"."trigger_product_id" is null));--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_suggest_kind_valid" CHECK ("recommendation_rules"."suggest_kind" in ('category','product','workshop_fitting'));--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_suggest_shape" CHECK (case "recommendation_rules"."suggest_kind"
        when 'category' then "recommendation_rules"."suggest_category_id" is not null and "recommendation_rules"."suggest_product_id" is null
        when 'product' then "recommendation_rules"."suggest_product_id" is not null and "recommendation_rules"."suggest_category_id" is null
        else "recommendation_rules"."suggest_category_id" is null and "recommendation_rules"."suggest_product_id" is null end);--> statement-breakpoint
ALTER TABLE "recommendation_rules" ADD CONSTRAINT "recommendation_rules_distinct" CHECK ("recommendation_rules"."trigger_category_id" is distinct from "recommendation_rules"."suggest_category_id" or "recommendation_rules"."trigger_category_id" is null);--> statement-breakpoint
-- Hand-written: RLS mirror (read own; the API connects as owner and is the only writer), version/updated_at triggers.
ALTER TABLE public.recently_viewed ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.recently_viewed FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.recently_viewed TO authenticated;--> statement-breakpoint
CREATE POLICY recently_viewed_read_own ON public.recently_viewed FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE TRIGGER recently_viewed_bump_version BEFORE UPDATE ON public.recently_viewed
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER recently_viewed_touch_updated_at BEFORE UPDATE ON public.recently_viewed
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- "Similar options" looks variants up by their exact size text (the trigram index serves LIKE, not equality).
CREATE INDEX IF NOT EXISTS "product_variants_size_compact_eq_idx" ON "product_variants" USING btree ("size_compact")
  WHERE size_compact <> '';
