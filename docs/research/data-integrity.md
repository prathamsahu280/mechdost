# Data-integrity & concurrency hardening — MechDost (researched 2026-10-31)

Implementation-ready patterns for Postgres (Supabase) + Drizzle + Hono + pg-boss + Razorpay. These are **mandatory** in the build (see `../specs/data-integrity.md` for the spec and `CLAUDE.md` hard rules). Sources inline.

## 1. Identifiers and GST invoice numbering

- **Bug**: sequential ids leak volume and enable enumeration; UUIDv4 unreadable on a phone call; using the PK as invoice number violates Rule 46.
- **Rule 46(b) CGST** (verified): invoice serial ≤ 16 chars, only `A–Z 0–9 - /`, consecutive, unique per financial year, one or multiple series (https://gstzen.in/a/tax-invoice-cgst-rule-46.html). GSTR-1 Table 13 reports from/to/total/cancelled per series, so cancelled numbers must remain as cancelled invoices (https://www.terra-insight.com/insights/can-i-skip-reuse-or-cancel-an-invoice-number-under-gst). Fresh series each FY advised (https://irisgst.com/effective-1st-april-2026-reset-the-invoice-number-series/).
- **Postgres sequences are not gapless** (`nextval` not reclaimed on rollback; docs: https://www.postgresql.org/docs/current/functions-sequence.html).
- **Pattern — three tiers**: (1) PK `uuid` v7 (never shown); (2) public code `MD-RPR-2026-7K3Q9X` (city prefix + year + ≥6-char random base32; sorted by `created_at`, not the code); (3) GST invoice number gapless per series, assigned **only at invoice finalisation** in the same transaction as the immutable invoice row:

```sql
CREATE TABLE invoice_counters (series text, fy text, last int NOT NULL DEFAULT 0, PRIMARY KEY (series, fy));
WITH c AS (
  INSERT INTO invoice_counters (series, fy, last) VALUES ($1,$2,1)
  ON CONFLICT (series, fy) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last)
INSERT INTO invoices (id, number, ...) SELECT gen_random_uuid(), format('%s/%s/%s',$1,$2,lpad(c.last::text,6,'0')), ... FROM c;
-- e.g. 'MDR/2627/000123' (15 chars). CHECK (length(number)<=16 AND number ~ '^[A-Z0-9/-]+$'); UNIQUE (number)
```

Row lock serialises concurrent finalisations; rollback releases the number. FY computed from `issued_at AT TIME ZONE 'Asia/Kolkata'` (April boundary). Cancellations keep the number with `status='cancelled'`; credit notes have their own series. Alternative: `pg_advisory_xact_lock(hashtext(series||fy))`.

## 2. Double assignment / double booking (write skew)

- **a. Conditional UPDATE as the state transition** (Read Committed re-checks WHERE after lock wait; https://www.postgresql.org/docs/current/transaction-iso.html):

```ts
const r = await tx
  .update(orders)
  .set({ status: 'accepted', shopId, acceptedAt: sql`now()`, version: sql`version + 1` })
  .where(and(eq(orders.id, id), eq(orders.status, 'awaiting_shop'), eq(orders.version, expectedVersion)))
  .returning({ id: orders.id });
if (r.length === 0) throw new Conflict('order no longer available');
```

Legal transitions in one `canTransition(from,to)` map; all writes through one repository so `version` is always bumped.

- **b. Unique partial index backstop** (https://www.postgresql.org/docs/current/indexes-partial.html): `CREATE UNIQUE INDEX one_active_assignment ON assignments (order_id) WHERE status IN ('offered','accepted','in_progress');` → map SQLSTATE 23505 to 409.
- **c. Queue-style claiming**: `SELECT … WHERE status='awaiting_shop' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED` (Shopify 2026 reservations: https://shopify.engineering/scaling-inventory-reservations). Drizzle: `.for('update', { skipLocked: true })`.
- **d. Slots: exclusion constraint** (https://www.postgresql.org/docs/current/ddl-constraints.html): `CREATE EXTENSION btree_gist; ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (status <> 'cancelled');` with half-open `tstzrange '[)'`; violation = 23P01. For capacity > 1 per hour, use a `slot_capacity` row with conditional decrement like stock.
- **e. SERIALIZABLE** only for multi-row invariants no constraint expresses; retry on 40001 (3 attempts).

## 3. Oversell / stock races

```sql
ALTER TABLE shop_inventory ADD CONSTRAINT stock_nonneg CHECK (on_hand - reserved >= 0);
UPDATE shop_inventory SET reserved = reserved + $qty WHERE id=$id AND on_hand - reserved >= $qty RETURNING id; -- 0 rows => out of stock
INSERT INTO reservations (order_id, inventory_id, qty, expires_at) VALUES ($o,$id,$qty, now() + interval '15 minutes');
```

Reserve at placement; convert on `payment.captured` / shop accept (`on_hand -= qty, reserved -= qty`); release on cancel/expiry via pg-boss cron (compare-and-set so a late payment doesn't fight the release). Never `SELECT stock` then `UPDATE stock = computed`. Hot SKUs: per-unit rows + SKIP LOCKED (Shopify).

## 4. Payments (Razorpay) — verified facts

- Signature: HMAC-SHA256 over the **raw body** with the webhook secret in `X-Razorpay-Signature`; after secret rotation old retries carry old-secret signatures → verify against both for 24 h (https://razorpay.com/docs/webhooks/validate-test).
- `x-razorpay-event-id` unique per event = dedupe key; delivery at-least-once; non-2xx or >5 s = failure; retries with backoff for 24 h then webhook disabled (https://razorpay.com/docs/webhooks/faqs).
- Ordering not guaranteed: `payment.failed` then `payment.captured` happens on UPI retries; `payment.captured` and `order.paid` both fire (https://razorpay.com/docs/webhooks/payments, https://razorpay.com/docs/webhooks/orders).
- Amounts integer paise; `receipt` ≤ 40 chars; failed attempt needs a new Razorpay order (https://razorpay.com/docs/api/orders/create.md); capture amount must equal authorised; uncaptured auto-refund ~5 days.
- Refunds: `X-Refund-Idempotency` header (≥10 chars `[A-Za-z0-9_-]`), same key different body → 409 (https://razorpay.com/docs/api/refunds/normal-refunds-idempotent).
- **Patterns**: `idempotency_keys(user_id, key, request_hash, locked_at, response_status, response_body, recovery_point)` per Brandur (https://brandur.org/idempotency-keys) / Stripe (24 h retention) / Airbnb Orpheus pre-RPC/RPC/post-RPC phases (https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb); store `razorpay_order_id UNIQUE` before returning to client. Webhook handler: verify raw-body HMAC → `INSERT INTO webhook_events(id=event_id) ON CONFLICT DO NOTHING` → enqueue job → 200 in <5 s; worker asserts `payment.amount === order.total_paise && currency='INR'` (else `amount_mismatch` + alert), monotonic state (`created < attempted < paid`), orphan events parked and retried; `payments UNIQUE (razorpay_payment_id)`. Refunds: `SELECT payment FOR UPDATE`, `remaining = captured - sum(refunds not failed)`, reject if over, insert refund row with `idem_key='rf_'||id`, commit, then call Razorpay with that key; reconcile pending refunds hourly; webhooks are hints, the fetch is the truth.

## 5. Timers and jobs (pg-boss)

- pg-boss 12 claims via SKIP LOCKED; defaults `retryLimit=2`, `expireInSeconds=900`; lapsed claims can run twice → **at-least-once**; throttled `send()` resolves `null` (https://pgboss.io/api/jobs). Use `singletonKey='expire-offer:'+id`.
- Expiry vs late accept: timer `UPDATE offers SET status='expired' WHERE id=$1 AND status='offered' AND expires_at <= now()`; accept `… status='accepted' WHERE status='offered' AND expires_at > now()`; DB `now()` is the single clock.
- Handlers start with a CAS or `INSERT … ON CONFLICT DO NOTHING` into `processed_jobs(job_key UNIQUE)`.
- **IST vs UTC**: all `timestamptz`; business day = `(ts AT TIME ZONE 'Asia/Kolkata')::date`; "today's slots" via tstzrange built in IST; store `cancellable_until timestamptz` on the order at placement; future wall-clock appointments store local timestamp + tz (tzdata can change).

## 6. Money

- Section 170 CGST: tax rounded to nearest rupee per invoice per component; GSTN accepts 2-decimal values (https://busy.in/gst/rounding-off-rules-in-gst-invoices/).
- `int` paise everywhere (`bigint` for ledgers); never floats, never `numeric` for transactional money. Rates in basis points (1800 = 18%).
- Per line: `taxable = qty*unit - line_discount`; `cgst = round_half_up(taxable*rate/2)`; `sgst = cgst` (copy, not recompute); invoice-level single `round_off_paise` line to whole rupee. Inclusive B2C: `taxable = round(gross*10000/(10000+rate_bp))`.
- Coupon allocation: Fowler `allocate` (ratio split, remainder paise from largest line, assert sum == total; https://verraes.net/2011/04/fowler-money-pattern-in-php/); persist per-line discount so refunds reuse it; refund shipping only on full cancel or explicit rule; never recompute from live prices.

## 7. Multi-tenancy leaks (OWASP API1:2023 BOLA)

- Hono middleware resolves `actor {userId, role, shopId?, workshopId?, cityIds}`; repositories always add the scope predicate; return 404 not 403 for cross-tenant ids (https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/).
- RLS mirror on every exposed table with `(select auth.uid())`, indexed policy columns, service-role only in jobs; Hono sets `SET LOCAL request.jwt.claims` per transaction so RLS applies (https://supabase.com/docs/guides/database/postgres/row-level-security).
- pgTAP tests per role × table asserting 42501 on cross-tenant reads (https://supabase.com/docs/guides/local-development/testing/pgtap-extended).
- Soft delete `deleted_at` + partial unique indexes (`UNIQUE (phone) WHERE deleted_at IS NULL`); keyset pagination on `(created_at DESC, id DESC)` (offset drifts; https://blog.readyset.io/optimizing-sql-pagination-in-postgres/).

## 8. Notifications — transactional outbox

Write the notification row in the same transaction as the business change; relay via pg-boss `FOR UPDATE SKIP LOCKED`; `dedupe_key UNIQUE` (e.g. `order_confirmed:<order_id>`) so at-least-once never double-sends (https://microservices.io/patterns/data/transactional-outbox.html). Because pg-boss shares the DB, `boss.send(..., { db: tx })` enqueues iff commit.

## 9. Audit / event-sourcing lite

`order_events (id bigserial, order_id, type, from_status, to_status, actor_id, payload jsonb, created_at)` append-only (`REVOKE UPDATE, DELETE`, trigger raises). Snapshot at placement: item title/sku/unit_price_paise/hsn/gst_rate_bp and `shipping_address jsonb` — never join live rows for history. Event insert in the same transaction as every CAS (BEFORE UPDATE trigger on status is the cheapest guarantee).

## 10. Data-model checklist

FKs with explicit `ON DELETE RESTRICT` for financial records (CASCADE only for pure children); index every FK; `NOT NULL` + defaults; status `text` + `CHECK (status IN (...))`; `CHECK (amount_paise >= 0)`, `CHECK (qty > 0)`, `CHECK (expires_at > created_at)`; `citext` email UNIQUE; phone E.164 UNIQUE WHERE deleted_at IS NULL (`NULLS NOT DISTINCT` awareness); all `timestamptz` + created_by/updated_by + updated_at trigger; `version int NOT NULL DEFAULT 1` on state rows; migrations expand/contract (nullable → backfill → NOT NULL; `CREATE INDEX CONCURRENTLY`; `NOT VALID` then `VALIDATE`; `SET lock_timeout='5s'`; no DROP COLUMN in the same release) (https://dev.to/whoffagents/zero-downtime-postgres-migrations-with-drizzle-orm-22ga); Supabase PITR add-on before launch, quarterly restore test (https://supabase.com/features/database-backups).

## 11. Testing (part of `website-testing` skill)

- Concurrency: 20 parallel accepts → exactly 1 success; 20×qty1 vs on_hand 5 → 5 successes; timer vs accept race.
- Property tests (fast-check): allocate sums to total, parts ≥ 0; cgst == sgst; taxable+cgst+sgst+round_off == gross.
- Webhook chaos: same event id ×3 → one change, one notification; captured-before-order → parked then reconciled; failed-after-paid → no-op; tampered amount → mismatch; wrong secret → 400; old-secret retry after rotation → 200.
- Clock: 23:59 / 00:01 IST, 05:29 UTC for "today" and windows.
- RLS matrix per role × table × op; idempotency: same key same body → identical response, one Razorpay order; different body → 409; concurrent → one 2xx one 409.

## Priority

1. Conditional-UPDATE state machine + version + partial unique indexes. 2. Webhook dedupe + raw HMAC + amount assert + async processing. 3. Integer paise + GST rounding + allocation. 4. Gapless invoice counters at finalisation. 5. Reservations with TTL + CHECK, outbox, tenant scoping + RLS mirror + keyset pagination, audit events, migration/backup hygiene, test harness.
