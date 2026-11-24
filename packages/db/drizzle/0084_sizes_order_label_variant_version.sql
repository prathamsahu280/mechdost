ALTER TABLE "product_variants" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_label" text;--> statement-breakpoint
CREATE TRIGGER "product_variants_bump_version" BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.bump_version();
