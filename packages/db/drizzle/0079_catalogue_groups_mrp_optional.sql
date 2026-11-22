CREATE TABLE "product_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_ranges_slug_unique" UNIQUE("slug"),
	CONSTRAINT "product_ranges_brand_name_uq" UNIQUE("brand_id","name"),
	CONSTRAINT "product_ranges_hidden_reason" CHECK (("product_ranges"."hidden" = ("product_ranges"."hidden_reason" is not null)) and ("product_ranges"."hidden_reason" is null or "product_ranges"."hidden_reason" in ('discontinued','supplier_issue','price_review','quality_issue','out_of_season','legal','other')))
);
--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "mrp_paise" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "range_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "hindi_machine" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "photo_source" text;--> statement-breakpoint
ALTER TABLE "product_ranges" ADD CONSTRAINT "product_ranges_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_ranges_brand_id_index" ON "product_ranges" USING btree ("brand_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_range_id_product_ranges_id_fk" FOREIGN KEY ("range_id") REFERENCES "public"."product_ranges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_range_id_index" ON "products" USING btree ("range_id");--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_hidden_reason" CHECK (("brands"."hidden" = ("brands"."hidden_reason" is not null)) and ("brands"."hidden_reason" is null or "brands"."hidden_reason" in ('discontinued','supplier_issue','price_review','quality_issue','out_of_season','legal','other')));--> statement-breakpoint
-- Real catalogue design 2026-11-22. A pack without an MRP is "price on request" (not sellable); the admin finds them here.
CREATE INDEX "product_variants_missing_mrp_idx" ON "product_variants" USING btree ("product_id") WHERE "mrp_paise" IS NULL;--> statement-breakpoint
-- Deny-all for the Data API; only the API role reads and writes (spec 13).
ALTER TABLE public.product_ranges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.product_ranges FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER product_ranges_bump_version BEFORE UPDATE ON public.product_ranges
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER product_ranges_touch_updated_at BEFORE UPDATE ON public.product_ranges
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER brands_bump_version BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
-- RLS mirror of the visibility rule (hidden brand => its products and the brand row vanish). Ranges are not mirrored
-- (deny-all table); the API predicate `productVisible` is the authority (docs/research/rls-matrix.md).
-- New columns are not readable until granted on purpose (0074): the policies below read brands.hidden. `photo_source`,
-- `hindi_machine`, `range_id` and the hide reasons stay staff-only.
GRANT SELECT (hidden) ON public.brands TO anon, authenticated;--> statement-breakpoint
DROP POLICY brands_read ON public.brands;--> statement-breakpoint
CREATE POLICY brands_read ON public.brands FOR SELECT TO anon, authenticated USING (NOT hidden);--> statement-breakpoint
DROP POLICY products_read ON public.products;--> statement-breakpoint
CREATE POLICY products_read ON public.products FOR SELECT TO anon, authenticated
  USING (status = 'live' AND brand_id IN (SELECT b.id FROM public.brands b WHERE NOT b.hidden));