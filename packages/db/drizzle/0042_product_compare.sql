-- Product comparison (plan 2026-11-13): net quantity per pack (variant) for the unit price, and products.spec
-- kept a JSON object (typed attributes per category). New columns are nullable (no rewrite); CHECKs are added
-- NOT VALID (no long lock while scanning), then validated.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "net_qty" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "net_unit" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_net_pair" CHECK (("product_variants"."net_qty" is null) = ("product_variants"."net_unit" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_net_qty_range" CHECK ("product_variants"."net_qty" between 1 and 1000000) NOT VALID;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_net_unit_valid" CHECK ("product_variants"."net_unit" in ('ml','g','piece','m')) NOT VALID;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_spec_object" CHECK (jsonb_typeof("products"."spec") = 'object') NOT VALID;--> statement-breakpoint
ALTER TABLE "product_variants" VALIDATE CONSTRAINT "product_variants_net_pair";--> statement-breakpoint
ALTER TABLE "product_variants" VALIDATE CONSTRAINT "product_variants_net_qty_range";--> statement-breakpoint
ALTER TABLE "product_variants" VALIDATE CONSTRAINT "product_variants_net_unit_valid";--> statement-breakpoint
ALTER TABLE "products" VALIDATE CONSTRAINT "products_spec_object";
