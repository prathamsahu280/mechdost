-- Ustaad preview testers (founder 2026-11-27; spec 23 § 3): named non-staff accounts let in during staff_preview.
-- Numbered 0110 (0105-0109 are held by parallel streams); the snapshot chains to 0104.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "ustaad_preview_testers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"added_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"remove_reason_code" text,
	"remove_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustaad_preview_testers_reason" CHECK ("ustaad_preview_testers"."reason_code" in ('qa_run','beta_mechanic','founder_request','other')),
	CONSTRAINT "ustaad_preview_testers_remove_reason" CHECK ("ustaad_preview_testers"."remove_reason_code" is null or "ustaad_preview_testers"."remove_reason_code" in ('run_finished','no_longer_needed','added_by_mistake','other')),
	CONSTRAINT "ustaad_preview_testers_removed_consistent" CHECK (("ustaad_preview_testers"."removed_at" is null) = ("ustaad_preview_testers"."remove_reason_code" is null)),
	CONSTRAINT "ustaad_preview_testers_note_len" CHECK ("ustaad_preview_testers"."note" is null or char_length("ustaad_preview_testers"."note") <= 200),
	CONSTRAINT "ustaad_preview_testers_remove_note_len" CHECK ("ustaad_preview_testers"."remove_note" is null or char_length("ustaad_preview_testers"."remove_note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "ustaad_preview_testers" ADD CONSTRAINT "ustaad_preview_testers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_preview_testers" ADD CONSTRAINT "ustaad_preview_testers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ustaad_preview_testers" ADD CONSTRAINT "ustaad_preview_testers_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ustaad_preview_testers_active_uq" ON "ustaad_preview_testers" USING btree ("user_id") WHERE "ustaad_preview_testers"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "ustaad_preview_testers_added_by_index" ON "ustaad_preview_testers" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "ustaad_preview_testers_removed_by_index" ON "ustaad_preview_testers" USING btree ("removed_by");;--> statement-breakpoint
ALTER TABLE public.ustaad_preview_testers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.ustaad_preview_testers FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER ustaad_preview_testers_bump_version BEFORE UPDATE ON public.ustaad_preview_testers
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER ustaad_preview_testers_touch_updated_at BEFORE UPDATE ON public.ustaad_preview_testers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
