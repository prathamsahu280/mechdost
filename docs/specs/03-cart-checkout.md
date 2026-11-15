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
- Not yet: server carts and merge, checkout sessions, COD OTP confirmation (coupons: built 2026-11-15, § Built: coupons; Coins redemption at the server: built, spec 20), the web cart on the API (the pay-online button already places API orders; see § Online payment).

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
  - (built 2026-11-15) refunds for paid orders that are cancelled or rejected: a request that finance approves, spec 05 "Built: refunds"; captured-after-close payments (`needs_refund`) still only audit;
  - the hourly reconciliation job;
  - pg-boss processing of webhooks.

## Delivery charges (2026-11-14, user: "admin configurable per shop or per pincode")

- Each shop group's delivery charge is the covering shop's `shop_pincodes.shipping_paise` for the delivery PIN.
- It becomes **free** when the group subtotal reaches the free-delivery threshold, chosen in this order:
  1. the **PIN's** `pincodes.free_delivery_min_paise` (Admin → Settings → Service area);
  2. the **shop's** override (`shops.free_delivery_min_paise`, migration 0051, Admin → Partners → Shops → Profile);
  3. the city setting `checkout.free_delivery_min_paise` (city value, else global; none = never free).
- NULL means "no override, look further"; **0 means always free** at that level. Integer paise, ₹0–₹1,00,000
  (CHECK). Tests: `packages/db/test/pincodes.test.ts` "free delivery per PIN" (0 = free, threshold, NULL falls back).
- The first value set wins, even when a shop's value is higher than the city's (it is not the lower of the two).
  Shared rule `@mechdost/shared/free-delivery` (`freeDeliveryMinPaise`, `groupShippingPaise`; Zod-free). More tests:
  shared `free-delivery.test.ts`; db `checkout.test.ts` "free delivery per group" (shop over city, 0 = always free,
  PIN 0 beats a shop threshold, PIN null falls back to the shop).
- An inactive PIN (spec 15 "PIN codes") is not serviceable: the quote refuses it with `PINCODE_NOT_SERVICEABLE`.

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

## Quantity where the product is (2026-11-14, user)

User: "after we click add to cart we should be able to add the quantity in there itself too just like swiggy or amazon". Once a product is in the cart, its "Add to cart" button (product cards, product page, comparison) becomes a stepper: − / "{n} in cart" / +. − at one shows a bin and removes the product, and "Add to cart" comes back; + stops at the 99-per-product limit; the header cart count follows every press; the change is announced to screen readers. Same cart store as the cart page (`setQuantity`, `removeFromCart`), so both always agree. Analytics: `add_to_cart` (qty 1 per +), `remove_from_cart`, `click` id `cart_qty_decrease`. Component `apps/web/src/components/catalogue/add-to-cart-button.tsx`; test `e2e/cart-stepper.spec.ts`. **Geometry (bug 2026-11-14: hovering + hid the count):** the stepper is exactly as tall as "Add to cart" (its outline is an overlay, not a border around the buttons); − and + are 44 px targets whose hover surface is an inset face; the count takes the space between them and clips; the words "{n} in cart" show from a 12rem stepper, the number alone below. Test `e2e/cart-stepper-geometry.spec.ts` (− / count / + never overlap at rest, hovering, focused, at 1 and at 99, card widths 360–1920 px, Hindi). **Focus and feedback (review 2026-11-14):** focus moves to "+" when "Add to cart" becomes the stepper and back to "Add to cart" when the bin removes the product; at 99 "+" stays focusable (`aria-disabled`) and says "Maximum 99 units per product."; every change is read out by one live region (`signal({ say })`, compare tray loader; "Removed from the cart" is `catalogue.cartRemoved`). A limit or refused save shows under the button on the product page and in the comparison table, and in the compare tray from product cards (`notify="tray"`), so a card's layout never changes. Styles are component classes in `globals.css` (`.cart-add`, `.cart-stepper`, `.cart-step`, `.cart-count`, `.cart-words`). Budget: `/shop` 179.5 KB gz of 180 — almost no headroom left on the shop list.

## Real API mode (2026-11-14, launch)

With `NEXT_PUBLIC_DATA_MODE=api` the cart and checkout use the API, not the browser demo:

