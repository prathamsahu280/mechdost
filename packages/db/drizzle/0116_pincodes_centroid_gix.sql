-- Nearest-PIN shortlist for "use my location" (spec 06, founder 2026-11-28): KNN + ST_DWithin on the PIN centroid.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "pincodes_centroid_gix" ON "pincodes" USING gist ("centroid");
