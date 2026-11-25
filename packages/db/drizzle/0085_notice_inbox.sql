ALTER TABLE "live_outbox" DROP CONSTRAINT "live_outbox_kind_valid";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "priority" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: the priority of existing rows comes from their kind (shared NOTICE_PRIORITY_OF_KIND; a unit test keeps
-- the map equal to the catalogue). Rows of any other kind stay info.
UPDATE "notifications" SET "priority" = 'urgent' WHERE "kind" IN ('refund.failed', 'quote.expiring', 'rsa.offer', 'shop.order_routed', 'shop.offer_expiring', 'staff.order_needs_routing', 'staff.shop_declined', 'staff.shop_timed_out', 'staff.shop_gave_up', 'staff.refund_overdue', 'staff.refund_alert');--> statement-breakpoint
UPDATE "notifications" SET "priority" = 'action' WHERE "kind" IN ('service.proposed', 'service.estimate_ready', 'service.bill_ready', 'rsa.bill_ready', 'quote.offer', 'ticket.reply', 'partner.warning', 'staff.new_application', 'staff.new_ticket');--> statement-breakpoint
UPDATE "notifications" SET "priority" = 'success' WHERE "kind" IN ('order.confirmed', 'order.delivered', 'payment.received', 'refund.processed', 'service.confirmed', 'service.completed', 'rsa.refunded', 'account.pin_served', 'ticket.resolved');--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("user_id",(case when read_at is null then (case when priority = 'urgent' then 0 else 1 end) else 2 end),"created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "notifications"."dismissed_at" is null and "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_dismissed_idx" ON "notifications" USING btree ("dismissed_at") WHERE "notifications"."dismissed_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_resolved_idx" ON "notifications" USING btree ("resolved_at") WHERE "notifications"."resolved_at" is not null;--> statement-breakpoint
CREATE INDEX "notifications_read_info_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."read_at" is not null and "notifications"."priority" in ('info','success');--> statement-breakpoint
ALTER TABLE "live_outbox" ADD CONSTRAINT "live_outbox_kind_valid" CHECK ("live_outbox"."kind" in ('order','assignment','shop','workshop','request','quote','coins','cart','wishlist','notice'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_priority_valid" CHECK ("notifications"."priority" in ('urgent','action','info','success'));