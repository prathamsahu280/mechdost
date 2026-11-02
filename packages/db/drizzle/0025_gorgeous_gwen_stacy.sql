ALTER TABLE "support_tickets" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_tickets_city_id_status_index" ON "support_tickets" USING btree ("city_id","status");--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_channel_valid" CHECK ("support_tickets"."channel" in ('web','app','whatsapp','email'));