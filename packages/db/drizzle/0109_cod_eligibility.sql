CREATE TABLE "cod_request_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cod_request_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"reason_code" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cod_request_events_actor_valid" CHECK ("cod_request_events"."actor_type" in ('customer','admin','system')),
	CONSTRAINT "cod_request_events_status_valid" CHECK ("cod_request_events"."to_status" in ('pending','approved','rejected','withdrawn','revoked','expired'))
);
--> statement-breakpoint
CREATE TABLE "cod_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason_code" text,
	"staff_note" text,
	"cap_paise" bigint,
	"expires_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "cod_requests_status_valid" CHECK ("cod_requests"."status" in ('pending','approved','rejected','withdrawn','revoked','expired')),
	CONSTRAINT "cod_requests_reason_valid" CHECK ("cod_requests"."reason_code" in ('no_upi_or_card','prefer_pay_on_receipt','business_cash_account','regular_buyer','large_order','other')),
	CONSTRAINT "cod_requests_decision_reason_valid" CHECK ("cod_requests"."decision_reason_code" is null or "cod_requests"."decision_reason_code" in ('insufficient_history','unverified_details','rto_history','area_not_supported','risk_signals','other')),
	CONSTRAINT "cod_requests_revoke_reason_valid" CHECK ("cod_requests"."revoke_reason_code" is null or "cod_requests"."revoke_reason_code" in ('cod_refused','misuse','customer_request','risk_signals','other')),
	CONSTRAINT "cod_requests_pincode_format" CHECK ("cod_requests"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "cod_requests_note_length" CHECK ("cod_requests"."note" is null or char_length("cod_requests"."note") <= 300),
	CONSTRAINT "cod_requests_staff_note_length" CHECK ("cod_requests"."staff_note" is null or char_length("cod_requests"."staff_note") <= 500),
	CONSTRAINT "cod_requests_cap_positive" CHECK ("cod_requests"."cap_paise" is null or "cod_requests"."cap_paise" > 0),
	CONSTRAINT "cod_requests_decided_complete" CHECK (("cod_requests"."status" in ('pending','withdrawn')) = ("cod_requests"."decided_at" is null) and ("cod_requests"."decided_at" is null) = ("cod_requests"."decided_by" is null)),
	CONSTRAINT "cod_requests_reject_reason" CHECK (("cod_requests"."status" = 'rejected') = ("cod_requests"."decision_reason_code" is not null)),
	CONSTRAINT "cod_requests_revoke_complete" CHECK (("cod_requests"."status" = 'revoked') = ("cod_requests"."revoked_at" is not null) and ("cod_requests"."revoked_at" is null) = ("cod_requests"."revoked_by" is null) and ("cod_requests"."revoked_at" is null) = ("cod_requests"."revoke_reason_code" is null)),
	CONSTRAINT "cod_requests_expires_after_decision" CHECK ("cod_requests"."expires_at" is null or "cod_requests"."expires_at" > "cod_requests"."decided_at"),
	CONSTRAINT "cod_requests_not_self" CHECK ("cod_requests"."decided_by" is null or "cod_requests"."decided_by" <> "cod_requests"."user_id")
);
--> statement-breakpoint
ALTER TABLE "cod_request_events" ADD CONSTRAINT "cod_request_events_request_id_cod_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."cod_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_requests" ADD CONSTRAINT "cod_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_requests" ADD CONSTRAINT "cod_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_requests" ADD CONSTRAINT "cod_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_requests" ADD CONSTRAINT "cod_requests_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_requests" ADD CONSTRAINT "cod_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cod_request_events_request_id_id_index" ON "cod_request_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "cod_requests_one_pending_uq" ON "cod_requests" USING btree ("user_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "cod_requests_one_approved_uq" ON "cod_requests" USING btree ("user_id","city_id") WHERE status = 'approved';--> statement-breakpoint
CREATE INDEX "cod_requests_queue_idx" ON "cod_requests" USING btree ("status","city_id","created_at");--> statement-breakpoint
CREATE INDEX "cod_requests_user_id_created_at_index" ON "cod_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cod_requests_city_id_index" ON "cod_requests" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "cod_requests_decided_by_index" ON "cod_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "cod_requests_revoked_by_index" ON "cod_requests" USING btree ("revoked_by");--> statement-breakpoint
CREATE INDEX "cod_requests_created_by_index" ON "cod_requests" USING btree ("created_by");--> statement-breakpoint
-- Hand-written (founder ruling 2026-11-26, COD eligibility): deny-all RLS (the API is the only reader and writer),
-- version and updated_at triggers on the request, append-only history.
ALTER TABLE public.cod_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.cod_request_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.cod_requests, public.cod_request_events FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER cod_requests_bump_version BEFORE UPDATE ON public.cod_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER cod_requests_touch_updated_at BEFORE UPDATE ON public.cod_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER cod_request_events_append_only BEFORE UPDATE OR DELETE ON public.cod_request_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();