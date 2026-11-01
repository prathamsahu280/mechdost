CREATE TABLE "coin_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_accounts_balance_nonneg" CHECK ("coin_accounts"."balance" >= 0),
	CONSTRAINT "coin_accounts_lifetime_nonneg" CHECK ("coin_accounts"."lifetime_earned" >= 0)
);
--> statement-breakpoint
CREATE TABLE "coin_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"order_group_id" uuid,
	"idem_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_ledger_idemKey_unique" UNIQUE("idem_key"),
	CONSTRAINT "coin_ledger_delta_nonzero" CHECK ("coin_ledger"."delta" <> 0),
	CONSTRAINT "coin_ledger_kind_valid" CHECK ("coin_ledger"."kind" in ('earn','redeem','restore','expire','adjust')),
	CONSTRAINT "coin_ledger_sign_matches_kind" CHECK (("coin_ledger"."kind" in ('earn','restore') and "coin_ledger"."delta" > 0) or ("coin_ledger"."kind" in ('redeem','expire') and "coin_ledger"."delta" < 0) or "coin_ledger"."kind" = 'adjust'),
	CONSTRAINT "coin_ledger_redeem_has_order" CHECK ("coin_ledger"."kind" not in ('redeem','restore') or "coin_ledger"."order_group_id" is not null),
	CONSTRAINT "coin_ledger_adjust_has_staff" CHECK ("coin_ledger"."kind" <> 'adjust' or "coin_ledger"."created_by" is not null),
	CONSTRAINT "coin_ledger_reason_length" CHECK (char_length("coin_ledger"."reason") between 3 and 200),
	CONSTRAINT "coin_ledger_idem_key_format" CHECK ("coin_ledger"."idem_key" ~ '^[A-Za-z0-9:_-]{10,100}$')
);
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_mode_valid";--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "coins_redeemed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_groups" ADD COLUMN "coin_discount_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coin_accounts" ADD CONSTRAINT "coin_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_order_group_id_order_groups_id_fk" FOREIGN KEY ("order_group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_ledger" ADD CONSTRAINT "coin_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coin_ledger_user_id_created_at_index" ON "coin_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coin_ledger_order_group_id_index" ON "coin_ledger" USING btree ("order_group_id");--> statement-breakpoint
CREATE INDEX "coin_ledger_created_by_index" ON "coin_ledger" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_coins_consistent" CHECK ("order_groups"."coins_redeemed" >= 0 and "order_groups"."coin_discount_paise" >= 0 and "order_groups"."coin_discount_paise" <= "order_groups"."discount_paise" and ("order_groups"."coins_redeemed" = 0) = ("order_groups"."coin_discount_paise" = 0));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_mode_valid" CHECK ("refunds"."mode" in ('source','bank_upi'));