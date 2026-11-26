SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "delivery_agent_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"reverses_id" uuid,
	"idem_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_agent_payouts_reversesId_unique" UNIQUE("reverses_id"),
	CONSTRAINT "delivery_agent_payouts_idemKey_unique" UNIQUE("idem_key"),
	CONSTRAINT "delivery_agent_payouts_kind_valid" CHECK ("delivery_agent_payouts"."kind" in ('payment','reversal')),
	CONSTRAINT "delivery_agent_payouts_method_valid" CHECK ("delivery_agent_payouts"."method" in ('upi','bank_transfer','cash','other')),
	CONSTRAINT "delivery_agent_payouts_sign" CHECK (("delivery_agent_payouts"."kind" = 'payment' and "delivery_agent_payouts"."amount_paise" > 0 and "delivery_agent_payouts"."reverses_id" is null) or ("delivery_agent_payouts"."kind" = 'reversal' and "delivery_agent_payouts"."amount_paise" < 0 and "delivery_agent_payouts"."reverses_id" is not null and "delivery_agent_payouts"."note" is not null)),
	CONSTRAINT "delivery_agent_payouts_period" CHECK ("delivery_agent_payouts"."period_from" <= "delivery_agent_payouts"."period_to"),
	CONSTRAINT "delivery_agent_payouts_other_note" CHECK ("delivery_agent_payouts"."method" <> 'other' or "delivery_agent_payouts"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "delivery_agent_payouts" ADD CONSTRAINT "delivery_agent_payouts_agent_id_delivery_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."delivery_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_payouts" ADD CONSTRAINT "delivery_agent_payouts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_payouts" ADD CONSTRAINT "delivery_agent_payouts_reverses_id_delivery_agent_payouts_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."delivery_agent_payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_payouts" ADD CONSTRAINT "delivery_agent_payouts_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_agent_payouts_agent_idx" ON "delivery_agent_payouts" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "delivery_agent_payouts_city_idx" ON "delivery_agent_payouts" USING btree ("city_id","created_at","id");--> statement-breakpoint
CREATE INDEX "delivery_agent_payouts_recorded_by_index" ON "delivery_agent_payouts" USING btree ("recorded_by");--> statement-breakpoint
-- Hand-written (spec 24, founder 2026-11-26): RLS deny-all, append-only.
ALTER TABLE public.delivery_agent_payouts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.delivery_agent_payouts FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER delivery_agent_payouts_append_only BEFORE UPDATE OR DELETE ON public.delivery_agent_payouts
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
