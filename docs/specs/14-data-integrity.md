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
10. **Lock order (2026-11-03, code review):** a transaction that changes an order and its assignments, reservations or stock locks the **order row first** (`lockOrder` in `packages/db/src/repo/orders.ts`, `findOrder(…, lock)` in routing), then the rest. Cancel, reject, route, accept, decline, timer expiry, the stock hold sweep (2026-11-09) and the shop steps all follow it, so they never deadlock each other. Unmapped Postgres outcomes still reach the API as 409 (`40P01`/`40001` → `RETRY`, `23505` → `UNIQUE_VIOLATION`), never 500. Timer jobs run one transaction per row and keep going past a failing row (`expireDueAssignments` and `releaseExpiredReservations` return the failures for the worker log); an offer whose order already moved on is withdrawn. Real-Postgres concurrency tests for cancel vs accept and cancel vs expiry wait for Supabase local (PGlite is single-connection). **MechDost Coins (2026-11-14):** the coin account comes before stock everywhere — checkout spends coins right after the group row and before reserving stock; a cancel restores coins (in `transitionOrder`) before releasing stock; staff adjustments and the expiry job lock only the coin account (adjustments under a per-customer advisory lock).
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

## Data model note: bulk quotes (migration 0049, 2026-11-14)

- `quote_requests`: code `QT-{CITY}-{YYYY}-{6}` (format CHECK + unique + retry), `(user_id, idempotency_key)` unique + request hash (same key, different request → refused), status CHECK from `QUOTE_STATES`, reason code bound to its status, `closed_at` set exactly when closed, an offered/accepted quote has an offer. Status changes: `quoteMachine` + conditional UPDATE on (id, status, version); every transaction locks the quote row first.
- `quote_offers`: UNIQUE (quote, offer_version), **one `active` per quote** (partial unique), total = subtotal + delivery CHECK, valid_until after created_at. Accepting checks the active version and validity under the quote lock, then places the order in the same transaction.
- `order_groups.quote_id` / `quote_offer_id`: both or neither, **partial unique on each** → one order per quote and per offer whatever the concurrency; the accept's Idempotency-Key is the order's key (a retry returns the same order).
- `order_items.price_source` (`catalogue` | `quote`): a negotiated unit may be below the shop's approved price only for `quote` lines (CHECK). `cost_ceiling_paise` is set exactly on quote lines (CHECK): the catalogue price at checkout, which routing uses as the most a shop may be paid; routing snapshots the routed shop's price into `shop_unit_paise`.
- `quote_lines`, `quote_messages`, `quote_events`: append-only (`forbid_update_delete`). All five tables: RLS on, client roles revoked, version / updated_at triggers, FKs indexed.

## Data model note: workshops and service requests (migration 0044, 2026-11-14)

- `workshops` (city, unique slug, Hindi name/address/area, PIN, `location geography(Point)` + GIST, vehicle types ⊆ 2W/3W/4W, hours jsonb, GSTIN ⇔ `gst_registered`, `published` ⇒ `location_verified`, standing approved/paused/suspended with reason and who, busy, version) and `workshop_services` (menu by a stable `key`, unique per workshop, price range and minutes CHECKed, switched off rather than deleted).
- `service_requests`: public code `SR-{CITY}-{YYYY}-{6}` (format CHECK + unique + retry), `(user_id, idempotency_key)` unique, status CHECK from `SERVICE_REQUEST_STATES`, reason code bound to its status (cancel / reject lists), workshop required from `awaiting_workshop` on, odometer required from `vehicle_received` on, snapshots of the vehicle and the chosen menu lines (jsonb), `vehicle_key` for the odometer history (indexed with `user_id`).
- `service_proposals` (one `pending` per request: partial unique index), `estimates` (`revision` n per request, unique; one non-superseded per request: partial unique index; `version` is the lock, not the revision) + `estimate_items` (qty 1–99, unit 1 paise–₹1,00,000, GST slab 0/5/12/18/28 %, decision pending/approved/declined), `service_bills` (one per request; total = taxable + CGST + SGST + round-off, CGST = SGST, no GST when unregistered, paid time ⇔ method, `labour_promise_days` 7–90 or null: the labour promise frozen when the bill is made, migration 0058), `service_events` (append-only via `forbid_update_delete`).
- `user_roles.workshop_id` now references `workshops` (added `NOT VALID`, then validated).
- All eight tables: RLS on, `anon` / `authenticated` revoked, version and updated_at triggers (schema-invariants test), every FK and filter indexed. Writes only through the repositories listed in spec 06 "Built: API"; lock order: the request row first, then proposals, estimates and bills.

## Data model note: shop management (migration 0051, 2026-11-14)

- `shops.free_delivery_min_paise`: bigint, nullable, CHECK `>= 0`. NULL = the city setting.
- `shops.hours`: jsonb, NOT NULL, default 09:00–21:00 Monday to Saturday, CHECK object; the shape is validated by
  `isShopHours` in the repositories.
