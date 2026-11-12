-- Vehicle types a product is for (2W/3W/4W; decision 2026-11-12, Q76 default). Empty = fitment not listed.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vehicle_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "products_vehicle_types_idx" ON "products" USING gin ("vehicle_types");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_vehicle_types_valid" CHECK ("products"."vehicle_types" <@ array['2W','3W','4W']::text[]);
