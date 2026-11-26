CREATE TABLE "customer_savings_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_savings_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"refund_id" uuid,
	"city_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mrp_paise" bigint NOT NULL,
	"coupon_paise" bigint NOT NULL,
	"coins_paise" bigint NOT NULL,
	"delivery_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"refund_paise" bigint DEFAULT 0 NOT NULL,
	"counted_lines" smallint NOT NULL,
	"excluded_lines" smallint NOT NULL,
	"period_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_savings_entries_kind_valid" CHECK ("customer_savings_entries"."kind" in ('delivered','refund')),
	CONSTRAINT "customer_savings_entries_refund_set" CHECK (("customer_savings_entries"."kind" = 'refund') = ("customer_savings_entries"."refund_id" is not null)),
	CONSTRAINT "customer_savings_entries_total" CHECK ("customer_savings_entries"."total_paise" = "customer_savings_entries"."mrp_paise" + "customer_savings_entries"."coupon_paise" + "customer_savings_entries"."coins_paise" + "customer_savings_entries"."delivery_paise"),
	CONSTRAINT "customer_savings_entries_sign" CHECK (case "customer_savings_entries"."kind"
        when 'delivered' then "customer_savings_entries"."mrp_paise" >= 0 and "customer_savings_entries"."coupon_paise" >= 0 and "customer_savings_entries"."coins_paise" >= 0 and "customer_savings_entries"."delivery_paise" >= 0 and "customer_savings_entries"."refund_paise" = 0
        else "customer_savings_entries"."mrp_paise" <= 0 and "customer_savings_entries"."coupon_paise" <= 0 and "customer_savings_entries"."coins_paise" <= 0 and "customer_savings_entries"."delivery_paise" <= 0 and "customer_savings_entries"."refund_paise" > 0 end),
	CONSTRAINT "customer_savings_entries_lines_nonneg" CHECK ("customer_savings_entries"."counted_lines" >= 0 and "customer_savings_entries"."excluded_lines" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_savings_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_savings_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entry_id" bigint NOT NULL,
	"order_item_id" uuid NOT NULL,
	"mrp_saving_paise" bigint NOT NULL,
	CONSTRAINT "customer_savings_lines_entryId_orderItemId_unique" UNIQUE("entry_id","order_item_id")
);
--> statement-breakpoint
CREATE TABLE "variant_price_daily" (
	"day" date NOT NULL,
	"variant_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"mrp_paise" bigint,
	"min_price_paise" bigint,
	"offers" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_price_daily_day_variant_id_city_id_pk" PRIMARY KEY("day","variant_id","city_id"),
	CONSTRAINT "variant_price_daily_amounts" CHECK (("variant_price_daily"."mrp_paise" is null or "variant_price_daily"."mrp_paise" >= 0) and ("variant_price_daily"."min_price_paise" is null or "variant_price_daily"."min_price_paise" >= 0) and "variant_price_daily"."offers" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "mrp_paise" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_waived_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_savings_entries" ADD CONSTRAINT "customer_savings_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_savings_entries" ADD CONSTRAINT "customer_savings_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_savings_entries" ADD CONSTRAINT "customer_savings_entries_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_savings_entries" ADD CONSTRAINT "customer_savings_entries_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_savings_lines" ADD CONSTRAINT "customer_savings_lines_entry_id_customer_savings_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."customer_savings_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_savings_lines" ADD CONSTRAINT "customer_savings_lines_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_daily" ADD CONSTRAINT "variant_price_daily_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_price_daily" ADD CONSTRAINT "variant_price_daily_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_savings_entries_delivered_once" ON "customer_savings_entries" USING btree ("order_id") WHERE "customer_savings_entries"."kind" = 'delivered';--> statement-breakpoint
CREATE UNIQUE INDEX "customer_savings_entries_refund_once" ON "customer_savings_entries" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "customer_savings_entries_user_period_idx" ON "customer_savings_entries" USING btree ("user_id","period_at");--> statement-breakpoint
CREATE INDEX "customer_savings_entries_order_id_index" ON "customer_savings_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "customer_savings_entries_city_id_index" ON "customer_savings_entries" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "customer_savings_lines_order_item_id_index" ON "customer_savings_lines" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "variant_price_daily_variant_id_day_index" ON "variant_price_daily" USING btree ("variant_id","day");--> statement-breakpoint
CREATE INDEX "variant_price_daily_city_id_index" ON "variant_price_daily" USING btree ("city_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_mrp_nonneg" CHECK ("order_items"."mrp_paise" is null or "order_items"."mrp_paise" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_waived_nonneg" CHECK ("orders"."delivery_waived_paise" >= 0);--> statement-breakpoint
-- Hand-written (decision 2026-11-26 "Your savings"): deny-all RLS (the API is the only reader and writer) and
-- append-only ledgers; a correction is a new row, never an edit.
ALTER TABLE public.customer_savings_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.customer_savings_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.variant_price_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.customer_savings_entries, public.customer_savings_lines, public.variant_price_daily FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER customer_savings_entries_append_only BEFORE UPDATE OR DELETE ON public.customer_savings_entries
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER customer_savings_lines_append_only BEFORE UPDATE OR DELETE ON public.customer_savings_lines
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER variant_price_daily_append_only BEFORE UPDATE OR DELETE ON public.variant_price_daily
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
