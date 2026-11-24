DROP INDEX "product_photos_media_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "product_photos_product_media_uq" ON "product_photos" USING btree ("product_id","media_id");--> statement-breakpoint
CREATE INDEX "product_photos_media_idx" ON "product_photos" USING btree ("media_id");