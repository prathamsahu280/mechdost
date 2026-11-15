-- Renumbered at merge 2026-11-15: built as 0066_export_indexes on its branch; now 0068 after coupons (0066) and workshops tier 1 (0067).
-- Indexes only; the tables are small at launch, so a plain CREATE INDEX holds its lock briefly.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "users_created_id_idx" ON "users" USING btree ("created_at","id") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "orders_city_placed_id_idx" ON "orders" USING btree ("city_id","placed_at","id");--> statement-breakpoint
CREATE INDEX "refunds_created_id_idx" ON "refunds" USING btree ("created_at","id");