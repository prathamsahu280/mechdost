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
- Refund follow-ups (2026-11-16, migration 0073): settle-by-hand `repo/refunds.ts#settleUnsureRefund` (conditional UPDATE on status + version under the payment lock, CHECKs `refunds_settle_valid`, `refunds_settle_four_eyes`); late captures `repo/payments.ts#recordLateCapture` (idempotency key `sys_late_<order id>`); credit notes `repo/credit-notes.ts` (series `CN`, unique `invoices.refund_id`, CHECKs `invoices_credit_note_link`, `invoices_refund_only_credit_note`, split `splitCreditNote`). Tests `packages/db/test/refund-followups.test.ts`.
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
- `quote_reads` (migration 0073, 2026-11-16): read receipts, one row per (quote, side `customer|staff`) by composite primary key; `read_through_at` only moves forward (`greatest` in one conditional upsert, no read-then-write); `read_by_user_id` is for audit and never leaves the server. RLS on, client roles revoked, version / updated_at triggers, FK indexed, `quote_reads_live` pings the quote topic. Quote photos are `media_objects` rows (`owner_kind = 'quote_message'`, `owner_id` = the message id, uuid v7), written in the same transaction as the message.

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

## Admin people screens: indexes and audit actions (migration `0060_admin_people_indexes`, 2026-11-15)

No table changes. Indexes for the search and audit filters: `users_phone_last10_idx` on `right(phone, 10)` and `users_name_prefix_idx` on `lower(name) text_pattern_ops` (both partial, `deleted_at is null`); `audit_log_entity_id_idx (entity, id)`, `audit_log_action_id_idx (action, id)`, `audit_log_actor_id_idx (actor_user_id, id)`, `audit_log_created_idx (created_at)`. Email and codes use existing unique indexes. New audit actions: `role.granted` and `role.revoked` (entity `user_role`, with reason), `customer.pii_viewed` (entity `user`), `auth.staff_signed_in` (entity `user`, one row per completed staff sign-in). Not applied by the builder; the coordinator renumbers at merge.

## Data model note: job photos (migration `service_photos`, 2026-11-15)

- `media_objects` (generic image record: owner kind + owner id, bucket, `path` and `thumb_path` under a CHECK-enforced random-key shape, mime fixed to `image/webp`, dimensions 1 to 4000, bytes up to 8 MB, sha256 hex, uploaded_by, soft delete) and `service_photos` (request, stage `before|after`, unique media, caption 1 to 80, sort, soft delete). Both have `version`, timestamps, bump/touch triggers, RLS on and all client grants revoked.
- **Integrity:** the per-stage limit is counted under the request row lock (`FOR UPDATE`), so parallel uploads cannot exceed it; the gates read photo counts in the status move's own transaction; a media id is unique across photos; no hard deletes (soft delete + audit row).
- **Indexes:** `(request_id, stage, sort_order) where deleted_at is null`, unique `(bucket, path)`, `(owner_kind, owner_id)`, foreign keys `uploaded_by`, `created_by`.
- **Orphans:** objects are uploaded before the row is saved; a failed save removes them best-effort. A crash in between leaves unreachable random-key objects (no row, no URL); a purge job for these and for soft-deleted media is a pending decision.

## Data model note: shop staff invites (migration `shop_staff_invites`, 2026-11-15; renumbered at merge)

New table `shop_staff_invites` (`shop_id` FK cascade, `name` CHECK 2 to 60, `phone` CHECK `+91[6-9]...`, `status` CHECK `sent|used|expired|revoked` driven by `shopStaffInviteMachine`, `expires_at`, `used_at`/`used_by` with a CHECK that `used` has both, `created_by`). Partial unique index: one `sent` invite per (shop, phone); partial index on `phone` where `sent` for the sign-in lookup; FK indexes. RLS on, grants revoked, `bump_version` and `touch_updated_at` triggers. The team limit (10) is enforced under `select ... for update` on the shop row in `repo/shop-staff.ts` (invites and claims), so parallel invites cannot pass it (test: three racing invites for the last place, one wins). `shops.busy` / `busy_until` already existed; the delivery-code lock reuses `shipments.delivery_code_attempts`.