- `partner_status_events.reason_code`: nullable, CHECK in `PARTNER_STANDING_REASONS`.
- All three are metadata-only changes (nullable or constant default, `lock_timeout` 5 s).
- The migration also backfills `shop_users` from the shop grants in `user_roles` (`DISTINCT ON`, owner first,
  `ON CONFLICT DO NOTHING`, joined to `shops` for the FK). A test re-runs the statement twice.
- Writes go only through `shops-admin.ts` and `partners.ts`:
  - compare-and-set on `shops.version` for profile, hours and coverage (`STALE_SHOP`);
  - standing is conditional on (id, status, version);
  - audit rows `shop.updated`, `shop.coverage_changed`, `shop.hours_changed`, `partner.status_changed`;
  - server events in the typed catalogue.
- Offer deadlines for closed shops are a fixed `expires_at` (opening + grace) in the same insert, never earlier than
  the normal timeout (`greatest(...)`), so the CHECK `expires_at > offered_at` and the timer job are unchanged.

## Data model note: event store cursor index (migration 0053, 2026-11-14)

- `events_received_idx` on `events (received_at, id)`, created on the partitioned parent, so every existing partition and every partition `ensure_event_partitions` makes later gets it. It serves the PostHog forwarder's read (`readForwardableEvents`: `(received_at, id) > cursor`, ordered) as an index range scan. No data change; plain build (CONCURRENTLY is not allowed on a partitioned parent; the table is small at launch). Numbered 0053 because 0049–0052 are taken by parallel branches; the journal `when` is re-stamped at merge (L106).

## Data model note: email templates (migration `email_templates`, 2026-11-15; renumbered at merge)

- **`notification_templates`:** two nullable columns, `heading` (≤ 120) and `button_label` (≤ 40, CHECKs `templates_heading_len`, `templates_button_label_len`), used by `channel = 'email'` rows. For email rows `body = ''` means "no body override" and `enabled = false` switches that language off; no row = code default, on. Compare-and-set on `version`, audit rows `email_template.saved|reset|test_sent`. No new table, so no new RLS work (the table already has RLS on and is revoked from anon/authenticated).
- **Outbox:** unchanged. Email dedupe keys are `{template}:{entity}:v{version}:email` (UNIQUE), written in the transaction of the state change; the delivery code travels sealed (`deliveryCodeEnc`) and is opened only by the dispatcher.
- **Quote expiry reminder:** `queueQuoteExpiringEmails` reads active offers of offered quotes ending within 24 h (the partial unique index on active offers keeps the scan small); one transaction per offer, dedupe per offer id.

## Give-up and warnings (2026-11-15, migration 0054)

- **Give-up is one transaction:** order row locked first (lock order), assignment `accepted -> given_up` as a compare-and-set
  on its status, order `confirmed -> needs_rerouting` as a conditional UPDATE on (status, version), committed holds reversed
  (`on_hand` + qty, status `released`). A concurrent pack, second give-up or staff cancel loses with 409; stock is restored
  exactly once. The one-active-assignment partial unique index is unchanged (`given_up` leaves the active set).
- **CHECKs:** `order_assignments_give_up_explained` (a given-up row has its code and time, no other status does),
  `..._give_up_note_length`; the status CHECK lists `given_up`.
- **`partner_warnings`:** append-only (`forbid_update_delete`), RLS on, REVOKE from anon/authenticated, CHECKs for kind,
  one partner FK, reason code, note length, "other needs a note", `withdrawn` rows point at an `issued` row; unique
  `withdraws_id` (one withdrawal per warning). No version/updated_at: rows never change.
- **Customer timeline:** `log_order_status_change` writes the `confirmed -> needs_rerouting` row with
  `visible_to_customer = false`.

## Data model note: refunds (migration 0055, 2026-11-15)

