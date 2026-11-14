-- Admin people screens (design 2026-11-15): customer search by phone (last 10 digits) and name prefix, and the audit
-- viewer's filters (entity, action, actor, IST date range; newest first by id). Plain CREATE INDEX inside the
-- migration's transaction (small tables at launch; lock_timeout keeps it from queueing behind a long transaction).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "users_phone_last10_idx" ON "users" USING btree (right("phone", 10)) WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "users_name_prefix_idx" ON "users" USING btree (lower("name") text_pattern_ops) WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "audit_log_entity_id_idx" ON "audit_log" USING btree ("entity","id");--> statement-breakpoint
CREATE INDEX "audit_log_action_id_idx" ON "audit_log" USING btree ("action","id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_user_id","id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");