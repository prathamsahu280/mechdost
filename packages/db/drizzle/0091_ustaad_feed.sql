CREATE TABLE "ustaad_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"answer_id" uuid,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text,
	"body_original" text,
	"correction" text DEFAULT 'none' NOT NULL,
	"media_id" uuid,
	"status" text DEFAULT 'visible' NOT NULL,
	"idem_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_comments_one_target" CHECK (num_nonnulls("ustaad_comments"."post_id", "ustaad_comments"."answer_id") = 1),
	CONSTRAINT "ustaad_comments_status_valid" CHECK ("ustaad_comments"."status" in ('held','visible','hidden_author','removed','expired')),
	CONSTRAINT "ustaad_comments_correction_valid" CHECK ("ustaad_comments"."correction" in ('none','suggested_used','auto')),
	CONSTRAINT "ustaad_comments_content" CHECK ("ustaad_comments"."body" is not null or "ustaad_comments"."media_id" is not null),
	CONSTRAINT "ustaad_comments_len" CHECK ("ustaad_comments"."body" is null or char_length("ustaad_comments"."body") <= 1000),
	CONSTRAINT "ustaad_comments_not_own_parent" CHECK ("ustaad_comments"."parent_id" is null or "ustaad_comments"."parent_id" <> "ustaad_comments"."id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_link_previews" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"final_host" text,
	"title" text,
	"description" text,
	"image_media_id" uuid,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_link_previews_hash" CHECK ("ustaad_link_previews"."url_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ustaad_link_previews_status_valid" CHECK ("ustaad_link_previews"."status" in ('ok','blocked','failed')),
	CONSTRAINT "ustaad_link_previews_len" CHECK (("ustaad_link_previews"."title" is null or char_length("ustaad_link_previews"."title") <= 200) and ("ustaad_link_previews"."description" is null or char_length("ustaad_link_previews"."description") <= 500))
);
--> statement-breakpoint
CREATE TABLE "ustaad_poll_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" smallint NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ustaad_poll_options_len" CHECK (char_length("ustaad_poll_options"."label") between 1 and 80),
	CONSTRAINT "ustaad_poll_options_votes" CHECK ("ustaad_poll_options"."votes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_poll_votes" (
	"poll_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_poll_votes_poll_id_member_id_pk" PRIMARY KEY("poll_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ustaad_post_counters" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_post_counters_non_negative" CHECK ("ustaad_post_counters"."likes" >= 0 and "ustaad_post_counters"."comments" >= 0 and "ustaad_post_counters"."saves" >= 0 and "ustaad_post_counters"."shares" >= 0 and "ustaad_post_counters"."views" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ustaad_post_media" (
	"post_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"role" text,
	CONSTRAINT "ustaad_post_media_post_id_position_pk" PRIMARY KEY("post_id","position"),
	CONSTRAINT "ustaad_post_media_role_valid" CHECK ("ustaad_post_media"."role" is null or "ustaad_post_media"."role" in ('before','after')),
	CONSTRAINT "ustaad_post_media_position" CHECK ("ustaad_post_media"."position" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE "ustaad_post_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid,
	"question_id" uuid,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_post_tags_one_target" CHECK (num_nonnulls("ustaad_post_tags"."post_id", "ustaad_post_tags"."question_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ustaad_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"template" text,
	"content_type" text DEFAULT 'ugc' NOT NULL,
	"body" text,
	"body_original" text,
	"correction" text DEFAULT 'none' NOT NULL,
	"fix_symptom" text,
	"fix_cause" text,
	"fix_fix" text,
	"segment_code" text,
	"vehicle_model_id" uuid,
	"link_url" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"held_reason_code" text,
	"expires_at" timestamp with time zone,
	"idem_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_posts_kind_valid" CHECK ("ustaad_posts"."kind" in ('voice','photo','video','text','document','poll','link','mixed','story')),
	CONSTRAINT "ustaad_posts_template_valid" CHECK ("ustaad_posts"."template" is null or "ustaad_posts"."template" in ('fix_log','tip','before_after')),
	CONSTRAINT "ustaad_posts_content_type_valid" CHECK ("ustaad_posts"."content_type" in ('ugc','mechdost_authored','sponsored')),
	CONSTRAINT "ustaad_posts_correction_valid" CHECK ("ustaad_posts"."correction" in ('none','suggested_used','auto')),
	CONSTRAINT "ustaad_posts_status_valid" CHECK ("ustaad_posts"."status" in ('held','visible','hidden_author','removed','expired')),
	CONSTRAINT "ustaad_posts_segment_valid" CHECK ("ustaad_posts"."segment_code" is null or "ustaad_posts"."segment_code" in ('two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev')),
	CONSTRAINT "ustaad_posts_story_expires" CHECK (("ustaad_posts"."kind" = 'story') = ("ustaad_posts"."expires_at" is not null)),
	CONSTRAINT "ustaad_posts_link_https" CHECK ("ustaad_posts"."link_url" is null or "ustaad_posts"."link_url" ~ '^https?://'),
	CONSTRAINT "ustaad_posts_len" CHECK (("ustaad_posts"."body" is null or char_length("ustaad_posts"."body") <= 3000) and ("ustaad_posts"."fix_symptom" is null or char_length("ustaad_posts"."fix_symptom") <= 500) and ("ustaad_posts"."fix_cause" is null or char_length("ustaad_posts"."fix_cause") <= 500) and ("ustaad_posts"."fix_fix" is null or char_length("ustaad_posts"."fix_fix") <= 500))
);
--> statement-breakpoint
CREATE TABLE "ustaad_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" text NOT NULL,
	"title_en" text NOT NULL,
	"title_hi" text NOT NULL,
	"body_en" text DEFAULT '' NOT NULL,
	"body_hi" text DEFAULT '' NOT NULL,
	"target" text NOT NULL,
	"target_id" text NOT NULL,
	"city_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"segment_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_promotions_slot_valid" CHECK ("ustaad_promotions"."slot" in ('feed','stories','search','jobs','learn','answer_parts')),
	CONSTRAINT "ustaad_promotions_target_valid" CHECK ("ustaad_promotions"."target" in ('product','category','coupon','learning','url_internal')),
	CONSTRAINT "ustaad_promotions_status_valid" CHECK ("ustaad_promotions"."status" in ('draft','scheduled','live','ended')),
	CONSTRAINT "ustaad_promotions_segments_valid" CHECK ("ustaad_promotions"."segment_codes" <@ array['two_wheeler','three_wheeler','car_suv','light_commercial','truck_bus','tractor_farm','ev']::text[]),
	CONSTRAINT "ustaad_promotions_window" CHECK ("ustaad_promotions"."ends_at" > "ustaad_promotions"."starts_at"),
	CONSTRAINT "ustaad_promotions_internal_target" CHECK ("ustaad_promotions"."target" <> 'url_internal' or ("ustaad_promotions"."target_id" ~ '^/([A-Za-z0-9._~!$&''()*+,\x3B=:@-]+(/[A-Za-z0-9._~!$&''()*+,\x3B=:@-]*)*)?([?#][^[:space:][:cntrl:]\\]*)?$' and "ustaad_promotions"."target_id" !~ '[[:cntrl:]\\]' and char_length("ustaad_promotions"."target_id") <= 300))
);
--> statement-breakpoint
CREATE TABLE "ustaad_reactions" (
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_reactions_post_id_member_id_kind_pk" PRIMARY KEY("post_id","member_id","kind"),
	CONSTRAINT "ustaad_reactions_kind_valid" CHECK ("ustaad_reactions"."kind" in ('like'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_saves" (
	"post_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_saves_post_id_member_id_pk" PRIMARY KEY("post_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_story_views" (
	"post_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_story_views_post_id_viewer_id_pk" PRIMARY KEY("post_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_tag_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"tag_id" uuid,
	"decided_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_tag_suggestions_status_valid" CHECK ("ustaad_tag_suggestions"."status" in ('open','accepted','rejected','merged')),
	CONSTRAINT "ustaad_tag_suggestions_len" CHECK (char_length("ustaad_tag_suggestions"."text") between 2 and 40)
);
--> statement-breakpoint
CREATE TABLE "ustaad_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_hi" text NOT NULL,
	"group" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"merged_into_id" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_tags_slug_format" CHECK ("ustaad_tags"."slug" ~ '^[a-z0-9][a-z0-9_]{1,39}$'),
	CONSTRAINT "ustaad_tags_group_valid" CHECK ("ustaad_tags"."group" in ('vehicle_model','repair','part','tool')),
	CONSTRAINT "ustaad_tags_not_self_merge" CHECK ("ustaad_tags"."merged_into_id" is null or "ustaad_tags"."merged_into_id" <> "ustaad_tags"."id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_blocks" (
	"member_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_blocks_member_id_target_id_pk" PRIMARY KEY("member_id","target_id"),
	CONSTRAINT "ustaad_blocks_not_self" CHECK ("ustaad_blocks"."member_id" <> "ustaad_blocks"."target_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"low_id" uuid NOT NULL,
	"high_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_connections_ordered" CHECK ("ustaad_connections"."low_id" < "ustaad_connections"."high_id"),
	CONSTRAINT "ustaad_connections_requester_in_pair" CHECK ("ustaad_connections"."requested_by" in ("ustaad_connections"."low_id", "ustaad_connections"."high_id")),
	CONSTRAINT "ustaad_connections_status_valid" CHECK ("ustaad_connections"."status" in ('requested','accepted','declined','removed'))
);
--> statement-breakpoint
CREATE TABLE "ustaad_follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"counted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "ustaad_follows_not_self" CHECK ("ustaad_follows"."follower_id" <> "ustaad_follows"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_mentorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ustaad_id" uuid NOT NULL,
	"shagird_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"ended_reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_mentorships_not_self" CHECK ("ustaad_mentorships"."ustaad_id" <> "ustaad_mentorships"."shagird_id"),
	CONSTRAINT "ustaad_mentorships_status_valid" CHECK ("ustaad_mentorships"."status" in ('requested','active','declined','ended')),
	CONSTRAINT "ustaad_mentorships_ended_reason" CHECK ("ustaad_mentorships"."status" <> 'ended' or "ustaad_mentorships"."ended_reason_code" is not null)
);
--> statement-breakpoint
CREATE TABLE "ustaad_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text,
	"media_id" uuid,
	"post_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_messages_kind_valid" CHECK ("ustaad_messages"."kind" in ('text','voice','photo','post_share')),
	CONSTRAINT "ustaad_messages_len" CHECK ("ustaad_messages"."body" is null or char_length("ustaad_messages"."body") <= 2000),
	CONSTRAINT "ustaad_messages_content" CHECK (("ustaad_messages"."kind" = 'text' and "ustaad_messages"."body" is not null) or ("ustaad_messages"."kind" in ('voice','photo') and "ustaad_messages"."media_id" is not null) or ("ustaad_messages"."kind" = 'post_share' and "ustaad_messages"."post_id" is not null) or "ustaad_messages"."deleted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "ustaad_mutes" (
	"member_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_mutes_member_id_target_id_pk" PRIMARY KEY("member_id","target_id"),
	CONSTRAINT "ustaad_mutes_not_self" CHECK ("ustaad_mutes"."member_id" <> "ustaad_mutes"."target_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_tag_follows" (
	"member_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_tag_follows_member_id_tag_id_pk" PRIMARY KEY("member_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "ustaad_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"low_id" uuid NOT NULL,
	"high_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"last_message_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_threads_ordered" CHECK ("ustaad_threads"."low_id" < "ustaad_threads"."high_id"),
	CONSTRAINT "ustaad_threads_requester_in_pair" CHECK ("ustaad_threads"."requested_by" in ("ustaad_threads"."low_id", "ustaad_threads"."high_id")),
	CONSTRAINT "ustaad_threads_status_valid" CHECK ("ustaad_threads"."status" in ('requested','open','declined','blocked'))
);
--> statement-breakpoint
ALTER TABLE "ustaad_comments" ADD CONSTRAINT "ustaad_comments_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_comments" ADD CONSTRAINT "ustaad_comments_answer_id_ustaad_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."ustaad_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_comments" ADD CONSTRAINT "ustaad_comments_author_id_ustaad_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_comments" ADD CONSTRAINT "ustaad_comments_parent_id_ustaad_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ustaad_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_comments" ADD CONSTRAINT "ustaad_comments_media_id_ustaad_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_link_previews" ADD CONSTRAINT "ustaad_link_previews_image_media_id_ustaad_media_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_poll_options" ADD CONSTRAINT "ustaad_poll_options_poll_id_ustaad_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."ustaad_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_poll_votes" ADD CONSTRAINT "ustaad_poll_votes_poll_id_ustaad_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."ustaad_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_poll_votes" ADD CONSTRAINT "ustaad_poll_votes_option_id_ustaad_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."ustaad_poll_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_poll_votes" ADD CONSTRAINT "ustaad_poll_votes_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_polls" ADD CONSTRAINT "ustaad_polls_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_counters" ADD CONSTRAINT "ustaad_post_counters_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_media" ADD CONSTRAINT "ustaad_post_media_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_media" ADD CONSTRAINT "ustaad_post_media_media_id_ustaad_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_tags" ADD CONSTRAINT "ustaad_post_tags_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_tags" ADD CONSTRAINT "ustaad_post_tags_question_id_ustaad_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."ustaad_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_post_tags" ADD CONSTRAINT "ustaad_post_tags_tag_id_ustaad_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."ustaad_tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_author_id_ustaad_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_vehicle_model_id_vehicle_models_id_fk" FOREIGN KEY ("vehicle_model_id") REFERENCES "public"."vehicle_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_promotions" ADD CONSTRAINT "ustaad_promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reactions" ADD CONSTRAINT "ustaad_reactions_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reactions" ADD CONSTRAINT "ustaad_reactions_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_saves" ADD CONSTRAINT "ustaad_saves_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_saves" ADD CONSTRAINT "ustaad_saves_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_story_views" ADD CONSTRAINT "ustaad_story_views_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_story_views" ADD CONSTRAINT "ustaad_story_views_viewer_id_ustaad_members_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tag_suggestions" ADD CONSTRAINT "ustaad_tag_suggestions_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tag_suggestions" ADD CONSTRAINT "ustaad_tag_suggestions_tag_id_ustaad_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."ustaad_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tag_suggestions" ADD CONSTRAINT "ustaad_tag_suggestions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tags" ADD CONSTRAINT "ustaad_tags_merged_into_id_ustaad_tags_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."ustaad_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tags" ADD CONSTRAINT "ustaad_tags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_blocks" ADD CONSTRAINT "ustaad_blocks_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_blocks" ADD CONSTRAINT "ustaad_blocks_target_id_ustaad_members_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_connections" ADD CONSTRAINT "ustaad_connections_low_id_ustaad_members_id_fk" FOREIGN KEY ("low_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_connections" ADD CONSTRAINT "ustaad_connections_high_id_ustaad_members_id_fk" FOREIGN KEY ("high_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_connections" ADD CONSTRAINT "ustaad_connections_requested_by_ustaad_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_follows" ADD CONSTRAINT "ustaad_follows_follower_id_ustaad_members_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_follows" ADD CONSTRAINT "ustaad_follows_followee_id_ustaad_members_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_mentorships" ADD CONSTRAINT "ustaad_mentorships_ustaad_id_ustaad_members_id_fk" FOREIGN KEY ("ustaad_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_mentorships" ADD CONSTRAINT "ustaad_mentorships_shagird_id_ustaad_members_id_fk" FOREIGN KEY ("shagird_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD CONSTRAINT "ustaad_messages_thread_id_ustaad_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ustaad_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD CONSTRAINT "ustaad_messages_sender_id_ustaad_members_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD CONSTRAINT "ustaad_messages_media_id_ustaad_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ustaad_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_messages" ADD CONSTRAINT "ustaad_messages_post_id_ustaad_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ustaad_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_mutes" ADD CONSTRAINT "ustaad_mutes_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_mutes" ADD CONSTRAINT "ustaad_mutes_target_id_ustaad_members_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tag_follows" ADD CONSTRAINT "ustaad_tag_follows_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_tag_follows" ADD CONSTRAINT "ustaad_tag_follows_tag_id_ustaad_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."ustaad_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_threads" ADD CONSTRAINT "ustaad_threads_low_id_ustaad_members_id_fk" FOREIGN KEY ("low_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_threads" ADD CONSTRAINT "ustaad_threads_high_id_ustaad_members_id_fk" FOREIGN KEY ("high_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_threads" ADD CONSTRAINT "ustaad_threads_requested_by_ustaad_members_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_comments_post_id_created_at_index" ON "ustaad_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_comments_answer_id_created_at_index" ON "ustaad_comments" USING btree ("answer_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_comments_author_id_created_at_index" ON "ustaad_comments" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_comments_parent_id_index" ON "ustaad_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ustaad_comments_media_id_index" ON "ustaad_comments" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_comments_idem_uq" ON "ustaad_comments" USING btree ("author_id","idem_key") WHERE "ustaad_comments"."idem_key" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_link_previews_image_media_id_index" ON "ustaad_link_previews" USING btree ("image_media_id");--> statement-breakpoint
CREATE INDEX "ustaad_link_previews_checked_at_index" ON "ustaad_link_previews" USING btree ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_poll_options_position_uq" ON "ustaad_poll_options" USING btree ("poll_id","position");--> statement-breakpoint
CREATE INDEX "ustaad_poll_votes_option_id_index" ON "ustaad_poll_votes" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "ustaad_poll_votes_member_id_index" ON "ustaad_poll_votes" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_polls_post_uq" ON "ustaad_polls" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "ustaad_post_media_media_id_index" ON "ustaad_post_media" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_post_tags_post_uq" ON "ustaad_post_tags" USING btree ("post_id","tag_id") WHERE "ustaad_post_tags"."post_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_post_tags_question_uq" ON "ustaad_post_tags" USING btree ("question_id","tag_id") WHERE "ustaad_post_tags"."question_id" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_post_tags_tag_id_created_at_index" ON "ustaad_post_tags" USING btree ("tag_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_post_tags_question_id_index" ON "ustaad_post_tags" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "ustaad_posts_author_id_created_at_index" ON "ustaad_posts" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_posts_city_id_status_created_at_index" ON "ustaad_posts" USING btree ("city_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_posts_story_expiry_idx" ON "ustaad_posts" USING btree ("expires_at") WHERE "ustaad_posts"."kind" = 'story';--> statement-breakpoint
CREATE INDEX "ustaad_posts_vehicle_model_id_index" ON "ustaad_posts" USING btree ("vehicle_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_posts_idem_uq" ON "ustaad_posts" USING btree ("author_id","idem_key") WHERE "ustaad_posts"."idem_key" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_promotions_slot_status_starts_at_index" ON "ustaad_promotions" USING btree ("slot","status","starts_at");--> statement-breakpoint
CREATE INDEX "ustaad_promotions_created_by_index" ON "ustaad_promotions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ustaad_reactions_member_id_created_at_index" ON "ustaad_reactions" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_saves_member_id_created_at_index" ON "ustaad_saves" USING btree ("member_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ustaad_story_views_viewer_id_index" ON "ustaad_story_views" USING btree ("viewer_id");--> statement-breakpoint
CREATE INDEX "ustaad_tag_suggestions_status_index" ON "ustaad_tag_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ustaad_tag_suggestions_member_id_index" ON "ustaad_tag_suggestions" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "ustaad_tag_suggestions_tag_id_index" ON "ustaad_tag_suggestions" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "ustaad_tag_suggestions_decided_by_index" ON "ustaad_tag_suggestions" USING btree ("decided_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_tags_slug_uq" ON "ustaad_tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ustaad_tags_aliases_gin" ON "ustaad_tags" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "ustaad_tags_name_trgm" ON "ustaad_tags" USING gin ("name_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "ustaad_tags_merged_into_id_index" ON "ustaad_tags" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "ustaad_tags_updated_by_index" ON "ustaad_tags" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "ustaad_blocks_target_id_index" ON "ustaad_blocks" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_connections_pair_uq" ON "ustaad_connections" USING btree ("low_id","high_id");--> statement-breakpoint
CREATE INDEX "ustaad_connections_high_id_status_index" ON "ustaad_connections" USING btree ("high_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_connections_requested_by_index" ON "ustaad_connections" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "ustaad_follows_followee_id_created_at_index" ON "ustaad_follows" USING btree ("followee_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_mentorships_active_uq" ON "ustaad_mentorships" USING btree ("ustaad_id","shagird_id") WHERE "ustaad_mentorships"."status" in ('requested','active');--> statement-breakpoint
CREATE INDEX "ustaad_mentorships_shagird_id_status_index" ON "ustaad_mentorships" USING btree ("shagird_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_messages_thread_id_created_at_index" ON "ustaad_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_messages_sender_id_created_at_index" ON "ustaad_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_messages_media_id_index" ON "ustaad_messages" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "ustaad_messages_post_id_index" ON "ustaad_messages" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "ustaad_mutes_target_id_index" ON "ustaad_mutes" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "ustaad_tag_follows_tag_id_index" ON "ustaad_tag_follows" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_threads_pair_uq" ON "ustaad_threads" USING btree ("low_id","high_id");--> statement-breakpoint
CREATE INDEX "ustaad_threads_high_id_last_message_at_index" ON "ustaad_threads" USING btree ("high_id","last_message_at");--> statement-breakpoint
CREATE INDEX "ustaad_threads_low_id_last_message_at_index" ON "ustaad_threads" USING btree ("low_id","last_message_at");--> statement-breakpoint
CREATE INDEX "ustaad_threads_requested_by_created_at_index" ON "ustaad_threads" USING btree ("requested_by","created_at");--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_comments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_link_previews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_poll_options ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_poll_votes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_polls ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_post_counters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_post_media ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_post_tags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_posts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_promotions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_reactions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_saves ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_story_views ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_tag_suggestions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_tags ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_blocks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_connections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_follows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_mentorships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_mutes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_tag_follows ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_threads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_comments, public.ustaad_link_previews, public.ustaad_poll_options, public.ustaad_poll_votes, public.ustaad_polls, public.ustaad_post_counters, public.ustaad_post_media, public.ustaad_post_tags, public.ustaad_posts, public.ustaad_promotions, public.ustaad_reactions, public.ustaad_saves, public.ustaad_story_views, public.ustaad_tag_suggestions, public.ustaad_tags, public.ustaad_blocks, public.ustaad_connections, public.ustaad_follows, public.ustaad_mentorships, public.ustaad_messages, public.ustaad_mutes, public.ustaad_tag_follows, public.ustaad_threads FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_comments_bump_version BEFORE UPDATE ON public.ustaad_comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_comments_touch_updated_at BEFORE UPDATE ON public.ustaad_comments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_post_counters_touch_updated_at BEFORE UPDATE ON public.ustaad_post_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_posts_bump_version BEFORE UPDATE ON public.ustaad_posts
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_posts_touch_updated_at BEFORE UPDATE ON public.ustaad_posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_promotions_bump_version BEFORE UPDATE ON public.ustaad_promotions
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_promotions_touch_updated_at BEFORE UPDATE ON public.ustaad_promotions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_tag_suggestions_bump_version BEFORE UPDATE ON public.ustaad_tag_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_tag_suggestions_touch_updated_at BEFORE UPDATE ON public.ustaad_tag_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_tags_bump_version BEFORE UPDATE ON public.ustaad_tags
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_tags_touch_updated_at BEFORE UPDATE ON public.ustaad_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_connections_bump_version BEFORE UPDATE ON public.ustaad_connections
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_connections_touch_updated_at BEFORE UPDATE ON public.ustaad_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_mentorships_bump_version BEFORE UPDATE ON public.ustaad_mentorships
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_mentorships_touch_updated_at BEFORE UPDATE ON public.ustaad_mentorships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_threads_bump_version BEFORE UPDATE ON public.ustaad_threads
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_threads_touch_updated_at BEFORE UPDATE ON public.ustaad_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
