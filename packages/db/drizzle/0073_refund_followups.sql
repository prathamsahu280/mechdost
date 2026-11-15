ALTER TABLE "refunds" DROP CONSTRAINT "refunds_source_valid";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_valid";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settled_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settle_reason_code" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settle_note" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_note_for_invoices_id_fk" FOREIGN KEY ("credit_note_for") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_credit_note_per_refund_uq" ON "invoices" USING btree ("refund_id") WHERE "invoices"."refund_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_credit_note_for_index" ON "invoices" USING btree ("credit_note_for");--> statement-breakpoint
CREATE INDEX "refunds_settled_by_index" ON "refunds" USING btree ("settled_by");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_credit_note_link" CHECK (("invoices"."kind" = 'credit_note') = ("invoices"."credit_note_for" is not null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_refund_only_credit_note" CHECK ("invoices"."refund_id" is null or "invoices"."kind" = 'credit_note');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_settle_valid" CHECK (("refunds"."settle_reason_code" is null and "refunds"."settle_note" is null) or ("refunds"."settle_reason_code" in ('dashboard_checked','provider_support_confirmed','bank_statement_checked','duplicate_found','other') and char_length("refunds"."settle_note") between 10 and 300));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_settle_four_eyes" CHECK ("refunds"."settled_by" is null or "refunds"."requested_by" is null or "refunds"."settled_by" <> "refunds"."requested_by");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("refunds"."source" in ('order_rejected','order_cancelled','service_cancelled','duplicate_payment','payment_after_close','unfulfilled','support_claim','part_refund','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_valid" CHECK ("refunds"."reason_code" in ('order_rejected','order_cancelled','service_cancelled','duplicate_payment','payment_after_close','faulty','damaged_in_transit','wrong_item','missing_item','not_fulfilled','goodwill','other'));