- `refunds` (expanded, see spec 05 "Built: refunds"): status CHECK from `REFUND_STATES`; one conditional UPDATE per change (id, status, version); four-eyes CHECK (`approved_by <> requested_by`); `idem_key` unique (Razorpay's idempotency header); `provider_refund_id` unique; `mode` ⇔ `payment_id` (CHECK); reject code ⇔ rejected; settled time ⇔ processed/failed; a manual paid refund carries its UTR; the dispatch sweep has a partial index on approved Razorpay refunds.
- `payments.refund_reserved_paise` / `refunded_paise`: CHECK `0 ≤ refunded ≤ reserved ≤ amount`; changed only by conditional UPDATEs under the payment row lock (group row first). **The ledger is the guarantee that refunds never exceed what was captured.** An unsure refund keeps its amount reserved.
- `refund_events`: append-only (`forbid_update_delete`). RLS on, client roles revoked, version / updated_at triggers (schema-invariants test).
- Lock order extended: order → group → payment → refund. `transitionOrder` (cancel/reject) creates the system request inside the same transaction.
- Guarded by `packages/db/test/refunds.test.ts` and `apps/api/test/refunds.test.ts`.

## Data model note: customer account (2026-11-15)

No migration. The existing `addresses` / `vehicles` rules are now used by the API: the one-default partial unique indexes, the per-customer live registration unique index (`vehicles_registration_uq`) and the version triggers. The limit of 10 per customer is enforced in the repository under a `users` row lock (`select … for update`), so concurrent creates cannot exceed it (test: 14 racing creates leave exactly 10). A default swap clears the old default before setting the new one inside one transaction, so the partial unique index holds at every statement.

## Data model note: bell and web push (migration `0057_notice_push`, 2026-11-15; renumbered at merge)

- **`notifications`** (the in-app bell; written for the first time by this change, so no backfill) gains `category` (`transactional|promotional|reminders`, default `transactional`, CHECK), `kind` (a code such as `order.confirmed`), `entity_type` (CHECK list) + `entity_id` (text: an id or a public code), `dedupe_key` and a CHECK that `link` is a path on this site (`^/[^/\]`). Unique partial index `(user_id, dedupe_key) where dedupe_key is not null` makes one change write one notice per person (retried transactions and double clicks write nothing twice); `notifications_created_idx` serves the 90-day retention delete; the existing `(user_id, created_at)` and partial unread indexes serve the list and the badge. Cursor pagination on `(created_at, id)`; the unread count is `count(*)` over a `limit 100` subquery. Title and body are plain text rendered in the recipient's language at write time.
- **`push_devices`** (new): `user_id` (FK cascade), `fcm_token` (UNIQUE, 20–4096 characters: one row per browser token; a browser that signs in as someone else moves the row), `platform` (`web|android|ios`), `ua_family` (`chrome|firefox|safari|edge|other`: the browser family only, never the user agent), `locale`, `created_at`, `last_seen_at`, `revoked_at`. Partial index on live rows per user. RLS on, `anon`/`authenticated` revoked. Tokens are personal data: never in analytics, logs or push outbox payloads (the adapter reads them at send time). Newest 10 live devices per person; the rest are revoked at registration.
- **No new triggers**: neither table has `version` or `updated_at` (rows are append-and-mark). `notification_templates` gains rows with channel `inapp`/`push` (key = notice kind), no schema change. The `notification_outbox` `push` channel and `notification_preferences` already existed.
- **Settings** (registry, all global): `notifications.retention_days` 90, `notifications.push_prompt_snooze_days` 14, `notifications.promo_per_week` 2, `notifications.offer_expiry_reminder_min` 5.
- **Tests:** `packages/db/test/notices.test.ts` (same-transaction and rollback, dedupe, language, staff permission and city scope, own-rows only, keyset paging, foreign ids, retention, device move/cap/404), `packages/db/test/schema-invariants.test.ts` (RLS on every table).

## Data model note: home servicing (migration `home_service`, 2026-11-15; renumbered at merge)

`workshops`: `home_service`, `home_radius_km` (CHECK 1 to 25), `home_visit_fee_paise` (CHECK 0 to 50 000), partial GIST index `workshops_home_location_gist` where `home_service`. `workshop_services.home_available`. `service_requests`: `service_mode` (CHECK), `address_id` (FK, set null), `home_address` (snapshot), `visit_fee_paise` (CHECK 0 to 50 000), `visit_fee_waived_reason` (CHECK codes), `visiting_mechanic` (CHECK 2 to 30), `arrival_override_reason/by` (CHECK pair); CHECKs: home never with pickup, home needs `location` + `home_address` + `visit_fee_paise`. New table `service_arrival_codes` (PK `request_id`, `code_enc` with the envelope CHECK, `attempts` CHECK 0 to 5; its own row so wrong guesses never bump the request `version`). New table `service_moves` (side record; one `proposed` per request by partial unique index; `decided_at` iff not proposed). `service_bills.estimate_id` is nullable, allowed only for a one-line (visit-fee-only) bill. Both new tables: RLS on, grants revoked, `bump_version` and `touch_updated_at` triggers. Machine edges: `vehicle_received → no_work_approved` (customer), `confirmed → vehicle_received` (admin, override). Lock order unchanged (request row first, then moves, estimates, bills; the arrival-code row is updated under the request lock).

## Data model note: job photos (migration `service_photos`, 2026-11-15)

- `media_objects` (generic image record: owner kind + owner id, bucket, `path` and `thumb_path` under a CHECK-enforced random-key shape, mime fixed to `image/webp`, dimensions 1 to 4000, bytes up to 8 MB, sha256 hex, uploaded_by, soft delete) and `service_photos` (request, stage `before|after`, unique media, caption 1 to 80, sort, soft delete). Both have `version`, timestamps, bump/touch triggers, RLS on and all client grants revoked.
- **Integrity:** the per-stage limit is counted under the request row lock (`FOR UPDATE`), so parallel uploads cannot exceed it; the gates read photo counts in the status move's own transaction; a media id is unique across photos; no hard deletes (soft delete + audit row).
- **Indexes:** `(request_id, stage, sort_order) where deleted_at is null`, unique `(bucket, path)`, `(owner_kind, owner_id)`, foreign keys `uploaded_by`, `created_by`.
- **Orphans:** objects are uploaded before the row is saved; a failed save removes them best-effort. A crash in between leaves unreachable random-key objects (no row, no URL); a purge job for these and for soft-deleted media is a pending decision.
