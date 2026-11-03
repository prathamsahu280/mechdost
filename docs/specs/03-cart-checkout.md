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
- Not yet: server carts and merge, checkout sessions, coupons, Coins redemption at the server, business GSTIN, COD OTP confirmation, reservation expiry job, Razorpay, web checkout wired to the API.

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
