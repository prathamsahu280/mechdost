-- Customer reviews on the API (spec 02 § Reviews, 2026-11-14): city for scoped moderation, the service-request
-- link as a real foreign key, moderation fields (hide reason code, staff note), version + updated_at for
-- compare-and-set moderation, integrity checks and the public/queue indexes. The table is empty everywhere
-- (no review API before this), so city_id is added NOT NULL directly.
SET lock_timeout = '5s';--> statement-breakpoint
DROP INDEX "reviews_target_type_target_id_status_index";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "city_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "moderation_note" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_target_public_idx" ON "reviews" USING btree ("target_type","target_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "reviews_status_created_idx" ON "reviews" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "reviews_user_created_idx" ON "reviews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_city_id_index" ON "reviews" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "reviews_service_request_id_index" ON "reviews" USING btree ("service_request_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_purchase_matches_target" CHECK (("reviews"."target_type" <> 'product' or "reviews"."order_id" is not null) and ("reviews"."target_type" <> 'workshop' or "reviews"."service_request_id" is not null));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_body_length" CHECK ("reviews"."body" is null or char_length("reviews"."body") between 1 and 1000);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hidden_reason" CHECK (("reviews"."status" = 'hidden') = ("reviews"."hidden_reason" is not null) and ("reviews"."hidden_reason" is null or "reviews"."hidden_reason" in ('spam','abusive','personal_data','off_topic','not_genuine','other')));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_note_length" CHECK ("reviews"."moderation_note" is null or char_length("reviews"."moderation_note") <= 300);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated" CHECK ("reviews"."status" = 'pending' or "reviews"."moderated_at" is not null);--> statement-breakpoint
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.reviews FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER reviews_bump_version BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER reviews_touch_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
