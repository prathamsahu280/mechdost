# 03 · Cart & checkout

Status: decided (payment mix at launch pending) · Phase 1 · Decisions: Checkout, COD, Multi-seller split

## Goal

A 3-step checkout (address → review → pay) that re-validates stock and price server-side, splits multi-shop carts automatically, supports coupons, GST invoices and COD rules, and never double-charges.

## User stories

- Guest adds to cart (max 20 products × 99); cart merges on login (union, keep higher qty, flag changes).
- Choose address (or add with GPS), see delivery options and ETA per shop group, apply coupon, add order note, toggle "Business purchase" with GSTIN.
- Review itemised totals (products incl. GST, delivery, discount, COD fee), consent, place order; pay online (Razorpay) or choose COD (OTP-confirmed).
- See confirmation with order code(s) and tracking link.

## Flow & states

cart (client + server `carts` for logged-in) → `checkout_sessions` (address, pricing snapshot, reservations with 15-min TTL) → `orders` (parent) + sub-orders per shop → payment: `pending` → `paid` | `failed` | `cod_confirmed`. Reservation released on failure/expiry (pg-boss).

## Data

`carts`, `cart_items`, `checkout_sessions` (idempotency_key, pricing jsonb, expires_at), `coupons`, `coupon_redemptions`, `orders` (parent_id nullable, code, user, address snapshot jsonb, city, pincode, payment_method, payment_status, subtotal/discount/shipping/cod_fee/tax/total paise, gstin, business_name, note, cancellable_until), `order_items` (snapshot: title, sku, hsn, gst_rate_bp, unit_paise, qty, line_discount_paise, cgst/sgst/igst paise), `reservations`, `payments` (razorpay_order_id UNIQUE, razorpay_payment_id UNIQUE, amount, status), `idempotency_keys`, `webhook_events`.

## API

`GET/POST /cart`, `POST /checkout/sessions` (idempotency key), `POST /checkout/sessions/:id/address`, `POST /checkout/sessions/:id/coupon`, `POST /checkout/sessions/:id/place` → creates orders + Razorpay order or COD OTP; `POST /webhooks/razorpay` (raw-body HMAC, event-id dedupe, async processing); `POST /orders/:code/cod/confirm-otp`.

**Built 2026-11-03 (first slice: quote + COD placement; `packages/db/src/repo/checkout.ts`, `apps/api/src/routes/checkout.ts`):**

