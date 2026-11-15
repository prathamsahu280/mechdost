-- Online payment of the service bill (payments + refunds can belong to a bill), staff cancel reasons (spec 06, 03, 05).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_source_valid";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_valid";--> statement-breakpoint
ALTER TABLE "service_bills" DROP CONSTRAINT "service_bills_method_valid";--> statement-breakpoint
ALTER TABLE "service_requests" DROP CONSTRAINT "service_requests_reason_code_valid";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "purpose" text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "bill_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_service_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."service_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bill_id_service_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."service_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_success_per_bill_uq" ON "payments" USING btree ("bill_id") WHERE "payments"."status" in ('paid','partially_refunded','refunded');--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_bill_uq" ON "payments" USING btree ("bill_id") WHERE "payments"."status" in ('created','attempted','failed');--> statement-breakpoint
CREATE INDEX "payments_bill_id_index" ON "payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "refunds_bill_id_index" ON "refunds" USING btree ("bill_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_valid" CHECK ("payments"."purpose" in ('order','service_bill'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_target" CHECK (("payments"."purpose" = 'order' and "payments"."group_id" is not null and "payments"."bill_id" is null) or ("payments"."purpose" = 'service_bill' and "payments"."bill_id" is not null and "payments"."group_id" is null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_group_or_bill" CHECK (("refunds"."group_id" is not null) <> ("refunds"."bill_id" is not null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("refunds"."source" in ('order_rejected','order_cancelled','service_cancelled','duplicate_payment','unfulfilled','support_claim','part_refund','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_valid" CHECK ("refunds"."reason_code" in ('order_rejected','order_cancelled','service_cancelled','duplicate_payment','faulty','damaged_in_transit','wrong_item','missing_item','not_fulfilled','goodwill','other'));--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_method_valid" CHECK ("service_bills"."method" is null or "service_bills"."method" in ('cash','upi','card','online'));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_reason_code_valid" CHECK (case "service_requests"."status"
        when 'rejected' then "service_requests"."status_reason_code" in ('no_workshop_nearby','all_workshops_declined','unserviceable_address','suspected_fraud','other')
        when 'cancelled' then "service_requests"."status_reason_code" in ('changed_mind','booked_by_mistake','found_another_workshop','slot_not_suitable','problem_solved','other','workshop_unavailable','workshop_unresponsive','customer_asked','duplicate_booking','policy_violation')
        else "service_requests"."status_reason_code" is null end);