- **Cart lines carry the SKU.** "Add to cart" stores it (`CartLine.sku`). Lines saved without one, from the demo, cannot be priced and are left out.
- **The cart page prices at the Raipur-centre PIN (492001).** It doesn't read the saved address, because that would pull the demo account store into `/cart`, which sits at 179.8 of its 180 KB JS budget. Checkout re-prices at the PIN the customer types.
- **Prices come from the API only.** `useCartPricing` (`apps/web/src/lib/use-cart-pricing.ts`) calls `POST /v1/checkout/quote` for the cart at the typed PIN. It re-quotes 250 ms after the cart or PIN changes and keeps the last good numbers on screen while it loads. Loading and error panels say so instead of showing ₹0.
- **Cash on delivery places the order on the API.** `POST /v1/orders` (`lib/orders-api.ts`) uses one idempotency key per attempt, so a retry never makes a second order. The key is renewed after a price or stock change.
  - API error codes become messages: sign in, verify email, price changed (re-quote), cart changed, COD not allowed, orders blocked. A PIN the API cannot serve shows on the PIN field.
  - On success: `purchase_submitted` with `demo: false`, the cart clears, and the customer goes to `/orders/{code}?new=1`.
- **Not in real mode:** coins (spec 20, later). Blocks are enforced by the API (`ORDERS_BLOCKED`), not the browser.
- **Response schemas:** `@mechdost/shared/checkout-api`.

Ruling (2026-11-14): the customer screens switch on `DATA_MODE` (prices and SKUs are catalogue data); the portals switch on `AUTH_MODE`. Launch flips both together. Mixed combinations are not supported.

## Built: saved addresses in the checkout (2026-11-15)

In real sign-in the address step offers "Use a saved address" (`components/account/saved-pickers.tsx`, lazy, `GET /v1/me/addresses`). The default address is picked once on load and fills name, phone, address and PIN (the PIN re-quotes the cart); "A different address" goes back to typing. An address whose PIN is not serviceable shows "We don't deliver here yet." The order body is unchanged (`address` is still sent in full and snapshotted on the order); the picker only fills the form. Not done: "save this address for next time" at checkout.

## Built: coupons (2026-11-15, design `docs/superpowers/specs/2026-11-15-catalogue-storefront-next-tier-design.md` item 2; migration `0064_coupons`)

Only admin creates and configures coupons (permission `coupons:write`, spec 08). Types **percent** (1–90, optional cap in paise), **flat** (paise) and **free delivery**; minimum order; start and end (typed in IST, stored UTC); total and per-customer limits; first order only (implies one use per customer, CHECK); city (null = every city, needs an all-cities grant); name and conditions text in English and Hindi. Each coupon has a **funder**: `mechdost` or `shop` (+ the shop; free delivery cannot be shop-funded, CHECK).

**Order of discounts (fixed):** price → ONE coupon → MechDost Coins on what is left → COD cap on what the customer pays → COD fee only for cash on delivery. The pure maths is `packages/shared/src/coupon.ts` (no Zod; property-tested): percent rounds down then caps; flat never exceeds the eligible products; free delivery takes each group's delivery charge and nothing off products; **a shop-funded coupon looks only at its own shop's lines and the minimum order is measured on those lines**.

**Allocation rule:** the discount is spread over the eligible product lines in proportion to line totals by the largest-remainder method (floor shares, then one paise at a time to the biggest fractional remainder, ties to the earlier line). Line shares add up to the discount exactly and never exceed a line. They are stored in `order_items.line_discount_paise`; per sub-order in `orders.coupon_discount_paise` (+ `coupon_funder`); on the group `order_groups.coupon_code`, `coupon_discount_paise`, `coupon_snapshot` (rules as at placement + allocation per sub-order and SKU). CHECKs: `discount_paise = coupon_discount_paise + coin_discount_paise` on group and sub-order, `line_discount <= unit x qty`. GST stays on the gross line (same as coins): see Q114.

**Server path:** `POST /v1/checkout/coupon` (signed in, verified, 30/hour per user and 60/hour per IP) checks a code on the cart and answers the coupon's conditions, the saving and the new totals, or one reason code (`not_found`, `paused`, `not_started`, `expired`, `exhausted`, `user_limit`, `min_order`, `wrong_city`, `first_order_only`, `not_for_cart`, `shop_terms_pending`, `quote_order`). Nothing is counted. `POST /v1/orders` takes `couponCode`; `expectedTotalPaise` already has the coupon and then the coins taken off; the coupon is checked again on the re-priced cart inside the placing transaction (refusal: 422 `COUPON_INVALID`, `details.reason`; a wrong total: 409 `PRICE_CHANGED`). The request hash includes the code (upper-cased), so a retry with the same key is the same order and counts one use. Not allowed on bulk quote orders (422, reason `quote_order`; spec 19).

