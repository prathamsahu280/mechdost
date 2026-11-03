-- Every mutable row bumps `version` and touches `updated_at` on UPDATE (CLAUDE.md conventions; rule 3). The
-- triggers were installed once by the loop in 0002 for the tables that existed then, so later tables with these
-- columns (customer_blocks, coin_accounts, …) never got them: their compare-and-set on `version` was cosmetic
-- (code review 2026-11-03). Re-run the same loop, skipping triggers that already exist. A test asserts the
-- invariant for every table, so a future table cannot miss it silently.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'version' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_bump_version')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()',
                   r.table_name || '_bump_version', r.table_name);
  END LOOP;
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
      AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = c.table_name || '_touch_updated_at')
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   r.table_name || '_touch_updated_at', r.table_name);
  END LOOP;
END $$;
