-- Trust wording, seller clause, labour promise (2026-11-15). Renumbered 0057 -> 0058 at merge (L106).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "partner_status_events" DROP CONSTRAINT "partner_status_events_reason_code_valid";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_kind_valid";--> statement-breakpoint
ALTER TABLE "service_bills" ADD COLUMN "labour_promise_days" integer;--> statement-breakpoint
ALTER TABLE "partner_status_events" ADD CONSTRAINT "partner_status_events_reason_code_valid" CHECK ("partner_status_events"."reason_code" is null or "partner_status_events"."reason_code" in ('partner_request','documents_pending','missed_offers','late_deliveries','quality_complaints','pricing_issue','policy_violation','fraud_suspected','counterfeit_confirmed','issue_resolved','other','pause_ended'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_kind_valid" CHECK ("support_tickets"."kind" in ('order_issue','service_issue','refund','fitment','product_sourcing','workshop_request','account','deletion_request','labour_redo','other'));--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_labour_promise_days_range" CHECK ("service_bills"."labour_promise_days" is null or "service_bills"."labour_promise_days" between 7 and 90);