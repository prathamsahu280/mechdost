ALTER TABLE "products" ADD COLUMN "spec_summary" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "spec_summary_hi" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "compatibility" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "compatibility_hi" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "highlights" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "highlights_hi" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "name_hi" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "address_line_hi" text;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_highlights_max" CHECK (coalesce(array_length("products"."highlights", 1), 0) <= 8);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_highlights_hi_aligned" CHECK (coalesce(array_length("products"."highlights_hi", 1), 0) in (0, coalesce(array_length("products"."highlights", 1), 0)));