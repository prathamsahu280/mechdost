-- Admin customer prices (plan 2026-11-13 admin catalogue + PIN prices; Q26): admin_prices (city price + PIN
-- overrides) and order_items.shop_unit_paise (the shop's approved price, for MechDost's margin, Q11).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "admin_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"pincode" text,
	"selling_paise" bigint NOT NULL,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_prices_positive" CHECK ("admin_prices"."selling_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "shop_unit_paise" bigint;--> statement-breakpoint
ALTER TABLE "admin_prices" ADD CONSTRAINT "admin_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_prices" ADD CONSTRAINT "admin_prices_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_prices" ADD CONSTRAINT "admin_prices_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_prices" ADD CONSTRAINT "admin_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_prices_city_uq" ON "admin_prices" USING btree ("variant_id","city_id") WHERE "admin_prices"."pincode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_prices_pin_uq" ON "admin_prices" USING btree ("variant_id","city_id","pincode") WHERE "admin_prices"."pincode" is not null;--> statement-breakpoint
CREATE INDEX "admin_prices_city_id_index" ON "admin_prices" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "admin_prices_pincode_index" ON "admin_prices" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "admin_prices_updated_by_index" ON "admin_prices" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shop_unit_valid" CHECK ("order_items"."shop_unit_paise" is null or ("order_items"."shop_unit_paise" >= 0 and "order_items"."shop_unit_paise" <= "order_items"."unit_paise")) NOT VALID;--> statement-breakpoint
ALTER TABLE "order_items" VALIDATE CONSTRAINT "order_items_shop_unit_valid";--> statement-breakpoint
ALTER TABLE public.admin_prices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.admin_prices FROM anon, authenticated;--> statement-breakpoint
-- Version and updated_at triggers for the new mutable table (same loop as 0031/0038).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'version' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_bump_version')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
                   r.table_name || '_bump_version', r.table_name);
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_touch_updated_at')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   r.table_name || '_touch_updated_at', r.table_name);
  END LOOP;
END $$;
