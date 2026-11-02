-- First-party event store, completed (spec 12; hard rules 9 and 16). The partitioned `events` table exists since
-- 0002 (unused so far). Server events for money and state changes are now written in the same transaction as the
-- change, so they are recorded exactly once. This migration adds the source, a DB-clock default for
-- occurred_at, props shape/size limits, append-only enforcement, a props index and the partition maintainer.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';
--> statement-breakpoint
ALTER TABLE public.events ALTER COLUMN occurred_at SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE public.events ADD CONSTRAINT events_source_valid CHECK (source in ('server', 'web', 'app'));
--> statement-breakpoint
ALTER TABLE public.events ADD CONSTRAINT events_props_object
  CHECK (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 8192);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_props_gin ON public.events USING gin (props jsonb_path_ops);
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint
ALTER TABLE public.events_default ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Monthly partitions from this month to `months_ahead` months ahead, each with RLS on (Data API deny-all).
-- The worker calls it at start and every 12 h; the default partition only catches rows if a month was missed.
CREATE OR REPLACE FUNCTION public.ensure_event_partitions(months_ahead integer DEFAULT 3) RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  m date := date_trunc('month', now() at time zone 'UTC')::date;
  created integer := 0;
  part text;
BEGIN
  FOR i IN 0..greatest(months_ahead, 0) LOOP
    part := 'events_' || to_char(m, 'YYYY_MM');
    IF to_regclass('public.' || part) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.events FOR VALUES FROM (%L) TO (%L)',
        part, m::timestamptz, (m + interval '1 month')::timestamptz);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', part);
      created := created + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN created;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ensure_event_partitions(integer) FROM PUBLIC;
--> statement-breakpoint
SELECT public.ensure_event_partitions(3);
