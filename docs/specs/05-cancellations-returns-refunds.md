# 05 · Cancellations, returns, refunds, replacements (and P1 exchanges, disputes)

Status: decided; P1 pull-forward pending (register #2) · Phase 2 · Decisions: Post-purchase

## Goal

Self-serve post-purchase flows with clear policy windows, photo evidence, QC and automatic, never-duplicated refunds.

## User stories

- Cancel my order until it is packed (free); after that request cancellation (admin decides).
- Request a return or replacement within the window with reason and photos; see pickup scheduling and refund status.
- Raise a claim for wrong/defective item (refund or replacement).
- Get refunds to source (5–7 days) or wallet (instant, P1).

## States

Cancellation: `requested` → `approved|rejected` → refund. Return: `requested` → `approved` (pickup scheduled) | `rejected` → `picked_up` → `received` → `qc_passed` → `refunded` | `qc_failed` (returned to customer / partial refund). Replacement: as return + new sub-order `replacement_of` auto-routed to same shop. Refund: `pending` → `initiated` (Razorpay refund id) → `processed` | `failed` (retry/reconcile).

## Data

`order_cancellations` (order_id, requested_by role, stage, reason, status, decided_by), `returns` (order_item_id, type return|replacement|claim, reason code, photos[], status, pickup_slot, qc_result, resolution), `refunds` (order_id, payment_id, amount_paise CHECK>0, mode source|wallet|bank_upi, idem_key UNIQUE, razorpay_refund_id UNIQUE, status, approved_by), `credit_notes` (gapless series), `return_policies` (per category: window_days, returnable, replacement_only, conditions).

## API

`POST /orders/:code/cancel`, `POST /orders/:code/items/:id/return|replace|claim`, `GET /returns/:id`, admin `POST /admin/returns/:id/approve|reject|received|qc`, `POST /admin/refunds/:id/approve` (four-eyes above threshold), shop `POST /shop/returns/:id/received|qc`, webhook `refund.processed`.

## Rules

Windows per city/category (default return 7 days from delivery; lubricants opened and installed batteries non-returnable; electricals replacement-only); refund = stored line amounts (taxable + tax) + proportional shipping only on full cancel; one refund ledger per payment with remaining-balance check (`SELECT … FOR UPDATE`); COD refunds collect UPI id/bank via verified form; credit note issued for every refund of an invoiced item; customer messaging uses concept policy wording updated for real flows.

## Edge cases

Refund API fails after DB row → reconciliation job resends with same idempotency key; return photo upload too large → compress client-side; replacement item out of stock → convert to refund with consent; chargeback/dispute from gateway → ticket + freeze refund.

## Notifications

`cancellation.requested|approved|rejected`, `return.requested|approved|rejected|picked_up|received|qc_result`, `refund.initiated|processed|failed` → customer in-app + email; shop and admin queues.

## Analytics

`cancel_requested` (stage, reason), `return_requested` (type, reason), `refund_processed` (mode, days).

## Acceptance tests

Cancel allowed until packed and blocked after; refund never exceeds captured; double-click refund → one Razorpay call; credit note gapless; QC fail path; replacement sub-order routed to same shop.

## Open decisions

Register #2: pull exchanges, service reminders, disputes, order chat into launch (user leaning yes; decide 2026-11-01).

## P1/P2

Exchanges with price difference; warranty replacement with workshop inspection; disputes with evidence and admin ruling; order chat; open-box delivery for batteries/tyres; RTO scoring.

## Policy change (decision 2026-11-01): no returns, no exchanges

This supersedes the self-service return/replacement/exchange flows above; the refund ledger, cancellation and integrity rules stay.

- **Not accepted:** returns or exchanges for change of mind, wrong part ordered or no longer needed.
- **Faulty, damaged or wrong item delivered:** the customer opens a **support ticket** (spec 09) from the order with photos within the claim window (default 7 days from delivery, Q25). Support checks with the shop and resolves as **replacement** (new sub-order `replacement_of`, routed like any order) or **refund** (refund ledger, four-eyes above threshold). Ticket reason codes: `faulty`, `damaged_in_transit`, `wrong_item`, `missing_item`.
- **Cancellation:** free until the shop packs the order (Q25 default); after that only through support. Orders we cannot fulfil (rejected, no shop) are cancelled with a full refund automatically, as before.
- **Refund destination:** the original payment method; bank/UPI (stored encrypted, `refunds.destination_enc`) for COD orders. **Never** into coins or a wallet; coins used on the order are restored as coins (spec 20).
- **Disclosure** (Consumer Protection (E-Commerce) Rules 2020): the policy is shown before purchase on product pages, checkout and `/policies/returns` (footer link), in English and Hindi.
- **Demo:** policy page and notes are live; the support-ticket claim flow arrives with spec 09. Test: `e2e/coins-policy.spec.ts` "returns policy".

## Built: order cancellation API (2026-11-03)

`packages/db/src/repo/customer-orders.ts`, routes in `apps/api/src/routes/checkout.ts` (customer) and `admin-orders.ts` (staff).

- **Customer** `POST /v1/orders/{subOrderCode}/cancel {reasonCode, version}`: own orders only (404 otherwise), while the sub-order is `placed`, `awaiting_shop`, `needs_rerouting` or `confirmed` and not past its `cancellable_until_status` (default `confirmed`); packed or later → 409 `NOT_CANCELLABLE` ("contact support").
- **Staff** `POST /v1/admin/orders/{code}/cancel` (`orders:cancel`, city-scoped): anything the order machine allows for admin (also `packed`).
- **Reason codes** `ORDER_CANCEL_REASONS` (changed_mind, ordered_by_mistake, found_cheaper, delivery_too_slow, customer_unreachable, other); a cancelled order always has one (migration 0029 CHECK `orders_cancelled_explained`).
- **One transaction:** order → `cancelled` (CAS on version; races with a shop accept resolve to exactly one winner), an open shop offer → `withdrawn`, held stock released, stock already taken by an accept put back on the shelf, audit row `order.cancelled`. COD has nothing to refund; prepaid refunds come with online payment.
- **Tracking** `GET /v1/orders` (newest first, keyset-paged: `?limit=` ≤ 50, pass `nextCursor` back as `?cursor=`; a tampered cursor is 422 `INVALID_CURSOR`) and `GET /v1/orders/{groupCode}`: per sub-order status, items, the customer-visible timeline, the seller once accepted, the rejection message, the 4-digit delivery code while out for delivery, and `canCancel`.
- Not yet: cancellation window by time, fees after dispatch, faulty-part tickets → replace/refund flow, notifications on cancel.

### Demo screens (2026-11-03, same rules as the API)

- Customer order page (`apps/web/src/components/commerce/order-view.tsx`): "Cancel this order" until the shop packs it (`customerMayCancel`: placed → confirmed), with a reason (`ORDER_CANCEL_REASONS` minus `customer_unreachable`) and a plain note (COD: nothing to refund; coins come back). "Keep my order" backs out. A cancelled order shows who cancelled, when and why.
- Admin order card (`admin-console.tsx`): "Cancel order" while not closed and at most packed (`staffMayCancel`), with a reason code; the card shows "Cancelled by the customer/MechDost on … · reason"; routing and reject disappear. New queue "Cancelled". Reject now also asks for a **reason code** (`ORDER_REJECT_REASONS`) besides the message, matching `POST /v1/admin/orders/{code}/reject`.
- Store (`apps/web/src/demo/store.ts`): `cancelDemoOrder` withdraws an open shop offer; closed orders (`isClosed`: rejected or cancelled) never move forward (demo controls, shop steps, delivery code). Shop portal drops cancelled orders from its active list. Coins used on the order are restored.
- Tests: `e2e/order-cancel.spec.ts` (desktop + mobile).
