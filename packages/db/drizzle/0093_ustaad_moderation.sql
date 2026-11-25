CREATE TABLE "ustaad_moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_code" text NOT NULL,
	"days" integer,
	"actor_id" uuid NOT NULL,
	"second_actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_moderation_actions_target_valid" CHECK ("ustaad_moderation_actions"."target_type" in ('post','story','comment','question','answer','member','job','message','media')),
	CONSTRAINT "ustaad_moderation_actions_action_valid" CHECK ("ustaad_moderation_actions"."action" in ('keep','hold','remove','restore','warn','restrict','ban','unban','strike','level_review','takedown')),
	CONSTRAINT "ustaad_moderation_actions_reason_format" CHECK ("ustaad_moderation_actions"."reason_code" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "ustaad_moderation_actions_four_eyes" CHECK ("ustaad_moderation_actions"."second_actor_id" is null or "ustaad_moderation_actions"."second_actor_id" <> "ustaad_moderation_actions"."actor_id"),
	CONSTRAINT "ustaad_moderation_actions_days" CHECK ("ustaad_moderation_actions"."days" is null or "ustaad_moderation_actions"."days" between 1 and 36500)
);
--> statement-breakpoint
CREATE TABLE "ustaad_removed_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"legal_hold" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_removed_archive_target_valid" CHECK ("ustaad_removed_archive"."target_type" in ('post','story','comment','question','answer','member','job','message','media')),
	CONSTRAINT "ustaad_removed_archive_retain" CHECK ("ustaad_removed_archive"."retain_until" > "ustaad_removed_archive"."removed_at"),
	CONSTRAINT "ustaad_removed_archive_versioned" CHECK ("ustaad_removed_archive"."snapshot" ? 'schema_version')
);
--> statement-breakpoint
CREATE TABLE "ustaad_report_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label_en" text NOT NULL,
	"label_hi" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"default_clock" text DEFAULT 'standard_24h' NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_report_reasons_code_valid" CHECK ("ustaad_report_reasons"."code" in ('wrong_unsafe','illegal_modification','abuse','spam','privacy','minor','not_work','fake','job_scam','ip','other')),
	CONSTRAINT "ustaad_report_reasons_clock_valid" CHECK ("ustaad_report_reasons"."default_clock" in ('intimate_2h','legal_3h','standard_24h','grievance_7d')),
	CONSTRAINT "ustaad_report_reasons_other_on" CHECK ("ustaad_report_reasons"."code" <> 'other' or "ustaad_report_reasons"."active")
);
--> statement-breakpoint
CREATE TABLE "ustaad_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_id" uuid,
	"city_id" uuid,
	"source" text DEFAULT 'member' NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"clock" text DEFAULT 'standard_24h' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"appeal_ticket_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_reports_code_format" CHECK ("ustaad_reports"."code" ~ '^UR-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'),
	CONSTRAINT "ustaad_reports_target_valid" CHECK ("ustaad_reports"."target_type" in ('post','story','comment','question','answer','member','job','message','media')),
	CONSTRAINT "ustaad_reports_source_valid" CHECK ("ustaad_reports"."source" in ('member','auto_word','auto_scam','legal_order','grievance')),
	CONSTRAINT "ustaad_reports_reason_valid" CHECK ("ustaad_reports"."reason_code" in ('wrong_unsafe','illegal_modification','abuse','spam','privacy','minor','not_work','fake','job_scam','ip','other')),
	CONSTRAINT "ustaad_reports_clock_valid" CHECK ("ustaad_reports"."clock" in ('intimate_2h','legal_3h','standard_24h','grievance_7d')),
	CONSTRAINT "ustaad_reports_status_valid" CHECK ("ustaad_reports"."status" in ('open','in_review','actioned','dismissed','appealed','upheld','overturned')),
	CONSTRAINT "ustaad_reports_member_reporter" CHECK ("ustaad_reports"."source" <> 'member' or "ustaad_reports"."reporter_id" is not null),
	CONSTRAINT "ustaad_reports_note_len" CHECK ("ustaad_reports"."note" is null or char_length("ustaad_reports"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ustaad_strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"izzat_delta" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"appeal_ticket_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"action_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_strikes_status_valid" CHECK ("ustaad_strikes"."status" in ('active','overturned','expired')),
	CONSTRAINT "ustaad_strikes_delta" CHECK ("ustaad_strikes"."izzat_delta" between -500 and 0),
	CONSTRAINT "ustaad_strikes_reason_format" CHECK ("ustaad_strikes"."reason_code" ~ '^[a-z][a-z0-9_]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "ustaad_word_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list" text NOT NULL,
	"phrase" text NOT NULL,
	"phrase_norm" text NOT NULL,
	"replacement" text,
	"lang" text DEFAULT 'any' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_word_lists_list_valid" CHECK ("ustaad_word_lists"."list" in ('banned','scam_phrase','protected','pii_pattern','link_domain','correction')),
	CONSTRAINT "ustaad_word_lists_lang_valid" CHECK ("ustaad_word_lists"."lang" in ('any','hi','en','hinglish','cg')),
	CONSTRAINT "ustaad_word_lists_len" CHECK (char_length("ustaad_word_lists"."phrase") between 1 and 120),
	CONSTRAINT "ustaad_word_lists_replacement" CHECK (("ustaad_word_lists"."list" = 'correction') = ("ustaad_word_lists"."replacement" is not null))
);
--> statement-breakpoint
ALTER TABLE "ustaad_moderation_actions" ADD CONSTRAINT "ustaad_moderation_actions_report_id_ustaad_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."ustaad_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_moderation_actions" ADD CONSTRAINT "ustaad_moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_moderation_actions" ADD CONSTRAINT "ustaad_moderation_actions_second_actor_id_users_id_fk" FOREIGN KEY ("second_actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_report_reasons" ADD CONSTRAINT "ustaad_report_reasons_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_reporter_id_ustaad_members_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."ustaad_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_reports" ADD CONSTRAINT "ustaad_reports_appeal_ticket_id_support_tickets_id_fk" FOREIGN KEY ("appeal_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_strikes" ADD CONSTRAINT "ustaad_strikes_member_id_ustaad_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."ustaad_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_strikes" ADD CONSTRAINT "ustaad_strikes_appeal_ticket_id_support_tickets_id_fk" FOREIGN KEY ("appeal_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_strikes" ADD CONSTRAINT "ustaad_strikes_action_id_ustaad_moderation_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."ustaad_moderation_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_word_lists" ADD CONSTRAINT "ustaad_word_lists_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustaad_moderation_actions_target_type_target_id_created_at_index" ON "ustaad_moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "ustaad_moderation_actions_report_id_index" ON "ustaad_moderation_actions" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "ustaad_moderation_actions_actor_id_index" ON "ustaad_moderation_actions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "ustaad_moderation_actions_second_actor_id_index" ON "ustaad_moderation_actions" USING btree ("second_actor_id");--> statement-breakpoint
CREATE INDEX "ustaad_removed_archive_target_type_target_id_index" ON "ustaad_removed_archive" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ustaad_removed_archive_purge_idx" ON "ustaad_removed_archive" USING btree ("retain_until") WHERE "ustaad_removed_archive"."legal_hold" is null;--> statement-breakpoint
CREATE INDEX "ustaad_report_reasons_updated_by_index" ON "ustaad_report_reasons" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_reports_code_uq" ON "ustaad_reports" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_reports_one_open_uq" ON "ustaad_reports" USING btree ("target_type","target_id","reporter_id") WHERE "ustaad_reports"."status" in ('open','in_review') and "ustaad_reports"."reporter_id" is not null;--> statement-breakpoint
CREATE INDEX "ustaad_reports_status_due_at_index" ON "ustaad_reports" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "ustaad_reports_city_id_status_due_at_index" ON "ustaad_reports" USING btree ("city_id","status","due_at");--> statement-breakpoint
CREATE INDEX "ustaad_reports_target_type_target_id_index" ON "ustaad_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ustaad_reports_reporter_id_index" ON "ustaad_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "ustaad_reports_assigned_to_index" ON "ustaad_reports" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "ustaad_reports_decided_by_index" ON "ustaad_reports" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "ustaad_reports_appeal_ticket_id_index" ON "ustaad_reports" USING btree ("appeal_ticket_id");--> statement-breakpoint
CREATE INDEX "ustaad_strikes_member_id_status_index" ON "ustaad_strikes" USING btree ("member_id","status");--> statement-breakpoint
CREATE INDEX "ustaad_strikes_appeal_ticket_id_index" ON "ustaad_strikes" USING btree ("appeal_ticket_id");--> statement-breakpoint
CREATE INDEX "ustaad_strikes_action_id_index" ON "ustaad_strikes" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_word_lists_uq" ON "ustaad_word_lists" USING btree ("list","phrase_norm");--> statement-breakpoint
CREATE INDEX "ustaad_word_lists_list_active_index" ON "ustaad_word_lists" USING btree ("list","active");--> statement-breakpoint
CREATE INDEX "ustaad_word_lists_updated_by_index" ON "ustaad_word_lists" USING btree ("updated_by");--> statement-breakpoint
-- Ustaad hand SQL (spec 23 § 6): deny-all for the Data API, only the API role reads and writes (spec 13);
-- mutable rows bump version and touch updated_at; history tables are append-only.
ALTER TABLE public.ustaad_moderation_actions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_removed_archive ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_report_reasons ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_reports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_strikes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ustaad_word_lists ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_moderation_actions, public.ustaad_removed_archive, public.ustaad_report_reasons, public.ustaad_reports, public.ustaad_strikes, public.ustaad_word_lists FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_moderation_actions_append_only BEFORE UPDATE OR DELETE ON public.ustaad_moderation_actions
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER ustaad_removed_archive_bump_version BEFORE UPDATE ON public.ustaad_removed_archive
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_removed_archive_touch_updated_at BEFORE UPDATE ON public.ustaad_removed_archive
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_report_reasons_bump_version BEFORE UPDATE ON public.ustaad_report_reasons
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_report_reasons_touch_updated_at BEFORE UPDATE ON public.ustaad_report_reasons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_reports_bump_version BEFORE UPDATE ON public.ustaad_reports
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_reports_touch_updated_at BEFORE UPDATE ON public.ustaad_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_strikes_bump_version BEFORE UPDATE ON public.ustaad_strikes
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_strikes_touch_updated_at BEFORE UPDATE ON public.ustaad_strikes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER ustaad_word_lists_bump_version BEFORE UPDATE ON public.ustaad_word_lists
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_word_lists_touch_updated_at BEFORE UPDATE ON public.ustaad_word_lists
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- Fixed report reason codes (labels admin-editable, en + hi; spec 23 § 13). `other` is always on.
INSERT INTO public.ustaad_report_reasons (code, label_en, label_hi, default_clock) VALUES
  ('wrong_unsafe', 'Wrong or unsafe advice', 'गलत या ख़तरनाक सलाह', 'standard_24h'),
  ('illegal_modification', 'Illegal modification', 'गैरकानूनी बदलाव', 'standard_24h'),
  ('abuse', 'Abuse or bad language', 'गाली या बुरी भाषा', 'standard_24h'),
  ('spam', 'Spam or selling', 'फ़ालतू पोस्ट या बिक्री', 'standard_24h'),
  ('privacy', 'Shows a customer face, plate or phone number', 'ग्राहक का चेहरा, नंबर प्लेट या फ़ोन नंबर दिखता है', 'standard_24h'),
  ('minor', 'Someone under 18', '18 साल से कम उम्र का कोई', 'standard_24h'),
  ('not_work', 'Not about work', 'काम से जुड़ा नहीं', 'standard_24h'),
  ('fake', 'Fake or misleading', 'झूठा या भ्रम फैलाने वाला', 'standard_24h'),
  ('job_scam', 'Job scam', 'नौकरी के नाम पर धोखा', 'standard_24h'),
  ('ip', 'Copyright', 'कॉपीराइट', 'standard_24h'),
  ('other', 'Other', 'कुछ और', 'standard_24h')
ON CONFLICT DO NOTHING;
