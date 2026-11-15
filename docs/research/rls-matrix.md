# RLS matrix — who may read what directly in Postgres

Built 2026-11-16 (migration `0073_rls_mirror_policies`, tests `packages/db/test/rls.test.ts` + `rls-inventory.ts`). Spec 13 and spec 14 point here.

## Why this exists

The API connects as the owner role and bypasses RLS; scope is enforced in repositories (hard rule 3). The mirror covers the day a client reaches Postgres directly as `authenticated` (Supabase Realtime or Storage, a leaked key). Then each role sees only what the API would show it, and `anon` sees nothing sensitive. **Default stays deny**: every table has RLS on; a table with no row below has no policy and no grant.

## How identity reaches Postgres

- Supabase is configured with **Firebase as a third-party JWT issuer** (user step, Q174). The verified token's `sub` is the Firebase uid; PostgREST/Realtime expose the claims as `request.jwt.claims`.
- `private.jwt_sub()` reads `sub` (the same read `auth.jwt()` does, so it also runs in PGlite). `private.current_user_id()` maps it to `users.id` through `users.firebase_uid`, only for an active, undeleted account (a deactivated or deleted account sees nothing).
- **No policy trusts a role claim.** Shop and workshop membership come from `shop_users` and `user_roles`; staff have no direct access at all (staff work through the API). Reason: Supabase needs the token's `role` claim to be `authenticated` (the database role), while spec 01 reserves `role` for the app role; reading memberships from tables removes the clash.
- Helpers (`private` schema, `SECURITY DEFINER`, `search_path = ''`, not exposed by the Data API, `anon` has no EXECUTE): `jwt_sub`, `current_user_id`, `my_shop_ids`, `my_workshop_ids`, `owns_order`, `owns_cart`. Policies call them as `(select private.…())` so Postgres evaluates them once per statement.

## Access tiers

| Tier      | Who reads                                      | Tables                                                                                                                                                                                                                                                                                                          |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public`  | anon + authenticated                           | `states`, `cities`, `categories` (not hidden/archived), `brands`, `vehicle_makes`, `vehicle_models`, `vehicle_variants`, `products` (status `live` only)                                                                                                                                                        |
| `own`     | authenticated, rows of the signed-in customer  | `users`, `addresses`, `vehicles`, `notifications`, `notification_preferences`, `consents`, `coin_accounts`, `coin_ledger`, `orders`, `order_items` (through the order), `service_requests`, `carts`, `cart_items` (through the cart), `wishlist_items`                                                          |
| `partner` | authenticated, members of that shop/workshop   | `shops`, `shop_users` (own membership row), `shop_inventory`, `order_assignments` (the shop's own offers), `workshops`                                                                                                                                                                                          |
| `none`    | nobody (API only): RLS on, no policy, no grant | every other table: pricing and money (`payments`, `refunds`, `invoices`, `admin_prices`, `shop_payout_entries`, …), routing and events, support, audit, outbox, settings and content, partner applications and invites, identity internals (`user_roles`, `sessions`, `staff_security`), exports, media, quotes |

No table has an INSERT, UPDATE or DELETE grant for a client role: **writes are API-only** (the spec asks for none). Realtime delivers changes only for tables whose policies allow the subscriber to SELECT them.

## Column grants (leave-outs)

SELECT is granted per column, every column except: `users.firebase_uid`; `products.submitted_by_shop_id`, `rejection_reason`; `coin_ledger.idem_key`, `reason` (staff text), `created_by`; `orders.suggested_shop_id`; `order_items.shop_unit_paise` (MechDost's margin), `reco_source`; `service_requests.idempotency_key`, `visit_fee_waived_reason`, `arrival_override_reason/by`; `shops.pan_enc`, `pan_index`, `status_changed_by`; `order_assignments.give_up_note`, `offered_by`; `workshops.status_changed_by`, `created_by`. A column added later is **not** readable until the next migration grants it on purpose (safe default).

## Deliberate gaps

- **A shop never reads a customer order directly**, only its assignment rows. The API hides the customer until the shop accepts and masks fields; row policies cannot mirror per-field masking, so partners get nothing there. Same for workshops and service requests (`service_requests` is customer-own only).
- Staff (support, finance, ops) have no direct path; they use the API with `requirePermission`.
- `reviews`, `support_tickets` and `ticket_messages` stay API-only for now (public review display goes through the API cache).

## Test and gates

`packages/db/test/rls.test.ts` (PGlite, `set role authenticated` with `request.jwt.claims`): own rows visible and foreign ones not, order lines through the order, margin column denied, partner sees own shop/stock/offers only and not PAN or the staff note, deactivated or unknown uid sees nothing, `anon` reads live products and nothing personal, no writes, helpers not executable by `anon`, fixed `search_path`, policy columns indexed. The matrix test lists every public table in `rls-inventory.ts` (a new table fails until it is classified), requires RLS on everywhere, no policy and no grant on `none` tables, SELECT-only policies elsewhere, `anon` only on `public`. `schema-invariants.test.ts` keeps "no client grants on tables without a policy".

**Harness choice (2026-11-16):** the PGlite harness (already runs all migrations), not pgTAP: pgTAP needs a real Postgres container the dev machines do not run, and PGlite supports `set role` + `set_config`. Concurrency-type suites stay on `TEST_DATABASE_URL`. If a real-Postgres CI job appears, port `rls.test.ts` queries unchanged.

## Supabase advisor expectations (after applying 0073)

Run `get_advisors` (security + performance) after migrating. Expected notices:

- **`rls_enabled_no_policy`** (INFO) for every `none` table. Intended: default deny, API-only.
- **`policy_exists_rls_disabled`**: none expected.
- **`auth_rls_initplan`**: none; policies use `(select …)`.
- **`function_search_path_mutable`**: none; helpers set `search_path = ''`.
- **`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`** (WARN): the `private` helpers are `SECURITY DEFINER` and `authenticated` can execute them. Accepted: they live in a schema the Data API does not expose, so they cannot be called as RPC; `anon` has no EXECUTE. Revisit if `private` is ever added to exposed schemas.
- **`unindexed_foreign_keys` / `unused_index`**: unchanged by this migration (no new index).
- **`multiple_permissive_policies`**: none; one SELECT policy per table and role.
- Column-level grants show as limited privileges; the advisor does not flag them.

## Applying it (not done by the builder)

Apply `0073` (renumbered on merge) with `pnpm db:migrate` after the usual dry run on a copy. It changes no table or row: only grants, policies and the `private` schema. Rollback: drop the policies, `REVOKE SELECT` from `anon, authenticated` on the listed tables, drop schema `private` cascade. Nothing in the API changes (it uses the owner role).
