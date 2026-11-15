-- Support threads, attachments, COD refund destination (2026-11-15). Renumbered 0064 -> 0065 at merge (L106).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_owner_kind_valid";--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "issue_code" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "refund_destination_enc" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "refund_destination_mask" text;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "refund_destination_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_order_thread_uq" ON "support_tickets" USING btree ("user_id","order_id") WHERE "support_tickets"."issue_code" is not null and "support_tickets"."order_id" is not null and "support_tickets"."status" <> 'closed';--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_service_thread_uq" ON "support_tickets" USING btree ("user_id","service_request_id") WHERE "support_tickets"."issue_code" is not null and "support_tickets"."service_request_id" is not null and "support_tickets"."status" <> 'closed';--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_issue_code_valid" CHECK ("support_tickets"."issue_code" is null or "support_tickets"."issue_code" in ('wrong_part','damaged','missing_item','late','workshop_issue','billing','other'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_refund_destination_encrypted" CHECK ("support_tickets"."refund_destination_enc" is null or "support_tickets"."refund_destination_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_refund_destination_pair" CHECK (("support_tickets"."refund_destination_enc" is null) = ("support_tickets"."refund_destination_mask" is null));--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_kind_valid" CHECK ("media_objects"."owner_kind" in ('service_photo','ticket_message'));
