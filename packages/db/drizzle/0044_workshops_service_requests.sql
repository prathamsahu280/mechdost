-- Workshops and service requests (spec 06; real-API launch plan 2026-11-14, stream A): workshops + menu,
-- service_requests (serviceRequestMachine), proposals, estimates + items, bills, the append-only service_events,
-- and the missing FK user_roles.workshop_id -> workshops. RLS on, client roles revoked, version/updated_at triggers.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "estimate_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"description" text NOT NULL,
	"service_key" text,
	"qty" smallint NOT NULL,
	"unit_paise" bigint NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "estimate_items_line_uq" UNIQUE("estimate_id","line_no"),
	CONSTRAINT "estimate_items_line_no" CHECK ("estimate_items"."line_no" between 1 and 20),
	CONSTRAINT "estimate_items_description_len" CHECK (char_length("estimate_items"."description") between 2 and 120),
	CONSTRAINT "estimate_items_qty_range" CHECK ("estimate_items"."qty" between 1 and 99),
	CONSTRAINT "estimate_items_unit_range" CHECK ("estimate_items"."unit_paise" between 1 and 10000000),
	CONSTRAINT "estimate_items_gst_slab" CHECK ("estimate_items"."gst_rate_bp" in (0,500,1200,1800,2800)),
	CONSTRAINT "estimate_items_decision_valid" CHECK ("estimate_items"."decision" in ('pending','approved','declined'))
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimates_revision_uq" UNIQUE("request_id","revision"),
	CONSTRAINT "estimates_revision_positive" CHECK ("estimates"."revision" > 0),
	CONSTRAINT "estimates_status_valid" CHECK ("estimates"."status" in ('sent','decided','superseded')),
	CONSTRAINT "estimates_decided_at" CHECK ("estimates"."status" <> 'decided' or "estimates"."decided_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "service_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"gst_registered" boolean NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"cgst_paise" bigint NOT NULL,
	"sgst_paise" bigint NOT NULL,
	"round_off_paise" integer NOT NULL,
	"total_paise" bigint NOT NULL,
	"billed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"billed_by" uuid,
	"paid_at" timestamp with time zone,
	"method" text,
	"paid_recorded_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_bills_requestId_unique" UNIQUE("request_id"),
	CONSTRAINT "service_bills_amounts_nonneg" CHECK ("service_bills"."taxable_paise" >= 0 and "service_bills"."cgst_paise" >= 0 and "service_bills"."sgst_paise" >= 0 and "service_bills"."total_paise" >= 0),
	CONSTRAINT "service_bills_cgst_equals_sgst" CHECK ("service_bills"."cgst_paise" = "service_bills"."sgst_paise"),
	CONSTRAINT "service_bills_round_off_range" CHECK ("service_bills"."round_off_paise" between -50 and 50),
	CONSTRAINT "service_bills_total_consistent" CHECK ("service_bills"."total_paise" = "service_bills"."taxable_paise" + "service_bills"."cgst_paise" + "service_bills"."sgst_paise" + "service_bills"."round_off_paise"),
	CONSTRAINT "service_bills_unregistered_no_gst" CHECK ("service_bills"."gst_registered" or "service_bills"."cgst_paise" = 0),
	CONSTRAINT "service_bills_lines_array" CHECK (jsonb_typeof("service_bills"."lines") = 'array'),
	CONSTRAINT "service_bills_method_valid" CHECK ("service_bills"."method" is null or "service_bills"."method" in ('cash','upi','card')),
	CONSTRAINT "service_bills_paid_pair" CHECK (("service_bills"."paid_at" is null) = ("service_bills"."method" is null))
);
--> statement-breakpoint
CREATE TABLE "service_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"visible_to_customer" boolean DEFAULT true NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_events_actor_valid" CHECK ("service_events"."actor_type" in ('customer','workshop','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "service_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workshop_id" uuid NOT NULL,
	"proposed_date" date NOT NULL,
	"slot" text NOT NULL,
	"low_paise" bigint NOT NULL,
	"high_paise" bigint NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_proposals_slot_valid" CHECK ("service_proposals"."slot" in ('morning','afternoon','evening')),
	CONSTRAINT "service_proposals_range" CHECK ("service_proposals"."low_paise" >= 0 and "service_proposals"."high_paise" >= "service_proposals"."low_paise"),
	CONSTRAINT "service_proposals_status_valid" CHECK ("service_proposals"."status" in ('pending','accepted','declined','withdrawn')),
	CONSTRAINT "service_proposals_note_len" CHECK ("service_proposals"."note" is null or char_length("service_proposals"."note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"workshop_id" uuid,
	"routing_mode" text NOT NULL,
	"vehicle_id" uuid,
	"vehicle_type" text NOT NULL,
	"vehicle_text" text NOT NULL,
	"vehicle_key" text NOT NULL,
	"services" jsonb NOT NULL,
	"concern" text,
	"pincode" text NOT NULL,
	"location" geography(Point,4326),
	"preferred_date" date NOT NULL,
	"preferred_slot" text NOT NULL,
	"pickup_requested" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"status_reason_code" text,
	"customer_message" text,
	"odometer_km" integer,
	"received_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "service_requests_idempotency_uq" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "service_requests_code_format" CHECK ("service_requests"."code" ~ '^SR-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "service_requests_status_valid" CHECK ("service_requests"."status" in ('requested','needs_routing','awaiting_workshop','proposed','confirmed','vehicle_received','estimate_sent','approved','no_work_approved','in_progress','ready','billed','paid','completed','cancelled','rejected')),
	CONSTRAINT "service_requests_routing_valid" CHECK ("service_requests"."routing_mode" in ('chosen','mechdost')),
	CONSTRAINT "service_requests_vehicle_type_valid" CHECK ("service_requests"."vehicle_type" in ('2W','3W','4W')),
	CONSTRAINT "service_requests_vehicle_text_len" CHECK (char_length("service_requests"."vehicle_text") between 2 and 80),
	CONSTRAINT "service_requests_slot_valid" CHECK ("service_requests"."preferred_slot" in ('morning','afternoon','evening')),
	CONSTRAINT "service_requests_services_array" CHECK (jsonb_typeof("service_requests"."services") = 'array'),
	CONSTRAINT "service_requests_concern_len" CHECK ("service_requests"."concern" is null or char_length("service_requests"."concern") <= 500),
	CONSTRAINT "service_requests_odometer_range" CHECK ("service_requests"."odometer_km" is null or "service_requests"."odometer_km" between 0 and 2000000),
	CONSTRAINT "service_requests_idempotency_format" CHECK ("service_requests"."idempotency_key" ~ '^[A-Za-z0-9_-]{16,64}$'),
	CONSTRAINT "service_requests_workshop_when_assigned" CHECK ("service_requests"."status" in ('requested','needs_routing','cancelled','rejected') or "service_requests"."workshop_id" is not null),
	CONSTRAINT "service_requests_odometer_when_received" CHECK ("service_requests"."status" in ('requested','needs_routing','awaiting_workshop','proposed','confirmed','cancelled','rejected') or "service_requests"."odometer_km" is not null),
	CONSTRAINT "service_requests_reason_code_valid" CHECK (case "service_requests"."status"
        when 'rejected' then "service_requests"."status_reason_code" in ('no_workshop_nearby','all_workshops_declined','unserviceable_address','suspected_fraud','other')
        when 'cancelled' then "service_requests"."status_reason_code" in ('changed_mind','booked_by_mistake','found_another_workshop','slot_not_suitable','problem_solved','other')
        else "service_requests"."status_reason_code" is null end),
	CONSTRAINT "service_requests_rejected_explained" CHECK ("service_requests"."status" <> 'rejected' or char_length("service_requests"."customer_message") between 10 and 500)
);
--> statement-breakpoint
CREATE TABLE "workshop_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"title_hi" text,
	"included" text,
	"included_hi" text,
	"low_paise" bigint NOT NULL,
	"high_paise" bigint NOT NULL,
	"min_minutes" integer NOT NULL,
	"max_minutes" integer NOT NULL,
	"vehicle_type" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_services_key_uq" UNIQUE("workshop_id","key"),
	CONSTRAINT "workshop_services_key_format" CHECK ("workshop_services"."key" ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
	CONSTRAINT "workshop_services_range" CHECK ("workshop_services"."low_paise" >= 0 and "workshop_services"."high_paise" >= "workshop_services"."low_paise"),
	CONSTRAINT "workshop_services_minutes" CHECK ("workshop_services"."min_minutes" between 5 and 10080 and "workshop_services"."max_minutes" between "workshop_services"."min_minutes" and 10080),
	CONSTRAINT "workshop_services_vehicle_type_valid" CHECK ("workshop_services"."vehicle_type" is null or "workshop_services"."vehicle_type" in ('2W','3W','4W'))
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"address_line" text NOT NULL,
	"address_line_hi" text,
	"area" text NOT NULL,
	"area_hi" text,
	"pincode" text NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"phone" text,
	"vehicle_types" text[] NOT NULL,
	"ev_basic" boolean DEFAULT false NOT NULL,
	"pickup" boolean DEFAULT false NOT NULL,
	"hours" jsonb NOT NULL,
	"gstin" text,
	"gst_registered" boolean DEFAULT false NOT NULL,
	"location_verified" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"status_reason" text,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"busy" boolean DEFAULT false NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshops_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workshops_slug_format" CHECK ("workshops"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("workshops"."slug") <= 80),
	CONSTRAINT "workshops_vehicle_types_valid" CHECK (cardinality("workshops"."vehicle_types") > 0 and "workshops"."vehicle_types" <@ array['2W','3W','4W']::text[]),
	CONSTRAINT "workshops_hours_object" CHECK (jsonb_typeof("workshops"."hours") = 'object'),
	CONSTRAINT "workshops_status_valid" CHECK ("workshops"."status" in ('approved','paused','suspended')),
	CONSTRAINT "workshops_standing_has_reason" CHECK ("workshops"."status" = 'approved' or (coalesce(char_length("workshops"."status_reason"), 0) >= 5 and "workshops"."status_changed_by" is not null)),
	CONSTRAINT "workshops_published_needs_location" CHECK (not "workshops"."published" or "workshops"."location_verified"),
	CONSTRAINT "workshops_gstin_format" CHECK ("workshops"."gstin" is null or "workshops"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
	CONSTRAINT "workshops_gst_registered_has_gstin" CHECK ("workshops"."gst_registered" = ("workshops"."gstin" is not null)),
	CONSTRAINT "workshops_phone_format" CHECK ("workshops"."phone" is null or "workshops"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "workshops_rating_count_nonneg" CHECK ("workshops"."rating_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_billed_by_users_id_fk" FOREIGN KEY ("billed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_paid_recorded_by_users_id_fk" FOREIGN KEY ("paid_recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_services" ADD CONSTRAINT "workshop_services_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_one_active_uq" ON "estimates" USING btree ("request_id") WHERE "estimates"."status" <> 'superseded';--> statement-breakpoint
CREATE INDEX "estimates_created_by_index" ON "estimates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "estimates_decided_by_index" ON "estimates" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "service_bills_estimate_id_index" ON "service_bills" USING btree ("estimate_id");--> statement-breakpoint
CREATE INDEX "service_bills_billed_by_index" ON "service_bills" USING btree ("billed_by");--> statement-breakpoint
CREATE INDEX "service_bills_paid_recorded_by_index" ON "service_bills" USING btree ("paid_recorded_by");--> statement-breakpoint
CREATE INDEX "service_events_request_id_id_index" ON "service_events" USING btree ("request_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_proposals_one_pending_uq" ON "service_proposals" USING btree ("request_id") WHERE "service_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "service_proposals_request_id_index" ON "service_proposals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "service_proposals_workshop_id_index" ON "service_proposals" USING btree ("workshop_id");--> statement-breakpoint
CREATE INDEX "service_proposals_created_by_index" ON "service_proposals" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "service_requests_user_id_created_at_index" ON "service_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_workshop_id_status_index" ON "service_requests" USING btree ("workshop_id","status");--> statement-breakpoint
CREATE INDEX "service_requests_status_city_id_created_at_index" ON "service_requests" USING btree ("status","city_id","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_city_id_index" ON "service_requests" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "service_requests_vehicle_id_index" ON "service_requests" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "service_requests_pincode_index" ON "service_requests" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "service_requests_user_id_vehicle_key_index" ON "service_requests" USING btree ("user_id","vehicle_key");--> statement-breakpoint
CREATE INDEX "workshops_location_gist" ON "workshops" USING gist ("location");--> statement-breakpoint
CREATE INDEX "workshops_city_id_published_index" ON "workshops" USING btree ("city_id","published");--> statement-breakpoint
CREATE INDEX "workshops_pincode_index" ON "workshops" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "workshops_status_changed_by_index" ON "workshops" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "workshops_created_by_index" ON "workshops" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_roles" VALIDATE CONSTRAINT "user_roles_workshop_id_workshops_id_fk";--> statement-breakpoint
ALTER TABLE public.workshops ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.workshop_services ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_proposals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_bills ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.workshops, public.workshop_services, public.service_requests, public.service_proposals,
  public.estimates, public.estimate_items, public.service_bills, public.service_events FROM anon, authenticated;--> statement-breakpoint
-- The timeline is append-only (same guard as order_events, 0002).
CREATE TRIGGER service_events_append_only BEFORE UPDATE OR DELETE ON public.service_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- Version and updated_at triggers for the new mutable tables (same loop as 0031/0038/0043).
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