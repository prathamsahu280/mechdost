-- Shop gives up an accepted order + partner warnings (2026-11-15). Renumbered 0053 -> 0054 at merge (L106).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "partner_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text DEFAULT 'issued' NOT NULL,
	"partner_kind" text NOT NULL,
	"shop_id" uuid,
	"workshop_id" uuid,
	"reason_code" text NOT NULL,
	"note" text,
	"withdraws_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_warnings_event_valid" CHECK ("partner_warnings"."event" in ('issued','withdrawn')),
	CONSTRAINT "partner_warnings_kind_valid" CHECK ("partner_warnings"."partner_kind" in ('shop','workshop')),
	CONSTRAINT "partner_warnings_one_partner" CHECK (("partner_warnings"."partner_kind" = 'shop' and "partner_warnings"."shop_id" is not null and "partner_warnings"."workshop_id" is null)
        or ("partner_warnings"."partner_kind" = 'workshop' and "partner_warnings"."workshop_id" is not null and "partner_warnings"."shop_id" is null)),
	CONSTRAINT "partner_warnings_reason_code_valid" CHECK ("partner_warnings"."reason_code" in ('missed_offers','gave_up_orders','late_deliveries','quality_complaints','pricing_issue','policy_violation','other')),
	CONSTRAINT "partner_warnings_note_length" CHECK ("partner_warnings"."note" is null or char_length("partner_warnings"."note") between 5 and 300),
	CONSTRAINT "partner_warnings_withdraws_consistent" CHECK (("partner_warnings"."event" = 'withdrawn') = ("partner_warnings"."withdraws_id" is not null)),
	CONSTRAINT "partner_warnings_other_needs_note" CHECK ("partner_warnings"."event" = 'withdrawn' or "partner_warnings"."reason_code" <> 'other' or "partner_warnings"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "order_assignments" DROP CONSTRAINT "order_assignments_status_valid";--> statement-breakpoint
ALTER TABLE "order_assignments" ADD COLUMN "given_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_assignments" ADD COLUMN "give_up_reason" text;--> statement-breakpoint
ALTER TABLE "order_assignments" ADD COLUMN "give_up_note" text;--> statement-breakpoint
ALTER TABLE "partner_warnings" ADD CONSTRAINT "partner_warnings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_warnings" ADD CONSTRAINT "partner_warnings_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_warnings" ADD CONSTRAINT "partner_warnings_withdraws_id_partner_warnings_id_fk" FOREIGN KEY ("withdraws_id") REFERENCES "public"."partner_warnings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_warnings" ADD CONSTRAINT "partner_warnings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_warnings_one_withdrawal_uq" ON "partner_warnings" USING btree ("withdraws_id") WHERE "partner_warnings"."withdraws_id" is not null;--> statement-breakpoint
CREATE INDEX "partner_warnings_shop_idx" ON "partner_warnings" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_warnings_workshop_idx" ON "partner_warnings" USING btree ("workshop_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_warnings_created_by_index" ON "partner_warnings" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_give_up_explained" CHECK (("order_assignments"."status" = 'given_up') = ("order_assignments"."given_up_at" is not null and "order_assignments"."give_up_reason" in ('out_of_stock','stock_damaged','cannot_deliver','shop_closed','price_issue','other'))
        and ("order_assignments"."status" = 'given_up' or ("order_assignments"."given_up_at" is null and "order_assignments"."give_up_reason" is null and "order_assignments"."give_up_note" is null)));--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_give_up_note_length" CHECK ("order_assignments"."give_up_note" is null or char_length("order_assignments"."give_up_note") <= 300);--> statement-breakpoint
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_status_valid" CHECK ("order_assignments"."status" in ('offered','accepted','declined','expired','withdrawn','given_up'));--> statement-breakpoint
-- partner_warnings: staff-only table (RLS on, no policy, no direct client access) and append-only history.
ALTER TABLE public.partner_warnings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.partner_warnings FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER partner_warnings_append_only BEFORE UPDATE OR DELETE ON public.partner_warnings
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();--> statement-breakpoint
-- A shop giving up a confirmed order is not shown to the customer (user ruling 2026-11-15): the timeline row for
-- confirmed -> needs_rerouting is written, for staff and analytics, but hidden from the customer.
CREATE OR REPLACE FUNCTION public.log_order_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actor_type text := coalesce(nullif(current_setting('app.actor_type', true), ''), 'system');
  v_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, from_status, to_status, actor_type, actor_id)
    VALUES (NEW.id, NULL, NEW.status, v_actor_type, v_actor_id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, from_status, to_status, actor_type, actor_id, visible_to_customer)
    VALUES (NEW.id, OLD.status, NEW.status, v_actor_type, v_actor_id,
      NOT (OLD.status = 'confirmed' AND NEW.status = 'needs_rerouting'));
  END IF;
  RETURN NEW;
END;
$$;