-- Service-area PIN codes are admin-configurable (spec 15 "PIN codes", decision 2026-11-14): Hindi area name, an
-- `active` master switch with a reason code + note, `source` (seed rows may be refreshed by the PIN seed, admin rows
-- are left alone), a per-PIN free-delivery threshold (spec 03 "Delivery charges"), and `version` for compare-and-set.
-- All columns are nullable or defaulted, so existing rows (the five Raipur PINs) stay valid and active.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "locality_hi" text;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "inactive_reason" text;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "inactive_note" text;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "source" text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "free_delivery_min_paise" bigint;--> statement-breakpoint
ALTER TABLE "pincodes" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_locality_pair" CHECK (("pincodes"."locality" is null) = ("pincodes"."locality_hi" is null));--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_locality_len" CHECK ("pincodes"."locality" is null or (char_length("pincodes"."locality") between 2 and 80 and char_length("pincodes"."locality_hi") between 2 and 80));--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_inactive_reason" CHECK (("pincodes"."active" and "pincodes"."inactive_reason" is null and "pincodes"."inactive_note" is null) or (not "pincodes"."active" and "pincodes"."inactive_reason" is not null and "pincodes"."inactive_reason" in ('outside_service_area','not_launched_yet','no_partners','operational_pause','other')));--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_inactive_note_len" CHECK ("pincodes"."inactive_note" is null or char_length("pincodes"."inactive_note") between 1 and 300);--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_free_delivery_min" CHECK ("pincodes"."free_delivery_min_paise" is null or "pincodes"."free_delivery_min_paise" between 0 and 10000000);--> statement-breakpoint
ALTER TABLE "pincodes" ADD CONSTRAINT "pincodes_source_valid" CHECK ("pincodes"."source" in ('seed','admin'));--> statement-breakpoint
-- `pincodes` existed before 0031's loop ran without a `version` column, so it needs its bump trigger now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pincodes_bump_version') THEN
    CREATE TRIGGER pincodes_bump_version BEFORE UPDATE ON public.pincodes
      FOR EACH ROW EXECUTE FUNCTION public.bump_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pincodes_touch_updated_at') THEN
    CREATE TRIGGER pincodes_touch_updated_at BEFORE UPDATE ON public.pincodes
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
