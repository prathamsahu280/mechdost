-- Keyset paging for the admin invite list and the shop's price requests (final review 2026-11-13, hard rule 7).
-- Small tables at this stage; created before the old single-column index is dropped (its column leads the new one).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_invites_city_id_created_at_id_index" ON "partner_invites" USING btree ("city_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_price_requests_shop_id_created_at_id_index" ON "shop_price_requests" USING btree ("shop_id","created_at","id");--> statement-breakpoint
DROP INDEX IF EXISTS "partner_invites_city_id_index";
