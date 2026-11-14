CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"mime" text DEFAULT 'image/webp' NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"thumb_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_objects_owner_kind_valid" CHECK ("media_objects"."owner_kind" in ('service_photo')),
	CONSTRAINT "media_objects_mime_valid" CHECK ("media_objects"."mime" = 'image/webp'),
	CONSTRAINT "media_objects_dims" CHECK ("media_objects"."width" between 1 and 4000 and "media_objects"."height" between 1 and 4000),
	CONSTRAINT "media_objects_bytes" CHECK ("media_objects"."bytes" between 1 and 8388608 and "media_objects"."thumb_bytes" between 1 and 8388608),
	CONSTRAINT "media_objects_sha_hex" CHECK ("media_objects"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_objects_path_safe" CHECK ("media_objects"."path" ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$' and "media_objects"."thumb_path" ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}-thumb[.]webp$')
);
--> statement-breakpoint
CREATE TABLE "service_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"media_id" uuid NOT NULL,
	"caption" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "service_photos_stage_valid" CHECK ("service_photos"."stage" in ('before','after')),
	CONSTRAINT "service_photos_caption_len" CHECK ("service_photos"."caption" is null or char_length("service_photos"."caption") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_photos" ADD CONSTRAINT "service_photos_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_photos" ADD CONSTRAINT "service_photos_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_photos" ADD CONSTRAINT "service_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_path_uq" ON "media_objects" USING btree ("bucket","path");--> statement-breakpoint
CREATE INDEX "media_objects_owner_kind_owner_id_index" ON "media_objects" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "media_objects_uploaded_by_index" ON "media_objects" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "service_photos_media_uq" ON "service_photos" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "service_photos_request_stage_idx" ON "service_photos" USING btree ("request_id","stage","sort_order") WHERE "service_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "service_photos_created_by_index" ON "service_photos" USING btree ("created_by");--> statement-breakpoint
-- New tables: RLS on, no direct client access (the API connects as owner), version + updated_at triggers (spec 14).
ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_photos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.media_objects FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.service_photos FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER media_objects_bump_version BEFORE UPDATE ON public.media_objects
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER media_objects_touch_updated_at BEFORE UPDATE ON public.media_objects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER service_photos_bump_version BEFORE UPDATE ON public.service_photos
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER service_photos_touch_updated_at BEFORE UPDATE ON public.service_photos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