## Data model note: policy history and site documents (migration `0063_admin_policy_history`, 2026-11-15; renumbered at merge)

New table `content_versions` (append-only; trigger `content_versions_append_only` refuses UPDATE and DELETE; RLS on, client roles revoked): one row per publish or restore of a content entry (`key`, `locale`, optional `city_id`, `version_no` from 1 per entry, `value` jsonb, `action` published|restored, `restored_from` set exactly when restored, `created_by`, `created_at`), unique on (key, locale, city, version_no). Numbers are allocated under a per-entry `pg_advisory_xact_lock` inside the publish or restore transaction, so concurrent publishes cannot share a number (the unique index is the backstop). The migration copies every row of `content_blocks` with status `published` in as version 1, so history starts with what is live. Two whole-site documents reuse `settings` rows (jsonb value, `version`, optional city): `site.home_layout` (global or per city) and `company.details` (global); both change only by compare-and-set and write `audit_log` (`layout.saved`, `layout.reset`, `company.saved`, `content.restored`; `content.published` now also carries `historyVersion`) with a server event in the same transaction. No new permissions.

## Workshop analytics: index (migration `0064_workshop_analytics`, 2026-11-15)

No table changes and nothing written. One index: `service_requests_workshop_created_idx` on `(workshop_id, created_at)` (one workshop's requests in a date range, every status). The reports are read-only (`readOnlyReport`: repeatable read, 10 s statement timeout), city-scoped by an explicit id list, and aggregate-only: the portal never receives another workshop's name or row, and medians are given only from three workshops with requests. Not applied live; the coordinator renumbers at merge.

## Data model note: support threads (migration `0065_support_threads`, 2026-11-15; renumbered at merge)

- `support_tickets` gains `issue_code` (CHECK enum or null for older tickets), `refund_destination_enc` (CHECK `v1.` envelope, AAD `support_tickets.refund_destination_enc`), `refund_destination_mask` and `refund_destination_at`; CHECK `support_tickets_refund_destination_pair` keeps the encrypted value and its mask both set or both null.
- Partial unique indexes `support_tickets_order_thread_uq (user_id, order_id)` and `support_tickets_service_thread_uq (user_id, service_request_id)`, each `where issue_code is not null and <link> is not null and status <> 'closed'`: one open thread per customer and subject, enforced by the database. Older tickets (no issue code) and `labour_redo` tickets are outside them.
- `media_objects` owner kinds now include `ticket_message` (CHECK widened; owner id = `ticket_messages.id`, not a foreign key, as for every owner kind). The jsonb `ticket_messages.attachments` column stays unused. A message and its media rows are written in one transaction; objects are stored first and removed on a failed save (orphans on a crash are unreachable random keys, like job photos).
- Concurrency: an advisory lock per customer serialises opening; the reply cap and message insert run under the ticket row lock; the destination save locks the ticket row and checks for an existing manual refund of the order in the same transaction; the refund from a ticket runs in one transaction with `createStaffRefund` (idempotency key replays; audit row and event only on a fresh request).

## Data model note: coupons (migration `0064_coupons`, 2026-11-15; renumbered at merge)

- `coupons` extended: `title/title_hi/terms/terms_hi`, `funder` + `shop_id` (CHECK: shop-funded iff shop, no shop-funded free delivery), `paused_reason`, `created_by`, `config_version` (admin edits only; `version` also moves with every redemption). CHECKs: value range per kind (percent 1–90, flat 1–10,000,000 paise, free delivery 0), cap for percent only, window, `used_count <= usage_limit_total`, per-user 1–100, first-order-only implies per-user 1, paused needs a reason, code format.
- `coupon_user_usage (coupon_id, user_id, uses)`: moves only by a conditional upsert; a trigger (`coupon_user_usage_limit`) refuses an increase above the coupon's per-customer limit whatever path tries it (closes the race noted in research/promotions-referrals.md § 5.3).
- `coupon_shop_terms`: one row per shop-funded coupon (status pending|accepted|declined, `terms` snapshot, decided by/at); bump_version trigger; redemption needs `accepted`.
- `coupon_redemptions`: + `funder`, `released_at` (the use given back once). `order_groups`: + `coupon_code`, `coupon_discount_paise`, `coupon_snapshot` and a real FK on `coupon_id`; `orders`: + `coupon_discount_paise`, `coupon_funder`; `order_items.line_discount_paise` now holds the line's coupon share. CHECKs: `discount_paise = coupon + coins` on group and sub-order; coupon set iff snapshot set; `line_discount <= unit x qty`.
- `shop_payout_entries.kind`: + `coupon_discount` (MechDost-funded discount made good to the delivering shop; amount > 0, order required). RLS on the two new tables, client roles revoked.
- Concurrency: the last use goes to exactly one of two parallel checkouts (`packages/db/test/coupons.test.ts`; PGlite serialises, the conditional UPDATE is also asserted directly; true multi-connection runs belong to the real-Postgres CI job).

## Data model note: workshops tier 1 (migration `workshops_tier1`, 2026-11-15)

`workshop_slots` (CHECK `0 <= booked <= capacity`, unique workshop + date + hour; booking is a conditional UPDATE; release is guarded by `service_proposals.slot_released_at`, so a place goes back once); `service_proposals.slot_hour`, `slot_released_at` (CHECK: released implies an hour); `service_requests.reschedule_count` (CHECK 0 to 2); `workshops.slot_capacity` (CHECK 1 to 20); `workshop_change_requests` (one waiting per workshop and kind by partial unique index; decided rows carry `decided_at`); index `service_events_expired_workshop_idx` on the timeout payload. RLS on for the two new tables, client roles revoked. Lock order unchanged: request row, then workshop (share), then the slot row.

## Catalogue tier 2 tables (migration 0068, 2026-11-15)

`recommendation_rules` (unique pair, CHECK distinct categories, label lengths, Devanagari Hindi, priority range; compare-and-set on `version`), `copurchase_pairs` (PK pair, CHECK distinct, count >= 1; rebuilt in one transaction under an advisory lock, idempotent), `data_export_requests` (CHECK `ready` iff payload present and expiry set, size <= 2 MB, partial unique index = one active export per person, owner-scoped reads), `pincode_waitlist` (unique per person and PIN, PIN format CHECK, `notified` iff `notified_at`; join cap under a user row lock; notify flips status and writes the notice in one transaction). Consents stay append-only. All four: RLS on, anon/authenticated revoked.

## Data model note: product photos, carts, wishlist (migration `0067_photos_cart_wishlist`, 2026-11-15; renumbered at merge)

- `product_photos` reshaped (see spec 02): CHECKs on status, `sort` 0..7, alt lengths (both languages), placeholder size, the 640 key shape and "a refusal has a deletion time"; partial indexes `(product_id, sort) WHERE deleted_at IS NULL` and `(created_at) WHERE status = 'pending' AND deleted_at IS NULL` (the queue); unique `media_id`. `media_objects.owner_kind` gains `product_photo`. The migration clears the table first (no code ever wrote to it).
- `carts` (partial unique index: one active cart per user), `cart_items` (unique cart+variant, qty CHECK 1..99, FK restrict on the variant), `wishlist_items` (unique user+product, cascade). RLS on, client roles revoked, `bump_version` and `touch_updated_at` on the mutable tables, `SET LOCAL lock_timeout = '5s'`.
- Concurrency: the photo limit and positions, the 20-line cart limit and the 100-product wishlist limit are each held under one row lock (product row, user row), not by read-then-write. PGlite serialises, so the tests show the loser's rollback and the final count; true multi-connection runs belong to the real-Postgres job.
- Role-leak: another customer's cart or wishlist cannot be named (no ids in URLs); a shop cannot see, add to or remove from a product it does not sell, nor remove an approved or another shop's photo (404).
- **Migration 0068 (service bill payments, 2026-11-15):** `payments.group_id` nullable, `payments.purpose`, `payments.bill_id` (+ CHECK `payments_purpose_target`, partial unique `payments_one_open_per_bill_uq` and `payments_one_success_per_bill_uq`, index on `bill_id`); `refunds.group_id` nullable, `refunds.bill_id` (+ CHECK `refunds_group_or_bill`, index); refund source and reason lists gain `service_cancelled`, `duplicate_payment`; `service_bills.method` gains `online`; `service_requests` cancelled reason codes gain the staff list. No new table, so no new trigger or RLS step. Lock order for a bill payment: request -> bill -> payment (refund ledger lock follows the same order).

## RLS mirror (2026-11-16)

`0074_rls_mirror_policies` adds the `private` helper schema, SELECT-only column grants and read policies for the tables listed in `docs/research/rls-matrix.md`; no table, column or row changes. New rule for every new table: add it to `packages/db/test/rls-inventory.ts` (default `none` = RLS on, no policy, no grant); the matrix test fails until you do. Spec 13 "RLS mirror" has the design.

## Data model note: live pings for service requests (migration `0073_live_service_requests`, 2026-11-16)

- `live_outbox_topic_format` now also allows `request:<uuid>` (the kind `request` was already allowed). Function `live_request_changed()` and trigger `service_requests_live` (AFTER INSERT OR UPDATE, per row) call `live_enqueue('request:'||id, 'request', id, version, 'request.status_changed')` in the same transaction as the change (a rolled-back change never pings); the row holds an id and a version only. No new table, no new column, no RLS change (the outbox stays closed to client roles).
- Recipients are resolved in `resolveLiveRecipients` from Postgres at relay time: the request's customer, `user_roles.workshop_id = service_requests.workshop_id`, and city staff holding `service:read` (all-city grants included); unknown ids resolve to nobody; deactivated users are skipped.
- Staff performance and earnings (spec 07, 2026-11-16) add **no schema**: reads use `order_assignments(shop_id)`, `order_events(order_id, id)` and `shop_payout_entries(shop_id, created_at, id)`, all existing indexes; nothing is written except the analytics event.

## Data model note: coupon follow-ups (migration `0073_coupon_offers_reports`, 2026-11-16; renumbered at merge)

- `coupons`: + `is_public bool` (default false), `auto_apply bool` (default false), `category_id uuid` (FK categories, restrict; discount limited to its lines and sub-categories). CHECKs: `coupons_auto_mechdost` (automatic offers are MechDost-funded), `coupons_category_not_delivery`. Indexes: `coupons_category_id_index`, partial `coupons_public_live_idx (city_id, starts_at) where active and (is_public or auto_apply)`.
- `coupon_redemptions`: index `coupon_redemptions_coupon_created_idx (coupon_id, created_at, id)` for usage reports and the `coupon_usage` export. No new table: RLS, revoke and triggers of the existing tables apply (additive columns only).
- Counters unchanged and still single conditional statements (`redeemCoupon` UPDATE with the window and limit in the WHERE; release by `released_at is null` once). The whole-order refund release locks the group row, then counts sub-orders with processed refunds below their total; two refunds paid together cannot both miss each other.
- Data for ML (hard rule 16): every new field is typed and an enum or boolean; reports read only; the export carries `customer_ref = left(md5(user_id), 12)`, no PII. Tests: `packages/db/test/coupon-offers.test.ts`, `apps/api/test/coupon-offers.test.ts`.

## Business applications data map (migration 0078, design 2026-11-22)

- `business_applications`: status CHECK from `BUSINESS_APPLICATION_STATES`; shape CHECKs per kind (trade needs user, type, spend band, 1-30 categories, never `closed`; fleet needs phone, email, counts >= 0 with a sum > 0, needs within `FLEET_NEEDS`, only new/in_review/closed); `reason_code` present exactly when rejected; partial unique `(user_id) where kind='trade' and status in ('new','in_review')`; GSTIN (a public identifier) stored plain with a format CHECK; indexes on `(status, kind, created_at, id)`, `(city_id, created_at, id)` and every FK.
- `business_application_events`, `trade_account_events`: append-only (`forbid_update_delete`).
- `trade_accounts`: unique `user_id`, status CHECK (`verified|revoked`), `reason_code` present exactly when revoked; version and updated_at triggers. Moves only through `tradeAccountMachine` as conditional UPDATEs on `(status, version)`.
- ML (rule 16): codes everywhere (type, spend band, needs, reasons); counts as ints; free text only the optional fleet note and review note.

## Data model note: catalogue groups and optional MRP (migration 0079, 2026-11-22)

`brands` + `hidden/hidden_reason/version` and `product_ranges` (CHECK: hidden iff a reason code, reasons from `HIDE_REASONS`; unique brand+name; RLS on, no grant; bump_version and touch_updated_at triggers), `products.range_id` (indexed FK), `products.hindi_machine`, `product_photos.photo_source`, `product_variants.mrp_paise` nullable (partial index on missing MRP). Switches are conditional UPDATEs on `version` with an audit row; bulk status and bulk MRP are single conditional statements (a product that moved meanwhile is skipped, never forced; an MRP is never set below a stored shop or admin price). The importer finds products by pack SKU, never deletes, never overwrites an MRP, an edited product or a hidden brand; one advisory lock per batch.

## Roadside assistance data map (migration 0082, 2026-11-24, spec 22)

State: `rsa_requests` moves only through `rsaMachine` as a conditional UPDATE on (id, status, version); `rsa_offers` has a partial unique index for one `offered|accepted` offer per request; one live request per customer (partial unique index). Money: integer paise; the advance is snapshotted on the request and asserted by every payment fact; `payments_one_success_per_rsa_uq` and `payments_one_open_per_rsa_uq` allow one captured and one open payment per request and purpose; the table CHECK `rsa_requests_balance_maths` keeps balance = max(total − advance, 0). Lock order: request → offer → payment → refund (a cash mark, a balance capture, a cancel and an accept all take the request row first). Refunds: `refunds_one_target` (exactly one of group, bill, request) and an idempotent key per payment and reason, so a double cancel or a late webhook makes one refund request. History: `rsa_events` and `rsa_bill_lines` are append-only by trigger. Arrival code: encrypted, 5 tries, own row. All seven new tables have RLS on and grants revoked.

- **Sizes (2026-11-24):** `product_variants.version` (migration 0084) is the compare-and-set token for staff edits of a size; `order_items.variant_label` is part of the order snapshot (nullable, written once at placement). Cart, inventory, reservation and routing already reference `variant_id`; nothing else changes.

## Savings ledger and price history (migration 0101_shopping_savings, 2026-11-26; decision "Your savings as built")

- **Snapshots at checkout:** `order_items.mrp_paise` (the printed MRP per unit when the order was placed; null on
  lines placed before 0101, CHECK ≥ 0) and `orders.delivery_waived_paise` (the delivery charge the free-delivery
  threshold waived on that part; 0 when charged or for a negotiated bulk-quote delivery; CHECK ≥ 0). Old lines are
  never back-filled from today's MRP: they count as "excluded".
- **`customer_savings_entries`** (append-only by `forbid_update_delete`): one `delivered` row per sub-order (partial
  unique index on `order_id where kind = 'delivered'`) and one `refund` row per processed refund (unique `refund_id`),
  with `mrp_paise`, `coupon_paise`, `coins_paise`, `delivery_paise`, `total_paise` (CHECK total = sum; CHECK signs:
  delivered ≥ 0, refund ≤ 0 with `refund_paise` > 0), `counted_lines`, `excluded_lines`, `period_at` (the order's
  delivery time: a later refund reduces the month the saving was counted in, never a negative month) and `city_id`.
  Index `(user_id, period_at)` serves "this month / this year". **`customer_savings_lines`**: one row per counted line
  (`order_item_id` FK, unique per entry), append-only.
- **Writer:** only `syncOrderSavings(tx, orderId)` (repo `savings.ts`), idempotent and derived from facts already on
  the order. It takes `pg_advisory_xact_lock(hashtext('customer_savings'), hashtext(order_id))` as its **last** lock
  (the deliver path holds order → group, the refund path group → payment), then inserts what is missing with ON
  CONFLICT DO NOTHING. Called by `transitionOrder` after `settleGroupPayment` when a part becomes `delivered`, and at
  the end of the refund `afterProcessed` hook (both refund modes, webhook replays, settle-by-hand), each inside a
  savepoint (`syncOrderSavingsSafely`): a savings failure writes an `audit_log` alert (`savings.alert.not_written`)
  and never undoes a delivery or a settled refund; the next sync repairs it. A part delivered before 0101 has no row
  and shows nothing (never an "estimate" on a delivered order) until QSV2 is decided.
- **Refund maths:** a refund reverses every component and line in proportion to refund / order total, telescoping:
  after refunds R1..Rn the reversal is floor(x · ΣR / T) per component and per line, so any split of partial refunds
  reverses at most what was saved, and refunds adding up to the total reverse exactly all of it (property tests in
  `packages/shared/test/savings.test.ts`).
- **`variant_price_daily`** (never updated: an UPDATE trigger refuses it; PK `(day, variant_id, city_id)`; rows go
  with their pack by FK cascade, so removing demo packs still works): per live pack and live city, the printed
  MRP and the lowest customer price among live listings (admin city price, else the shop's), written by the worker
  once per IST day (hourly check, ON CONFLICT DO NOTHING). The record for any future "lowest price in N days" claim.
- RLS on, grants revoked, deny-all for all three tables (`rls-inventory.ts`); the privacy export includes the
  person's savings rows. PGlite is one connection: the concurrency test proves idempotency under interleaving, not
  real contention; run `packages/db/test/savings.test.ts` with `TEST_DATABASE_URL` on real Postgres before relying on
  the advisory lock under load.

## Data model note: delivery agents (migrations 0105 and 0106, 2026-11-26, spec 24)

- Machines `deliveryJobMachine`, `deliveryOfferMachine`, `agentStatusMachine` (`packages/shared/src/state/delivery.ts`);
  every move is a conditional UPDATE on `version` with an event row, in one transaction.
- **One active job per order:** partial unique index `delivery_jobs_one_active_uq` over the non-terminal states. **One
  open offer per job:** `delivery_job_offers_one_open_uq` (`offered|accepted`). One open invite per phone, one open
  switch per order, one pending mode request per shop (partial uniques). One document per agent and kind.
- **Lock order:** order row, then job, then offer and handover codes, then the agent row; `lockAgentWork` is taken
  before the agent row. Never the reverse.
- **Append-only:** `delivery_job_events`, `delivery_agent_events`, `delivery_agent_payouts` (a correction is one
  reversing row, `reverses_id` unique; sign CHECKs; amounts in paise).
- Handover codes (pickup, return) live in `delivery_handover_codes`, their own rows, with attempt counters and locks.
- Order CHECKs accept `ready_for_pickup`, `returned` and actor `delivery_agent`; `orders_agent_states` keeps agent-only
  states to agent mode; a returned order needs a delivery failure reason.
- Idempotency: payouts by `idem_key`; refunds by the existing refund keys (`delivery_returned`).

## Data model note: sessions and devices (migration `0117_user_sessions`, 2026-11-28)

Table `user_sessions`: uuid v7 `id`; `user_id` FK users ON DELETE CASCADE; `key_hash` text unique with CHECK 64 lower-case hex;
`device_kind`, `browser`, `os` text with CHECK lists from `packages/shared/src/devices.ts`; `country_code` CHECK `^[A-Z]{2}$`
or null; `region`, `city` English names or null; `last_active_at`; `revoked_at` + `revoked_reason` (CHECK: both set or both
null; reason in `self_device`, `self_others`, `self_all`, `staff_role_removed`, `password_changed`); `version`, `created_at`,
`updated_at`. RLS on, anon/authenticated revoked (`none` in the RLS inventory), `bump_version` + `touch_updated_at` triggers.
Indexes: unique `key_hash`; partial `(user_id, last_active_at desc) WHERE revoked_at IS NULL` for the list. Never stored: IP
address, raw User-Agent, raw session key. Ending a session is a conditional UPDATE guarded by `revoked_at IS NULL` (the
state), not by a client version, because the trigger bumps `version` on the hourly last-active refresh too. ML-ready: enums
for device, browser, OS and reason; UTC timestamps. The older unused `sessions` table (identity.ts) is superseded and left in
place (PENDING DECISIONS). Audit actions: `auth.device_signed_out`, `auth.devices_signed_out_others`.
