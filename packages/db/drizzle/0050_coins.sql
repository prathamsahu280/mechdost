-- MechDost Coins on the real API (spec 20; Q24 answered 2026-11-13): coin_rewards (earned coins waiting for the
-- unlock days, then credited once by the worker), each sub-order's share of the checkout's coins, a reason code
-- on every ledger row (hard rule 16), shop_payout_entries (append-only: what MechDost owes a shop, e.g. the coin
-- discount of a delivered part) and indexes for admin activity and the expiry job. RLS on, client roles revoked,
-- version/updated_at triggers on coin_rewards, append-only trigger on shop_payout_entries.
-- Numbered 0050 (after 0049 quotes; 0051 shops; launch plan 2026-11-14).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "coin_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"coins" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"order_id" uuid,
	"service_request_id" uuid,
	"ledger_id" uuid,
	"cancel_reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_rewards_source_valid" CHECK ("coin_rewards"."source" in ('order','first_order','workshop_booking')),
	CONSTRAINT "coin_rewards_status_valid" CHECK ("coin_rewards"."status" in ('pending','credited','cancelled')),
	CONSTRAINT "coin_rewards_coins_positive" CHECK ("coin_rewards"."coins" > 0 and "coin_rewards"."coins" <= 1000000),
	CONSTRAINT "coin_rewards_credited_has_ledger" CHECK (("coin_rewards"."status" = 'credited') = ("coin_rewards"."ledger_id" is not null)),
	CONSTRAINT "coin_rewards_cancel_reason" CHECK (("coin_rewards"."status" = 'cancelled') = ("coin_rewards"."cancel_reason_code" is not null) and ("coin_rewards"."cancel_reason_code" is null or "coin_rewards"."cancel_reason_code" in ('order_cancelled','order_refunded','request_cancelled'))),
	CONSTRAINT "coin_rewards_has_source_ref" CHECK (case "coin_rewards"."source" when 'workshop_booking' then "coin_rewards"."service_request_id" is not null else "coin_rewards"."order_id" is not null end)
);
--> statement-breakpoint
CREATE TABLE "shop_payout_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_id" uuid,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"idem_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_payout_entries_idemKey_unique" UNIQUE("idem_key"),
	CONSTRAINT "shop_payout_entries_kind_valid" CHECK ("shop_payout_entries"."kind" in ('coin_discount')),
	CONSTRAINT "shop_payout_entries_amount_positive" CHECK ("shop_payout_entries"."amount_paise" > 0),
	CONSTRAINT "shop_payout_entries_order_kind" CHECK ("shop_payout_entries"."kind" <> 'coin_discount' or "shop_payout_entries"."order_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coins_redeemed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coin_discount_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "coin_rewards" ADD CONSTRAINT "coin_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_rewards" ADD CONSTRAINT "coin_rewards_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_rewards" ADD CONSTRAINT "coin_rewards_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_rewards" ADD CONSTRAINT "coin_rewards_ledger_id_coin_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."coin_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_payout_entries" ADD CONSTRAINT "shop_payout_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_payout_entries" ADD CONSTRAINT "shop_payout_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_rewards_order_source_uq" ON "coin_rewards" USING btree ("source","order_id") WHERE "coin_rewards"."order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_rewards_service_uq" ON "coin_rewards" USING btree ("service_request_id") WHERE "coin_rewards"."service_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_rewards_first_order_uq" ON "coin_rewards" USING btree ("user_id") WHERE "coin_rewards"."source" = 'first_order' and "coin_rewards"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "coin_rewards_status_available_at_index" ON "coin_rewards" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "coin_rewards_user_id_created_at_index" ON "coin_rewards" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coin_rewards_order_id_index" ON "coin_rewards" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "coin_rewards_ledger_id_index" ON "coin_rewards" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "shop_payout_entries_shop_id_created_at_id_index" ON "shop_payout_entries" USING btree ("shop_id","created_at","id");--> statement-breakpoint
CREATE INDEX "shop_payout_entries_order_id_index" ON "shop_payout_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shop_payout_entries_created_at_id_index" ON "shop_payout_entries" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "coin_ledger_created_at_id_index" ON "coin_ledger" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "coin_ledger_expiring_idx" ON "coin_ledger" USING btree ("expires_at") WHERE "coin_ledger"."expires_at" is not null and "coin_ledger"."delta" > 0;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coins_consistent" CHECK ("orders"."coins_redeemed" >= 0 and "orders"."coin_discount_paise" >= 0 and "orders"."coin_discount_paise" <= "orders"."discount_paise" and ("orders"."coins_redeemed" = 0) = ("orders"."coin_discount_paise" = 0));--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_reason_code_valid" CHECK ("coin_ledger"."reason_code" is null or "coin_ledger"."reason_code" in ('order','first_order','workshop_booking','goodwill','service_recovery','promotion','correction','fraud_reversal','other','order_redeem','order_cancelled','expired'));--> statement-breakpoint
ALTER TABLE public.coin_rewards ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.shop_payout_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.coin_rewards, public.shop_payout_entries FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER coin_rewards_bump_version BEFORE UPDATE ON public.coin_rewards
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER coin_rewards_touch_updated_at BEFORE UPDATE ON public.coin_rewards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
-- Money owed to shops is history: append-only like the coin ledger (corrections are new rows).
CREATE TRIGGER shop_payout_entries_append_only BEFORE UPDATE OR DELETE ON public.shop_payout_entries
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
