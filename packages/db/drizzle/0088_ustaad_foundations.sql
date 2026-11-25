CREATE TABLE "ustaad_application_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"prefill" jsonb DEFAULT '{"schema_version":1}'::jsonb NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"member_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_application_links_status_valid" CHECK ("ustaad_application_links"."status" in ('invited','joined','closed')),
	CONSTRAINT "ustaad_application_links_phone_hash" CHECK ("ustaad_application_links"."phone_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ustaad_application_links_joined_member" CHECK (("ustaad_application_links"."status" = 'joined') = ("ustaad_application_links"."member_id" is not null)),
	CONSTRAINT "ustaad_application_links_prefill_versioned" CHECK ("ustaad_application_links"."prefill" ? 'schema_version')
);
--> statement-breakpoint
CREATE TABLE "ustaad_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason_code" text,
	"actor_id" uuid,
	"actor_role" text NOT NULL,
	"city_id" uuid,
	"props" jsonb DEFAULT '{"schema_version":1}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_events_entity_valid" CHECK ("ustaad_events"."entity_type" in ('member','verification','attestation','vouch','post','question','answer','comment','report','job','application','mentorship','connection','message_thread','media','location')),
	CONSTRAINT "ustaad_events_kind_format" CHECK ("ustaad_events"."kind" ~ '^[a-z][a-z0-9_]{1,60}$'),
	CONSTRAINT "ustaad_events_actor_role_format" CHECK ("ustaad_events"."actor_role" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "ustaad_events_props_versioned" CHECK ("ustaad_events"."props" ? 'schema_version')
);
--> statement-breakpoint
CREATE TABLE "ustaad_member_specialities" (
	"member_id" uuid NOT NULL,
	"code" text NOT NULL,
	"step" text DEFAULT 'shuru' NOT NULL,
	"earned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_member_specialities_member_id_code_pk" PRIMARY KEY("member_id","code"),
	CONSTRAINT "ustaad_member_specialities_code_valid" CHECK ("ustaad_member_specialities"."code" in ('two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev','engine','electrical','ac','diagnostics','tyres','battery','denting_painting','suspension_brakes')),
	CONSTRAINT "ustaad_member_specialities_step_valid" CHECK ("ustaad_member_specialities"."step" in ('shuru','pakka','mahir'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"display_name_hi" text,
	"photo_media_id" uuid,
	"track" text NOT NULL,
	"level" text NOT NULL,
	"level_since" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"banned_until" timestamp with time zone,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"restricted_mode" text DEFAULT 'none' NOT NULL,
	"perks_frozen_until" timestamp with time zone,
	"city_id" uuid NOT NULL,
	"area_label" text NOT NULL,
	"area_label_hi" text,
	"pincode" text NOT NULL,
	"work_place" text NOT NULL,
	"garage_name" text,
	"show_garage" boolean DEFAULT false NOT NULL,
	"workshop_id" uuid,
	"years_claimed" smallint DEFAULT 0 NOT NULL,
	"verified_years" smallint,
	"dm_mode" text DEFAULT 'request' NOT NULL,
	"suggest_me" boolean DEFAULT true NOT NULL,
	"correction_mode" text,
	"lang" text DEFAULT 'hi' NOT NULL,
	"data_saver" boolean DEFAULT true NOT NULL,
	"official" boolean DEFAULT false NOT NULL,
	"founding" boolean DEFAULT false NOT NULL,
	"source_application_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ustaad_members_handle_format" CHECK ("ustaad_members"."handle" ~ '^[a-z0-9_]{3,24}$'),
	CONSTRAINT "ustaad_members_track_valid" CHECK ("ustaad_members"."track" in ('apprentice','ustaad')),
	CONSTRAINT "ustaad_members_level_valid" CHECK ("ustaad_members"."level" in ('apprentice','ustaad_pending','naya','pakka','bada','master')),
	CONSTRAINT "ustaad_members_level_track" CHECK (("ustaad_members"."track" = 'apprentice' and "ustaad_members"."level" = 'apprentice') or ("ustaad_members"."track" = 'ustaad' and "ustaad_members"."level" <> 'apprentice')),
	CONSTRAINT "ustaad_members_status_valid" CHECK ("ustaad_members"."status" in ('active','restricted','banned','left')),
	CONSTRAINT "ustaad_members_verification_valid" CHECK ("ustaad_members"."verification_state" in ('unverified','pending_verification','verified','revoked')),
	CONSTRAINT "ustaad_members_restricted_valid" CHECK ("ustaad_members"."restricted_mode" in ('none','minor_report','review')),
	CONSTRAINT "ustaad_members_work_place_valid" CHECK ("ustaad_members"."work_place" in ('shop','home_roadside')),
	CONSTRAINT "ustaad_members_dm_mode_valid" CHECK ("ustaad_members"."dm_mode" in ('everyone','request','nobody')),
	CONSTRAINT "ustaad_members_correction_valid" CHECK ("ustaad_members"."correction_mode" is null or "ustaad_members"."correction_mode" in ('suggest','auto','off')),
	CONSTRAINT "ustaad_members_lang_valid" CHECK ("ustaad_members"."lang" in ('hi','en')),
	CONSTRAINT "ustaad_members_pincode_format" CHECK ("ustaad_members"."pincode" ~ '^[1-9][0-9]{5}$'),
	CONSTRAINT "ustaad_members_years" CHECK ("ustaad_members"."years_claimed" between 0 and 60),
	CONSTRAINT "ustaad_members_verified_years" CHECK ("ustaad_members"."verified_years" is null or "ustaad_members"."verified_years" between 0 and 60),
	CONSTRAINT "ustaad_members_left_at" CHECK (("ustaad_members"."status" = 'left') = ("ustaad_members"."left_at" is not null)),
	CONSTRAINT "ustaad_members_banned_until" CHECK ("ustaad_members"."banned_until" is null or "ustaad_members"."status" = 'banned')
);
--> statement-breakpoint
CREATE TABLE "ustaad_reach_cities" (
	"city_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ustaad_reserved_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"skeleton" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_reserved_names_len" CHECK (char_length("ustaad_reserved_names"."name") between 2 and 60)
);
--> statement-breakpoint
CREATE TABLE "ustaad_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_member_id" uuid NOT NULL,
	"host" text NOT NULL,
	"bucket" text DEFAULT 'quarantine' NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"declared_mime" text NOT NULL,
	"sha256" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"object_key" text NOT NULL,
	"upload_id" text,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"reject_reason_code" text,
	"removed_retain_until" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"legal_hold" text,
	"lqip" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_media_host_valid" CHECK ("ustaad_media"."host" in ('r2','supabase')),
	CONSTRAINT "ustaad_media_bucket_valid" CHECK ("ustaad_media"."bucket" in ('quarantine','media','docs','evidence')),
	CONSTRAINT "ustaad_media_kind_valid" CHECK ("ustaad_media"."kind" in ('image','video','audio','document')),
	CONSTRAINT "ustaad_media_status_valid" CHECK ("ustaad_media"."status" in ('pending_upload','uploaded','verified','rejected','removed_archived','purged')),
	CONSTRAINT "ustaad_media_mime_per_kind" CHECK ((kind = 'image' and declared_mime in ('image/webp','image/jpeg')) or (kind = 'video' and declared_mime in ('video/mp4','video/webm')) or (kind = 'audio' and declared_mime in ('audio/ogg','audio/webm','audio/mp4')) or (kind = 'document' and declared_mime in ('application/pdf'))),
	CONSTRAINT "ustaad_media_bytes_cap" CHECK ("ustaad_media"."declared_bytes" > 0 and ((kind = 'image' and declared_bytes <= 3145728) or (kind = 'video' and declared_bytes <= 157286400) or (kind = 'audio' and declared_bytes <= 10485760) or (kind = 'document' and declared_bytes <= 5242880))),
	CONSTRAINT "ustaad_media_sha256" CHECK ("ustaad_media"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ustaad_media_object_key_format" CHECK ("ustaad_media"."object_key" ~ '^[qmde]/[0-9a-f-]{36}/[0-9a-f-]{36}[.](webp|jpg|mp4|webm|ogg|m4a|pdf)$'),
	CONSTRAINT "ustaad_media_reject_reason_valid" CHECK ("ustaad_media"."reject_reason_code" is null or "ustaad_media"."reject_reason_code" in ('size_mismatch','type_mismatch','magic_mismatch','too_long','too_large','location_atom','external_reference','decompression_bomb','expired_upload','unreadable')),
	CONSTRAINT "ustaad_media_rejected_reason" CHECK (("ustaad_media"."status" = 'rejected') = ("ustaad_media"."reject_reason_code" is not null)),
	CONSTRAINT "ustaad_media_duration" CHECK ("ustaad_media"."duration_ms" is null or "ustaad_media"."duration_ms" between 1 and 600000),
	CONSTRAINT "ustaad_media_lqip_size" CHECK ("ustaad_media"."lqip" is null or octet_length("ustaad_media"."lqip") <= 400)
);
--> statement-breakpoint
CREATE TABLE "ustaad_media_totals" (
	"kind" text PRIMARY KEY NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_media_totals_kind_valid" CHECK ("ustaad_media_totals"."kind" in ('image','video','audio','document')),
	CONSTRAINT "ustaad_media_totals_non_negative" CHECK ("ustaad_media_totals"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_media_usage" (
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"uploads" integer DEFAULT 0 NOT NULL,
	"videos" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_media_usage_member_id_day_pk" PRIMARY KEY("member_id","day"),
	CONSTRAINT "ustaad_media_usage_non_negative" CHECK ("ustaad_media_usage"."bytes" >= 0 and "ustaad_media_usage"."uploads" >= 0 and "ustaad_media_usage"."videos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_media_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"object_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_media_variants_valid" CHECK ("ustaad_media_variants"."variant" in ('img_1080','img_480','thumb','poster')),
	CONSTRAINT "ustaad_media_variants_bytes" CHECK ("ustaad_media_variants"."bytes" > 0 and "ustaad_media_variants"."bytes" <= 3145728)
);
--> statement-breakpoint
ALTER TABLE "consents" DROP CONSTRAINT "consents_purpose_valid";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_valid";--> statement-breakpoint
ALTER TABLE "ustaad_application_links" ADD CONSTRAINT "ustaad_application_links_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_application_links" ADD CONSTRAINT "ustaad_application_links_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_events" ADD CONSTRAINT "ustaad_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_events" ADD CONSTRAINT "ustaad_events_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_member_specialities" ADD CONSTRAINT "ustaad_member_specialities_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_photo_media_id_ustaad_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_source_application_id_partner_applications_id_fk" FOREIGN KEY ("source_application_id") REFERENCES "public"."partner_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_members" ADD CONSTRAINT "ustaad_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reach_cities" ADD CONSTRAINT "ustaad_reach_cities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reach_cities" ADD CONSTRAINT "ustaad_reach_cities_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reserved_names" ADD CONSTRAINT "ustaad_reserved_names_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_media" ADD CONSTRAINT "ustaad_media_owner_member_id_ustaad_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_media_usage" ADD CONSTRAINT "ustaad_media_usage_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_media_variants" ADD CONSTRAINT "ustaad_media_variants_media_id_ustaad_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_application_links_application_uq" ON "ustaad_application_links" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "ustaad_application_links_phone_hash_index" ON "ustaad_application_links" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "ustaad_application_links_member_id_index" ON "ustaad_application_links" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ustaad_events_entity_type_entity_id_occurred_at_index" ON "ustaad_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ustaad_events_occurred_brin" ON "ustaad_events" USING brin ("occurred_at");--> statement-breakpoint
CREATE INDEX "ustaad_events_actor_id_index" ON "ustaad_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ustaad_events_city_id_index" ON "ustaad_events" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "ustaad_member_specialities_code_step_index" ON "ustaad_member_specialities" USING btree ("code","step");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_members_user_uq" ON "ustaad_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_members_handle_uq" ON "ustaad_members" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "ustaad_members_city_id_level_index" ON "ustaad_members" USING btree ("city_id","level");--> statement-breakpoint
CREATE INDEX "ustaad_members_status_index" ON "ustaad_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ustaad_members_last_active_at_index" ON "ustaad_members" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "ustaad_members_workshop_id_index" ON "ustaad_members" USING btree ("workshop_id");--> statement-breakpoint
CREATE INDEX "ustaad_members_photo_media_id_index" ON "ustaad_members" USING btree ("photo_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_members_source_application_id_index" ON "ustaad_members" USING btree ("source_application_id");--> statement-breakpoint
CREATE INDEX "ustaad_members_created_by_index" ON "ustaad_members" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ustaad_reach_cities_updated_by_index" ON "ustaad_reach_cities" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_reserved_names_skeleton_uq" ON "ustaad_reserved_names" USING btree ("skeleton");--> statement-breakpoint
CREATE INDEX "ustaad_reserved_names_created_by_index" ON "ustaad_reserved_names" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_media_object_key_uq" ON "ustaad_media" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "ustaad_media_owner_member_id_created_at_index" ON "ustaad_media" USING btree ("owner_member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_media_pending_idx" ON "ustaad_media" USING btree ("upload_expires_at") WHERE "ustaad_media"."status" = 'pending_upload';--> statement-breakpoint
CREATE INDEX "ustaad_media_purge_idx" ON "ustaad_media" USING btree ("purge_after") WHERE "ustaad_media"."purge_after" is not null and "ustaad_media"."status" <> 'purged';--> statement-breakpoint
CREATE INDEX "ustaad_media_usage_day_index" ON "ustaad_media_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_media_variants_uq" ON "ustaad_media_variants" USING btree ("media_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_media_variants_key_uq" ON "ustaad_media_variants" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_purpose_valid" CHECK ("consents"."purpose" in ('account','marketing','analytics','location','share_with_partner','whatsapp','ustaad_profile','ustaad_directory','ustaad_training','ustaad_offers','ustaad_location_verify','ustaad_zone_count','ustaad_exact_pin','ustaad_voice','ustaad_correction','ustaad_ml_training'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_valid" CHECK ("notifications"."entity_type" is null or "notifications"."entity_type" in ('order','service_request','rsa_request','quote','ticket','refund','shop','application','account','ustaad'));--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_application_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_member_specialities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_reach_cities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_reserved_names ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_media ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_media_totals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_media_usage ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_media_variants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_application_links, public.ustaad_events, public.ustaad_member_specialities, public.ustaad_members, public.ustaad_reach_cities, public.ustaad_reserved_names, public.ustaad_media, public.ustaad_media_totals, public.ustaad_media_usage, public.ustaad_media_variants FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_application_links_bump_version BEFORE UPDATE ON public.ustaad_application_links
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_application_links_touch_updated_at BEFORE UPDATE ON public.ustaad_application_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_events_append_only BEFORE UPDATE OR DELETE ON public.ustaad_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER ustaad_members_bump_version BEFORE UPDATE ON public.ustaad_members
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_members_touch_updated_at BEFORE UPDATE ON public.ustaad_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_reach_cities_bump_version BEFORE UPDATE ON public.ustaad_reach_cities
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_reach_cities_touch_updated_at BEFORE UPDATE ON public.ustaad_reach_cities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_reserved_names_bump_version BEFORE UPDATE ON public.ustaad_reserved_names
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_reserved_names_touch_updated_at BEFORE UPDATE ON public.ustaad_reserved_names
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_media_bump_version BEFORE UPDATE ON public.ustaad_media
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_media_touch_updated_at BEFORE UPDATE ON public.ustaad_media
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_media_totals_touch_updated_at BEFORE UPDATE ON public.ustaad_media_totals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_media_usage_touch_updated_at BEFORE UPDATE ON public.ustaad_media_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- One budget row per media kind (conditional increments only; spec 23 § 10 step 5).
INSERT INTO public.ustaad_media_totals (kind) VALUES ('image'), ('video'), ('audio'), ('document') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Default reach (spec 23 § 15): the Chhattisgarh cities that exist in this database; the admin edits the list.
INSERT INTO public.ustaad_reach_cities (city_id)
  SELECT c.id FROM public.cities c
  WHERE c.slug IN ('raipur','bilaspur','durg','bhilai','durg-bhilai','korba','rajnandgaon','jagdalpur','ambikapur')
  ON CONFLICT DO NOTHING;
