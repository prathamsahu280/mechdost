CREATE TABLE "ustaad_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"workshop_id" uuid,
	"owner_user_id" uuid,
	"owner_phone_enc" text,
	"owner_phone_hash" text,
	"owner_business_id" text,
	"since_year" smallint,
	"status" text DEFAULT 'requested' NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_attestations_status_valid" CHECK ("ustaad_attestations"."status" in ('requested','confirmed','declined','expired','revoked')),
	CONSTRAINT "ustaad_attestations_owner_phone_enc" CHECK ("ustaad_attestations"."owner_phone_enc" is null or "ustaad_attestations"."owner_phone_enc" ~ '^v1\.[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "ustaad_attestations_owner_known" CHECK ("ustaad_attestations"."workshop_id" is not null or "ustaad_attestations"."owner_phone_hash" is not null),
	CONSTRAINT "ustaad_attestations_since_year" CHECK ("ustaad_attestations"."since_year" is null or "ustaad_attestations"."since_year" between 1950 and 2100)
);
--> statement-breakpoint
CREATE TABLE "ustaad_badge_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"badge_code" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_badge_awards_revoked_reason" CHECK ("ustaad_badge_awards"."revoked_at" is null or "ustaad_badge_awards"."revoked_reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "ustaad_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text NOT NULL,
	"rule_en" text NOT NULL,
	"rule_hi" text NOT NULL,
	"icon" text NOT NULL,
	"kind" text NOT NULL,
	"rule" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_badges_code_format" CHECK ("ustaad_badges"."code" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "ustaad_badges_kind_valid" CHECK ("ustaad_badges"."kind" in ('speciality','fun','level')),
	CONSTRAINT "ustaad_badges_rule_typed" CHECK ("ustaad_badges"."rule" ? 'schema_version' and ("ustaad_badges"."rule" ->> 'kind') in ('best_answers_with_tag','helpful_answers_in_segment','apprentice_answers_in_week','first_post','first_question','first_answer','founding'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_izzat_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason_code" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"idem_key" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_izzat_ledger_reason_valid" CHECK ("ustaad_izzat_ledger"."reason_code" in ('answer_posted','best_answer','helpful_received','follower_gained','video_completed','strike','reversal','correction')),
	CONSTRAINT "ustaad_izzat_ledger_delta" CHECK ("ustaad_izzat_ledger"."delta" between -500 and 100 and "ustaad_izzat_ledger"."delta" <> 0),
	CONSTRAINT "ustaad_izzat_ledger_source_format" CHECK ("ustaad_izzat_ledger"."source_type" ~ '^[a-z_]{2,30}$'),
	CONSTRAINT "ustaad_izzat_ledger_idem_len" CHECK (char_length("ustaad_izzat_ledger"."idem_key") between 8 and 120)
);
--> statement-breakpoint
CREATE TABLE "ustaad_level_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" text NOT NULL,
	"rule_group" text DEFAULT 'A' NOT NULL,
	"min_followers" integer DEFAULT 0 NOT NULL,
	"min_best_answers" integer DEFAULT 0 NOT NULL,
	"min_helpful_pct" smallint DEFAULT 0 NOT NULL,
	"min_verified_years" smallint DEFAULT 0 NOT NULL,
	"min_videos" integer DEFAULT 0 NOT NULL,
	"min_recommendations" integer DEFAULT 0 NOT NULL,
	"needs_staff_review" boolean DEFAULT false NOT NULL,
	"perk_en" text DEFAULT '' NOT NULL,
	"perk_hi" text DEFAULT '' NOT NULL,
	"coin_multiplier_bp" integer DEFAULT 10000 NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text NOT NULL,
	"position" smallint NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_level_rules_level_valid" CHECK ("ustaad_level_rules"."level" in ('apprentice','ustaad_pending','naya','pakka','bada','master')),
	CONSTRAINT "ustaad_level_rules_group" CHECK ("ustaad_level_rules"."rule_group" ~ '^[A-Z]$'),
	CONSTRAINT "ustaad_level_rules_non_negative" CHECK ("ustaad_level_rules"."min_followers" >= 0 and "ustaad_level_rules"."min_best_answers" >= 0 and "ustaad_level_rules"."min_verified_years" >= 0 and "ustaad_level_rules"."min_videos" >= 0 and "ustaad_level_rules"."min_recommendations" >= 0),
	CONSTRAINT "ustaad_level_rules_pct" CHECK ("ustaad_level_rules"."min_helpful_pct" between 0 and 100),
	CONSTRAINT "ustaad_level_rules_multiplier" CHECK ("ustaad_level_rules"."coin_multiplier_bp" between 10000 and 30000),
	CONSTRAINT "ustaad_level_rules_staff_review_locked" CHECK ("ustaad_level_rules"."level" not in ('bada','master') or "ustaad_level_rules"."needs_staff_review")
);
--> statement-breakpoint
CREATE TABLE "ustaad_member_counters" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"following" integer DEFAULT 0 NOT NULL,
	"posts" integer DEFAULT 0 NOT NULL,
	"answers" integer DEFAULT 0 NOT NULL,
	"best_answers" integer DEFAULT 0 NOT NULL,
	"helpful_votes" integer DEFAULT 0 NOT NULL,
	"helpful_answers" integer DEFAULT 0 NOT NULL,
	"videos_watched" integer DEFAULT 0 NOT NULL,
	"recommendations" integer DEFAULT 0 NOT NULL,
	"izzat" integer DEFAULT 0 NOT NULL,
	"best_answers30d" integer DEFAULT 0 NOT NULL,
	"helpful30d" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_member_counters_non_negative" CHECK ("ustaad_member_counters"."followers" >= 0 and "ustaad_member_counters"."following" >= 0 and "ustaad_member_counters"."posts" >= 0 and "ustaad_member_counters"."answers" >= 0 and "ustaad_member_counters"."best_answers" >= 0 and "ustaad_member_counters"."helpful_votes" >= 0 and "ustaad_member_counters"."helpful_answers" >= 0 and "ustaad_member_counters"."videos_watched" >= 0 and "ustaad_member_counters"."recommendations" >= 0 and "ustaad_member_counters"."best_answers30d" >= 0 and "ustaad_member_counters"."helpful30d" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"requested_level" text DEFAULT 'naya' NOT NULL,
	"granted_level" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"proof_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reason_code" text,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_verifications_status_valid" CHECK ("ustaad_verifications"."status" in ('requested','in_review','approved','rejected','withdrawn','revoked')),
	CONSTRAINT "ustaad_verifications_requested_level" CHECK ("ustaad_verifications"."requested_level" in ('naya','pakka','bada','master')),
	CONSTRAINT "ustaad_verifications_granted_level" CHECK ("ustaad_verifications"."granted_level" is null or "ustaad_verifications"."granted_level" in ('apprentice','ustaad_pending','naya','pakka','bada','master')),
	CONSTRAINT "ustaad_verifications_proofs_valid" CHECK ("ustaad_verifications"."proof_kinds" <@ array['owner','vouch','certificate']::text[]),
	CONSTRAINT "ustaad_verifications_reason_valid" CHECK ("ustaad_verifications"."reason_code" is null or "ustaad_verifications"."reason_code" in ('owner_unreachable','proofs_mismatch','duplicate_account','other')),
	CONSTRAINT "ustaad_verifications_decided_by_staff" CHECK ("ustaad_verifications"."status" not in ('approved','rejected','revoked') or ("ustaad_verifications"."decided_by" is not null and "ustaad_verifications"."decided_at" is not null)),
	CONSTRAINT "ustaad_verifications_granted_when_approved" CHECK ("ustaad_verifications"."status" <> 'approved' or "ustaad_verifications"."granted_level" is not null),
	CONSTRAINT "ustaad_verifications_note_len" CHECK ("ustaad_verifications"."note" is null or char_length("ustaad_verifications"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ustaad_vouches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"vouchee_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"verification_id" uuid,
	"revoked_reason_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_vouches_not_self" CHECK ("ustaad_vouches"."voucher_id" <> "ustaad_vouches"."vouchee_id"),
	CONSTRAINT "ustaad_vouches_status_valid" CHECK ("ustaad_vouches"."status" in ('requested','given','declined','expired','revoked')),
	CONSTRAINT "ustaad_vouches_relation_valid" CHECK ("ustaad_vouches"."relation" in ('worked_together','trained_by','known_work')),
	CONSTRAINT "ustaad_vouches_revoked_reason" CHECK ("ustaad_vouches"."status" <> 'revoked' or "ustaad_vouches"."revoked_reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "ustaad_coachmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"text_en" text NOT NULL,
	"text_hi" text NOT NULL,
	"position" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_coachmarks_target_valid" CHECK ("ustaad_coachmarks"."target" in ('mic','create','like_reply','discover','pin','jobs')),
	CONSTRAINT "ustaad_coachmarks_len" CHECK (char_length("ustaad_coachmarks"."text_en") <= 140 and char_length("ustaad_coachmarks"."text_hi") <= 200)
);
--> statement-breakpoint
CREATE TABLE "ustaad_member_onboarding" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"tutorial_completed_at" timestamp with time zone,
	"tutorial_skipped_at" timestamp with time zone,
	"last_card" smallint,
	"coachmarks_seen" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_member_onboarding_coachmarks_valid" CHECK ("ustaad_member_onboarding"."coachmarks_seen" <@ array['mic','create','like_reply','discover','pin','jobs']::text[])
);
--> statement-breakpoint
CREATE TABLE "ustaad_tutorial_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"position" smallint NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"body_en" text NOT NULL,
	"body_hi" text NOT NULL,
	"image_media_id" uuid,
	"audio_en_media_id" uuid,
	"audio_hi_media_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_tutorial_cards_code_format" CHECK ("ustaad_tutorial_cards"."code" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "ustaad_tutorial_cards_len" CHECK (char_length("ustaad_tutorial_cards"."title_en") <= 80 and char_length("ustaad_tutorial_cards"."title_hi") <= 120 and char_length("ustaad_tutorial_cards"."body_en") <= 300 and char_length("ustaad_tutorial_cards"."body_hi") <= 400)
);
--> statement-breakpoint
ALTER TABLE "ustaad_attestations" ADD CONSTRAINT "ustaad_attestations_verification_id_ustaad_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."ustaad_verifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_attestations" ADD CONSTRAINT "ustaad_attestations_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_attestations" ADD CONSTRAINT "ustaad_attestations_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_attestations" ADD CONSTRAINT "ustaad_attestations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_badge_awards" ADD CONSTRAINT "ustaad_badge_awards_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_badges" ADD CONSTRAINT "ustaad_badges_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_izzat_ledger" ADD CONSTRAINT "ustaad_izzat_ledger_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_izzat_ledger" ADD CONSTRAINT "ustaad_izzat_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_level_rules" ADD CONSTRAINT "ustaad_level_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_member_counters" ADD CONSTRAINT "ustaad_member_counters_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_verifications" ADD CONSTRAINT "ustaad_verifications_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_verifications" ADD CONSTRAINT "ustaad_verifications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_vouches" ADD CONSTRAINT "ustaad_vouches_voucher_id_ustaad_members_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_vouches" ADD CONSTRAINT "ustaad_vouches_vouchee_id_ustaad_members_id_fk" FOREIGN KEY ("vouchee_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_vouches" ADD CONSTRAINT "ustaad_vouches_verification_id_ustaad_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."ustaad_verifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_coachmarks" ADD CONSTRAINT "ustaad_coachmarks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_member_onboarding" ADD CONSTRAINT "ustaad_member_onboarding_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tutorial_cards" ADD CONSTRAINT "ustaad_tutorial_cards_image_media_id_ustaad_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tutorial_cards" ADD CONSTRAINT "ustaad_tutorial_cards_audio_en_media_id_ustaad_media_id_fk" FOREIGN KEY ("audio_en_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tutorial_cards" ADD CONSTRAINT "ustaad_tutorial_cards_audio_hi_media_id_ustaad_media_id_fk" FOREIGN KEY ("audio_hi_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tutorial_cards" ADD CONSTRAINT "ustaad_tutorial_cards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_attestations_one_open_uq" ON "ustaad_attestations" USING btree ("verification_id") WHERE "ustaad_attestations"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_attestations_token_uq" ON "ustaad_attestations" USING btree ("token_hash") WHERE "ustaad_attestations"."token_hash" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_attestations_workshop_id_status_index" ON "ustaad_attestations" USING btree ("workshop_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_attestations_member_id_index" ON "ustaad_attestations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ustaad_attestations_owner_user_id_index" ON "ustaad_attestations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "ustaad_attestations_owner_phone_hash_created_at_index" ON "ustaad_attestations" USING btree ("owner_phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_attestations_expiring_idx" ON "ustaad_attestations" USING btree ("expires_at") WHERE "ustaad_attestations"."status" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_badge_awards_active_uq" ON "ustaad_badge_awards" USING btree ("member_id","badge_code") WHERE "ustaad_badge_awards"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "ustaad_badge_awards_badge_code_index" ON "ustaad_badge_awards" USING btree ("badge_code");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_badges_code_uq" ON "ustaad_badges" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ustaad_badges_updated_by_index" ON "ustaad_badges" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_izzat_ledger_idem_uq" ON "ustaad_izzat_ledger" USING btree ("idem_key");--> statement-breakpoint
CREATE INDEX "ustaad_izzat_ledger_member_id_created_at_index" ON "ustaad_izzat_ledger" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_izzat_ledger_actor_id_index" ON "ustaad_izzat_ledger" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_level_rules_uq" ON "ustaad_level_rules" USING btree ("level","rule_group");--> statement-breakpoint
CREATE INDEX "ustaad_level_rules_updated_by_index" ON "ustaad_level_rules" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_verifications_one_open_uq" ON "ustaad_verifications" USING btree ("member_id") WHERE "ustaad_verifications"."status" in ('requested','in_review');--> statement-breakpoint
CREATE INDEX "ustaad_verifications_status_created_at_index" ON "ustaad_verifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_verifications_member_id_created_at_index" ON "ustaad_verifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_verifications_decided_by_index" ON "ustaad_verifications" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_vouches_active_pair_uq" ON "ustaad_vouches" USING btree ("voucher_id","vouchee_id") WHERE "ustaad_vouches"."status" in ('requested','given');--> statement-breakpoint
CREATE INDEX "ustaad_vouches_vouchee_id_status_index" ON "ustaad_vouches" USING btree ("vouchee_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_vouches_voucher_id_created_at_index" ON "ustaad_vouches" USING btree ("voucher_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_vouches_verification_id_index" ON "ustaad_vouches" USING btree ("verification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_coachmarks_target_uq" ON "ustaad_coachmarks" USING btree ("target");--> statement-breakpoint
CREATE INDEX "ustaad_coachmarks_updated_by_index" ON "ustaad_coachmarks" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_tutorial_cards_code_uq" ON "ustaad_tutorial_cards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ustaad_tutorial_cards_active_position_index" ON "ustaad_tutorial_cards" USING btree ("active","position");--> statement-breakpoint
CREATE INDEX "ustaad_tutorial_cards_image_media_id_index" ON "ustaad_tutorial_cards" USING btree ("image_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_tutorial_cards_audio_en_media_id_index" ON "ustaad_tutorial_cards" USING btree ("audio_en_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_tutorial_cards_audio_hi_media_id_index" ON "ustaad_tutorial_cards" USING btree ("audio_hi_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_tutorial_cards_updated_by_index" ON "ustaad_tutorial_cards" USING btree ("updated_by");--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_attestations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_badge_awards ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_badges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_izzat_ledger ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_level_rules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_member_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_verifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_vouches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_coachmarks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_member_onboarding ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_tutorial_cards ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_attestations, public.ustaad_badge_awards, public.ustaad_badges, public.ustaad_izzat_ledger, public.ustaad_level_rules, public.ustaad_member_counters, public.ustaad_verifications, public.ustaad_vouches, public.ustaad_coachmarks, public.ustaad_member_onboarding, public.ustaad_tutorial_cards FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_attestations_bump_version BEFORE UPDATE ON public.ustaad_attestations
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_attestations_touch_updated_at BEFORE UPDATE ON public.ustaad_attestations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_badge_awards_bump_version BEFORE UPDATE ON public.ustaad_badge_awards
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_badge_awards_touch_updated_at BEFORE UPDATE ON public.ustaad_badge_awards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_badges_bump_version BEFORE UPDATE ON public.ustaad_badges
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_badges_touch_updated_at BEFORE UPDATE ON public.ustaad_badges
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_izzat_ledger_append_only BEFORE UPDATE OR DELETE ON public.ustaad_izzat_ledger
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER ustaad_level_rules_bump_version BEFORE UPDATE ON public.ustaad_level_rules
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_level_rules_touch_updated_at BEFORE UPDATE ON public.ustaad_level_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_member_counters_touch_updated_at BEFORE UPDATE ON public.ustaad_member_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_verifications_bump_version BEFORE UPDATE ON public.ustaad_verifications
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_verifications_touch_updated_at BEFORE UPDATE ON public.ustaad_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_vouches_bump_version BEFORE UPDATE ON public.ustaad_vouches
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_vouches_touch_updated_at BEFORE UPDATE ON public.ustaad_vouches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_coachmarks_bump_version BEFORE UPDATE ON public.ustaad_coachmarks
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_coachmarks_touch_updated_at BEFORE UPDATE ON public.ustaad_coachmarks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_member_onboarding_bump_version BEFORE UPDATE ON public.ustaad_member_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_member_onboarding_touch_updated_at BEFORE UPDATE ON public.ustaad_member_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_tutorial_cards_bump_version BEFORE UPDATE ON public.ustaad_tutorial_cards
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_tutorial_cards_touch_updated_at BEFORE UPDATE ON public.ustaad_tutorial_cards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
