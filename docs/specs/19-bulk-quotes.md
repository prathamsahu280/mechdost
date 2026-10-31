# 19 · Bulk orders: negotiate with admin, then the normal order flow

Status: decided 2026-11-01 (user) · Phase 1 (with catalogue + orders) · Decisions: "Bulk quotes"

## Goal (user's words)

"If a customer wants to do a bulk order then he should have a little chat window to negotiate … which he would directly negotiate with the admin … and then the admin can set a final price for his bulk order and then the workflow for that order."

## Flow

1. **Request** — from the cart ("Request bulk price"), a product page ("Buying in bulk?") or the assistant, a signed-in, verified customer opens a **quote request**: lines (product, quantity), delivery PIN, optional note. Eligibility: total quantity ≥ `settings.bulk_min_units` or value ≥ `settings.bulk_min_value_paise` (defaults in inbox Q20).
2. **Negotiate** — a chat thread between the customer and **MechDost admin staff** (ops/city manager with `quotes:negotiate`); shops are not in the thread (user decision). Messages, attachments (≤ 5 MB images/PDF), read receipts, realtime via Supabase Realtime, notifications through the outbox.
3. **Offer** — the admin sets the **final price** per line (and delivery, validity, payment terms) as a versioned **offer**. Each new offer supersedes the previous one; the customer sees exactly one active offer.
4. **Accept** — the customer accepts the active offer before it expires → the system creates a normal **order** with the negotiated line prices snapshotted (`price_source = 'quote'`, `quote_id`, `offer_version`), then the **standard workflow** applies: payment (COD/online per settings) → admin routes to a shop → shop accepts/declines → fulfilment → delivery (spec 04). Cancellation/returns per spec 05 using the negotiated prices.
5. **Close** — expired, declined or withdrawn quotes close the thread (read-only history kept).

## States (`packages/shared/state`, CAS + version like orders)

`quote_requests`: `open → negotiating → offered → accepted | declined | expired | withdrawn`; `offered → negotiating` when a new message reopens talks (old offer superseded).

## Data

`quote_requests` (code `QT-{CITY}-{YYYY}-{6}`, customer, city, pincode, status, version, expires_at), `quote_lines` (product, qty, list price snapshot), `quote_messages` (append-only; author role, body, attachment ids), `quote_offers` (version, per-line unit price paise, delivery paise, total, valid_until, terms, created_by; UNIQUE (quote_id, version); one active offer via partial unique index), `orders.quote_id` + `offer_version`. Money in paise; GST computed on negotiated prices; audit log for every offer.

## Rules

- Only staff with `quotes:negotiate` can post offers; four-eyes approval when the discount vs list price exceeds `settings.bulk_max_discount_bp` (default 15%).
- Accept is idempotent (Idempotency-Key) and checks `offer.version` + `valid_until` in one conditional UPDATE; exactly one order per accepted offer (UNIQUE `orders.quote_offer_id`).
- Rate limits: 3 open quotes per customer, 30 messages/hour; Turnstile not needed (signed-in only).
- Analytics: `quote_requested`, `quote_message_sent`, `quote_offer_sent`, `quote_accepted`, `quote_expired`.

## UI

Customer: "Bulk quotes" in the account, thread view with the active offer card pinned on top (line table, total, expiry countdown, **Accept offer** as the single primary action). Admin: quotes queue (open / waiting for us / offered / expiring), thread + offer builder with list price, margin and discount warnings.

## Interim (until Phase 1)

Demo mode (2026-11-01): `/quotes/new` (prefilled from `?product=` or `?from=cart`; minimum 10 units = Q20 default) and `/quotes/{code}` (thread, offer card, accept/close) run on the browser store (`apps/web/src/demo/store.ts`: `createQuote`, `postQuoteMessage`, `sendOffer`, `acceptOffer(code, version)`, `declineQuote`). "Demo controls" stand in for the admin reply and offer builder until the admin console ships. The assistant's bulk answer links to `/quotes/new`. Acceptance test: `e2e/demo-flows.spec.ts` "bulk quote → negotiation → order".

## Acceptance tests

Two concurrent accepts → one order; accept after expiry → 409; superseded offer cannot be accepted; customer cannot see other customers' quotes (404); order lines carry negotiated prices; four-eyes on large discounts.
