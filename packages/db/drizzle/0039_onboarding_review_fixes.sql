-- Security review 2026-11-13: an applicant is linked as shop owner once (owner_user_id); invites belong to a city.
-- partner_invites is new (0038) and empty, so the NOT NULL column needs no backfill.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "partner_applications" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD COLUMN "city_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invites" ADD CONSTRAINT "partner_invites_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_applications_owner_user_id_index" ON "partner_applications" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "partner_invites_city_id_index" ON "partner_invites" USING btree ("city_id");