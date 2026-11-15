-- RLS mirror (spec 13, docs/research/rls-matrix.md). The API connects as the owner role and bypasses RLS; these
-- policies matter only if a client reaches Postgres directly as `anon` / `authenticated` (Supabase Realtime or
-- Storage, a leaked key). Default stays deny: every table keeps RLS on and no grant; this migration re-grants SELECT
-- (never a write) on the tables the matrix lists, with a policy per table and column grants that leave out PAN,
-- margins and staff-only fields. Supabase third-party auth (Firebase): the verified JWT `sub` is the Firebase uid,
-- mapped to `users.firebase_uid` here; no policy trusts a role claim (roles/memberships come from the tables).
SET lock_timeout = '5s';--> statement-breakpoint

-- Helpers live in `private`, a schema the Data API does not expose; `anon` has no EXECUTE on any of them.
CREATE SCHEMA IF NOT EXISTS private;--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;--> statement-breakpoint

-- Same read Supabase's auth.jwt() does (PostgREST/Realtime set request.jwt.claims from the verified token), so it
-- also runs in PGlite tests where the `auth` schema does not exist.
CREATE FUNCTION private.jwt_sub() RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '') $$;--> statement-breakpoint

CREATE FUNCTION private.current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT u.id FROM public.users u
      WHERE u.firebase_uid = private.jwt_sub() AND u.deleted_at IS NULL AND u.status = 'active' $$;--> statement-breakpoint

CREATE FUNCTION private.my_shop_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT su.shop_id FROM public.shop_users su WHERE su.user_id = private.current_user_id()
      UNION
      SELECT ur.shop_id FROM public.user_roles ur WHERE ur.user_id = private.current_user_id() AND ur.shop_id IS NOT NULL $$;--> statement-breakpoint

CREATE FUNCTION private.my_workshop_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT ur.workshop_id FROM public.user_roles ur
      WHERE ur.user_id = private.current_user_id() AND ur.workshop_id IS NOT NULL $$;--> statement-breakpoint

CREATE FUNCTION private.owns_order(p_order_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.user_id = private.current_user_id()) $$;--> statement-breakpoint

CREATE FUNCTION private.owns_cart(p_cart_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.carts c WHERE c.id = p_cart_id AND c.user_id = private.current_user_id()) $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.jwt_sub(), private.current_user_id(), private.my_shop_ids(), private.my_workshop_ids(),
  private.owns_order(uuid), private.owns_cart(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.jwt_sub(), private.current_user_id(), private.my_shop_ids(), private.my_workshop_ids(),
  private.owns_order(uuid), private.owns_cart(uuid) TO authenticated;--> statement-breakpoint

-- Every policy column already leads an index (checked by rls.test.ts), so no index is added here.

-- Column grants: SELECT on every column except the listed ones (a column added later is NOT readable until it is
-- granted on purpose). `role_list` = who may read.
DO $$
DECLARE
  r record;
  cols text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('states',            ARRAY[]::text[],                                                 'anon, authenticated'),
    ('cities',            ARRAY[]::text[],                                                 'anon, authenticated'),
    ('categories',        ARRAY[]::text[],                                                 'anon, authenticated'),
    ('brands',            ARRAY[]::text[],                                                 'anon, authenticated'),
    ('vehicle_makes',     ARRAY[]::text[],                                                 'anon, authenticated'),
    ('vehicle_models',    ARRAY[]::text[],                                                 'anon, authenticated'),
    ('vehicle_variants',  ARRAY[]::text[],                                                 'anon, authenticated'),
    ('products',          ARRAY['submitted_by_shop_id','rejection_reason'],                'anon, authenticated'),
    ('users',             ARRAY['firebase_uid'],                                           'authenticated'),
    ('addresses',         ARRAY[]::text[],                                                 'authenticated'),
    ('vehicles',          ARRAY[]::text[],                                                 'authenticated'),
    ('notifications',     ARRAY[]::text[],                                                 'authenticated'),
    ('notification_preferences', ARRAY[]::text[],                                          'authenticated'),
    ('consents',          ARRAY[]::text[],                                                 'authenticated'),
    ('coin_accounts',     ARRAY[]::text[],                                                 'authenticated'),
    ('coin_ledger',       ARRAY['idem_key','reason','created_by'],                         'authenticated'),
    ('orders',            ARRAY['suggested_shop_id'],                                      'authenticated'),
    ('order_items',       ARRAY['shop_unit_paise','reco_source'],                          'authenticated'),
    ('service_requests',  ARRAY['idempotency_key','visit_fee_waived_reason','arrival_override_reason','arrival_override_by'], 'authenticated'),
    ('carts',             ARRAY[]::text[],                                                 'authenticated'),
    ('cart_items',        ARRAY[]::text[],                                                 'authenticated'),
    ('wishlist_items',    ARRAY[]::text[],                                                 'authenticated'),
    ('shops',             ARRAY['pan_enc','pan_index','status_changed_by'],                'authenticated'),
    ('shop_users',        ARRAY[]::text[],                                                 'authenticated'),
    ('shop_inventory',    ARRAY[]::text[],                                                 'authenticated'),
    ('order_assignments', ARRAY['give_up_note','offered_by'],                              'authenticated'),
    ('workshops',         ARRAY['status_changed_by','created_by'],                         'authenticated')
  ) AS t(tbl, denied, role_list) LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) INTO cols
      FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', r.tbl)::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname <> ALL (r.denied);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO %s', cols, r.tbl, r.role_list);
  END LOOP;
