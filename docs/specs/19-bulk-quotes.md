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
- Analytics: `quote_requested`, `quote_message_sent`, `quote_offer_sent`, `quote_accepted`, `quote_expired`, plus `quote_closed` (declined by the customer or withdrawn by staff, with the reason code).

## UI

Customer: "Bulk quotes" in the account, thread view with the active offer card pinned on top (line table, total, expiry countdown, **Accept offer** as the single primary action). Admin: quotes queue (open / waiting for us / offered / expiring), thread + offer builder with list price and the discount vs list shown for information (no gate).

## Interim (until Phase 1)

Demo mode (2026-11-01): `/quotes/new` (prefilled from `?product=` or `?from=cart`; minimum 10 units = Q20 default) and `/quotes/{code}` (thread, offer card, accept/close) run on the browser store (`apps/web/src/demo/store.ts`: `createQuote`, `postQuoteMessage`, `sendOffer`, `acceptOffer(code, version)`, `declineQuote`). "Demo controls" stand in for the admin reply and offer builder until the admin console ships. The assistant's bulk answer links to `/quotes/new`. Acceptance test: `e2e/demo-flows.spec.ts` "bulk quote → negotiation → order".

## Demo hardening (2026-11-11, review B4/B10)

- The request form asks for the **delivery address** with the PIN code; accepting an offer applies the checkout rules (a serviceable Raipur address, from the account's default address or the request, and no `orders`/`cod_only` block), otherwise the customer sees "Add a Raipur delivery address" or the blocked message (`quote_accept_address`, `quote_accept_blocked`).
- Admin offer prices are parsed to integer paise (`apps/web/src/lib/money-input.ts`: ₹ sign, digit grouping and Devanagari digits accepted; up to 2 decimals); a bad or ₹0 unit price shows an error next to the field (aria-invalid + aria-describedby), the total waits until prices are valid, delivery may be ₹0, validity is 1–30 days, and "Send offer" stays enabled and focuses the first wrong field (`admin_quote_offer_invalid`).

## Acceptance tests

Two concurrent accepts → one order; accept after expiry → 409; superseded offer cannot be accepted; customer cannot see other customers' quotes (404); order lines carry negotiated prices; a quote below 10 units is refused (400).

## Built: API + real mode (2026-11-14, real-API launch)

Quotes run on the API in real data mode (`QUOTES_ON_API` = `NEXT_PUBLIC_DATA_MODE=api`; `QUOTES_AVAILABLE` also keeps the demo); they are no longer part of `BROWSER_ONLY_FEATURES`. Rulings in `docs/decisions.md` "Bulk quotes on the API".

**Database (migration 0049):** `quote_requests` (code `QT-…`, customer, city, PIN, delivery address snapshot, status CHECK from `QUOTE_STATES`, reason code bound to its status, `offer_version`, `list_total_paise`, `units`, `last_message_at/by`, `expires_at`, `closed_at`, idempotency key + request hash, `version`), `quote_lines` (append-only: product, variant, SKU, slug, title en/hi, qty 1–99, catalogue unit price for the PIN at request time, MRP), `quote_messages` (append-only; customer / staff / system), `quote_offers` (versioned, UNIQUE (quote, version), **one `active` per quote** by partial unique index; lines `[{lineNo, unitPaise}]`, subtotal + delivery = total CHECK, `valid_until`, terms, COD, created_by), `quote_events` (append-only timeline). `order_groups.quote_id` / `quote_offer_id` (both or neither; **partial unique on each**: one order per quote and per offer) and `order_items.price_source` (`catalogue` | `quote`). RLS on, client roles revoked, version / updated_at triggers, live pings (`quote:<id>` → the customer and the city's `quotes:read` staff), and the `quotes:*` permissions inserted for the system staff roles.

**States (`quoteMachine`):** `open → negotiating` (first staff reply) · `open|negotiating → offered` (offer; a newer offer keeps `offered` and supersedes the active one) · `offered → negotiating` (a **customer** message reopens talks; the active offer is superseded) · `offered → accepted` (customer) · `open|negotiating|offered → declined` (customer, reason code) · `→ withdrawn` (staff, reason code + message) · `→ expired` (worker: the active offer ran out, or nobody wrote for 30 days).

**API** (`apps/api/src/routes/quotes.ts`; customers signed in, writes need phone + email verified; staff verified and city-scoped per permission):

| Route                                                                                                 | Who                         | Notes                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/quotes/rules`                                                                                | customer                    | minimum units (`quotes.min_units`, admin setting, default 10), limits, open count                                                                                                                                   |
| `POST /v1/quotes`                                                                                     | customer (`quotes:request`) | Idempotency-Key (201, replay 200); products by catalogue slug (+ optional SKU), live only; below the minimum → **400** `QUOTE_MIN_UNITS`; 3 open per customer (422 `QUOTE_OPEN_LIMIT`); 20/h                        |
| `GET /v1/quotes`, `GET /v1/quotes/{code}`                                                             | customer                    | own quotes only (others 404); keyset paged                                                                                                                                                                          |
| `POST /v1/quotes/{code}/messages`                                                                     | customer                    | 30 per quote per hour (+ a per-user rate limit)                                                                                                                                                                     |
| `POST /v1/quotes/{code}/accept`                                                                       | customer                    | `{offerVersion}` + Idempotency-Key → places a **normal COD order** through `placeOrder` with the negotiated prices (same transaction); 409 `QUOTE_OFFER_STALE` / `QUOTE_OFFER_EXPIRED` / `QUOTE_CLOSED`; replay 200 |
| `POST /v1/quotes/{code}/decline`                                                                      | customer                    | reason code                                                                                                                                                                                                         |
| `GET /v1/admin/quotes?view=waiting\|active\|offered\|expiring\|closed`, `GET /v1/admin/quotes/{code}` | staff `quotes:read`         | phone masked to the last 4 digits                                                                                                                                                                                   |
| `POST /v1/admin/quotes/{code}/messages`                                                               | staff `quotes:negotiate`    | first reply → `negotiating`                                                                                                                                                                                         |
| `POST /v1/admin/quotes/{code}/offer`                                                                  | staff `quotes:negotiate`    | `{version, lines[{lineNo, unitPaise}], deliveryPaise, validDays 1–30, terms}`; a price for every line; audited with the catalogue total                                                                             |
| `POST /v1/admin/quotes/{code}/withdraw`                                                               | staff `quotes:negotiate`    | `{version, reasonCode, message 10–500}`                                                                                                                                                                             |

**Accepting an offer** locks the quote row, checks the active offer's version and `valid_until`, then calls `placeOrder` with `quotePricing`: the negotiated GST-inclusive unit prices replace the catalogue prices (GST split on them, exact paise), the offer's delivery charge rides on the first sub-order, **no COD fee and no COD cap** (staff agreed the order), the PIN's COD rule, customer blocks and stock reservation apply as for any order; the order then follows the normal routing and fulfilment (spec 04). A negotiated price may sit below the shop's approved price (`price_source = 'quote'`): the shop is paid its price. Stock missing at accept → `CHECKOUT_UNAVAILABLE`, nothing changes.

**Notifications:** live ping on every quote change (customer + city staff); an **email** to a verified address when an offer is sent (`quote_offer` template, dedupe per offer version). No WhatsApp template (not approved yet). The worker expires quotes every 5 minutes.

**Web (real mode):** `/quotes/new` (product search on `GET /v1/catalogue/products?q=`, prefill from `?product=` or the cart), `/quotes/{code}` (offer card with Accept as the one primary action, cash on delivery, close with a reason, chat with the "reopens talks" hint, refresh every 20 s), account "Bulk quotes" list and badge (`useQuoteRows`), Admin → Quotes desk (`admin-quotes-api.tsx`: views, thread, reply, offer builder with the discount for information, withdraw). API screens are lazy chunks (`quote-lazy.tsx`, `next/dynamic` in the admin console); response schemas `@mechdost/shared/quote-api`; strings `quote.api_*` (en + hi).

**Not built yet (pending, see decisions):** attachments and read receipts in the thread; online payment for an accepted quote (COD only); WhatsApp notification templates.

**Tests:** `packages/db/test/quotes.test.ts` (19: snapshot, idempotency, minimum, non-live products, PIN, open limit, foreign ids 404, staff city scope, one active offer, stale offer, reopen on customer message, message limit, accept with negotiated prices below the shop price, two concurrent accepts → one order + replay, expired offer 409, out of stock, decline, withdraw, expiry sweep, live recipients), `apps/api/test/quotes.test.ts` (9, incl. 401/403/400/404/409/422 paths), `packages/shared/test/quotes.test.ts` (machine walk of every pair × actor, schemas), `apps/web/test/quote-views.test.ts`. Acceptance tests above: all covered (the minimum refusal is 400 at the API).
