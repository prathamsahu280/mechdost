# 19 · Bulk orders: negotiate with admin, then the normal order flow

Status: decided 2026-11-01 (user) · Phase 1 (with catalogue + orders) · Decisions: "Bulk quotes"

## Goal (user's words)

"If a customer wants to do a bulk order then he should have a little chat window to negotiate … which he would directly negotiate with the admin … and then the admin can set a final price for his bulk order and then the workflow for that order."

## Flow

1. **Request** — from the cart ("Request bulk price"), a product page ("Buying in bulk?") or the assistant, a signed-in, verified customer opens a **quote request**: lines (product, quantity), delivery PIN, optional note. Eligibility: total quantity ≥ `settings.bulk_min_units` (default **10 units**, user 2026-11-01, Q20; admin-editable). There is no value-based threshold.
2. **Negotiate** — a chat thread between the customer and **MechDost admin staff** (ops/city manager with `quotes:negotiate`); shops are not in the thread (user decision). Messages, attachments (≤ 5 MB images/PDF), read receipts, live updates via a Firebase Realtime Database ping + refetch (decision 2026-11-01), notifications through the outbox.
3. **Offer** — the admin sets the **final price** per line (and delivery, validity, payment terms) as a versioned **offer**. Each new offer supersedes the previous one; the customer sees exactly one active offer.
4. **Accept** — the customer accepts the active offer before it expires → the system creates a normal **order** with the negotiated line prices snapshotted (`price_source = 'quote'`, `quote_id`, `offer_version`), then the **standard workflow** applies: payment (COD/online per settings) → admin routes to a shop → shop accepts/declines → fulfilment → delivery (spec 04). Cancellation/returns per spec 05 using the negotiated prices.
5. **Close** — expired, declined or withdrawn quotes close the thread (read-only history kept).

## States (`packages/shared/state`, CAS + version like orders)

`quote_requests`: `open → negotiating → offered → accepted | declined | expired | withdrawn`; `offered → negotiating` when a new message reopens talks (old offer superseded).

## Data

`quote_requests` (code `QT-{CITY}-{YYYY}-{6}`, customer, city, pincode, status, version, expires_at), `quote_lines` (product, qty, list price snapshot), `quote_messages` (append-only; author role, body, attachment ids), `quote_offers` (version, per-line unit price paise, delivery paise, total, valid_until, terms, created_by; UNIQUE (quote_id, version); one active offer via partial unique index), `orders.quote_id` + `offer_version`. Money in paise; GST computed on negotiated prices; audit log for every offer.

## Rules

- Only staff with `quotes:negotiate` can post offers. **The price is whatever the negotiation settles** (user 2026-11-01, Q20): no discount cap and no second-approver gate. The offer builder shows the discount vs list price for information only; every offer is still audit-logged.
- Accept is idempotent (Idempotency-Key) and checks `offer.version` + `valid_until` in one conditional UPDATE; exactly one order per accepted offer (UNIQUE `orders.quote_offer_id`).
- Rate limits: 3 open quotes per customer, 30 messages/hour; Turnstile not needed (signed-in only).
- Analytics: `quote_requested`, `quote_message_sent`, `quote_offer_sent`, `quote_accepted`, `quote_expired`.

## UI

Customer: "Bulk quotes" in the account, thread view with the active offer card pinned on top (line table, total, expiry countdown, **Accept offer** as the single primary action). Admin: quotes queue (open / waiting for us / offered / expiring), thread + offer builder with list price and the discount vs list shown for information (no gate).

## Interim (until Phase 1)

Demo mode (2026-11-01): `/quotes/new` (prefilled from `?product=` or `?from=cart`; minimum 10 units = Q20 default) and `/quotes/{code}` (thread, offer card, accept/close) run on the browser store (`apps/web/src/demo/store.ts`: `createQuote`, `postQuoteMessage`, `sendOffer`, `acceptOffer(code, version)`, `declineQuote`). "Demo controls" stand in for the admin reply and offer builder until the admin console ships. The assistant's bulk answer links to `/quotes/new`. Acceptance test: `e2e/demo-flows.spec.ts` "bulk quote → negotiation → order".

## Demo hardening (2026-11-11, review B4/B10)

- The request form asks for the **delivery address** with the PIN code; accepting an offer applies the checkout rules (a serviceable Raipur address, from the account's default address or the request, and no `orders`/`cod_only` block), otherwise the customer sees "Add a Raipur delivery address" or the blocked message (`quote_accept_address`, `quote_accept_blocked`).
- Admin offer prices are parsed to integer paise (`apps/web/src/lib/money-input.ts`: ₹ sign, digit grouping and Devanagari digits accepted; up to 2 decimals); a bad or ₹0 unit price shows an error next to the field (aria-invalid + aria-describedby), the total waits until prices are valid, delivery may be ₹0, validity is 1–30 days, and "Send offer" stays enabled and focuses the first wrong field (`admin_quote_offer_invalid`).

## Acceptance tests

Two concurrent accepts → one order; accept after expiry → 409; superseded offer cannot be accepted; customer cannot see other customers' quotes (404); order lines carry negotiated prices; a quote below 10 units is refused (400).
