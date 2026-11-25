CREATE TABLE "ustaad_answer_parts" (
	"answer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_answer_parts_answer_id_product_id_pk" PRIMARY KEY("answer_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_answer_votes" (
	"answer_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_answer_votes_answer_id_voter_id_pk" PRIMARY KEY("answer_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text,
	"body_original" text,
	"correction" text DEFAULT 'none' NOT NULL,
	"voice_media_id" uuid,
	"status" text DEFAULT 'visible' NOT NULL,
	"counts_for_levels" boolean DEFAULT false NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"idem_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_answers_status_valid" CHECK ("ustaad_answers"."status" in ('held','visible','hidden_author','removed','expired')),
	CONSTRAINT "ustaad_answers_correction_valid" CHECK ("ustaad_answers"."correction" in ('none','suggested_used','auto')),
	CONSTRAINT "ustaad_answers_helpful_non_negative" CHECK ("ustaad_answers"."helpful_count" >= 0),
	CONSTRAINT "ustaad_answers_has_content" CHECK ("ustaad_answers"."body" is not null or "ustaad_answers"."voice_media_id" is not null),
	CONSTRAINT "ustaad_answers_len" CHECK ("ustaad_answers"."body" is null or char_length("ustaad_answers"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "ustaad_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_courses_code_format" CHECK ("ustaad_courses"."code" ~ '^[a-z][a-z0-9_]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "ustaad_learning_progress" (
	"member_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_learning_progress_member_id_resource_id_pk" PRIMARY KEY("member_id","resource_id"),
	CONSTRAINT "ustaad_learning_progress_watched" CHECK ("ustaad_learning_progress"."watched_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_learning_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid,
	"kind" text NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"segment_code" text,
	"work_code" text,
	"duration_s" integer,
	"media_id" uuid,
	"url" text,
	"label" text DEFAULT 'none' NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_learning_resources_kind_valid" CHECK ("ustaad_learning_resources"."kind" in ('hosted_video','external_link')),
	CONSTRAINT "ustaad_learning_resources_label_valid" CHECK ("ustaad_learning_resources"."label" in ('none','mechdost_training')),
	CONSTRAINT "ustaad_learning_resources_segment_valid" CHECK ("ustaad_learning_resources"."segment_code" is null or "ustaad_learning_resources"."segment_code" in ('two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev')),
	CONSTRAINT "ustaad_learning_resources_work_valid" CHECK ("ustaad_learning_resources"."work_code" is null or "ustaad_learning_resources"."work_code" in ('engine','electrical','ac','diagnostics','tyres','battery','denting_painting','suspension_brakes')),
	CONSTRAINT "ustaad_learning_resources_source" CHECK (("ustaad_learning_resources"."kind" = 'hosted_video' and "ustaad_learning_resources"."media_id" is not null and "ustaad_learning_resources"."url" is null) or ("ustaad_learning_resources"."kind" = 'external_link' and "ustaad_learning_resources"."url" is not null and "ustaad_learning_resources"."media_id" is null)),
	CONSTRAINT "ustaad_learning_resources_url" CHECK ("ustaad_learning_resources"."url" is null or "ustaad_learning_resources"."url" ~ '^https://'),
	CONSTRAINT "ustaad_learning_resources_duration" CHECK ("ustaad_learning_resources"."duration_s" is null or "ustaad_learning_resources"."duration_s" > 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"asker_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"reach" text DEFAULT 'city' NOT NULL,
	"segment_code" text,
	"vehicle_model_id" uuid,
	"work_code" text,
	"title" text NOT NULL,
	"body" text,
	"body_original" text,
	"correction" text DEFAULT 'none' NOT NULL,
	"voice_media_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"best_answer_id" uuid,
	"safety_tag" text,
	"hide_garage" boolean DEFAULT false NOT NULL,
	"idem_key" text,
	"widened_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_questions_code_format" CHECK ("ustaad_questions"."code" ~ '^UQ-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'),
	CONSTRAINT "ustaad_questions_status_valid" CHECK ("ustaad_questions"."status" in ('open','answered','solved','closed','removed')),
	CONSTRAINT "ustaad_questions_reach_valid" CHECK ("ustaad_questions"."reach" in ('city','state')),
	CONSTRAINT "ustaad_questions_segment_valid" CHECK ("ustaad_questions"."segment_code" is null or "ustaad_questions"."segment_code" in ('two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev')),
	CONSTRAINT "ustaad_questions_work_valid" CHECK ("ustaad_questions"."work_code" is null or "ustaad_questions"."work_code" in ('engine','electrical','ac','diagnostics','tyres','battery','denting_painting','suspension_brakes')),
	CONSTRAINT "ustaad_questions_safety_valid" CHECK ("ustaad_questions"."safety_tag" is null or "ustaad_questions"."safety_tag" in ('brake','steering','fuel','airbag','ev_hv')),
	CONSTRAINT "ustaad_questions_correction_valid" CHECK ("ustaad_questions"."correction" in ('none','suggested_used','auto')),
	CONSTRAINT "ustaad_questions_len" CHECK (char_length("ustaad_questions"."title") between 1 and 200 and ("ustaad_questions"."body" is null or char_length("ustaad_questions"."body") <= 2000)),
	CONSTRAINT "ustaad_questions_solved_best" CHECK ("ustaad_questions"."status" <> 'solved' or "ustaad_questions"."best_answer_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "ustaad_answer_parts" ADD CONSTRAINT "ustaad_answer_parts_answer_id_ustaad_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ustaad_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answer_parts" ADD CONSTRAINT "ustaad_answer_parts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answer_parts" ADD CONSTRAINT "ustaad_answer_parts_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answer_votes" ADD CONSTRAINT "ustaad_answer_votes_answer_id_ustaad_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ustaad_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answer_votes" ADD CONSTRAINT "ustaad_answer_votes_voter_id_ustaad_members_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answers" ADD CONSTRAINT "ustaad_answers_question_id_ustaad_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."ustaad_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answers" ADD CONSTRAINT "ustaad_answers_author_id_ustaad_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_answers" ADD CONSTRAINT "ustaad_answers_voice_media_id_ustaad_media_id_fk" FOREIGN KEY ("voice_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_courses" ADD CONSTRAINT "ustaad_courses_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_learning_progress" ADD CONSTRAINT "ustaad_learning_progress_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_learning_progress" ADD CONSTRAINT "ustaad_learning_progress_resource_id_ustaad_learning_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."ustaad_learning_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_learning_resources" ADD CONSTRAINT "ustaad_learning_resources_course_id_ustaad_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."ustaad_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_learning_resources" ADD CONSTRAINT "ustaad_learning_resources_media_id_ustaad_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_learning_resources" ADD CONSTRAINT "ustaad_learning_resources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_questions" ADD CONSTRAINT "ustaad_questions_asker_id_ustaad_members_id_fk" FOREIGN KEY ("asker_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_questions" ADD CONSTRAINT "ustaad_questions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_questions" ADD CONSTRAINT "ustaad_questions_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_questions" ADD CONSTRAINT "ustaad_questions_voice_media_id_ustaad_media_id_fk" FOREIGN KEY ("voice_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_questions" ADD CONSTRAINT "ustaad_questions_best_answer_id_ustaad_answers_id_fk" FOREIGN KEY ("best_answer_id") REFERENCES "public"."ustaad_answers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_answer_parts_product_id_index" ON "ustaad_answer_parts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ustaad_answer_parts_added_by_index" ON "ustaad_answer_parts" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "ustaad_answer_votes_voter_id_created_at_index" ON "ustaad_answer_votes" USING btree ("voter_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_answers_question_id_created_at_index" ON "ustaad_answers" USING btree ("question_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_answers_author_id_created_at_index" ON "ustaad_answers" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_answers_voice_media_id_index" ON "ustaad_answers" USING btree ("voice_media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_answers_idem_uq" ON "ustaad_answers" USING btree ("author_id","idem_key") WHERE "ustaad_answers"."idem_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_courses_code_uq" ON "ustaad_courses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ustaad_courses_active_position_index" ON "ustaad_courses" USING btree ("active","position");--> statement-breakpoint
CREATE INDEX "ustaad_courses_updated_by_index" ON "ustaad_courses" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "ustaad_learning_progress_resource_id_index" ON "ustaad_learning_progress" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "ustaad_learning_resources_course_id_position_index" ON "ustaad_learning_resources" USING btree ("course_id","position");--> statement-breakpoint
CREATE INDEX "ustaad_learning_resources_segment_code_work_code_index" ON "ustaad_learning_resources" USING btree ("segment_code","work_code");--> statement-breakpoint
CREATE INDEX "ustaad_learning_resources_media_id_index" ON "ustaad_learning_resources" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "ustaad_learning_resources_updated_by_index" ON "ustaad_learning_resources" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_questions_code_uq" ON "ustaad_questions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_questions_idem_uq" ON "ustaad_questions" USING btree ("asker_id","idem_key") WHERE "ustaad_questions"."idem_key" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_questions_city_id_status_created_at_index" ON "ustaad_questions" USING btree ("city_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_questions_segment_code_work_code_created_at_index" ON "ustaad_questions" USING btree ("segment_code","work_code","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_questions_asker_id_created_at_index" ON "ustaad_questions" USING btree ("asker_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_questions_vehicle_model_id_index" ON "ustaad_questions" USING btree ("vehicle_model_id");--> statement-breakpoint
CREATE INDEX "ustaad_questions_voice_media_id_index" ON "ustaad_questions" USING btree ("voice_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_questions_best_answer_id_index" ON "ustaad_questions" USING btree ("best_answer_id");--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_answer_parts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_answer_votes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_answers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_courses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_learning_progress ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_learning_resources ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_questions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_answer_parts, public.ustaad_answer_votes, public.ustaad_answers, public.ustaad_courses, public.ustaad_learning_progress, public.ustaad_learning_resources, public.ustaad_questions FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_answers_bump_version BEFORE UPDATE ON public.ustaad_answers
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_answers_touch_updated_at BEFORE UPDATE ON public.ustaad_answers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_courses_bump_version BEFORE UPDATE ON public.ustaad_courses
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_courses_touch_updated_at BEFORE UPDATE ON public.ustaad_courses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_learning_progress_bump_version BEFORE UPDATE ON public.ustaad_learning_progress
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_learning_progress_touch_updated_at BEFORE UPDATE ON public.ustaad_learning_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_learning_resources_bump_version BEFORE UPDATE ON public.ustaad_learning_resources
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_learning_resources_touch_updated_at BEFORE UPDATE ON public.ustaad_learning_resources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_questions_bump_version BEFORE UPDATE ON public.ustaad_questions
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_questions_touch_updated_at BEFORE UPDATE ON public.ustaad_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- No vote for your own answer (spec 23 § 6.3); the best answer must belong to its question.
CREATE OR REPLACE FUNCTION public.ustaad_vote_not_own() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ustaad_answers a WHERE a.id = NEW.answer_id AND a.author_id = NEW.voter_id) THEN
    RAISE EXCEPTION 'ustaad: a member cannot vote for their own answer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ustaad_answer_votes_not_own BEFORE INSERT OR UPDATE ON public.ustaad_answer_votes
  FOR EACH ROW EXECUTE FUNCTION public.ustaad_vote_not_own();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ustaad_best_answer_same_question() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.best_answer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ustaad_answers a WHERE a.id = NEW.best_answer_id AND a.question_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'ustaad: the best answer must belong to the question' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER ustaad_questions_best_answer_check BEFORE INSERT OR UPDATE OF best_answer_id ON public.ustaad_questions
  FOR EACH ROW EXECUTE FUNCTION public.ustaad_best_answer_same_question();