**Counting:** `redeemCoupon` runs after the coins and before any stock: a conditional UPDATE on `coupons.used_count` (live window and limit in the WHERE) and a conditional upsert on `coupon_user_usage` (never above the per-customer limit, repeated by a trigger). A parallel checkout that took the last use makes the other roll back whole. **Release:** when every sub-order of the group is cancelled or rejected (`transitionOrder`, group row locked first) the use goes back (total and per customer, once, `coupon_redemptions.released_at`). A partly cancelled order, a partial refund and a delivered order keep the use.

**Payouts:** a MechDost-funded discount is made good to the delivering shop on delivery (`shop_payout_entries.kind = coupon_discount`, once per order); a shop-funded discount is not (its payout is the lower amount). If the order is routed to a different shop than the funder, MechDost makes the delivering shop whole (the funder never pays for another shop's goods).

**Customer UI:** the checkout field (`components/commerce/checkout-coupon.tsx`) is lazy, real data mode only: "Have a coupon code?" opens a field; "Check code" shows the card with the conditions (what it gives, cap, minimum, end date, first order only, who funds it) and the saving **before** "Use this offer"; applied state with Remove; the total summary shows the coupon line before the coins line. Codes are never listed publicly (guessing is rate limited). Events: client `apply_coupon` (result, reason code, funder; the typed code is never recorded), server `coupon_redeemed`, `coupon_released`. Locale: namespace `coupons` (en + hi).

## "Add before checkout" (2026-11-15)

Under the cart: up to four suggestions from spec 11 (server rendered, lean cards, real data mode). The browser mirrors the slugs of the cart into the cookie `mechdost-cart-slugs` (slugs only) so the server can ask for them until the server cart exists.

## Built: server cart and merge at sign-in (2026-11-15, design item 3; migration `0067_photos_cart_wishlist`)

- **Tables:** `carts` (one **active** cart per customer: partial unique index `WHERE status = 'active'`) and `cart_items` (pack = variant id, quantity 1 to 99 by CHECK, each pack once). A line is a SKU and a quantity **only**: no price is stored, accepted or returned; prices, delivery, GST and stock come from the checkout quote (`quoteInternal`) when the cart is priced, so a client cannot name a price (the body is strict: a price field is a 400).
- **Superseded by "Several devices" below (same day):** the whole-cart `PUT /v1/me/cart` and the whole-cart push were removed because a stale copy could wipe another device's lines. What stays: tables, SKU-and-quantity-only, merge, limits.
- **API (real sign-in only):** `GET /v1/me/cart` (lines whose pack is no longer sold are deleted and reported once as `not_for_sale`), `PUT /v1/me/cart` (the cart is exactly these lines; up to 20), `POST /v1/me/cart/merge` (guest cart into the saved one). **Merge is idempotent: the larger quantity wins, never the sum**, so a retry or a second tab changes nothing; unknown SKUs (`unknown_sku`), unsellable packs (`not_for_sale`) and lines beyond 20 (`too_many_lines`) are dropped and listed in `dropped`. Writes lock the customer's user row, so two devices queue instead of racing past the limit. Limits: 240 replaces and 20 merges an hour per customer. The customer is the session; no id is in any URL.
- **Browser:** the browser cart stays the working copy (header, cards and cart page read it with no wait). `lib/cart-sync.ts` (loaded by dynamic import only when someone is signed in, real mode only): at sign-in or sign-up the guest cart is merged and the answer replaces the browser cart; on the first visit of a page load the server cart wins when it has lines (else the browser cart is sent up); every later change is sent after an 800 ms pause as "the cart is exactly these lines". Every later send waits for the merge. Failures are silent: the browser cart keeps working and the next change tries again. Two devices editing at once: **last change wins** (ruling 2026-11-15). The demo build is untouched.
- **Audit and events:** merge writes `audit_log` (`cart.merge`) and `cart_merged`; replace writes `cart_replaced` only (ruling: auditing every cart edit would be noise; the event store is the trail). Counts only, never prices.
- Not built: a server-priced cart view, abandoned-cart reminders, closing the cart when an order is placed (the `closed` status exists; checkout still clears the browser cart and the next sync empties the server cart).
- Tests: `packages/db/test/cart-wishlist.test.ts`, `apps/api/test/storefront.test.ts` (strict bodies, limits, idempotent merge, privacy, rate limit), `apps/web/test/storefront-next-tier.test.ts` (lazy-import guards, no price in the sync code).

**Shared devices (security review 2026-11-15, two MEDIUM findings fixed):** the browser cart remembers which account it was adopted for (`mechdost-cart-owner`); a cart adopted for another account is dropped, never merged or sent (only a genuine guest cart, or your own, merges). Sign-out (`lib/auth/sign-out.ts`, real mode) clears the browser cart and calls `resetCartSync` (owner, `started`, `known`, the push timer, the pending merge, and a generation counter that makes in-flight answers stale) and `resetWishlist`. The wishlist cache is tied to the account's uid: a different uid resets it, and answers that arrive after sign-out or for another account are discarded (also a failed change's "put it back"). Tests: `apps/web/test/storefront-session.test.ts` (11).