END $$;--> statement-breakpoint

-- Public catalogue: published rows only.
CREATE POLICY states_read ON public.states FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY cities_read ON public.cities FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY categories_read ON public.categories FOR SELECT TO anon, authenticated
  USING (NOT hidden AND archived_at IS NULL);--> statement-breakpoint
CREATE POLICY brands_read ON public.brands FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY vehicle_makes_read ON public.vehicle_makes FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY vehicle_models_read ON public.vehicle_models FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY vehicle_variants_read ON public.vehicle_variants FOR SELECT TO anon, authenticated USING (true);--> statement-breakpoint
CREATE POLICY products_read ON public.products FOR SELECT TO anon, authenticated USING (status = 'live');--> statement-breakpoint

-- A customer's own rows.
CREATE POLICY users_read_own ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY addresses_read_own ON public.addresses FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()) AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY vehicles_read_own ON public.vehicles FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()) AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY notification_preferences_read_own ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY consents_read_own ON public.consents FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY coin_accounts_read_own ON public.coin_accounts FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY coin_ledger_read_own ON public.coin_ledger FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY orders_read_own ON public.orders FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY order_items_read_own ON public.order_items FOR SELECT TO authenticated
  USING ((SELECT private.owns_order(order_id)));--> statement-breakpoint
CREATE POLICY service_requests_read_own ON public.service_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY carts_read_own ON public.carts FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY cart_items_read_own ON public.cart_items FOR SELECT TO authenticated
  USING ((SELECT private.owns_cart(cart_id)));--> statement-breakpoint
CREATE POLICY wishlist_items_read_own ON public.wishlist_items FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint

-- Members of a shop or workshop: that partner's own rows. A shop never reads the customer's order directly (the API
-- hides the customer until the shop accepts and cannot be mirrored by row policies), only its own offers.
CREATE POLICY shops_read_member ON public.shops FOR SELECT TO authenticated
  USING (id IN (SELECT private.my_shop_ids()));--> statement-breakpoint
CREATE POLICY shop_users_read_own ON public.shop_users FOR SELECT TO authenticated
  USING (user_id = (SELECT private.current_user_id()));--> statement-breakpoint
CREATE POLICY shop_inventory_read_member ON public.shop_inventory FOR SELECT TO authenticated
  USING (shop_id IN (SELECT private.my_shop_ids()));--> statement-breakpoint
CREATE POLICY order_assignments_read_member ON public.order_assignments FOR SELECT TO authenticated
  USING (shop_id IN (SELECT private.my_shop_ids()));--> statement-breakpoint
CREATE POLICY workshops_read_member ON public.workshops FOR SELECT TO authenticated
  USING (id IN (SELECT private.my_workshop_ids()));
