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
10. **Schema hygiene**: FKs with explicit rules, CHECKs, citext email, E.164 phone, timestamptz, created_by/updated_by, expand/contract migrations with `lock_timeout`, `CREATE INDEX CONCURRENTLY`, PITR enabled before launch, quarterly restore drill.

## Tests (owned by the `website-testing` skill)
Concurrency (parallel accepts, stock, timer-vs-accept), property tests (money/GST/allocation), webhook chaos (replay, out-of-order, orphan, tamper, rotated secret), clock tests (IST boundaries), RLS matrix, idempotency behaviours, migration dry-run on a copy of prod.

## Acceptance
No test in this spec may be skipped in CI; schema PRs require the `drizzle-postgis-supabase` skill checklist in the PR description.
