-- Coupons (spec 03, design 2026-11-15): funder + shop acceptance, per-customer counter with a DB-level limit, order
-- snapshot and per-line allocation, `coupon_discount` payout kind. Existing coupon rows (none in use) are kept.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "coupon_shop_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"terms" jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_shop_terms_couponId_unique" UNIQUE("coupon_id"),
	CONSTRAINT "coupon_shop_terms_status_valid" CHECK ("coupon_shop_terms"."status" in ('pending','accepted','declined')),
	CONSTRAINT "coupon_shop_terms_decided" CHECK (("coupon_shop_terms"."status" = 'pending') = ("coupon_shop_terms"."decided_at" is null) and ("coupon_shop_terms"."status" = 'pending') = ("coupon_shop_terms"."decided_by" is null))
);
--> statement-breakpoint
CREATE TABLE "coupon_user_usage" (
	"coupon_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_user_usage_coupon_id_user_id_pk" PRIMARY KEY("coupon_id","user_id"),
	CONSTRAINT "coupon_user_usage_nonneg" CHECK ("coupon_user_usage"."uses" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_value_range";--> statement-breakpoint
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_usage_within_limit";--> statement-breakpoint
ALTER TABLE "shop_payout_entries" DROP CONSTRAINT "shop_payout_entries_kind_valid";--> statement-breakpoint
ALTER TABLE "shop_payout_entries" DROP CONSTRAINT "shop_payout_entries_order_kind";--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "funder" text DEFAULT 'mechdost' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "title_hi" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "terms" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "terms_hi" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "funder" text DEFAULT 'mechdost' NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "config_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "coupon_discount_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "coupon_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_discount_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_funder" text;--> statement-breakpoint
ALTER TABLE "coupon_shop_terms" ADD CONSTRAINT "coupon_shop_terms_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_shop_terms" ADD CONSTRAINT "coupon_shop_terms_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_shop_terms" ADD CONSTRAINT "coupon_shop_terms_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_user_usage" ADD CONSTRAINT "coupon_user_usage_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_user_usage" ADD CONSTRAINT "coupon_user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupon_shop_terms_shop_id_status_index" ON "coupon_shop_terms" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "coupon_shop_terms_decided_by_index" ON "coupon_shop_terms" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "coupon_user_usage_user_id_index" ON "coupon_user_usage" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coupons_shop_id_index" ON "coupons" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "coupons_created_by_index" ON "coupons" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "coupons_active_starts_at_index" ON "coupons" USING btree ("active","starts_at");--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_funder_valid" CHECK ("coupon_redemptions"."funder" in ('mechdost','shop'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_funder_valid" CHECK ("coupons"."funder" in ('mechdost','shop'));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_funder_shop" CHECK (("coupons"."funder" = 'shop') = ("coupons"."shop_id" is not null));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_shop_not_free_delivery" CHECK ("coupons"."funder" = 'mechdost' or "coupons"."kind" <> 'free_shipping');--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_code_format" CHECK ("coupons"."code" ~ '^[A-Za-z0-9]{4,20}$');--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_cap_percent_only" CHECK ("coupons"."max_discount_paise" is null or ("coupons"."kind" = 'percent' and "coupons"."max_discount_paise" > 0));--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_min_nonneg" CHECK ("coupons"."min_subtotal_paise" >= 0);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_per_user_range" CHECK ("coupons"."usage_limit_per_user" between 1 and 100);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_first_order_once" CHECK (not "coupons"."first_order_only" or "coupons"."usage_limit_per_user" = 1);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_paused_reason" CHECK ("coupons"."active" or char_length("coupons"."paused_reason") between 3 and 300);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_range" CHECK (case "coupons"."kind" when 'percent' then "coupons"."value" between 1 and 90 when 'flat' then "coupons"."value" between 1 and 10000000 else "coupons"."value" = 0 end);--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_within_limit" CHECK ("coupons"."used_count" >= 0 and ("coupons"."usage_limit_total" is null or ("coupons"."usage_limit_total" >= 1 and "coupons"."used_count" <= "coupons"."usage_limit_total")));--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_discount_parts" CHECK ("order_groups"."discount_paise" = "order_groups"."coupon_discount_paise" + "order_groups"."coin_discount_paise" and "order_groups"."coupon_discount_paise" >= 0);--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_coupon_set" CHECK (("order_groups"."coupon_id" is null) = ("order_groups"."coupon_code" is null) and ("order_groups"."coupon_id" is null) = ("order_groups"."coupon_snapshot" is null) and ("order_groups"."coupon_id" is not null or "order_groups"."coupon_discount_paise" = 0));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_discount_max" CHECK ("order_items"."line_discount_paise" <= "order_items"."unit_paise" * "order_items"."qty");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_parts" CHECK ("orders"."discount_paise" = "orders"."coupon_discount_paise" + "orders"."coin_discount_paise" and "orders"."coupon_discount_paise" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_funder" CHECK (("orders"."coupon_discount_paise" = 0) = ("orders"."coupon_funder" is null) and ("orders"."coupon_funder" is null or "orders"."coupon_funder" in ('mechdost','shop')));--> statement-breakpoint
ALTER TABLE "shop_payout_entries" ADD CONSTRAINT "shop_payout_entries_kind_valid" CHECK ("shop_payout_entries"."kind" in ('coin_discount','coupon_discount'));--> statement-breakpoint
ALTER TABLE "shop_payout_entries" ADD CONSTRAINT "shop_payout_entries_order_kind" CHECK ("shop_payout_entries"."kind" not in ('coin_discount','coupon_discount') or "shop_payout_entries"."order_id" is not null);--> statement-breakpoint
-- RLS on, no direct client access (the API connects as owner); version + updated_at triggers (spec 14).
ALTER TABLE public.coupon_shop_terms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.coupon_shop_terms FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE public.coupon_user_usage ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.coupon_user_usage FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER coupon_shop_terms_bump_version BEFORE UPDATE ON public.coupon_shop_terms
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER coupon_shop_terms_touch_updated_at BEFORE UPDATE ON public.coupon_shop_terms
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER coupon_user_usage_touch_updated_at BEFORE UPDATE ON public.coupon_user_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- The per-customer limit lives in the database (data-integrity.md section 5.3): a use can only be added while the
-- customer is under the coupon's limit, whatever code path tries it. Taking a use back is always allowed.
CREATE FUNCTION public.coupon_user_usage_limit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  per_user integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.uses <= OLD.uses THEN
    RETURN NEW;
  END IF;
  SELECT usage_limit_per_user INTO per_user FROM public.coupons WHERE id = NEW.coupon_id;
  IF NEW.uses > per_user THEN
    RAISE EXCEPTION 'coupon per-customer limit reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER coupon_user_usage_limit BEFORE INSERT OR UPDATE ON public.coupon_user_usage
  FOR EACH ROW EXECUTE FUNCTION public.coupon_user_usage_limit();