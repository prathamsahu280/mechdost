-- Admin analytics (spec 08 "Analytics", 2026-11-14): every dashboard query is bounded by a date range on an index.
-- service_requests (city_id, created_at): requests of a city in a range, any status; it also serves the city_id FK,
-- so it replaces the single-column index (created first, then the old one dropped; precedent 0040).
-- order_assignments (offered_at): shop acceptance over the offers made in a range (one small btree; the table grows
-- with offers, a few per order). Small tables at launch, so a plain CREATE INDEX inside the migration's transaction
-- (CONCURRENTLY is not possible there) holds its lock for milliseconds; lock_timeout keeps it from queueing behind
-- a long transaction.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_requests_city_created_idx" ON "service_requests" USING btree ("city_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_assignments_offered_at_idx" ON "order_assignments" USING btree ("offered_at");--> statement-breakpoint
DROP INDEX IF EXISTS "service_requests_city_id_index";
