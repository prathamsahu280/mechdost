-- Product photos, server cart, wishlist (spec 02 / 03, design 2026-11-15 items 1, 3, 5). Built as 0067 on its branch; the
-- coordinator renumbers at merge. `product_photos` existed since 0001 but no code ever wrote to it (the catalogue read it
-- only), so it is reshaped in place: the empty table is cleared first so the new NOT NULL columns can be added, and the
-- old `storage_path` / `blurhash` columns go (the keys now live on `media_objects` and the placeholder is `lqip`).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DELETE FROM "product_photos";--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" smallint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cart_variant_uq" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_items_qty_range" CHECK ("cart_items"."qty" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_status_valid" CHECK ("carts"."status" in ('active','closed'))
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_user_product_uq" UNIQUE("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "media_objects" DROP CONSTRAINT "media_objects_owner_kind_valid";--> statement-breakpoint
DROP INDEX "product_photos_product_id_sort_index";--> statement-breakpoint
ALTER TABLE "product_photos" ALTER COLUMN "alt_hi" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ALTER COLUMN "sort" SET DATA TYPE smallint;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "media_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "path640" text NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "lqip" text;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "submitted_by_shop_id" uuid;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_photos" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_photos" DROP COLUMN "storage_path";--> statement-breakpoint
ALTER TABLE "product_photos" DROP COLUMN "blurhash";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_items_variant_id_index" ON "cart_items" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_one_active_per_user" ON "carts" USING btree ("user_id") WHERE "carts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "wishlist_items_product_id_index" ON "wishlist_items" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_media_id_media_objects_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_submitted_by_shop_id_shops_id_fk" FOREIGN KEY ("submitted_by_shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_photos_media_uq" ON "product_photos" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "product_photos_product_live_idx" ON "product_photos" USING btree ("product_id","sort") WHERE "product_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "product_photos_pending_idx" ON "product_photos" USING btree ("created_at") WHERE "product_photos"."status" = 'pending' and "product_photos"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "product_photos_submitted_by_shop_id_index" ON "product_photos" USING btree ("submitted_by_shop_id");--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_status_valid" CHECK ("product_photos"."status" in ('pending','approved'));--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_sort_range" CHECK ("product_photos"."sort" between 0 and 7);--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_alt_len" CHECK (char_length("product_photos"."alt") between 3 and 160 and char_length("product_photos"."alt_hi") between 3 and 160);--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_lqip_len" CHECK ("product_photos"."lqip" is null or char_length("product_photos"."lqip") <= 2000);--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_path640_safe" CHECK ("product_photos"."path640" ~ '^[a-z0-9-]+/[0-9a-f-]{36}/[0-9a-f-]{36}-640[.]webp$');--> statement-breakpoint
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_rejected_has_reason" CHECK ("product_photos"."reject_reason" is null or "product_photos"."deleted_at" is not null);--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_owner_kind_valid" CHECK ("media_objects"."owner_kind" in ('service_photo','ticket_message','product_photo'));--> statement-breakpoint
-- New tables: RLS on, no direct client access (the API connects as owner); version + updated_at triggers on the mutable ones (spec 14).
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.carts FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.cart_items FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.wishlist_items FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER carts_bump_version BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER carts_touch_updated_at BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER cart_items_bump_version BEFORE UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER cart_items_touch_updated_at BEFORE UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER product_photos_bump_version BEFORE UPDATE ON public.product_photos
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER product_photos_touch_updated_at BEFORE UPDATE ON public.product_photos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
