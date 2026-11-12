-- One Razorpay order a customer can still pay per order group (final review 2026-11-12, finding 2).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_group_uq" ON "payments" USING btree ("group_id") WHERE "payments"."status" in ('created','attempted','failed');
