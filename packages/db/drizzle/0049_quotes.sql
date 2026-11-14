-- Bulk quotes (spec 19; real-API launch 2026-11-14): quote_requests, quote_lines (request snapshot), quote_messages
-- (thread), quote_offers (versioned, one active per quote), quote_events (append-only timeline); order_groups.quote_id /
-- quote_offer_id (one order per quote and per offer: an order group is one checkout, split into per-shop sub-orders)
-- and order_items.price_source ('catalogue' | 'quote': a negotiated price may sit below the shop's approved price).
-- RLS on, client roles revoked, version/updated_at triggers, live pings, and the quotes:* permissions for the system
-- staff roles (the seed keeps the catalogue exact afterwards).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "quote_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "quote_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"quote_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_events_kind_valid" CHECK ("quote_events"."kind" in ('requested','message','offer','status')),
	CONSTRAINT "quote_events_actor_valid" CHECK ("quote_events"."actor_type" in ('customer','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"title_hi" text,
	"qty" smallint NOT NULL,
	"list_unit_paise" bigint,
	"mrp_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_lines_line_uq" UNIQUE("quote_id","line_no"),
	CONSTRAINT "quote_lines_variant_uq" UNIQUE("quote_id","variant_id"),
	CONSTRAINT "quote_lines_line_no" CHECK ("quote_lines"."line_no" between 1 and 20),
	CONSTRAINT "quote_lines_qty_range" CHECK ("quote_lines"."qty" between 1 and 99),
	CONSTRAINT "quote_lines_prices_nonneg" CHECK ("quote_lines"."mrp_paise" >= 0 and ("quote_lines"."list_unit_paise" is null or "quote_lines"."list_unit_paise" >= 0))
);
--> statement-breakpoint
CREATE TABLE "quote_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_messages_role_valid" CHECK ("quote_messages"."author_role" in ('customer','staff','system')),
	CONSTRAINT "quote_messages_body_len" CHECK (char_length("quote_messages"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "quote_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"offer_version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"lines" jsonb NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"delivery_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"list_total_paise" bigint,
	"payment_method" text DEFAULT 'cod' NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"terms" text,
	"created_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_offers_version_uq" UNIQUE("quote_id","offer_version"),
	CONSTRAINT "quote_offers_version_positive" CHECK ("quote_offers"."offer_version" > 0),
	CONSTRAINT "quote_offers_status_valid" CHECK ("quote_offers"."status" in ('active','superseded','accepted','closed')),
	CONSTRAINT "quote_offers_lines_array" CHECK (jsonb_typeof("quote_offers"."lines") = 'array' and jsonb_array_length("quote_offers"."lines") between 1 and 20),
	CONSTRAINT "quote_offers_amounts" CHECK ("quote_offers"."subtotal_paise" > 0 and "quote_offers"."delivery_paise" >= 0 and "quote_offers"."total_paise" = "quote_offers"."subtotal_paise" + "quote_offers"."delivery_paise"),
	CONSTRAINT "quote_offers_list_total_nonneg" CHECK ("quote_offers"."list_total_paise" is null or "quote_offers"."list_total_paise" >= 0),
	CONSTRAINT "quote_offers_payment_valid" CHECK ("quote_offers"."payment_method" in ('cod')),
	CONSTRAINT "quote_offers_valid_after_created" CHECK ("quote_offers"."valid_until" > "quote_offers"."created_at"),
	CONSTRAINT "quote_offers_terms_len" CHECK ("quote_offers"."terms" is null or char_length("quote_offers"."terms") between 1 and 500),
	CONSTRAINT "quote_offers_decided" CHECK ("quote_offers"."status" <> 'accepted' or "quote_offers"."decided_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_reason_code" text,
	"closing_message" text,
	"offer_version" integer DEFAULT 0 NOT NULL,
	"list_total_paise" bigint,
	"units" integer NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_by" text,
	"closed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "quote_requests_idempotency_uq" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "quote_requests_code_format" CHECK ("quote_requests"."code" ~ '^QT-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$'),
	CONSTRAINT "quote_requests_status_valid" CHECK ("quote_requests"."status" in ('open','negotiating','offered','accepted','declined','expired','withdrawn')),
	CONSTRAINT "quotes_reason_code_valid" CHECK (case "quote_requests"."status"
        when 'declined' then "quote_requests"."status_reason_code" in ('price_too_high','found_elsewhere','no_longer_needed','delivery_too_slow','other')
        when 'withdrawn' then "quote_requests"."status_reason_code" in ('cannot_supply','not_serviceable','duplicate','suspected_fraud','customer_unreachable','other')
        when 'expired' then "quote_requests"."status_reason_code" in ('offer_expired','inactive')
        else "quote_requests"."status_reason_code" is null end),
	CONSTRAINT "quotes_withdrawn_explained" CHECK ("quote_requests"."status" <> 'withdrawn' or char_length("quote_requests"."closing_message") between 10 and 500),
	CONSTRAINT "quotes_closed_at" CHECK (("quote_requests"."closed_at" is null) = ("quote_requests"."status" in ('open','negotiating','offered'))),
	CONSTRAINT "quote_requests_offered_has_offer" CHECK ("quote_requests"."status" not in ('offered','accepted') or "quote_requests"."offer_version" > 0),
	CONSTRAINT "quote_requests_offer_version_nonneg" CHECK ("quote_requests"."offer_version" >= 0),
	CONSTRAINT "quote_requests_units_range" CHECK ("quote_requests"."units" between 1 and 1980),
	CONSTRAINT "quote_requests_list_total_nonneg" CHECK ("quote_requests"."list_total_paise" is null or "quote_requests"."list_total_paise" >= 0),
	CONSTRAINT "quotes_last_message_by_valid" CHECK ("quote_requests"."last_message_by" is null or "quote_requests"."last_message_by" in ('customer','staff')),
	CONSTRAINT "quote_requests_address_object" CHECK (jsonb_typeof("quote_requests"."shipping_address") = 'object'),
	CONSTRAINT "quote_requests_idempotency_format" CHECK ("quote_requests"."idempotency_key" ~ '^[A-Za-z0-9_-]{16,64}$')
);
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_shop_unit_valid";--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "quote_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "price_source" text DEFAULT 'catalogue' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_events" ADD CONSTRAINT "quote_events_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_messages" ADD CONSTRAINT "quote_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_offers" ADD CONSTRAINT "quote_offers_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_offers" ADD CONSTRAINT "quote_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_pincode_pincodes_pincode_fk" FOREIGN KEY ("pincode") REFERENCES "public"."pincodes"("pincode") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_events_quote_id_id_index" ON "quote_events" USING btree ("quote_id","id");--> statement-breakpoint
CREATE INDEX "quote_lines_product_id_index" ON "quote_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "quote_lines_variant_id_index" ON "quote_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "quote_messages_quote_id_created_at_index" ON "quote_messages" USING btree ("quote_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_messages_author_user_id_index" ON "quote_messages" USING btree ("author_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_offers_one_active_uq" ON "quote_offers" USING btree ("quote_id") WHERE "quote_offers"."status" = 'active';--> statement-breakpoint
CREATE INDEX "quote_offers_created_by_index" ON "quote_offers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "quote_requests_user_id_created_at_index" ON "quote_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_requests_status_city_id_updated_at_index" ON "quote_requests" USING btree ("status","city_id","updated_at");--> statement-breakpoint
CREATE INDEX "quote_requests_status_expires_at_index" ON "quote_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "quote_requests_city_id_index" ON "quote_requests" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "quote_requests_pincode_index" ON "quote_requests" USING btree ("pincode");--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_quote_id_quote_requests_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_quote_offer_id_quote_offers_id_fk" FOREIGN KEY ("quote_offer_id") REFERENCES "public"."quote_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_quote_uq" ON "order_groups" USING btree ("quote_id") WHERE "order_groups"."quote_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "order_groups_quote_offer_uq" ON "order_groups" USING btree ("quote_offer_id") WHERE "order_groups"."quote_offer_id" is not null;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_quote_pair" CHECK (("order_groups"."quote_id" is null) = ("order_groups"."quote_offer_id" is null));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_source_valid" CHECK ("order_items"."price_source" in ('catalogue','quote'));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_shop_unit_valid" CHECK ("order_items"."shop_unit_paise" is null or ("order_items"."shop_unit_paise" >= 0 and ("order_items"."shop_unit_paise" <= "order_items"."unit_paise" or "order_items"."price_source" = 'quote')));--> statement-breakpoint
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.quote_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.quote_offers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.quote_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.quote_requests, public.quote_lines, public.quote_messages, public.quote_offers,
  public.quote_events FROM anon, authenticated;--> statement-breakpoint
-- Snapshots and the thread are append-only (same guard as order_events, 0002).
CREATE TRIGGER quote_lines_append_only BEFORE UPDATE OR DELETE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER quote_messages_append_only BEFORE UPDATE OR DELETE ON public.quote_messages
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER quote_events_append_only BEFORE UPDATE OR DELETE ON public.quote_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- Version and updated_at triggers for the new mutable tables (same loop as 0044).
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
END $$;--> statement-breakpoint
-- Any change to a quote (status, a new message, a new offer) pings its customer and the city's quote staff (relay).
CREATE OR REPLACE FUNCTION public.live_quote_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM public.live_enqueue('quote:' || NEW.id, 'quote', NEW.id, NEW.version, 'quote.changed');
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER quote_requests_live AFTER INSERT OR UPDATE ON public.quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.live_quote_changed();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.live_quote_changed() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
-- New permissions (packages/shared/src/rbac.ts) for the system staff roles, so the quote desk works right after the
-- migration; `pnpm db:seed` (syncRbacCatalogue) keeps the catalogue exact afterwards. Idempotent.
INSERT INTO public.permissions (key, description) VALUES
  ('quotes:request', 'Ask MechDost for a bulk price and negotiate it'),
  ('quotes:read', 'Read bulk quotes in scope'),
  ('quotes:negotiate', 'Reply to bulk quotes, send price offers and withdraw quotes')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT r.id, p.key FROM public.roles r
CROSS JOIN (VALUES ('quotes:read'), ('quotes:negotiate')) AS p(key)
WHERE r.key IN ('super_admin', 'ops_manager', 'city_manager')
ON CONFLICT DO NOTHING;
