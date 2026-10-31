-- Data-integrity layer (docs/specs/14-data-integrity.md, docs/research/data-integrity.md).
-- Hand-written; drizzle-kit does not model triggers, functions, partitioned tables or RLS lockdown.
-- NOTE for future migrations: new tables with `version`/`updated_at` must get the same triggers (see
-- .claude/skills/drizzle-postgis-supabase), and new tables must have RLS enabled.

-- 1) Append-only tables: history must never be rewritten.
CREATE OR REPLACE FUNCTION public.forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON public.consents
  FOR EACH ROW EXECUTE FUNCTION public.forbid_update_delete();
--> statement-breakpoint

-- 2) Optimistic locking: every UPDATE bumps `version` by exactly one, whatever the application sends.
CREATE OR REPLACE FUNCTION public.bump_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'version' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
                   r.table_name || '_bump_version', r.table_name);
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   r.table_name || '_touch_updated_at', r.table_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- 3) Every order status change writes exactly one timeline event, in the same transaction.
--    The API sets the actor with: SET LOCAL app.actor_type = 'shop'; SET LOCAL app.actor_id = '<uuid>';
CREATE OR REPLACE FUNCTION public.log_order_status_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actor_type text := coalesce(nullif(current_setting('app.actor_type', true), ''), 'system');
  v_actor_id uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, from_status, to_status, actor_type, actor_id)
    VALUES (NEW.id, NULL, NEW.status, v_actor_type, v_actor_id);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, from_status, to_status, actor_type, actor_id)
    VALUES (NEW.id, OLD.status, NEW.status, v_actor_type, v_actor_id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_status_event AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();
--> statement-breakpoint

-- 4) Gapless GST invoice serials (CGST Rule 46). The row lock on the counter serialises concurrent
--    finalisations; a rolled-back transaction releases its number. Call only inside the transaction that
--    inserts the invoice row.
CREATE OR REPLACE FUNCTION public.allocate_invoice_seq(p_series text, p_fy text) RETURNS integer
LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO public.invoice_counters (series, fy, last) VALUES (p_series, p_fy, 1)
  ON CONFLICT (series, fy) DO UPDATE SET last = public.invoice_counters.last + 1
  RETURNING last;
$$;
--> statement-breakpoint

-- 5) Search and geo indexes.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON public.products USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS brands_name_trgm_idx ON public.brands USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_variants_sku_trgm_idx ON public.product_variants USING gin (sku gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cities_centroid_gist_idx ON public.cities USING gist (centroid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pincodes_centroid_gist_idx ON public.pincodes USING gist (centroid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS addresses_location_gist_idx ON public.addresses USING gist (location);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shops_location_gist_idx ON public.shops USING gist (location);
--> statement-breakpoint

-- 6) First-party analytics events, partitioned by month (docs/specs/12-analytics-events.md).
--    Monthly partitions are created ahead of time by a pg-boss job; the DEFAULT partition catches strays.
CREATE TABLE IF NOT EXISTS public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  anonymous_id text,
  session_id text,
  city_id uuid,
  vehicle_id uuid,
  event text NOT NULL CHECK (event ~ '^[a-z][a-z0-9_]{1,63}$'),
  page text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  device jsonb,
  consent_version text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.events_default PARTITION OF public.events DEFAULT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_occurred_brin_idx ON public.events USING brin (occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_event_time_idx ON public.events (event, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_user_time_idx ON public.events (user_id, occurred_at);
--> statement-breakpoint

-- 7) Row Level Security: enabled on every table; end-user roles get nothing by default.
--    The API connects as the owner role; per-table policies for Realtime are added in later migrations.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename NOT LIKE '\_\_drizzle%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', r.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.allocate_invoice_seq(text, text) FROM PUBLIC;
