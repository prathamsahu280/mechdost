CREATE INDEX "user_roles_granted_by_index" ON "user_roles" USING btree ("granted_by");--> statement-breakpoint
CREATE INDEX "content_blocks_city_id_index" ON "content_blocks" USING btree ("city_id");