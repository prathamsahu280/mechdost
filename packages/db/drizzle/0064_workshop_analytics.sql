-- Workshop analytics (design 2026-11-15): one workshop's requests in a date range (Performance view in the portal).
-- Plain CREATE INDEX inside the migration's transaction (small table at launch; lock_timeout keeps it from queueing
-- behind a long transaction).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "service_requests_workshop_created_idx" ON "service_requests" USING btree ("workshop_id","created_at");
