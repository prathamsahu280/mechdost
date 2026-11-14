CREATE TABLE "service_arrival_codes" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"code_enc" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_arrival_codes_attempts" CHECK ("service_arrival_codes"."attempts" between 0 and 5),
	CONSTRAINT "service_arrival_codes_encrypted" CHECK ("service_arrival_codes"."code_enc" is null or "service_arrival_codes"."code_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE TABLE "service_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"transport" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_moves_reason_valid" CHECK ("service_moves"."reason_code" in ('needs_lift','needs_tools','parts_unavailable','other')),
	CONSTRAINT "service_moves_transport_valid" CHECK ("service_moves"."transport" in ('customer_drops','workshop_picks_up')),
	CONSTRAINT "service_moves_status_valid" CHECK ("service_moves"."status" in ('proposed','accepted','declined')),
	CONSTRAINT "service_moves_decided_pair" CHECK (("service_moves"."status" = 'proposed') = ("service_moves"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "service_bills" ALTER COLUMN "estimate_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "service_mode" text DEFAULT 'workshop' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "address_id" uuid;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "home_address" jsonb;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "visit_fee_paise" integer;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "visit_fee_waived_reason" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "visiting_mechanic" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "arrival_override_reason" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "arrival_override_by" uuid;--> statement-breakpoint
ALTER TABLE "workshop_services" ADD COLUMN "home_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "home_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "home_radius_km" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "home_visit_fee_paise" integer DEFAULT 9900 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_arrival_codes" ADD CONSTRAINT "service_arrival_codes_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_moves" ADD CONSTRAINT "service_moves_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_moves" ADD CONSTRAINT "service_moves_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_moves_one_proposed_uq" ON "service_moves" USING btree ("request_id") WHERE "service_moves"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "service_moves_request_id_index" ON "service_moves" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "service_moves_proposed_by_index" ON "service_moves" USING btree ("proposed_by");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_arrival_override_by_users_id_fk" FOREIGN KEY ("arrival_override_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_requests_address_id_index" ON "service_requests" USING btree ("address_id");--> statement-breakpoint
CREATE INDEX "service_requests_arrival_override_by_index" ON "service_requests" USING btree ("arrival_override_by");--> statement-breakpoint
CREATE INDEX "workshops_home_location_gist" ON "workshops" USING gist ("location") WHERE "workshops"."home_service";--> statement-breakpoint
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_estimate_or_visit_only" CHECK ("service_bills"."estimate_id" is not null or (jsonb_typeof("service_bills"."lines") = 'array' and jsonb_array_length("service_bills"."lines") = 1));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_mode_valid" CHECK ("service_requests"."service_mode" in ('workshop','home'));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_home_no_pickup" CHECK ("service_requests"."service_mode" <> 'home' or not "service_requests"."pickup_requested");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_home_needs_pin" CHECK ("service_requests"."service_mode" <> 'home' or ("service_requests"."location" is not null and "service_requests"."home_address" is not null and "service_requests"."visit_fee_paise" is not null));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_visit_fee_range" CHECK ("service_requests"."visit_fee_paise" is null or "service_requests"."visit_fee_paise" between 0 and 50000);--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_waive_reason_valid" CHECK ("service_requests"."visit_fee_waived_reason" is null or ("service_requests"."visit_fee_paise" is not null and "service_requests"."visit_fee_waived_reason" in ('goodwill','small_job','regular_customer','other')));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_mechanic_len" CHECK ("service_requests"."visiting_mechanic" is null or char_length("service_requests"."visiting_mechanic") between 2 and 30);--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_arrival_override_pair" CHECK (("service_requests"."arrival_override_reason" is null) = ("service_requests"."arrival_override_by" is null));--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_home_radius_range" CHECK ("workshops"."home_radius_km" between 1 and 25);--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_home_fee_range" CHECK ("workshops"."home_visit_fee_paise" between 0 and 50000);--> statement-breakpoint
-- New tables: RLS on, no direct client access (the API connects as owner), version + updated_at triggers (spec 14).
ALTER TABLE public.service_moves ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_arrival_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.service_moves FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.service_arrival_codes FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER service_moves_bump_version BEFORE UPDATE ON public.service_moves
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER service_moves_touch_updated_at BEFORE UPDATE ON public.service_moves
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER service_arrival_codes_bump_version BEFORE UPDATE ON public.service_arrival_codes
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER service_arrival_codes_touch_updated_at BEFORE UPDATE ON public.service_arrival_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