## Several devices at once (2026-11-15, user: "phone and laptop at the same time, nothing may be lost")

- **Ruling: per-line operations, not a versioned whole-cart PUT.** The server cart is the source of truth; the browser copy is a cache. API (real sign-in): `POST /v1/me/cart/lines/{sku}/add {qty}` (increment: adds from two devices **sum**, the line stops at 99), `PUT /v1/me/cart/lines/{sku} {qty}` (that line's quantity, last write wins **for that line only**), `DELETE /v1/me/cart/lines/{sku}` (idempotent; never creates a cart); each answers the whole cart with its `version`. Each is one conditional statement under the customer's user-row lock (`INSERT … WHERE cart has room OR line exists ON CONFLICT DO UPDATE …`), so 20 lines and 99 each hold under parallel requests (422 `CART_MAX_LINES` / `CART_LINE_UNAVAILABLE`). `PUT /v1/me/cart` no longer exists. Cost if wrong: two devices setting the same line in the same second keep the later value (a per-line version would change that).
- **Version and the cheap refresh.** Every effective change touches the cart row (a trigger moves `carts.version`; a no-op, a repeat add at 99, a remove of a missing line touch nothing). `GET /v1/me/cart?since=<version>` answers `{ unchanged: true, version }` (one indexed read) or the cart. The wishlist has the same `?since=` with a content fingerprint (sum of a hash of each product id), and add/remove stay idempotent.
- **Browser (`lib/cart-sync.ts`).** It remembers the last server snapshot it saw (`mechdost-cart-sync`: account, version, lines) and sends only the **difference between the cart now and that snapshot**, one line at a time (more of a pack = add of the difference, fewer = set, gone = remove), then adopts the whole cart each answer returns. Edits typed while a refresh runs are sent in the next round (bounded to 3). A page load or refresh with no local edits only reads the server cart and adopts it: a stale copy is never pushed. One function, `refreshCart(locale)` (calls queue), is what everything uses; `refreshStorefront` (cart + wishlist) is what the future live listener calls.
- **Freshness.** While a customer is signed in and the tab is visible: a check on mount and every **60 s**; hidden tabs do not poll; becoming visible or the window gaining focus checks at once (never twice within 5 s); opening the cart or checkout checks; a failure backs off (60 s, 2, 4, at most 5 minutes) and a success returns to 60 s (`lib/storefront-poll.ts`, the bell's pattern). Signed-out shoppers never poll. A poll never overwrites a pending local edit (edits are sent on top of the fresh cart). The same poll re-reads the wishlist; the account list reloads when the shared version moves.
- **After an order.** Placing a cash-on-delivery order, or an online order being paid, removes the ordered packs from the saved cart in the same transaction (`removeOrderedCartLines`; one ping), so the other device shows it on its next refresh and a stale browser copy cannot offer them again. (Checkout still prices the lines the browser sends; the browser sends what its refreshed cache holds.)
- **Live pings (server side built, listener not).** Triggers on `carts` (insert/update) and `wishlist_items` (insert/delete) write one `live_outbox` row on the customer's own `user:<id>` topic: kinds `cart` and `wishlist`, events `cart.changed` / `wishlist.changed`, ids and a version only (no SKU, slug or quantity). The relay already resolves `user` topics from Postgres and publishes to the RTDB inbox. Nothing in the browser listens yet (JS budget: /shop and /cart sit at 179.6 of 180 KB; no Firebase database SDK in this task). **Next step:** one lazy-loaded shared RTDB listener for the bell, shop offers, cart and wishlist calling `refreshStorefront` (and the bell's refetch).
- Tests: `packages/db/test/cart-multidevice.test.ts` (stale-copy scenario, sums, remove vs stale edit, parallel adds at the limit and on one pack, versions, one ping per real change and none for a no-op, order removes lines, wishlist fingerprint), `apps/api/test/storefront.test.ts` (two sessions over HTTP, `since` answers, pings), `apps/web/test/storefront-multidevice.test.ts` (fake server where another device changes it between snapshots; poll stops when hidden and resumes, focus, back-off), `storefront-session.test.ts` (wishlist refresh).
- Not built: a visible "your cart changed on another device" notice (the cart simply updates; no separate state to audit), a per-line version.

## Service bill payments (2026-11-15, workshops tier 3)

`payments` now has `purpose` (`order` | `service_bill`), a nullable `group_id` and `bill_id` (CHECK exactly one target); `refunds` gets `bill_id` (CHECK exactly one of `group_id` / `bill_id`). Same table, same checkout callback, same webhook (`applyRazorpayPayment` dispatches on the stored row), same amount and currency asserts (also against the bill total), same monotonic `paymentMachine`, same event dedupe. One open Razorpay order and one captured payment per bill (partial unique indexes). Details and the double-settlement rule: spec 06 "Built: workshops tier 3".

## Built: coupon follow-ups (2026-11-16; migration `0073_coupon_offers_reports`, renumbered at merge)

Plan `docs/superpowers/plans/2026-11-16-coupon-followups.md`; rulings in `docs/decisions.md` 2026-11-16 "Coupon follow-ups". All four "Not built" items of the section above are now built.

- **Public offers list** (`/offers`, Server Component, `GET /v1/offers?city&locale`, anonymous, 120/min per IP, cached 60 s, tag `offers`): lists coupons the admin marked **public** (`coupons.is_public`, off by default) that are live now (active, started, not ended, uses left, the customer's city or every city, shop-funded only when accepted by an approved shop), newest first, at most 50, text in the page language, end time in IST (Hindi: "भारतीय समय"). No usage numbers; an **automatic** offer shows "applied automatically" and never its code. The only client code is the copy button and an `offers_viewed` ping (JS budget unchanged for home, shop and product). Empty state: "No offers right now" with one action (Shop products); failed load: its own state with "Try again". Footer link under Shop (real data mode only).
- **Automatic offers**: a coupon with `auto_apply` (MechDost-funded only, CHECK) is applied at checkout with no code. Its code is an internal name: typing it is "not valid". Conditions reuse the coupon rules: minimum order, first order only, window, limits, city and an optional **category** (`category_id`, by slug in the form; the minimum, the percent and the per-line shares count only that category's lines and sub-categories; not for free delivery). **Stacking ruling: never.** A typed code and the best automatic offer compete, the larger discount wins, a tie goes to the typed code; a typed code that is invalid is refused even if an automatic offer exists. The preview (`POST /v1/checkout/coupon`, `code` now optional) answers `source: code|automatic` and `beaten` (what the loser would have given) and the screen says so. Re-priced only on the server (`chooseOffer`, shared by preview and placing); the client never sends an automatic offer, a stale total is 409 `PRICE_CHANGED` (also when an automatic offer ran out during payment). Snapshot on the group: `coupon_snapshot.automatic`, `.beaten`, `.categoryId`. Bulk quote orders never get an automatic offer.
- **Release after a whole-order refund**: when every sub-order of the group that was not cancelled or rejected has processed refunds of at least its total, the use goes back (total and per customer) once (`released_at`, the same function as cancellation; event `coupon_released` with `reason: order_refunded`). A partial refund keeps the use. The MechDost-funded payout owed to the shop is not reversed by this (out of scope).
- **Usage reports** (admin, `GET /v1/admin/coupons/{id}/usage`, `coupons:write`, city scope, 404 outside it): orders, released, uses kept (equals `used_count`), discount given (kept uses only, integer paise), unique customers, and IST days newest first with a day cursor. Index `coupon_redemptions_coupon_created_idx`. CSV: export dataset `coupon_usage` (one row per use, short hashed customer reference, no personal data).
- Not built: shop-funded automatic offers (a shop would have to accept terms), reversing the shop payout entry after a refund, scheduled campaigns beyond the offer window, a home or shop teaser of the offers (kept off the first-load budget on purpose).
