SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "delivery_agent_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number_enc" text NOT NULL,
	"number_index" text NOT NULL,
	"number_last4" text NOT NULL,
	"media_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reject_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_agent_documents_kind_valid" CHECK ("delivery_agent_documents"."kind" in ('pan','driving_licence','vehicle_rc')),
	CONSTRAINT "delivery_agent_documents_status_valid" CHECK ("delivery_agent_documents"."status" in ('submitted','verified','rejected')),
	CONSTRAINT "delivery_agent_documents_encrypted" CHECK ("delivery_agent_documents"."number_enc" is null or "delivery_agent_documents"."number_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "delivery_agent_documents_last4" CHECK ("delivery_agent_documents"."number_last4" ~ '^[0-9A-Z]{4}$'),
	CONSTRAINT "delivery_agent_documents_reject_reason" CHECK (("delivery_agent_documents"."status" = 'rejected') = ("delivery_agent_documents"."reject_reason" is not null) and ("delivery_agent_documents"."reject_reason" is null or "delivery_agent_documents"."reject_reason" in ('unreadable','name_mismatch','expired','wrong_document','number_mismatch','other'))),
	CONSTRAINT "delivery_agent_documents_reviewed" CHECK ("delivery_agent_documents"."status" = 'submitted' or ("delivery_agent_documents"."reviewed_by" is not null and "delivery_agent_documents"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "delivery_agent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delivery_agent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason_code" text,
	"note" text,
	"document_kind" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_agent_events_kind_valid" CHECK ("delivery_agent_events"."kind" in ('joined','status','document_submitted','document_verified','document_rejected','online','offline','vehicle','document_viewed')),
	CONSTRAINT "delivery_agent_events_actor_valid" CHECK ("delivery_agent_events"."actor_type" in ('delivery_agent','admin','system')),
	CONSTRAINT "delivery_agent_events_status_valid" CHECK (("delivery_agent_events"."from_status" is null or "delivery_agent_events"."from_status" in ('onboarding','active','paused','suspended','offboarded')) and ("delivery_agent_events"."to_status" is null or "delivery_agent_events"."to_status" in ('onboarding','active','paused','suspended','offboarded'))),
	CONSTRAINT "delivery_agent_events_document_kind" CHECK ("delivery_agent_events"."document_kind" is null or "delivery_agent_events"."document_kind" in ('pan','driving_licence','vehicle_rc'))
);
--> statement-breakpoint
CREATE TABLE "delivery_agent_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" "citext",
	"city_id" uuid NOT NULL,
	"vehicle_type" text NOT NULL,
	"application_id" uuid,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_agent_invites_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "delivery_agent_invites_status_valid" CHECK ("delivery_agent_invites"."status" in ('sent','used','expired','revoked')),
	CONSTRAINT "delivery_agent_invites_vehicle_valid" CHECK ("delivery_agent_invites"."vehicle_type" in ('bike','scooter','three_wheeler','goods_vehicle')),
	CONSTRAINT "delivery_agent_invites_token_hash" CHECK ("delivery_agent_invites"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "delivery_agent_invites_phone" CHECK ("delivery_agent_invites"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "delivery_agent_invites_used" CHECK (("delivery_agent_invites"."status" = 'used') = ("delivery_agent_invites"."used_at" is not null and "delivery_agent_invites"."used_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "delivery_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"status_reason" text,
	"status_note" text,
	"status_changed_by" uuid,
	"status_changed_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"online" boolean DEFAULT false NOT NULL,
	"last_online_at" timestamp with time zone,
	"home_location" geography(Point,4326),
	"invite_id" uuid,
	"application_id" uuid,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"offboarded_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_agents_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "delivery_agents_status_valid" CHECK ("delivery_agents"."status" in ('onboarding','active','paused','suspended','offboarded')),
	CONSTRAINT "delivery_agents_vehicle_valid" CHECK ("delivery_agents"."vehicle_type" in ('bike','scooter','three_wheeler','goods_vehicle')),
	CONSTRAINT "delivery_agents_phone" CHECK ("delivery_agents"."phone" ~ '^\+91[6-9][0-9]{9}$'),
	CONSTRAINT "delivery_agents_reason_valid" CHECK ("delivery_agents"."status_reason" is null or "delivery_agents"."status_reason" in ('documents_expired','documents_invalid','customer_complaint','repeated_declines','repeated_failures','safety_incident','fraud_suspected','agent_request','inactive','other')),
	CONSTRAINT "delivery_agents_standing_has_reason" CHECK ("delivery_agents"."status" not in ('paused','suspended','offboarded') or ("delivery_agents"."status_reason" is not null and "delivery_agents"."status_changed_by" is not null)),
	CONSTRAINT "delivery_agents_online_active" CHECK (not "delivery_agents"."online" or "delivery_agents"."status" = 'active'),
	CONSTRAINT "delivery_agents_active_verified" CHECK ("delivery_agents"."status" <> 'active' or "delivery_agents"."verified_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "delivery_handover_codes" (
	"job_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_enc" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_handover_codes_job_id_purpose_pk" PRIMARY KEY("job_id","purpose"),
	CONSTRAINT "delivery_handover_codes_purpose" CHECK ("delivery_handover_codes"."purpose" in ('pickup','return')),
	CONSTRAINT "delivery_handover_codes_attempts" CHECK ("delivery_handover_codes"."attempts" between 0 and 5),
	CONSTRAINT "delivery_handover_codes_encrypted" CHECK ("delivery_handover_codes"."code_enc" is null or "delivery_handover_codes"."code_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_job_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delivery_job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason_code" text,
	"offer_id" uuid,
	"agent_id" uuid,
	"media_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_job_events_kind_valid" CHECK ("delivery_job_events"."kind" in ('created','status','offered','offer_declined','offer_expired','offer_withdrawn','offer_given_up','contact_revealed','photo','code_wrong','code_locked','override')),
	CONSTRAINT "delivery_job_events_actor_valid" CHECK ("delivery_job_events"."actor_type" in ('delivery_agent','shop','admin','system')),
	CONSTRAINT "delivery_job_events_status_valid" CHECK (("delivery_job_events"."from_status" is null or "delivery_job_events"."from_status" in ('needs_agent','offered','accepted','picked_up','delivered','failed','returning','returned','cancelled')) and ("delivery_job_events"."to_status" is null or "delivery_job_events"."to_status" in ('needs_agent','offered','accepted','picked_up','delivered','failed','returning','returned','cancelled')))
);
--> statement-breakpoint
CREATE TABLE "delivery_job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"offered_by" uuid,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"reason_code" text,
	"note" text,
	"distance_m" integer,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "delivery_job_offers_status_valid" CHECK ("delivery_job_offers"."status" in ('offered','accepted','declined','expired','withdrawn','given_up')),
	CONSTRAINT "delivery_job_offers_expiry_after_offer" CHECK ("delivery_job_offers"."expires_at" > "delivery_job_offers"."offered_at"),
	CONSTRAINT "delivery_job_offers_reason" CHECK (case "delivery_job_offers"."status"
        when 'declined' then "delivery_job_offers"."reason_code" in ('too_far','vehicle_unsuitable','busy','going_offline','other')
        when 'given_up' then "delivery_job_offers"."reason_code" in ('vehicle_issue','emergency','shop_closed','parcel_not_ready','other')
        when 'withdrawn' then "delivery_job_offers"."reason_code" is null or "delivery_job_offers"."reason_code" in ('agent_unresponsive','reassigning','order_changed','other')
        else "delivery_job_offers"."reason_code" is null end)
);
--> statement-breakpoint
CREATE TABLE "delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" text DEFAULT 'needs_agent' NOT NULL,
	"seq" smallint DEFAULT 1 NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"load_weight_g" integer DEFAULT 0 NOT NULL,
	"load_class" text DEFAULT 'light' NOT NULL,
	"unknown_weight" boolean DEFAULT false NOT NULL,
	"pickup_photo_id" uuid,
	"delivery_photo_id" uuid,
	"fail_photo_id" uuid,
	"fail_reason" text,
	"fail_note" text,
	"return_outcome" text,
	"cancel_reason" text,
	"accepted_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"override_kind" text,
	"override_reason" text,
	"override_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_jobs_status_valid" CHECK ("delivery_jobs"."status" in ('needs_agent','offered','accepted','picked_up','delivered','failed','returning','returned','cancelled')),
	CONSTRAINT "delivery_jobs_load_class_valid" CHECK ("delivery_jobs"."load_class" in ('light','heavy','bulky')),
	CONSTRAINT "delivery_jobs_load_nonneg" CHECK ("delivery_jobs"."load_weight_g" >= 0 and "delivery_jobs"."seq" >= 1 and "delivery_jobs"."failed_attempts" >= 0),
	CONSTRAINT "delivery_jobs_agent_when_held" CHECK ("delivery_jobs"."status" in ('needs_agent','offered','cancelled') or "delivery_jobs"."agent_id" is not null),
	CONSTRAINT "delivery_jobs_fail_reason_valid" CHECK ("delivery_jobs"."fail_reason" is null or "delivery_jobs"."fail_reason" in ('customer_unreachable','customer_refused','wrong_address','unsafe_location','vehicle_issue','other')),
	CONSTRAINT "delivery_jobs_failed_explained" CHECK ("delivery_jobs"."status" <> 'failed' or "delivery_jobs"."fail_reason" is not null),
	CONSTRAINT "delivery_jobs_return_outcome" CHECK (("delivery_jobs"."status" = 'returned') = ("delivery_jobs"."return_outcome" is not null) and ("delivery_jobs"."return_outcome" is null or "delivery_jobs"."return_outcome" in ('retry','close'))),
	CONSTRAINT "delivery_jobs_override" CHECK ("delivery_jobs"."override_kind" is null or ("delivery_jobs"."override_kind" in ('override_pickup','override_delivery','override_return') and char_length("delivery_jobs"."override_reason") between 5 and 300 and "delivery_jobs"."override_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "order_delivery_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"decline_reason" text,
	"decline_note" text,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_switches_status_valid" CHECK ("order_delivery_switches"."status" in ('requested','confirmed','declined','withdrawn')),
	CONSTRAINT "order_delivery_switches_reason_valid" CHECK ("order_delivery_switches"."reason_code" in ('no_vehicle_for_load','no_agent_available','repeated_failures','customer_request','other')),
	CONSTRAINT "order_delivery_switches_decline" CHECK (("order_delivery_switches"."status" = 'declined') = ("order_delivery_switches"."decline_reason" is not null) and ("order_delivery_switches"."decline_reason" is null or "order_delivery_switches"."decline_reason" in ('no_rider','too_far','too_busy','other')))
);
--> statement-breakpoint
CREATE TABLE "shop_delivery_mode_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"requested_mode" text NOT NULL,
	"source" text DEFAULT 'shop' NOT NULL,
	"reason_code" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"decision_note" text,
	"requested_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_delivery_mode_requests_mode_valid" CHECK ("shop_delivery_mode_requests"."requested_mode" in ('agents','self')),
	CONSTRAINT "shop_delivery_mode_requests_source_valid" CHECK ("shop_delivery_mode_requests"."source" in ('shop','staff')),
	CONSTRAINT "shop_delivery_mode_requests_status_valid" CHECK ("shop_delivery_mode_requests"."status" in ('pending','approved','rejected','withdrawn')),
	CONSTRAINT "shop_delivery_mode_requests_reason" CHECK ("shop_delivery_mode_requests"."source" = 'staff' or "shop_delivery_mode_requests"."reason_code" in ('own_riders','faster_local_delivery','customer_relationship','agents_unreliable','other')),
	CONSTRAINT "shop_delivery_mode_requests_decision" CHECK (("shop_delivery_mode_requests"."status" = 'rejected') = ("shop_delivery_mode_requests"."decision_reason" is not null) and ("shop_delivery_mode_requests"."decision_reason" is null or "shop_delivery_mode_requests"."decision_reason" in ('agents_cover_area','service_quality','incomplete_request','other')))
);
--> statement-breakpoint
ALTER TABLE "order_events" DROP CONSTRAINT "order_events_actor_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_reason_code_valid";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_mode_valid";--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_courier_awb";--> statement-breakpoint
ALTER TABLE "partner_applications" DROP CONSTRAINT "partner_applications_kind_valid";--> statement-breakpoint
ALTER TABLE "partner_applications" DROP CONSTRAINT "partner_applications_pincode";--> statement-breakpoint
ALTER TABLE "partner_applications" DROP CONSTRAINT "partner_applications_details_for_others";--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_owner_kind_valid";--> statement-breakpoint
ALTER TABLE "partner_applications" ALTER COLUMN "pincode" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "load_class" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "delivery_mode" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_mode" text DEFAULT 'shop' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "vehicle_type" text;--> statement-breakpoint
ALTER TABLE "delivery_agent_documents" ADD CONSTRAINT "delivery_agent_documents_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_documents" ADD CONSTRAINT "delivery_agent_documents_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_documents" ADD CONSTRAINT "delivery_agent_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_events" ADD CONSTRAINT "delivery_agent_events_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_invites" ADD CONSTRAINT "delivery_agent_invites_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_invites" ADD CONSTRAINT "delivery_agent_invites_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_invites" ADD CONSTRAINT "delivery_agent_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_invites" ADD CONSTRAINT "delivery_agent_invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_invite_id_delivery_agent_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."delivery_agent_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_handover_codes" ADD CONSTRAINT "delivery_handover_codes_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_offer_id_delivery_job_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."delivery_job_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_offers" ADD CONSTRAINT "delivery_job_offers_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_offers" ADD CONSTRAINT "delivery_job_offers_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job_offers" ADD CONSTRAINT "delivery_job_offers_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_pickup_photo_id_media_objects_id_fk" FOREIGN KEY ("pickup_photo_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_delivery_photo_id_media_objects_id_fk" FOREIGN KEY ("delivery_photo_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_fail_photo_id_media_objects_id_fk" FOREIGN KEY ("fail_photo_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_switches" ADD CONSTRAINT "order_delivery_switches_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_switches" ADD CONSTRAINT "order_delivery_switches_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_switches" ADD CONSTRAINT "order_delivery_switches_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_delivery_switches" ADD CONSTRAINT "order_delivery_switches_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_delivery_mode_requests" ADD CONSTRAINT "shop_delivery_mode_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_delivery_mode_requests" ADD CONSTRAINT "shop_delivery_mode_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_delivery_mode_requests" ADD CONSTRAINT "shop_delivery_mode_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_agent_documents_kind_uq" ON "delivery_agent_documents" USING btree ("agent_id","kind");--> statement-breakpoint
CREATE INDEX "delivery_agent_documents_kind_number_index_index" ON "delivery_agent_documents" USING btree ("kind","number_index");--> statement-breakpoint
CREATE INDEX "delivery_agent_documents_media_id_index" ON "delivery_agent_documents" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "delivery_agent_documents_reviewed_by_index" ON "delivery_agent_documents" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX "delivery_agent_documents_queue_idx" ON "delivery_agent_documents" USING btree ("status","created_at") WHERE "delivery_agent_documents"."status" = 'submitted';--> statement-breakpoint
CREATE INDEX "delivery_agent_events_agent_id_created_at_index" ON "delivery_agent_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_agent_events_actor_id_index" ON "delivery_agent_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_agent_invites_one_open_per_phone_uq" ON "delivery_agent_invites" USING btree ("phone") WHERE "delivery_agent_invites"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "delivery_agent_invites_city_id_created_at_id_index" ON "delivery_agent_invites" USING btree ("city_id","created_at","id");--> statement-breakpoint
CREATE INDEX "delivery_agent_invites_status_expires_at_index" ON "delivery_agent_invites" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "delivery_agent_invites_created_by_index" ON "delivery_agent_invites" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "delivery_agent_invites_used_by_index" ON "delivery_agent_invites" USING btree ("used_by");--> statement-breakpoint
CREATE INDEX "delivery_agent_invites_application_id_index" ON "delivery_agent_invites" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "delivery_agents_city_status_online_idx" ON "delivery_agents" USING btree ("city_id","status","online");--> statement-breakpoint
CREATE INDEX "delivery_agents_city_created_idx" ON "delivery_agents" USING btree ("city_id","created_at","id");--> statement-breakpoint
CREATE INDEX "delivery_agents_home_gix" ON "delivery_agents" USING gist ("home_location");--> statement-breakpoint
CREATE INDEX "delivery_agents_status_changed_by_index" ON "delivery_agents" USING btree ("status_changed_by");--> statement-breakpoint
CREATE INDEX "delivery_agents_invite_id_index" ON "delivery_agents" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "delivery_agents_application_id_index" ON "delivery_agents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "delivery_agents_verified_by_index" ON "delivery_agents" USING btree ("verified_by");--> statement-breakpoint
CREATE INDEX "delivery_agents_paused_until_idx" ON "delivery_agents" USING btree ("paused_until") WHERE "delivery_agents"."status" = 'paused' and "delivery_agents"."paused_until" is not null;--> statement-breakpoint
CREATE INDEX "delivery_job_events_job_id_created_at_index" ON "delivery_job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_job_events_order_id_index" ON "delivery_job_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_job_events_offer_id_index" ON "delivery_job_events" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "delivery_job_events_agent_id_created_at_index" ON "delivery_job_events" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_job_events_media_id_index" ON "delivery_job_events" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "delivery_job_events_actor_id_index" ON "delivery_job_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "delivery_job_events_kind_idx" ON "delivery_job_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_job_offers_one_open_uq" ON "delivery_job_offers" USING btree ("job_id") WHERE "delivery_job_offers"."status" in ('offered','accepted');--> statement-breakpoint
CREATE INDEX "delivery_job_offers_expiring_idx" ON "delivery_job_offers" USING btree ("expires_at") WHERE "delivery_job_offers"."status" = 'offered';--> statement-breakpoint
CREATE INDEX "delivery_job_offers_agent_idx" ON "delivery_job_offers" USING btree ("agent_id","status","offered_at");--> statement-breakpoint
CREATE INDEX "delivery_job_offers_job_id_offered_at_index" ON "delivery_job_offers" USING btree ("job_id","offered_at");--> statement-breakpoint
CREATE INDEX "delivery_job_offers_offered_by_index" ON "delivery_job_offers" USING btree ("offered_by");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_jobs_one_active_uq" ON "delivery_jobs" USING btree ("order_id") WHERE "delivery_jobs"."status" in ('needs_agent','offered','accepted','picked_up','failed','returning');--> statement-breakpoint
CREATE INDEX "delivery_jobs_city_status_idx" ON "delivery_jobs" USING btree ("city_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "delivery_jobs_agent_status_idx" ON "delivery_jobs" USING btree ("agent_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "delivery_jobs_order_id_seq_index" ON "delivery_jobs" USING btree ("order_id","seq");--> statement-breakpoint
CREATE INDEX "delivery_jobs_shop_id_index" ON "delivery_jobs" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_pickup_photo_id_index" ON "delivery_jobs" USING btree ("pickup_photo_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_delivery_photo_id_index" ON "delivery_jobs" USING btree ("delivery_photo_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_fail_photo_id_index" ON "delivery_jobs" USING btree ("fail_photo_id");--> statement-breakpoint
CREATE INDEX "delivery_jobs_override_by_index" ON "delivery_jobs" USING btree ("override_by");--> statement-breakpoint
CREATE UNIQUE INDEX "order_delivery_switches_one_open_uq" ON "order_delivery_switches" USING btree ("order_id") WHERE "order_delivery_switches"."status" = 'requested';--> statement-breakpoint
CREATE INDEX "order_delivery_switches_shop_id_status_index" ON "order_delivery_switches" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "order_delivery_switches_requested_by_index" ON "order_delivery_switches" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "order_delivery_switches_decided_by_index" ON "order_delivery_switches" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_delivery_mode_requests_one_pending_uq" ON "shop_delivery_mode_requests" USING btree ("shop_id") WHERE "shop_delivery_mode_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "shop_delivery_mode_requests_status_created_at_index" ON "shop_delivery_mode_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shop_delivery_mode_requests_shop_id_created_at_index" ON "shop_delivery_mode_requests" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "shop_delivery_mode_requests_requested_by_index" ON "shop_delivery_mode_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "shop_delivery_mode_requests_decided_by_index" ON "shop_delivery_mode_requests" USING btree ("decided_by");--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_applications_city_id_index" ON "partner_applications" USING btree ("city_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_load_class_valid" CHECK ("products"."load_class" in ('light','heavy','bulky'));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_delivery_mode_valid" CHECK ("shops"."delivery_mode" in ('agents','self'));--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_valid" CHECK ("order_events"."actor_type" in ('customer','shop','workshop','admin','system','delivery_agent'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_mode_valid" CHECK ("orders"."delivery_mode" in ('agent','shop'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_states" CHECK ("orders"."status" not in ('ready_for_pickup','returned') or "orders"."delivery_mode" = 'agent');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('placed','awaiting_shop','needs_rerouting','confirmed','packed','ready_for_pickup','shipped','out_for_delivery','delivered','cancelled','rejected','returned'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_reason_code_valid" CHECK (case "orders"."status"
        when 'rejected' then "orders"."status_reason_code" in ('no_stock_nearby','all_shops_declined','unserviceable_address','suspected_fraud','pricing_error','other')
        when 'cancelled' then "orders"."status_reason_code" in ('changed_mind','ordered_by_mistake','found_cheaper','delivery_too_slow','customer_unreachable','payment_not_completed','other')
        when 'returned' then "orders"."status_reason_code" in ('customer_unreachable','customer_refused','wrong_address','unsafe_location','vehicle_issue','other')
        else "orders"."status_reason_code" is null end);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_mode_valid" CHECK ("shipments"."mode" in ('own','courier','agent'));--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courier_awb" CHECK ("shipments"."mode" in ('own','agent') or ("shipments"."courier" is not null and "shipments"."awb" is not null));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_agent_complete" CHECK (("partner_applications"."kind" = 'delivery_agent') = ("partner_applications"."city_id" is not null and "partner_applications"."vehicle_type" is not null) and ("partner_applications"."vehicle_type" is null or "partner_applications"."vehicle_type" in ('bike','scooter','three_wheeler','goods_vehicle')));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_pincode_needed" CHECK ("partner_applications"."kind" = 'delivery_agent' or "partner_applications"."pincode" is not null);--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_kind_valid" CHECK ("partner_applications"."kind" in ('seller','garage','mechanic','delivery_agent'));--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_pincode" CHECK ("partner_applications"."pincode" is null or "partner_applications"."pincode" ~ '^[1-9][0-9]{5}$');--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_details_for_others" CHECK ("partner_applications"."kind" in ('seller','delivery_agent') or "partner_applications"."details" is not null);--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_kind_valid" CHECK ("media_objects"."owner_kind" in ('service_photo','ticket_message','product_photo','quote_message','delivery_photo','agent_document'));--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_source_valid";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_valid";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("refunds"."source" in ('order_rejected','order_cancelled','service_cancelled','rsa_cancelled','rsa_overpaid','duplicate_payment','payment_after_close','delivery_returned','unfulfilled','support_claim','part_refund','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_valid" CHECK ("refunds"."reason_code" in ('order_rejected','order_cancelled','service_cancelled','rsa_cancelled','rsa_overpaid','duplicate_payment','payment_after_close','delivery_returned','faulty','damaged_in_transit','wrong_item','missing_item','not_fulfilled','goodwill','other'));--> statement-breakpoint
CREATE TABLE "delivery_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stars" smallint NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"editable_until" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_ratings_jobId_unique" UNIQUE("job_id"),
	CONSTRAINT "delivery_ratings_stars" CHECK ("delivery_ratings"."stars" between 1 and 5),
	CONSTRAINT "delivery_ratings_reasons" CHECK ("delivery_ratings"."reasons" <@ array['on_time','polite','careful_with_parcel','late','rude','damaged','other']::text[]),
	CONSTRAINT "delivery_ratings_other_note" CHECK (not ('other' = any("delivery_ratings"."reasons")) or "delivery_ratings"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD COLUMN "rating_sum" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD COLUMN "low_rating_alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_job_id_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_ratings_agent_idx" ON "delivery_ratings" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_ratings_order_id_index" ON "delivery_ratings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_ratings_user_id_index" ON "delivery_ratings" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "delivery_agents" ADD CONSTRAINT "delivery_agents_rating_range" CHECK ("delivery_agents"."rating_count" >= 0 and "delivery_agents"."rating_sum" between "delivery_agents"."rating_count" and "delivery_agents"."rating_count" * 5);--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD COLUMN "return_intent" text;--> statement-breakpoint
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_return_intent" CHECK (("delivery_jobs"."return_intent" is null or "delivery_jobs"."return_intent" in ('retry','close')) and ("delivery_jobs"."status" <> 'returning' or "delivery_jobs"."return_intent" is not null));--> statement-breakpoint
ALTER TABLE "delivery_job_events" DROP CONSTRAINT "delivery_job_events_kind_valid";--> statement-breakpoint
ALTER TABLE "delivery_job_events" ADD CONSTRAINT "delivery_job_events_kind_valid" CHECK ("delivery_job_events"."kind" in ('created','status','offered','offer_declined','offer_expired','offer_withdrawn','offer_given_up','contact_revealed','photo','code_wrong','code_locked','override','agent_unavailable'));
--> statement-breakpoint
-- Hand-written (spec 24): RLS deny-all, version and updated_at triggers, append-only timelines.
ALTER TABLE public.delivery_agent_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_agent_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_agent_invites ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_agents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_handover_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_job_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_job_offers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.order_delivery_switches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.shop_delivery_mode_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.delivery_agent_documents, public.delivery_agent_events, public.delivery_agent_invites, public.delivery_agents, public.delivery_handover_codes, public.delivery_job_events, public.delivery_job_offers, public.delivery_jobs, public.order_delivery_switches, public.shop_delivery_mode_requests FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER delivery_agent_events_append_only BEFORE UPDATE OR DELETE ON public.delivery_agent_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER delivery_job_events_append_only BEFORE UPDATE OR DELETE ON public.delivery_job_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER delivery_agent_documents_bump_version BEFORE UPDATE ON public.delivery_agent_documents
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_agent_documents_touch_updated_at BEFORE UPDATE ON public.delivery_agent_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER delivery_agent_invites_bump_version BEFORE UPDATE ON public.delivery_agent_invites
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_agent_invites_touch_updated_at BEFORE UPDATE ON public.delivery_agent_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER delivery_agents_bump_version BEFORE UPDATE ON public.delivery_agents
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_agents_touch_updated_at BEFORE UPDATE ON public.delivery_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER delivery_handover_codes_bump_version BEFORE UPDATE ON public.delivery_handover_codes
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_handover_codes_touch_updated_at BEFORE UPDATE ON public.delivery_handover_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER delivery_job_offers_bump_version BEFORE UPDATE ON public.delivery_job_offers
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_jobs_bump_version BEFORE UPDATE ON public.delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_jobs_touch_updated_at BEFORE UPDATE ON public.delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER order_delivery_switches_bump_version BEFORE UPDATE ON public.order_delivery_switches
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER order_delivery_switches_touch_updated_at BEFORE UPDATE ON public.order_delivery_switches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER shop_delivery_mode_requests_bump_version BEFORE UPDATE ON public.shop_delivery_mode_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER shop_delivery_mode_requests_touch_updated_at BEFORE UPDATE ON public.shop_delivery_mode_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
ALTER TABLE public.delivery_ratings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.delivery_ratings FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER delivery_ratings_bump_version BEFORE UPDATE ON public.delivery_ratings
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER delivery_ratings_touch_updated_at BEFORE UPDATE ON public.delivery_ratings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
