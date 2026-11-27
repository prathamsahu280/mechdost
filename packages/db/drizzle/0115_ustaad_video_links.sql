-- Video-link posts (spec 23 § 10b, founder 2026-11-28): provider, id, start, oEmbed title/author on ustaad_posts;
-- author_name on the preview cache. Columns only on existing tables (RLS, grants and version triggers already in place).
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ustaad_link_previews" DROP CONSTRAINT "ustaad_link_previews_len";--> statement-breakpoint
ALTER TABLE "ustaad_link_previews" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD COLUMN "video_provider" text;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD COLUMN "video_id" text;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD COLUMN "video_start_s" integer;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD COLUMN "link_title" text;--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD COLUMN "link_author" text;--> statement-breakpoint
ALTER TABLE "ustaad_link_previews" ADD CONSTRAINT "ustaad_link_previews_len" CHECK (("ustaad_link_previews"."title" is null or char_length("ustaad_link_previews"."title") <= 200) and ("ustaad_link_previews"."description" is null or char_length("ustaad_link_previews"."description") <= 500) and ("ustaad_link_previews"."author_name" is null or char_length("ustaad_link_previews"."author_name") <= 100));--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_video_provider_valid" CHECK ("ustaad_posts"."video_provider" is null or "ustaad_posts"."video_provider" in ('youtube'));--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_video_shape" CHECK (("ustaad_posts"."video_provider" is null) = ("ustaad_posts"."video_id" is null) and ("ustaad_posts"."video_id" is null or ("ustaad_posts"."video_id" ~ '^[A-Za-z0-9_-]{11}$' and "ustaad_posts"."link_url" is not null)) and ("ustaad_posts"."video_start_s" is null or ("ustaad_posts"."video_id" is not null and "ustaad_posts"."video_start_s" between 0 and 43200)));--> statement-breakpoint
ALTER TABLE "ustaad_posts" ADD CONSTRAINT "ustaad_posts_link_meta_len" CHECK (("ustaad_posts"."link_title" is null or char_length("ustaad_posts"."link_title") <= 200) and ("ustaad_posts"."link_author" is null or char_length("ustaad_posts"."link_author") <= 100));