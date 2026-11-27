ALTER TABLE "ustaad_media" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "ustaad_media" ADD COLUMN "captions" text;--> statement-breakpoint
ALTER TABLE "ustaad_media" ADD COLUMN "captions_lang" text;--> statement-breakpoint
ALTER TABLE "ustaad_media" ADD CONSTRAINT "ustaad_media_summary" CHECK ("ustaad_media"."summary" is null or ("ustaad_media"."kind" in ('audio', 'video') and char_length("ustaad_media"."summary") between 1 and 200));--> statement-breakpoint
ALTER TABLE "ustaad_media" ADD CONSTRAINT "ustaad_media_captions" CHECK (("ustaad_media"."captions" is null and "ustaad_media"."captions_lang" is null) or ("ustaad_media"."kind" = 'video' and "ustaad_media"."captions_lang" in ('hi', 'en') and char_length("ustaad_media"."captions") between 1 and 4000));