-- Refunds (spec 05; decision 2026-11-15 "All need approval"; Q104 manual payout for cash on delivery): the existing,
-- never-written `refunds` table becomes the refund request (status requested → approved → initiated → processed, or
-- rejected / failed; source and reason codes; four-eyes CHECK; Razorpay refund id + idempotency key). Mode `source` hangs
-- on a captured payment (Razorpay); mode `bank_upi` has no payment (cash on delivery): encrypted destination, finance pays
-- by hand and records the UTR. `payments` gets the refund ledger with a CHECK (refunded <= reserved <= captured) and
-- `refund_events` is the append-only timeline. RLS on, client roles revoked, version/updated_at triggers. No new
-- permissions: refunds:read / initiate / approve already exist.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "refund_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refund_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"refund_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_events_kind_valid" CHECK ("refund_events"."kind" in ('requested','approved','rejected','initiated','processed','failed','retry')),
	CONSTRAINT "refund_events_actor_valid" CHECK ("refund_events"."actor_type" in ('admin','system'))
);
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_status_valid";--> statement-breakpoint
UPDATE "refunds" SET "status" = 'requested' WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "status" SET DEFAULT 'requested';--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_reserved_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "group_id" uuid;--> statement-breakpoint
UPDATE "refunds" r SET "group_id" = p."group_id" FROM "payments" p WHERE p."id" = r."payment_id";--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "source" text NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason_code" text NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "reason_code" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reject_reason_code" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "initiated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "manual_reference" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "dispatch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refund_events" ADD CONSTRAINT "refund_events_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_events_refund_id_id_index" ON "refund_events" USING btree ("refund_id","id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_rejected_by_index" ON "refunds" USING btree ("rejected_by");--> statement-breakpoint
CREATE INDEX "refunds_group_id_index" ON "refunds" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "refunds_status_created_at_index" ON "refunds" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refunds_dispatch_due_idx" ON "refunds" USING btree ("next_attempt_at") WHERE "refunds"."status" = 'approved' and "refunds"."mode" = 'source';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_ledger" CHECK ("payments"."refunded_paise" >= 0 and "payments"."refunded_paise" <= "payments"."refund_reserved_paise" and "payments"."refund_reserved_paise" <= "payments"."amount_paise");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("refunds"."source" in ('order_rejected','order_cancelled','unfulfilled','support_claim','part_refund','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_valid" CHECK ("refunds"."reason_code" in ('order_rejected','order_cancelled','faulty','damaged_in_transit','wrong_item','missing_item','not_fulfilled','goodwill','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reject_reason_valid" CHECK (("refunds"."status" = 'rejected') = ("refunds"."reject_reason_code" is not null) and ("refunds"."reject_reason_code" is null or "refunds"."reject_reason_code" in ('not_eligible','already_refunded','wrong_amount','suspected_fraud','other')));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_note_len" CHECK ("refunds"."reason" is null or char_length("refunds"."reason") between 1 and 300);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_four_eyes" CHECK ("refunds"."approved_by" is null or "refunds"."requested_by" is null or "refunds"."approved_by" <> "refunds"."requested_by");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_before_dispatch" CHECK ("refunds"."status" not in ('approved','initiated','processed') or "refunds"."decided_at" is not null);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_provider_id_when_sent" CHECK ("refunds"."mode" <> 'source' or "refunds"."status" not in ('initiated','processed') or "refunds"."provider_refund_id" is not null);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_mode_payment" CHECK (("refunds"."mode" = 'source') = ("refunds"."payment_id" is not null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_manual_paid_has_reference" CHECK ("refunds"."mode" = 'source' or "refunds"."status" <> 'processed' or "refunds"."manual_reference" ~ '^[A-Za-z0-9]{6,35}$');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_manual_never_initiated" CHECK ("refunds"."mode" = 'source' or "refunds"."status" <> 'initiated');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_settled_when_final" CHECK (("refunds"."status" in ('processed','failed')) = ("refunds"."settled_at" is not null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_attempts_nonneg" CHECK ("refunds"."dispatch_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('requested','approved','rejected','initiated','processed','failed'));--> statement-breakpoint
ALTER TABLE public.refund_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.refund_events FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER refund_events_append_only BEFORE UPDATE OR DELETE ON public.refund_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- Version and updated_at triggers for tables that still miss them (same loop as 0044 / 0049); refunds already has them.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'version' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_bump_version')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
                   r.table_name || '_bump_version', r.table_name);
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_touch_updated_at')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   r.table_name || '_touch_updated_at', r.table_name);
  END LOOP;
END $$;
