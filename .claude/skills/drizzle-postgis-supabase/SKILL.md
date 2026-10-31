---
name: drizzle-postgis-supabase
description: Use for any MechDost database change — new tables/columns, migrations, triggers, RLS policies, PostGIS/geo queries, indexes, repositories, seeds, or applying migrations to Supabase. Encodes the project's Drizzle conventions, migration workflow, integrity patterns, PGlite test harness and the gotchas already hit. Run supabase-postgres-best-practices alongside it.
---

# Drizzle + PostGIS + Supabase (MechDost)

Package: `packages/db`. Read `docs/specs/14-data-integrity.md` and `docs/research/data-integrity.md` first.

## Schema conventions (`src/schema/*.ts`)
- Builders in `_common.ts`: `id()` (uuid v7 app-side, `gen_random_uuid()` DB fallback), `createdAt()`, `updatedAt()`,
  `version()`, `paise()` (bigint number mode), `citext()`, `geographyPoint()` (geography(Point,4326)).
- `casing: 'snake_case'` — write camelCase in TS; columns become snake_case.
- Status columns are `text` + `CHECK (status in (...))` generated from `packages/shared/state` arrays (single source).
- Money `bigint` paise with `CHECK (>= 0)`; totals consistency CHECKs where possible.
- Every FK gets an index; every query filter gets an index; partial unique indexes for "one active X".
- Soft delete via `deleted_at` + partial unique indexes `WHERE deleted_at IS NULL`.
- Snapshots (address, price, title) on orders — never join live rows for history.

## Migration workflow
1. Edit schema → `pnpm --filter @mechdost/db generate` (runs drizzle-kit + `scripts/fix-migrations.mjs`, which unquotes
   `"geography(...)"`). Name it: `pnpm --filter @mechdost/db exec drizzle-kit generate --name=<what>` then run the fix script.
2. Hand-written SQL (triggers, functions, RLS policies, partitions): `drizzle-kit generate --custom --name=<what>` and fill
   the file; separate statements with `--> statement-breakpoint`.
3. **Every new table**: `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM anon, authenticated`, and if
   mutable add `<table>_bump_version` (`public.bump_version()`) and `<table>_touch_updated_at` (`public.touch_updated_at()`)
   triggers — the 0002 DO-loops only covered tables that existed then. Append-only tables get
   `public.forbid_update_delete()`.
4. Safe migrations: `SET lock_timeout = '5s'`; `CREATE INDEX CONCURRENTLY` for big tables (outside a transaction);
   `ADD CONSTRAINT … NOT VALID` then `VALIDATE`; expand → backfill → contract; never drop a column in the same release
   that stops writing it.
5. Test: `pnpm --filter @mechdost/db test` (PGlite applies all migrations from scratch every run).
6. Apply: `pnpm db:migrate` (uses `DATABASE_URL` session pooler from root `.env`).
7. Check: Supabase MCP `get_advisors` (security + performance). Only expected notices: "RLS enabled, no policy" until
   policies exist; "unused index" on an empty DB. Fix everything else.
8. Update `docs/specs/14` implementation map and `docs/progress.md`.

## Repositories (`src/repo/*.ts`) — the only place that writes SQL
- Take a `Tx` and an `ActorContext`; call `setActor(tx, actor)` before status changes (trigger writes `order_events`).
- Status changes: `machine.assert(from, to, actor)` → conditional UPDATE on `(id, status, version)` → zero rows ⇒ `ConflictError`.
- Counters/stock/coupons: single conditional UPDATE (`… WHERE on_hand - reserved >= $qty`), never read-then-write.
- Map Postgres errors with `mapPgError` (23505 → Conflict, 23514/23503 → Validation, 23P01, 40001).
- Return 404 (`NotFoundError`) for rows outside the actor's scope.

## PostGIS
- Extensions live in schema `extensions` (Supabase advisor); `search_path` must include it (Supabase roles do; tests set it).
- Write points: `{ lng, lat }` via `geographyPoint()`. Read: select `ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng`.
- Nearby: `ST_DWithin(location, ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography, $metres)` ordered by
  `location <-> point` (KNN with the GIST index) — GIST indexes exist on all geography columns.

## RLS policies (when Realtime/Storage need them)
Use `(select auth.uid())` style, `to authenticated`, separate policies per operation with `with check`, index the policy
columns. API connects as the owner role (bypasses RLS) and enforces scope in repositories; RLS is the mirror for
Realtime/Storage/any direct client access. Test with SQL as `authenticated` role.

## Test harness
`createTestDb()` from `@mechdost/db/testing` (PGlite 0.5.12 + pglite-postgis 0.2.12 + citext/pg_trgm/btree_gist).
Single connection — concurrency suites must also run on real Postgres (`TEST_DATABASE_URL`).

## Gotchas already hit
- drizzle-kit quotes parenthesised custom types → fix script.
- `pnpm run generate -- --name=x` does not pass `--name` through the `&&` chain; call drizzle-kit directly to name it.
- PGlite/pglite-postgis versions must match exactly; release-age policy blocks the newest ones.
- Passwords in URLs must be percent-encoded.
