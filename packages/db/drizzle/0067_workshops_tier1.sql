-- Renumbered at merge 2026-11-15: built as 0064_workshops_tier1 on its branch; now 0067 after workshop analytics (0064),
-- support threads (0065) and coupons (0066). Added at merge: lock_timeout and the version/updated_at triggers on the two
-- new mutable tables (drizzle-postgis-supabase rule 3).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "workshop_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_change_requests_kind_valid" CHECK ("workshop_change_requests"."kind" in ('location','gstin')),
	CONSTRAINT "workshop_change_requests_status_valid" CHECK ("workshop_change_requests"."status" in ('pending','approved','rejected')),
	CONSTRAINT "workshop_change_requests_decided_pair" CHECK (("workshop_change_requests"."status" = 'pending') = ("workshop_change_requests"."decided_at" is null)),
	CONSTRAINT "workshop_change_requests_note_len" CHECK ("workshop_change_requests"."decision_note" is null or char_length("workshop_change_requests"."decision_note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "workshop_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workshop_id" uuid NOT NULL,
	"slot_date" date NOT NULL,
	"hour" smallint NOT NULL,
	"capacity" smallint NOT NULL,
	"booked" smallint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_slots_hour_uq" UNIQUE("workshop_id","slot_date","hour"),
	CONSTRAINT "workshop_slots_hour_range" CHECK ("workshop_slots"."hour" between 0 and 23),
	CONSTRAINT "workshop_slots_capacity_range" CHECK ("workshop_slots"."capacity" between 0 and 20),
	CONSTRAINT "workshop_slots_booked_within_capacity" CHECK ("workshop_slots"."booked" >= 0 and "workshop_slots"."booked" <= "workshop_slots"."capacity")
);
--> statement-breakpoint
ALTER TABLE "service_proposals" ADD COLUMN "slot_hour" smallint;--> statement-breakpoint
ALTER TABLE "service_proposals" ADD COLUMN "slot_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "reschedule_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "slot_capacity" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "workshop_change_requests" ADD CONSTRAINT "workshop_change_requests_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_change_requests" ADD CONSTRAINT "workshop_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_change_requests" ADD CONSTRAINT "workshop_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_slots" ADD CONSTRAINT "workshop_slots_workshop_id_workshops_id_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workshop_change_requests_one_pending_uq" ON "workshop_change_requests" USING btree ("workshop_id","kind") WHERE "workshop_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workshop_change_requests_workshop_id_index" ON "workshop_change_requests" USING btree ("workshop_id");--> statement-breakpoint
CREATE INDEX "workshop_change_requests_requested_by_index" ON "workshop_change_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "workshop_change_requests_decided_by_index" ON "workshop_change_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "workshop_change_requests_status_created_at_index" ON "workshop_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "service_events_expired_workshop_idx" ON "service_events" USING btree (("payload" ->> 'expiredWorkshopId')) WHERE "service_events"."to_status" = 'needs_routing';--> statement-breakpoint
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_slot_hour_range" CHECK ("service_proposals"."slot_hour" is null or "service_proposals"."slot_hour" between 0 and 23);--> statement-breakpoint
ALTER TABLE "service_proposals" ADD CONSTRAINT "service_proposals_release_needs_hour" CHECK ("service_proposals"."slot_released_at" is null or "service_proposals"."slot_hour" is not null);--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_reschedule_range" CHECK ("service_requests"."reschedule_count" between 0 and 2);--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_slot_capacity_range" CHECK ("workshops"."slot_capacity" between 1 and 20);--> statement-breakpoint
ALTER TABLE public.workshop_slots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.workshop_change_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.workshop_slots FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON public.workshop_change_requests FROM anon, authenticated;--> statement-breakpoint
CREATE TRIGGER workshop_slots_bump_version BEFORE UPDATE ON public.workshop_slots
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER workshop_slots_touch_updated_at BEFORE UPDATE ON public.workshop_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();--> statement-breakpoint
CREATE TRIGGER workshop_change_requests_bump_version BEFORE UPDATE ON public.workshop_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_version();--> statement-breakpoint
CREATE TRIGGER workshop_change_requests_touch_updated_at BEFORE UPDATE ON public.workshop_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
