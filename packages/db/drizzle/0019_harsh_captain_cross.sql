CREATE TABLE "live_revocations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "live_revocations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"firebase_uid" text NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_revocations_reason_valid" CHECK ("live_revocations"."reason" in ('deactivated','partner_removed','role_revoked'))
);
--> statement-breakpoint
CREATE INDEX "live_revocations_pending_idx" ON "live_revocations" USING btree ("id") WHERE "live_revocations"."done_at" is null;