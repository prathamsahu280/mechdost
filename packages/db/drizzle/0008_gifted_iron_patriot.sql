ALTER TABLE "shipments" ADD COLUMN "delivery_code_enc" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivered_via" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "override_by" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_override_by_index" ON "shipments" USING btree ("override_by");--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivery_code_encrypted" CHECK ("shipments"."delivery_code_enc" is null or "shipments"."delivery_code_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$');--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivery_attempts_range" CHECK ("shipments"."delivery_code_attempts" between 0 and 5);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivered_via_valid" CHECK ("shipments"."delivered_via" is null or "shipments"."delivered_via" in ('code','override'));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_delivered_needs_proof" CHECK ("shipments"."status" <> 'delivered' or ("shipments"."delivered_at" is not null and ("shipments"."delivered_via" = 'code' or ("shipments"."delivered_via" = 'override' and "shipments"."override_by" is not null and char_length("shipments"."override_reason") >= 5))));