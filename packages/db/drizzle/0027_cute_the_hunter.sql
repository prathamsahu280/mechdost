CREATE TABLE "customer_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" text NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"ends_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lifted_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_blocks_level_valid" CHECK ("customer_blocks"."level" in ('cod_only','orders','full')),
	CONSTRAINT "customer_blocks_reason_valid" CHECK ("customer_blocks"."reason_code" in ('cod_refused','fake_orders','payment_fraud','abusive_behaviour','policy_violation','account_security','other')),
	CONSTRAINT "customer_blocks_note_length" CHECK ("customer_blocks"."note" is null or char_length("customer_blocks"."note") <= 500),
	CONSTRAINT "customer_blocks_ends_after_start" CHECK ("customer_blocks"."ends_at" is null or "customer_blocks"."ends_at" > "customer_blocks"."created_at"),
	CONSTRAINT "customer_blocks_lift_complete" CHECK (("customer_blocks"."lifted_at" is null and "customer_blocks"."lifted_by" is null and "customer_blocks"."lifted_reason" is null) or ("customer_blocks"."lifted_at" is not null and "customer_blocks"."lifted_by" is not null and char_length("customer_blocks"."lifted_reason") between 5 and 300)),
	CONSTRAINT "customer_blocks_not_self" CHECK ("customer_blocks"."created_by" <> "customer_blocks"."user_id")
);
--> statement-breakpoint
ALTER TABLE "customer_blocks" ADD CONSTRAINT "customer_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_blocks" ADD CONSTRAINT "customer_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_blocks" ADD CONSTRAINT "customer_blocks_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_blocks_one_active_uq" ON "customer_blocks" USING btree ("user_id","level") WHERE lifted_at is null;--> statement-breakpoint
CREATE INDEX "customer_blocks_user_id_created_at_index" ON "customer_blocks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_blocks_created_by_index" ON "customer_blocks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "customer_blocks_lifted_by_index" ON "customer_blocks" USING btree ("lifted_by");--> statement-breakpoint
-- Deny-all for the Data API (anon/authenticated); only the API role reads and writes blocks (spec 13).
ALTER TABLE public.customer_blocks ENABLE ROW LEVEL SECURITY;