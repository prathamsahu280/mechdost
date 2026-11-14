-- Shop management on the real API (decision 2026-11-14 "Shop management"; specs 03, 07, 08):
-- shops.free_delivery_min_paise = the shop's free-delivery threshold (NULL = city setting, 0 = always free; a PIN
-- override wins over it), partner_status_events.reason_code = why a partner was paused/suspended/reactivated, as a
-- code (hard rule 16; NULL on older rows), shops.hours = working hours {open, close, days} in IST (user 2026-11-14;
-- default 09:00-21:00 Mon-Sat). Nullable columns and a constant default: metadata-only in PG 11+, no table rewrite.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "free_delivery_min_paise" bigint;--> statement-breakpoint
ALTER TABLE "partner_status_events" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_free_delivery_nonneg" CHECK ("shops"."free_delivery_min_paise" is null or "shops"."free_delivery_min_paise" >= 0);--> statement-breakpoint
ALTER TABLE "partner_status_events" ADD CONSTRAINT "partner_status_events_reason_code_valid" CHECK ("partner_status_events"."reason_code" is null or "partner_status_events"."reason_code" in ('partner_request','documents_pending','missed_offers','late_deliveries','quality_complaints','pricing_issue','policy_violation','fraud_suspected','issue_resolved','other','pause_ended'));--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "hours" jsonb DEFAULT '{"open":"09:00","close":"21:00","days":[1,2,3,4,5,6]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_hours_object" CHECK (jsonb_typeof("shops"."hours") = 'object');
