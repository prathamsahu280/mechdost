ALTER TABLE "ticket_messages" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_messages_external_uq" ON "ticket_messages" USING btree ("channel","external_id") WHERE "ticket_messages"."external_id" is not null;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_channel_valid" CHECK ("ticket_messages"."channel" in ('web','app','whatsapp','email','console','system'));