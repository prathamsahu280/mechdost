CREATE TABLE "ustaad_locations" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"accuracy_m" integer NOT NULL,
	"source" text NOT NULL,
	"mock_suspected" boolean DEFAULT false NOT NULL,
	"landmark" text,
	"circle_center" geography(Point,4326) NOT NULL,
	"zone_cell" text NOT NULL,
	"share_exact" boolean DEFAULT false NOT NULL,
	"exact_audience" text DEFAULT 'connections' NOT NULL,
	"count_in_zone" boolean DEFAULT false NOT NULL,
	"use_for_verify" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"signboard_media_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_locations_source_valid" CHECK ("ustaad_locations"."source" in ('gps','manual')),
	CONSTRAINT "ustaad_locations_audience_valid" CHECK ("ustaad_locations"."exact_audience" in ('connections','all_verified')),
	CONSTRAINT "ustaad_locations_accuracy" CHECK ("ustaad_locations"."accuracy_m" between 0 and 100000),
	CONSTRAINT "ustaad_locations_zone_format" CHECK ("ustaad_locations"."zone_cell" ~ '^hx:-?[0-9]+:-?[0-9]+$'),
	CONSTRAINT "ustaad_locations_landmark_len" CHECK ("ustaad_locations"."landmark" is null or char_length("ustaad_locations"."landmark") <= 120)
);
--> statement-breakpoint
CREATE TABLE "ustaad_pin_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"distance_m" integer NOT NULL,
	"accuracy_m" smallint NOT NULL,
	CONSTRAINT "ustaad_pin_changes_values" CHECK ("ustaad_pin_changes"."distance_m" >= 0 and "ustaad_pin_changes"."accuracy_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_zone_counts" (
	"zone_cell" text PRIMARY KEY NOT NULL,
	"city_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"members" integer NOT NULL,
	"by_segment" jsonb DEFAULT '{"schema_version":1}'::jsonb NOT NULL,
	"center" geography(Point,4326) NOT NULL,
	CONSTRAINT "ustaad_zone_counts_members" CHECK ("ustaad_zone_counts"."members" >= 0),
	CONSTRAINT "ustaad_zone_counts_zone_format" CHECK ("ustaad_zone_counts"."zone_cell" ~ '^hx:-?[0-9]+:-?[0-9]+$'),
	CONSTRAINT "ustaad_zone_counts_versioned" CHECK ("ustaad_zone_counts"."by_segment" ? 'schema_version')
);
--> statement-breakpoint
CREATE TABLE "ustaad_job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"share_phone" boolean DEFAULT false NOT NULL,
	"voice_intro_media_id" uuid,
	"closed_reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_job_applications_status_valid" CHECK ("ustaad_job_applications"."status" in ('applied','seen','shortlisted','hired','rejected','withdrawn','closed')),
	CONSTRAINT "ustaad_job_applications_closed_reason" CHECK ("ustaad_job_applications"."status" <> 'closed' or "ustaad_job_applications"."closed_reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "ustaad_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"employer_member_id" uuid NOT NULL,
	"workshop_id" uuid,
	"trade_account_id" uuid,
	"city_id" uuid NOT NULL,
	"area_label" text NOT NULL,
	"area_label_hi" text,
	"role_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"pay_min_paise_month" bigint NOT NULL,
	"pay_max_paise_month" bigint NOT NULL,
	"timing" text NOT NULL,
	"experience_min_years" smallint DEFAULT 0 NOT NULL,
	"segment_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"adult_attested_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"held_reason_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"idem_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_jobs_code_format" CHECK ("ustaad_jobs"."code" ~ '^UJ-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'),
	CONSTRAINT "ustaad_jobs_role_valid" CHECK ("ustaad_jobs"."role_code" in ('helper','mechanic_2w','mechanic_4w','electrician','ac_technician','denter_painter','tyre_technician','other')),
	CONSTRAINT "ustaad_jobs_status_valid" CHECK ("ustaad_jobs"."status" in ('draft','pending_review','open','paused','filled','closed','expired','removed')),
	CONSTRAINT "ustaad_jobs_segments_valid" CHECK ("ustaad_jobs"."segment_codes" <@ array['two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev']::text[]),
	CONSTRAINT "ustaad_jobs_pay" CHECK ("ustaad_jobs"."pay_min_paise_month" > 0 and "ustaad_jobs"."pay_max_paise_month" > 0 and "ustaad_jobs"."pay_min_paise_month" <= "ustaad_jobs"."pay_max_paise_month"),
	CONSTRAINT "ustaad_jobs_one_employer" CHECK (num_nonnulls("ustaad_jobs"."workshop_id", "ustaad_jobs"."trade_account_id") = 1),
	CONSTRAINT "ustaad_jobs_experience" CHECK ("ustaad_jobs"."experience_min_years" between 0 and 40),
	CONSTRAINT "ustaad_jobs_len" CHECK (char_length("ustaad_jobs"."title") between 3 and 120 and char_length("ustaad_jobs"."description") between 10 and 2000 and char_length("ustaad_jobs"."timing") between 2 and 80)
);
--> statement-breakpoint
ALTER TABLE "ustaad_locations" ADD CONSTRAINT "ustaad_locations_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_locations" ADD CONSTRAINT "ustaad_locations_signboard_media_id_ustaad_media_id_fk" FOREIGN KEY ("signboard_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_pin_changes" ADD CONSTRAINT "ustaad_pin_changes_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_zone_counts" ADD CONSTRAINT "ustaad_zone_counts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_job_applications" ADD CONSTRAINT "ustaad_job_applications_job_id_ustaad_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ustaad_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_job_applications" ADD CONSTRAINT "ustaad_job_applications_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_job_applications" ADD CONSTRAINT "ustaad_job_applications_voice_intro_media_id_ustaad_media_id_fk" FOREIGN KEY ("voice_intro_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_jobs" ADD CONSTRAINT "ustaad_jobs_employer_member_id_ustaad_members_id_fk" FOREIGN KEY ("employer_member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_jobs" ADD CONSTRAINT "ustaad_jobs_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_jobs" ADD CONSTRAINT "ustaad_jobs_trade_account_id_trade_accounts_id_fk" FOREIGN KEY ("trade_account_id") REFERENCES "public"."trade_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_jobs" ADD CONSTRAINT "ustaad_jobs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_locations_location_gix" ON "ustaad_locations" USING gist ("location");--> statement-breakpoint
CREATE INDEX "ustaad_locations_circle_gix" ON "ustaad_locations" USING gist ("circle_center");--> statement-breakpoint
CREATE INDEX "ustaad_locations_zone_cell_index" ON "ustaad_locations" USING btree ("zone_cell");--> statement-breakpoint
CREATE INDEX "ustaad_locations_signboard_media_id_index" ON "ustaad_locations" USING btree ("signboard_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_pin_changes_member_id_changed_at_index" ON "ustaad_pin_changes" USING btree ("member_id","changed_at");--> statement-breakpoint
CREATE INDEX "ustaad_zone_counts_city_id_index" ON "ustaad_zone_counts" USING btree ("city_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_job_applications_uq" ON "ustaad_job_applications" USING btree ("job_id","member_id");--> statement-breakpoint
CREATE INDEX "ustaad_job_applications_member_id_created_at_index" ON "ustaad_job_applications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_job_applications_job_id_status_index" ON "ustaad_job_applications" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_job_applications_voice_intro_media_id_index" ON "ustaad_job_applications" USING btree ("voice_intro_media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_jobs_code_uq" ON "ustaad_jobs" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_jobs_idem_uq" ON "ustaad_jobs" USING btree ("employer_member_id","idem_key") WHERE "ustaad_jobs"."idem_key" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_jobs_city_id_status_created_at_index" ON "ustaad_jobs" USING btree ("city_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_jobs_employer_member_id_created_at_index" ON "ustaad_jobs" USING btree ("employer_member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_jobs_workshop_id_index" ON "ustaad_jobs" USING btree ("workshop_id");--> statement-breakpoint
CREATE INDEX "ustaad_jobs_trade_account_id_index" ON "ustaad_jobs" USING btree ("trade_account_id");--> statement-breakpoint
CREATE INDEX "ustaad_jobs_expiring_idx" ON "ustaad_jobs" USING btree ("expires_at") WHERE "ustaad_jobs"."status" in ('open','paused');--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_locations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_pin_changes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_zone_counts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_job_applications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_locations, public.ustaad_pin_changes, public.ustaad_zone_counts, public.ustaad_job_applications, public.ustaad_jobs FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_locations_bump_version BEFORE UPDATE ON public.ustaad_locations
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_locations_touch_updated_at BEFORE UPDATE ON public.ustaad_locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_pin_changes_append_only BEFORE UPDATE OR DELETE ON public.ustaad_pin_changes
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER ustaad_job_applications_bump_version BEFORE UPDATE ON public.ustaad_job_applications
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_job_applications_touch_updated_at BEFORE UPDATE ON public.ustaad_job_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_jobs_bump_version BEFORE UPDATE ON public.ustaad_jobs
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_jobs_touch_updated_at BEFORE UPDATE ON public.ustaad_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
