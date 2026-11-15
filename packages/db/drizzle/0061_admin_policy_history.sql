-- Policy page history (design 2026-11-15 item 5): `content_versions` is the append-only list of what went live per
-- content entry (publish or restore, numbered per entry); restoring an old text is a new row, never an edit of an old
-- one. RLS on, client roles revoked, UPDATE/DELETE refused by trigger. Existing published rows become version 1.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"city_id" uuid,
	"version_no" integer NOT NULL,
	"value" jsonb NOT NULL,
	"action" text NOT NULL,
	"restored_from" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_versions_entry_uq" UNIQUE NULLS NOT DISTINCT("key","locale","city_id","version_no"),
	CONSTRAINT "content_versions_locale_valid" CHECK ("content_versions"."locale" in ('en','hi')),
	CONSTRAINT "content_versions_action_valid" CHECK ("content_versions"."action" in ('published','restored')),
	CONSTRAINT "content_versions_no_positive" CHECK ("content_versions"."version_no" >= 1),
	CONSTRAINT "content_versions_restored_from" CHECK (("content_versions"."action" = 'restored') = ("content_versions"."restored_from" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_versions_created_by_index" ON "content_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "content_versions_city_id_index" ON "content_versions" USING btree ("city_id");--> statement-breakpoint
ALTER TABLE public.content_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.content_versions FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER content_versions_append_only BEFORE UPDATE OR DELETE ON public.content_versions
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- History starts with what is live today: each published entry becomes its version 1 (policy pages edited before this
-- migration keep their current text as the first version).
INSERT INTO public.content_versions (key, locale, city_id, version_no, value, action, created_by, created_at)
SELECT key, locale, city_id, 1, value, 'published', updated_by, coalesce(published_at, updated_at)
FROM public.content_blocks WHERE status = 'published';
