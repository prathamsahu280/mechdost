-- Coupon follow-ups (2026-11-16): public offers list flag, automatic offers, category offers, usage-report index.
-- Built as 0073 on its branch (latest on merge/fix2 was 0072); the coordinator renumbers at merge. All columns are
-- additive with safe defaults; no table is new, so RLS/revoke/triggers of `coupons` and `coupon_redemptions` already apply.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "auto_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_created_idx" ON "coupon_redemptions" USING btree ("coupon_id","created_at","id");--> statement-breakpoint
CREATE INDEX "coupons_category_id_index" ON "coupons" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "coupons_public_live_idx" ON "coupons" USING btree ("city_id","starts_at") WHERE "coupons"."active" and ("coupons"."is_public" or "coupons"."auto_apply");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_auto_mechdost" CHECK (not "coupons"."auto_apply" or "coupons"."funder" = 'mechdost');--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_category_not_delivery" CHECK ("coupons"."category_id" is null or "coupons"."kind" <> 'free_shipping');