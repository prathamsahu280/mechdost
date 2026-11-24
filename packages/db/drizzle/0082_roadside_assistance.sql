CREATE TABLE "rsa_arrival_codes" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"code_enc" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_arrival_codes_attempts" CHECK ("rsa_arrival_codes"."attempts" between 0 and 5),
	CONSTRAINT "rsa_arrival_codes_encrypted" CHECK ("rsa_arrival_codes"."code_enc" is null or "rsa_arrival_codes"."code_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE TABLE "rsa_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_bill_lines_kind" CHECK ("rsa_bill_lines"."kind" in ('labour','part','towing','other')),
	CONSTRAINT "rsa_bill_lines_description" CHECK (char_length("rsa_bill_lines"."description") between 1 and 120),
	CONSTRAINT "rsa_bill_lines_qty" CHECK ("rsa_bill_lines"."quantity" between 1 and 99),
	CONSTRAINT "rsa_bill_lines_money" CHECK ("rsa_bill_lines"."unit_price_paise" >= 0 and "rsa_bill_lines"."total_paise" = "rsa_bill_lines"."quantity" * "rsa_bill_lines"."unit_price_paise")
);
--> statement-breakpoint
CREATE TABLE "rsa_city_settings" (
	"city_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"vehicle_types" text[] DEFAULT '{2W,4W}'::text[] NOT NULL,
	"advance_paise" jsonb DEFAULT '{"2W":50000,"4W":50000}'::jsonb NOT NULL,
	"pincodes" text[] DEFAULT '{}'::text[] NOT NULL,
	"always_open" boolean DEFAULT true NOT NULL,
	"opens_at_minute" smallint DEFAULT 0 NOT NULL,
	"closes_at_minute" smallint DEFAULT 0 NOT NULL,
	"routing_mode" text DEFAULT 'manual' NOT NULL,
	"accept_timer_seconds" integer DEFAULT 150 NOT NULL,
	"max_auto_attempts" smallint DEFAULT 3 NOT NULL,
	"max_bill_paise" bigint DEFAULT 2500000 NOT NULL,
	"bill_dispute_enabled" boolean DEFAULT false NOT NULL,
	"problem_types" text[] DEFAULT '{dead_battery,flat_tyre,out_of_fuel,minor_fix,needs_towing,unknown}'::text[] NOT NULL,
	"sos_phone" text,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_city_settings_vehicle_types" CHECK ("rsa_city_settings"."vehicle_types" <@ array['2W','3W','4W']::text[] and cardinality("rsa_city_settings"."vehicle_types") between 1 and 3),
	CONSTRAINT "rsa_city_settings_advance_matches" CHECK (jsonb_typeof("rsa_city_settings"."advance_paise") = 'object' and "rsa_city_settings"."advance_paise" ?& "rsa_city_settings"."vehicle_types" and ("rsa_city_settings"."advance_paise" - "rsa_city_settings"."vehicle_types") = '{}'::jsonb),
	CONSTRAINT "rsa_city_settings_routing_mode" CHECK ("rsa_city_settings"."routing_mode" in ('manual','auto','auto_then_manual')),
	CONSTRAINT "rsa_city_settings_max_bill" CHECK ("rsa_city_settings"."max_bill_paise" between 100000 and 10000000),
	CONSTRAINT "rsa_city_settings_hours" CHECK ("rsa_city_settings"."opens_at_minute" between 0 and 1439 and "rsa_city_settings"."closes_at_minute" between 0 and 1439),
	CONSTRAINT "rsa_city_settings_timer" CHECK ("rsa_city_settings"."accept_timer_seconds" between 60 and 900 and "rsa_city_settings"."max_auto_attempts" between 1 and 10),
	CONSTRAINT "rsa_city_settings_problem_types" CHECK ("rsa_city_settings"."problem_types" <@ array['dead_battery','flat_tyre','out_of_fuel','minor_fix','needs_towing','unknown']::text[] and cardinality("rsa_city_settings"."problem_types") >= 1),
	CONSTRAINT "rsa_city_settings_sos_phone" CHECK ("rsa_city_settings"."sos_phone" is null or "rsa_city_settings"."sos_phone" ~ '^\+91[6-9][0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "rsa_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rsa_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"visible_to_customer" boolean DEFAULT true NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_events_actor_valid" CHECK ("rsa_events"."actor_type" in ('customer','workshop','admin','system')),
	CONSTRAINT "rsa_events_status_valid" CHECK ("rsa_events"."to_status" in ('awaiting_payment','requested','offered','accepted','en_route','arrived','in_progress','billed','completed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "rsa_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"responder_type" text DEFAULT 'workshop' NOT NULL,
	"workshop_id" uuid NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"distance_m" integer,
	"offered_by" uuid,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rsa_offers_status_valid" CHECK ("rsa_offers"."status" in ('offered','accepted','declined','expired','withdrawn')),
	CONSTRAINT "rsa_offers_responder_type" CHECK ("rsa_offers"."responder_type" in ('workshop')),
	CONSTRAINT "rsa_offers_expiry_after_offer" CHECK ("rsa_offers"."expires_at" > "rsa_offers"."offered_at"),
	CONSTRAINT "rsa_offers_decline_reason" CHECK (("rsa_offers"."status" = 'declined') = ("rsa_offers"."decline_reason" is not null) and ("rsa_offers"."decline_reason" is null or "rsa_offers"."decline_reason" in ('busy','too_far','vehicle_not_served','problem_not_handled','closed','other')))
);
--> statement-breakpoint
CREATE TABLE "rsa_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"city_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"vehicle_type" text NOT NULL,
	"fuel" text NOT NULL,
	"vehicle_label" text,
	"problem_type" text,
	"note" text,
	"photo_paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"pincode" text NOT NULL,
	"address_line" text,
	"advance_paise" bigint NOT NULL,
	"advance_paid_at" timestamp with time zone,
	"workshop_id" uuid,
	"total_paise" bigint,
	"balance_paise" bigint,
	"overpaid_paise" bigint,
	"balance_method" text,
	"balance_paid_at" timestamp with time zone,
	"billed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancel_note" text,
	"idem_key" text,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "rsa_requests_status_valid" CHECK ("rsa_requests"."status" in ('awaiting_payment','requested','offered','accepted','en_route','arrived','in_progress','billed','completed','cancelled')),
	CONSTRAINT "rsa_requests_vehicle_type" CHECK ("rsa_requests"."vehicle_type" in ('2W','3W','4W')),
	CONSTRAINT "rsa_requests_fuel" CHECK ("rsa_requests"."fuel" in ('petrol','diesel','cng','electric','other')),
	CONSTRAINT "rsa_requests_problem_type" CHECK ("rsa_requests"."problem_type" is null or "rsa_requests"."problem_type" in ('dead_battery','flat_tyre','out_of_fuel','minor_fix','needs_towing','unknown')),
	CONSTRAINT "rsa_requests_pincode" CHECK ("rsa_requests"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "rsa_requests_note_len" CHECK ("rsa_requests"."note" is null or char_length("rsa_requests"."note") between 1 and 300),
	CONSTRAINT "rsa_requests_photos" CHECK (cardinality("rsa_requests"."photo_paths") <= 3),
	CONSTRAINT "rsa_requests_advance_positive" CHECK ("rsa_requests"."advance_paise" > 0),
	CONSTRAINT "rsa_requests_money" CHECK (("rsa_requests"."total_paise" is null or "rsa_requests"."total_paise" > 0) and ("rsa_requests"."balance_paise" is null or "rsa_requests"."balance_paise" >= 0) and ("rsa_requests"."overpaid_paise" is null or "rsa_requests"."overpaid_paise" >= 0)),
	CONSTRAINT "rsa_requests_balance_maths" CHECK ("rsa_requests"."total_paise" is null or ("rsa_requests"."balance_paise" = greatest("rsa_requests"."total_paise" - "rsa_requests"."advance_paise", 0) and "rsa_requests"."overpaid_paise" = greatest("rsa_requests"."advance_paise" - "rsa_requests"."total_paise", 0))),
	CONSTRAINT "rsa_requests_balance_method" CHECK ("rsa_requests"."balance_method" is null or "rsa_requests"."balance_method" in ('online','cash', 'none')),
	CONSTRAINT "rsa_requests_billed_has_total" CHECK ("rsa_requests"."status" not in ('billed','completed') or ("rsa_requests"."total_paise" is not null and "rsa_requests"."billed_at" is not null)),
	CONSTRAINT "rsa_requests_completed_settled" CHECK ("rsa_requests"."status" <> 'completed' or ("rsa_requests"."balance_method" is not null and "rsa_requests"."completed_at" is not null)),
	CONSTRAINT "rsa_requests_cancel_explained" CHECK (("rsa_requests"."status" = 'cancelled') = ("rsa_requests"."cancel_reason" is not null and "rsa_requests"."cancelled_at" is not null) and ("rsa_requests"."cancel_reason" is null or "rsa_requests"."cancel_reason" in ('no_responder_accepted','customer_unreachable','duplicate_request','other','payment_window_expired','customer_abandoned'))),
	CONSTRAINT "rsa_requests_responder_attached" CHECK ("rsa_requests"."status" not in ('accepted','en_route','arrived','in_progress','billed') or "rsa_requests"."workshop_id" is not null),
	CONSTRAINT "rsa_requests_advance_paid" CHECK ("rsa_requests"."status" = 'awaiting_payment' or "rsa_requests"."status" = 'cancelled' or "rsa_requests"."advance_paid_at" is not null),
	CONSTRAINT "rsa_requests_idem_format" CHECK ("rsa_requests"."idem_key" is null or "rsa_requests"."idem_key" ~ '^[A-Za-z0-9_-]{10,64}$')
);
--> statement-breakpoint
CREATE TABLE "rsa_responders" (
	"workshop_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"radius_km" smallint DEFAULT 10 NOT NULL,
	"vehicle_types" text[] DEFAULT '{2W,4W}'::text[] NOT NULL,
	"problem_types" text[] DEFAULT '{dead_battery,flat_tyre,out_of_fuel,minor_fix,unknown}'::text[] NOT NULL,
	"towing" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsa_responders_radius" CHECK ("rsa_responders"."radius_km" between 1 and 50),
	CONSTRAINT "rsa_responders_vehicle_types" CHECK ("rsa_responders"."vehicle_types" <@ array['2W','3W','4W']::text[] and cardinality("rsa_responders"."vehicle_types") >= 1),
	CONSTRAINT "rsa_responders_problem_types" CHECK ("rsa_responders"."problem_types" <@ array['dead_battery','flat_tyre','out_of_fuel','minor_fix','needs_towing','unknown']::text[] and cardinality("rsa_responders"."problem_types") >= 1)
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_purpose_valid";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_purpose_target";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_group_or_bill";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_source_valid";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_valid";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_valid";--> statement-breakpoint
ALTER TABLE "support_tickets" DROP CONSTRAINT "support_tickets_kind_valid";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "rsa_request_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "rsa_request_id" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "rsa_request_id" uuid;--> statement-breakpoint
ALTER TABLE "rsa_arrival_codes" ADD CONSTRAINT "rsa_arrival_codes_request_id_rsa_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_bill_lines" ADD CONSTRAINT "rsa_bill_lines_request_id_rsa_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_bill_lines" ADD CONSTRAINT "rsa_bill_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_city_settings" ADD CONSTRAINT "rsa_city_settings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_city_settings" ADD CONSTRAINT "rsa_city_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_events" ADD CONSTRAINT "rsa_events_request_id_rsa_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_offers" ADD CONSTRAINT "rsa_offers_request_id_rsa_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_offers" ADD CONSTRAINT "rsa_offers_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_offers" ADD CONSTRAINT "rsa_offers_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_requests" ADD CONSTRAINT "rsa_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_requests" ADD CONSTRAINT "rsa_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_requests" ADD CONSTRAINT "rsa_requests_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_requests" ADD CONSTRAINT "rsa_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsa_responders" ADD CONSTRAINT "rsa_responders_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rsa_bill_lines_position_uq" ON "rsa_bill_lines" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "rsa_bill_lines_created_by_index" ON "rsa_bill_lines" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rsa_city_settings_updated_by_index" ON "rsa_city_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "rsa_events_request_id_id_index" ON "rsa_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsa_offers_one_active_uq" ON "rsa_offers" USING btree ("request_id") WHERE "rsa_offers"."status" in ('offered','accepted');--> statement-breakpoint
CREATE INDEX "rsa_offers_expiring_idx" ON "rsa_offers" USING btree ("expires_at") WHERE "rsa_offers"."status" = 'offered';--> statement-breakpoint
CREATE INDEX "rsa_offers_workshop_id_status_index" ON "rsa_offers" USING btree ("workshop_id","status");--> statement-breakpoint
CREATE INDEX "rsa_offers_request_id_attempt_index" ON "rsa_offers" USING btree ("request_id","attempt");--> statement-breakpoint
CREATE INDEX "rsa_offers_offered_by_index" ON "rsa_offers" USING btree ("offered_by");--> statement-breakpoint
CREATE UNIQUE INDEX "rsa_requests_one_live_per_user_uq" ON "rsa_requests" USING btree ("user_id") WHERE "rsa_requests"."status" not in ('completed','cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "rsa_requests_idem_uq" ON "rsa_requests" USING btree ("user_id","idem_key") WHERE "rsa_requests"."idem_key" is not null;--> statement-breakpoint
CREATE INDEX "rsa_requests_city_status_idx" ON "rsa_requests" USING btree ("city_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "rsa_requests_user_id_created_at_index" ON "rsa_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rsa_requests_workshop_id_status_index" ON "rsa_requests" USING btree ("workshop_id","status");--> statement-breakpoint
CREATE INDEX "rsa_requests_created_by_index" ON "rsa_requests" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rsa_requests_location_gix" ON "rsa_requests" USING gist ("location");--> statement-breakpoint
CREATE INDEX "rsa_requests_unpaid_idx" ON "rsa_requests" USING btree ("created_at") WHERE "rsa_requests"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE INDEX "rsa_responders_enabled_index" ON "rsa_responders" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rsa_request_id_rsa_requests_id_fk" FOREIGN KEY ("rsa_request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_rsa_request_id_rsa_requests_id_fk" FOREIGN KEY ("rsa_request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_rsa_request_id_rsa_requests_id_fk" FOREIGN KEY ("rsa_request_id") REFERENCES "public"."rsa_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_success_per_rsa_uq" ON "payments" USING btree ("rsa_request_id","purpose") WHERE "payments"."status" in ('paid','partially_refunded','refunded') and "payments"."rsa_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_open_per_rsa_uq" ON "payments" USING btree ("rsa_request_id","purpose") WHERE "payments"."status" in ('created','attempted','failed') and "payments"."rsa_request_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_rsa_request_id_index" ON "payments" USING btree ("rsa_request_id");--> statement-breakpoint
CREATE INDEX "refunds_rsa_request_id_index" ON "refunds" USING btree ("rsa_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_rsa_dispute_uq" ON "support_tickets" USING btree ("rsa_request_id") WHERE "support_tickets"."kind" = 'rsa_bill_dispute' and "support_tickets"."status" in ('open','in_review','awaiting_customer');--> statement-breakpoint
CREATE INDEX "support_tickets_rsa_request_id_index" ON "support_tickets" USING btree ("rsa_request_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_valid" CHECK ("payments"."purpose" in ('order','service_bill','rsa_advance','rsa_balance'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_target" CHECK (("payments"."purpose" = 'order' and "payments"."group_id" is not null and "payments"."bill_id" is null and "payments"."rsa_request_id" is null) or ("payments"."purpose" = 'service_bill' and "payments"."bill_id" is not null and "payments"."group_id" is null and "payments"."rsa_request_id" is null) or ("payments"."purpose" in ('rsa_advance','rsa_balance') and "payments"."rsa_request_id" is not null and "payments"."group_id" is null and "payments"."bill_id" is null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_one_target" CHECK (num_nonnulls("refunds"."group_id", "refunds"."bill_id", "refunds"."rsa_request_id") = 1);--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("refunds"."source" in ('order_rejected','order_cancelled','service_cancelled','rsa_cancelled','rsa_overpaid','duplicate_payment','payment_after_close','unfulfilled','support_claim','part_refund','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_valid" CHECK ("refunds"."reason_code" in ('order_rejected','order_cancelled','service_cancelled','rsa_cancelled','rsa_overpaid','duplicate_payment','payment_after_close','faulty','damaged_in_transit','wrong_item','missing_item','not_fulfilled','goodwill','other'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_valid" CHECK ("notifications"."entity_type" is null or "notifications"."entity_type" in ('order','service_request','rsa_request','quote','ticket','refund','shop','application','account'));--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_kind_valid" CHECK ("support_tickets"."kind" in ('order_issue','service_issue','refund','fitment','product_sourcing','workshop_request','account','deletion_request','labour_redo','rsa_bill_dispute','other'));--> statement-breakpoint
-- Roadside assistance (design 2026-11-24, spec 22). Deny-all for the Data API (anon/authenticated); only the API role
-- reads and writes these (spec 13). History and bill lines are append-only; mutable rows get version + updated_at.
ALTER TABLE public.rsa_city_settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_responders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_offers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_bill_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.rsa_arrival_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.rsa_city_settings, public.rsa_responders, public.rsa_requests, public.rsa_offers, public.rsa_events, public.rsa_bill_lines, public.rsa_arrival_codes FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER rsa_events_append_only BEFORE UPDATE OR DELETE ON public.rsa_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER rsa_bill_lines_append_only BEFORE UPDATE OR DELETE ON public.rsa_bill_lines
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER rsa_city_settings_bump_version BEFORE UPDATE ON public.rsa_city_settings
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER rsa_city_settings_touch_updated_at BEFORE UPDATE ON public.rsa_city_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER rsa_responders_bump_version BEFORE UPDATE ON public.rsa_responders
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER rsa_responders_touch_updated_at BEFORE UPDATE ON public.rsa_responders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER rsa_requests_bump_version BEFORE UPDATE ON public.rsa_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER rsa_requests_touch_updated_at BEFORE UPDATE ON public.rsa_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER rsa_offers_bump_version BEFORE UPDATE ON public.rsa_offers
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER rsa_arrival_codes_bump_version BEFORE UPDATE ON public.rsa_arrival_codes
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER rsa_arrival_codes_touch_updated_at BEFORE UPDATE ON public.rsa_arrival_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
