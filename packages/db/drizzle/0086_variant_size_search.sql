ALTER TABLE "product_variants" ADD COLUMN "size_compact" text;--> statement-breakpoint
-- Search by size (spec 02 "Search by size", design 2026-11-25): a product is found by any of its active sizes.
-- `size_compact` is the variant's size text (every option value, then the pack) with only A-Z and 0-9 left, so
-- "90/90-12 54J TL", "90 90 12" and "9090-12" all meet in "909012...". A trigger keeps it current on every insert
-- and options / pack change; the trigram index makes the LIKE '%...%' an index scan (every query indexed, rule 14).
CREATE OR REPLACE FUNCTION public.variant_size_compact(opts jsonb, qty integer, unit text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(upper(coalesce((SELECT string_agg(e.value, ' ' ORDER BY (e.key <> 'size'), e.key) FROM jsonb_each_text(opts) e), '')
    || ' ' || coalesce(qty::text, '') || coalesce(unit, '')), '[^A-Z0-9]', '', 'g')
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.product_variants_size_compact() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.size_compact := public.variant_size_compact(NEW.options, NEW.net_qty, NEW.net_unit);
  RETURN NEW;
END $$;--> statement-breakpoint
-- Backfill without bumping `version` / `updated_at`: staff may have a size open for editing.
ALTER TABLE public.product_variants DISABLE TRIGGER USER;--> statement-breakpoint
UPDATE public.product_variants SET size_compact = public.variant_size_compact(options, net_qty, net_unit);--> statement-breakpoint
ALTER TABLE public.product_variants ENABLE TRIGGER USER;--> statement-breakpoint
CREATE TRIGGER product_variants_size_compact BEFORE INSERT OR UPDATE OF options, net_qty, net_unit ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.product_variants_size_compact();--> statement-breakpoint
CREATE INDEX "product_variants_size_compact_trgm_idx" ON "product_variants" USING gin ("size_compact" gin_trgm_ops);
