CREATE INDEX "users_created_id_idx" ON "users" USING btree ("created_at","id") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "orders_city_placed_id_idx" ON "orders" USING btree ("city_id","placed_at","id");--> statement-breakpoint
CREATE INDEX "refunds_created_id_idx" ON "refunds" USING btree ("created_at","id");