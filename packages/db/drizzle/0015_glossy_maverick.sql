DROP INDEX "outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "pricing_category" text;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "billable" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_provider_id_uq" ON "notification_outbox" USING btree ("channel","provider_id") WHERE "notification_outbox"."provider_id" is not null;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "notification_outbox" USING btree ("next_attempt_at") WHERE "notification_outbox"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "outbox_pricing_category_valid" CHECK ("notification_outbox"."pricing_category" is null or "notification_outbox"."pricing_category" in ('utility','authentication','authentication_international','marketing','marketing_lite','service','referral_conversion'));