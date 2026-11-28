-- Delivery / COD QA batch DC (2026-11-28). Migration number 0118 (0116 pincode index and 0117 device list are taken).
--
-- DC-F1 / DC-P2: one open delivery application per phone. The QA runs filed three open applications from one phone, so
-- older duplicates are closed as rejected first (the earliest stays open) and the unique index can be built.
UPDATE "partner_applications" a
SET "status" = 'rejected',
    "review_note" = 'Duplicate application (same phone), closed when one open application per phone became the rule'
WHERE a."kind" = 'delivery_agent' AND a."status" IN ('new','in_review')
  AND EXISTS (
    SELECT 1 FROM "partner_applications" b
    WHERE b."kind" = 'delivery_agent' AND b."status" IN ('new','in_review') AND b."phone" = a."phone"
      AND (b."created_at", b."id") < (a."created_at", a."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "partner_applications_agent_open_phone" ON "partner_applications" USING btree ("phone") WHERE "partner_applications"."kind" = 'delivery_agent' and "partner_applications"."status" in ('new','in_review');--> statement-breakpoint
-- DC-P7: reasons for a shop that asks for MechDost delivery partners (no_riders, wider_area, save_time).
ALTER TABLE "shop_delivery_mode_requests" DROP CONSTRAINT "shop_delivery_mode_requests_reason";--> statement-breakpoint
ALTER TABLE "shop_delivery_mode_requests" ADD CONSTRAINT "shop_delivery_mode_requests_reason" CHECK ("shop_delivery_mode_requests"."source" = 'staff' or "shop_delivery_mode_requests"."reason_code" in ('own_riders','faster_local_delivery','customer_relationship','agents_unreliable','no_riders','wider_area','save_time','other'));