- `POST /v1/checkout/quote` `{pincode, lines:[{sku, qty}], locale}`: public (60/min per IP). Each line is priced from the **nearest covering shop with free stock for the whole quantity** (same rule as spec 02); lines are grouped by that shop into per-shop groups ("Sold by …", delivery from `shop_pincodes.shipping_paise`, free when the group subtotal reaches setting `checkout.free_delivery_min_paise`); GST split exactly per line (`splitInclusiveGst`: CGST = SGST when shop state = delivery state, else IGST). Line issues: `unavailable` (not live / no stock anywhere) or `insufficient_stock` with `available` = the most one shop can deliver. COD eligibility: `checkout.cod_cap_paise` (default ₹5,000) and the PIN's `cod_allowed`; `checkout.cod_fee_paise` (default 0). The COD fee is stored on the group (`order_groups.cod_fee_paise`) **and on the first sub-order** (`orders.cod_fee_paise`, migration 0032), so each sub-order's total is exactly what its shop collects (`orders_total_matches` CHECK: total = subtotal − discount + shipping + COD fee) and the sub-orders add up to the group total (code review 2026-11-03). Settings are per city with a global fallback (admin-editable, hard rule 8). Unknown or non-live PIN → 422 `PINCODE_NOT_SERVICEABLE`.
- `POST /v1/orders` (signed in, phone + email verified, `orders:place`, 10 per 10 min per user, **`Idempotency-Key` header required**): COD only (`online` → 422 `PAYMENT_METHOD_UNAVAILABLE` until Razorpay, pending #1). In one transaction: advisory lock on (user, key) → same key returns the same order (200, `replayed: true`; first time 201) — but only for the same request: a SHA-256 of address, lines and note is stored (`order_groups.request_hash`, 0033) and the same key with a different request is 422 `IDEMPOTENCY_MISMATCH` → re-quote → `CHECKOUT_UNAVAILABLE` (422, `details.lines`) / `PRICE_CHANGED` (409, the customer's `expectedTotalPaise` must equal the re-priced total) / `COD_NOT_ALLOWED` (422) → order group `MD-{CITY}-{YYYY}-{6}` (code collision retried in a savepoint) + one sub-order per shop (`{group}-{n}`, status `placed`, `suggested_shop_id` = pricing shop, address snapshot) + items with tax snapshot and the title in English and Hindi (`order_items.title` / `title_hi`, 0033; readers pick by locale, shops get both) + stock reservations (conditional updates; TTL `checkout.cod_reservation_minutes`, default 24 h) + audit row; the insert trigger writes the `placed` timeline event with actor customer and the live outbox pings the admin queue.
- Customer blocks (spec 08, built 2026-11-03): `orders`/`full` → 403 `ORDERS_BLOCKED`; `cod_only` → `COD_NOT_ALLOWED` (`reason: customer`). The public quote does not know the customer, so placement is the authoritative check.
- Not yet: server carts and merge, checkout sessions, coupons, Coins redemption at the server, COD OTP confirmation, the web cart on the API (the pay-online button already places API orders; see § Online payment).

## Online payment — Razorpay Standard Checkout (backend built 2026-11-12)

Plan `docs/superpowers/plans/2026-11-12-razorpay-checkout-backend.md`; user chose "backend now, pay button with the real checkout".

- **Quote:** `POST /v1/checkout/quote` returns `totalPaise` (cash on delivery, includes the COD fee) and `onlineTotalPaise` (paid online: no COD fee).
- **Place:** `POST /v1/orders {paymentMethod: 'online', expectedTotalPaise: onlineTotalPaise, …}` with `Idempotency-Key`.
  - It places the order like COD (re-priced, reserved, idempotent) with `payment_method = 'online'` and `payment_status = 'created'`, no COD fee, and stock held for `checkout.online_payment_minutes` (admin setting, 10–120, default 30).
  - It then creates the Razorpay order (`amount` = what is still payable: the live sub-orders; `receipt` = group code) and stores it in `payments` (unique provider order id; **one open Razorpay order per group**, `payments_one_open_per_group_uq`) **before** answering. When two place calls overlap, the first stored order wins and the other is never shown.
  - The answer carries `razorpay {keyId, orderId, amountPaise, currency}`. A retried place reuses the stored Razorpay order.
  - `422 PAYMENT_METHOD_UNAVAILABLE` while the keys are not set.
- **Checkout callback:** `POST /v1/payments/razorpay/verify {razorpayOrderId, razorpayPaymentId, razorpaySignature}`, for a signed-in, verified owner only (404 otherwise).
  - It checks `HMAC_SHA256(our order id + "|" + payment id, key secret)` in constant time (`400 SIGNATURE_INVALID`).
  - It then **fetches the payment from Razorpay**: only `captured`, for our order, the stored amount and INR, marks the order paid.
  - Answer: `{orderCode, outcome: paid | attempted | failed | unchanged | mismatch | unknown_order | needs_refund}`. `needs_refund` and `mismatch` are logged as errors here as on the webhook.
- **Webhook:** `POST /webhooks/razorpay`; 404 until `RAZORPAY_WEBHOOK_SECRET` is set.
  - It checks the raw-body HMAC (`X-Razorpay-Signature`) before parsing.
  - Each `x-razorpay-event-id` is recorded once (`webhook_events`).
  - It handles `payment.captured`, `payment.authorized`, `payment.failed` and `order.paid`, applied inline (one small transaction; pg-boss later).
- **Payment facts** (`applyRazorpayPayment`):
  - The payment row is locked, and the amount and currency must match (otherwise audit `payment.amount_mismatch`, no change).
  - The state is monotonic through `paymentMachine`: a failure after paid is a no-op, and a failed UPI attempt can still be paid later.
  - Events `payment_captured` / `payment_failed`.
- **Unpaid online orders:**
  - They never appear in the routing queue, and `routeOrder` refuses them (`409 AWAITING_PAYMENT`).
  - The worker cancels them after the payment window (system, reason `payment_not_completed`), puts the stock back, and marks the group and payment `expired`.
- **Security review fixes (2026-11-12):**
  - A webhook event is recorded only together with its payment fact (one transaction), so a failed apply is retried.
  - Locks are taken group first, then payment (the expiry job takes orders, then group, then payments).
  - Cancelling the last live part of an unpaid online order expires the group and its Razorpay orders.
  - Money captured for an expired or cancelled order never completes it: outcome `needs_refund`, audit `payment.captured_needs_refund` (once per payment), logged as an error for finance until automatic refunds exist (spec 05).
  - Razorpay order `expire_by` is not set (not verified for the Orders API); the window is enforced on our side.
- **Final review fixes (2026-11-12):**
  - A capture extends the order's stock holds to `checkout.cod_reservation_minutes`, so a paid order keeps its stock until staff route it.
  - A capture on another Razorpay order of a group that is already paid is `needs_refund` (never an error loop).
  - Cancelling one part of an unpaid online order expires its open Razorpay order; the next payment asks only for the live parts.
  - The payment window is `checkout.online_payment_minutes` of the order's **city** (else global), the same value that set the stock hold. The expiry query decides the window in SQL, so a batch holds only due groups (no starvation); one group failing never stops the rest.
  - The Razorpay order is stored under the group lock (the lock a part cancel takes) after re-checking the payable amount: a part cancelled while Razorpay was creating the order makes the API start once more with the new amount (`PAYABLE_CHANGED`), never store the old total.
  - Production refuses to start with Razorpay keys but no `RAZORPAY_WEBHOOK_SECRET`.
  - The website: a retry of a paid attempt is a success; a closed window or changed details start a new order; once Razorpay took the money, a failed confirmation says "not confirmed yet" (it checks the order, which the webhook may have confirmed), never "choose cash on delivery".
- **Website:** checkout offers "Pay online" in real sign-in builds (`apps/web/src/lib/payments/pay-online.ts`); local test steps in `docs/runbooks/payments.md`.
- **Not yet:**
  - refunds for paid orders that are cancelled or rejected (spec 05);
  - the hourly reconciliation job;
  - pg-boss processing of webhooks.

## UI

Cart drawer (concept "Your cart" modal copy), checkout pages reuse concept "Checkout · Delivery details" and "Review your order" labels; shop-group blocks "Sold by {shop} · Delivery ₹x · {n} days"; coupon field; payment selector; COD OTP screen; confirmation "Order placed" with stepper.

## Rules

Server re-prices every line from `shop_inventory` for the pincode; qty ≤ stock and ≤ per-SKU max; price change since add → notice; fitment warning with override; coupons: percent/flat/free-shipping, min subtotal, first-order, per-user and total limits, schedule, stacking off by default, allocation across lines (Fowler allocate); GST: CGST+SGST if shop state == ship state else IGST, inclusive maths from `data-integrity.md` §6; COD: cap per city (default ₹5,000), OTP confirm, fee optional, blocked for RTO-flagged customers/pincodes/categories; order codes `MD-{CITY}-{YYYY}-{6 base32}`; email + phone verified required to place.

## Edge cases

Stock drops between review and place → specific line error (concept copy "only {n} unit(s) available"); payment success but webhook late → "payment processing" state with reconciliation; duplicate place (double click/offline retry) → same idempotency key returns same order; address pincode becomes unserviceable → prompt to change; coupon exhausted at place → re-price and show.

## Notifications & events

`order.placed` (customer in-app+email; admin queue), `payment.captured`, `payment.failed`, `cod.confirmed`; outbox dedupe `order_placed:{id}`.

## Analytics

`view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `apply_coupon` (success/fail), `purchase` (server-side), `checkout_abandoned` (session expiry).

## Acceptance tests

Multi-shop split creates N sub-orders with one payment; parallel place with same key → one order; reservation expiry releases stock; GST split property tests; Razorpay webhook replay ×3 → one state change; amount mismatch flagged; COD above cap blocked.

## Open decisions

Payment methods at launch (register #1).

## P1/P2

Buy-X-get-Y and campaign budgets, MechDost Coins redemption (built, spec 20), click-and-collect, EMI/pay-later, abandoned-cart recovery, saved cards via tokens, gift cards (P2), express checkout (P2).

## Built: business purchase with a GSTIN (2026-11-13)

Design `docs/superpowers/specs/2026-11-13-buyer-gstin-design.md`, plan `docs/superpowers/plans/2026-11-13-buyer-gstin.md`.

- **Checkout:** an optional "This is a business purchase (GST invoice)" tick shows **GSTIN** and **Business name (as on GST)**. The GSTIN is normalised (spaces removed, upper case) and checked with the checksum (`isGstin`); errors show next to the fields. A GSTIN registered in another state than the delivery address shows a note, never an error: "This GSTIN is registered in {state}. Goods delivered in {deliveryState} are invoiced with {deliveryState} as the place of supply." State names come from the locale namespace `gstStates` (all GST state codes, English and Hindi).
- **API:** `POST /v1/orders` takes an optional `business: { gstin, businessName }` (`BusinessPurchaseSchema`, both or neither, strict); `GET /v1/orders/{code}` returns `business`; `POST /v1/checkout/quote` returns `deliveryStateCode` (the GST state code of the delivery PIN).
- **Data:** `order_groups.gstin` and `business_name` (snapshot), behind CHECKs for the GSTIN format, both-or-neither and a 2–120 character name (migration 0041). The idempotency hash includes them: the same key with a different GSTIN is `IDEMPOTENCY_MISMATCH`.
- **Shown back:** the order page, the admin's order card and the shop's order card show "GST invoice for {business} ({GSTIN})". **The shop sees it only after accepting** the order, like the other customer details (final review 2026-11-13); the API shop and routing reads do not carry it yet (to add at the data switch, with the same rule). The business name is marked as user text (Latin allowed on `/hi`). Every shop that can be routed is GST-registered (seller onboarding), so any shop can issue the B2B invoice once invoicing is built.
- **Not yet:** saving the GSTIN to the account for reuse (P1); B2B invoices (with invoicing).
- **Tests:** shared `business.test.ts`, db `checkout.test.ts` (business purchase), api `checkout.test.ts`, e2e `checkout-business.spec.ts` (5 tests × desktop and mobile: unticked, business purchase with the state note and the admin card, the Hindi note, untick after typing and one field alone, the shop seeing the GSTIN only after accepting); the Hindi crawl seeds a business purchase on its orders.
