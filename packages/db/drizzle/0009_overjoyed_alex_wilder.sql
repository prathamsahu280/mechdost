CREATE TABLE "partner_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_kind" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason" text NOT NULL,
	"internal_note" text,
	"ends_at" timestamp with time zone,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_status_events_kind_valid" CHECK ("partner_status_events"."partner_kind" in ('shop','workshop','mechanic')),
	CONSTRAINT "partner_status_events_status_valid" CHECK ("partner_status_events"."to_status" in ('approved','paused','suspended') and "partner_status_events"."from_status" <> "partner_status_events"."to_status"),
	CONSTRAINT "partner_status_events_reason_length" CHECK (char_length("partner_status_events"."reason") between 5 and 300)
);
--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT "shops_status_valid";--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "status_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_status_events" ADD CONSTRAINT "partner_status_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_status_events_partner_kind_partner_id_created_at_index" ON "partner_status_events" USING btree ("partner_kind","partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_status_events_changed_by_index" ON "partner_status_events" USING btree ("changed_by");--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_standing_has_reason" CHECK ("shops"."status" not in ('paused','suspended') or (char_length("shops"."status_reason") >= 5 and "shops"."status_changed_by" is not null));--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_status_valid" CHECK ("shops"."status" in ('pending','approved','paused','suspended'));