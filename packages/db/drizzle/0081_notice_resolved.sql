ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notifications_open_entity_idx" ON "notifications" USING btree ("kind","entity_id" text_pattern_ops) WHERE "notifications"."resolved_at" is null;--> statement-breakpoint
-- Notices that went stale before this column existed: "needs routing" for a checkout whose orders are all routed,
-- rejected or cancelled; "shop declined / timed out / gave up" for an order no longer waiting for a new shop.
UPDATE "notifications" n SET "read_at" = coalesce(n."read_at", now()), "resolved_at" = now()
WHERE n."resolved_at" IS NULL AND n."kind" = 'staff.order_needs_routing'
  AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."group_id"::text = n."entity_id" AND o."status" IN ('placed', 'needs_rerouting'));--> statement-breakpoint
UPDATE "notifications" n SET "read_at" = coalesce(n."read_at", now()), "resolved_at" = now()
WHERE n."resolved_at" IS NULL AND n."kind" IN ('staff.shop_declined', 'staff.shop_timed_out', 'staff.shop_gave_up')
  AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."id"::text = n."entity_id" AND o."status" = 'needs_rerouting');
