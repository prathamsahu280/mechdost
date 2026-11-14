# 14 · Data integrity & identifiers

Status: decided · Phase 1 · Research: `../research/data-integrity.md` (mandatory reading before touching the schema)

## Non-negotiables (CLAUDE.md hard rule 3 expands to these)

1. **Identifiers**: PK uuid v7; public codes `MD-{CITY}-{YYYY}-{6 base32}` (orders), `SR-…` (service), `REQ-…` (tickets), unique + random; **GST invoice numbers gapless per series/FY ≤ 16 chars from `invoice_counters` row lock, assigned only at invoice finalisation**; cancelled invoices keep their number; credit notes own series.
2. **State transitions** are single conditional `UPDATE … WHERE id=$1 AND status=$from AND version=$v` with row-count check → 409 on zero rows; legal transitions in one map per entity in `packages/shared/state`; `version` bumped on every write via one repository per entity.
3. **One active assignment per order/service request** enforced by partial unique index; slots via exclusion constraint / capacity conditional decrement; stock via `UPDATE … WHERE on_hand - reserved >= qty` + `CHECK`.
4. **Payments**: idempotency keys for order creation and refunds; raw-body HMAC verification; `webhook_events(id)` unique dedupe; async processing; amount/currency assert; monotonic payment state; refund ledger with remaining-balance check under `FOR UPDATE`; hourly reconciliation.
5. **Jobs**: at-least-once; every handler starts with CAS or `processed_jobs` insert; DB `now()` is the clock; `singletonKey` for timers.
6. **Money**: integer paise, basis-point rates, line-level tax with `sgst = cgst`, invoice-level round-off, Fowler allocation for discounts, stored per-line discounts reused by refunds.
7. **Tenancy**: actor-scoped repositories, 404 for foreign ids, RLS mirror, keyset pagination, soft-delete filters by helper.
8. **Outbox** for notifications/jobs inside the business transaction.
9. **Audit**: append-only `*_events` with triggers; snapshots of price/address/title on orders.
10. **Lock order (2026-11-03, code review):** a transaction that changes an order and its assignments, reservations or stock locks the **order row first** (`lockOrder` in `packages/db/src/repo/orders.ts`, `findOrder(…, lock)` in routing), then the rest. Cancel, reject, route, accept, decline, timer expiry, the stock hold sweep (2026-11-09) and the shop steps all follow it, so they never deadlock each other. Unmapped Postgres outcomes still reach the API as 409 (`40P01`/`40001` → `RETRY`, `23505` → `UNIQUE_VIOLATION`), never 500. Timer jobs run one transaction per row and keep going past a failing row (`expireDueAssignments` and `releaseExpiredReservations` return the failures for the worker log); an offer whose order already moved on is withdrawn. Real-Postgres concurrency tests for cancel vs accept and cancel vs expiry wait for Supabase local (PGlite is single-connection).
11. **Reason codes belong to their status** (0034): `orders_reason_code_valid` — a rejected order carries a reject reason, a cancelled one a cancel reason, every other status none.
12. **Keyset pagination helpers** `packages/db/src/repo/cursor.ts` (`encodeCursor` / `decodeCursor` / `pageSize`) for every paged list; sort keys travel as Postgres text so timestamps keep microseconds.
13. **Version and updated_at triggers on every table** that has those columns (0002 installed them once; 0031 re-runs the loop for later tables); `packages/db/test/schema-invariants.test.ts` fails if a new table misses them.
14. **Schema hygiene**: FKs with explicit rules, CHECKs, citext email, E.164 phone, timestamptz, created_by/updated_by, expand/contract migrations with `lock_timeout`, `CREATE INDEX CONCURRENTLY`, PITR enabled before launch, quarterly restore drill.

## Tests (owned by the `website-testing` skill)

Concurrency (parallel accepts, stock, timer-vs-accept), property tests (money/GST/allocation), webhook chaos (replay, out-of-order, orphan, tamper, rotated secret), clock tests (IST boundaries), RLS matrix, idempotency behaviours, migration dry-run on a copy of prod.

## Acceptance

No test in this spec may be skipped in CI; schema PRs require the `drizzle-postgis-supabase` skill checklist in the PR description.

## Implementation map (2026-10-31)

- Schema & constraints: `packages/db/src/schema/*.ts`; migrations `packages/db/drizzle/0000–0003` (hand-written `0000_extensions`, `0002_integrity`).
- State machines: `packages/shared/src/state/index.ts`; CAS transitions: `packages/db/src/repo/orders.ts`, `assignments.ts`.
- Stock: `packages/db/src/repo/inventory.ts`; invoices: `repo/invoices.ts` + SQL `public.allocate_invoice_seq()`.
- Acceptance tests: `packages/db/test/integrity.test.ts` (PGlite). Multi-connection concurrency tests run against real Postgres in CI (to add with the CI workflow).
- Rule for new tables: add `version`/`updated_at` triggers and `ENABLE ROW LEVEL SECURITY` in the same migration (the 0002 DO-loops only covered tables existing at that time).

## Data model note: admin prices (migration 0043, 2026-11-13)

- `admin_prices` (variant × city × optional PIN; `price_paise` bigint > 0, `version`, `updated_by`): partial unique indexes on (variant, city) where `pincode` is null and on (variant, city, pincode) where it is not null; RLS on, anon/authenticated revoked, version and updated_at triggers; writes only through `packages/db/src/repo/admin-prices.ts` (compare-and-set, audited).
- `order_items.shop_unit_paise` (nullable for older rows, CHECK `>= 0` and `<= unit_paise`): the chosen shop's approved price, beside the customer `unit_paise`.
- Guarded by `packages/db/test/admin-prices.test.ts`, `admin-price-resolution.test.ts` and the schema invariants (RLS, triggers) in `schema-invariants.test.ts`.
