# Shopping personalisation: vehicle segments, recently viewed, suggestions, savings (design, 2026-11-25)

Founder requests (2026-11-25): "in the product list we need like a last viewed products and suggestions based on that basically
just like other ecommerce websites work", "we have products for trucks and tractors etc as well right? if yes then add
filters and tags for those too", "study it and research it much more properly", "to our customers we can show like total
savings this month or this year from our websites etc like promote the things like that".

Research: `scratchpad/research-ecommerce-2026-11-25.md` (summarised below; Baymard, NN/g, Amazon/eBay/Apollo/JK Tyre
references; Flipkart/boodmo/maker stores could not be verified). Live data (2026-11-25): 1,237 live products; vehicle types
today only 2W/3W/4W and 650 products have none; truck-bus-tyres 97, cv-batteries 55, farm-tyres 28, heavy-duty-oils 27,
light-commercial-tyres 26, tractor-batteries 24, tractor-agri-oils 19, industrial/OTR tyres 32, earth-moving-batteries 5.

## Goals and non-goals

- Goals: shoppers of trucks, tractors and construction machines find their parts; returning shoppers see what they looked
  at and honest, relevant alternatives and add-ons; customers see real money saved.
- Non-goals: "Recommended for you" claims without guaranteed fit; inflated reference prices; fake urgency or scarcity;
  personal data used for suggestions without consent (DPDP).

## Phase 1 — Vehicle segments (approved 2026-11-25: "yeah the segments are fine go ahead")

- Segments (admin-editable, en + hi): Two-wheeler, Three-wheeler, Car/SUV, Light commercial, Truck & bus, Tractor & farm,
  Construction/OTR, Not a vehicle (inverter, home power, genset, workshop tools).
- A product has one or more segments. Back-filled from category (e.g. truck-bus-tyres → Truck & bus, tractor-batteries →
  Tractor & farm, home-power → Not a vehicle) and from the existing 2W/3W/4W vehicle types; admin can change any.
- Shop: segment chips with counts (multi-select) above the results, in the URL; card tag with the segment name; home
  "Shop by vehicle" tiles for Truck & bus, Tractor & farm, Construction/OTR. Search understands segment words (truck,
  tractor, JCB, bus, tempo; Hindi too) through the existing admin-editable vocabulary.
- Existing `VEHICLE_TYPES` (2W/3W/4W) keep working for vehicles in "My Vehicles", roadside and service requests.

## Phase 2 — Recently viewed + Back keeps your place

- Last 8–10 products; guests in browser storage only; signed-in customers on the server only with the personalisation
  consent; merge at sign-in; visible Clear and an off switch. Shown on product page, cart, empty search, account, and home
  once 2+ items exist. Back to a list restores scroll position.

## Phase 3 — Suggestions

- Product page: "Similar options" (same size/spec and segment, other brands) and "Goes well with" (admin-editable pairs:
  tyre → tube/flap, battery → terminal grease, oil → filter, plus workshop fitting). Co-view / co-purchase later, above a
  minimum-support floor. Impressions, clicks, add-to-cart and orders measured per surface and algorithm.

## Phase 4 — Your savings

- Basis: delivered orders only; printed-MRP snapshot minus price paid, coupons, redeemed Coins, waived delivery fee; stored
  per component, reversed on refund; price-on-request lines without an MRP are not counted (and the count is shown).
  Wording "vs the maker's printed MRP", never "sale price".
- Placement: cart and order confirmation first, then an account "Your savings" card (this month / this year); a monthly
  WhatsApp/email recap only with consent.
- From 1 Jan 2027 (Consumer Protection E-Commerce amendment, Rule 4(13) per secondary sources; counsel to confirm): start
  recording daily price history now; avoid "was ₹X" strike-throughs on promotions.

### Phase 4 as built (2026-11-26, migration 0101_shopping_savings)

- **Snapshots:** checkout now writes `order_items.mrp_paise` (printed MRP per unit) and
  `orders.delivery_waived_paise` (the charge the free-delivery threshold waived). Orders placed before 0101 have no
  MRP snapshot: their lines are excluded and counted, never filled from today's MRP. Coupon and Coins come from the
  existing `coupon_discount_paise` / `coin_discount_paise`. Price-on-request packs cannot be checked out, so in
  practice "excluded" means pre-0101 lines.
- **Ledger:** append-only `customer_savings_entries` (+ `customer_savings_lines` per line) written by one idempotent
  `syncOrderSavings` on delivery and on each processed refund (proportional, telescoping reversal); periods count by
  the delivery time (IST), so a refund never makes a month negative. Details: spec 14 "Savings ledger".
- **One breakdown for every surface:** `@mechdost/shared/savings` (`savingsBreakdown`, `savingsReversal`,
  `savingsPeriodBounds`); the cart estimate, the order-page estimate, the ledger and the demo use it.
- **API:** `GET /v1/me/savings?period=month|year` (totals per component, delivered orders, excluded lines) and
  `GET /v1/me/orders/{code}/savings` (final / estimate / none; another customer's code is 404); the checkout quote
  carries `savingsEstimate` (MRP saving + waived delivery; coupon and Coins are chosen later).
- **UI:** order page (estimate while on its way, "You saved ₹X vs the maker's printed MRP on this order" after
  delivery, breakdown, refund and excluded notes), cart summary row "Estimated saving vs the maker's printed MRP" +
  "Estimate, final after delivery.", account overview card (this month / this year, breakdown in a disclosure,
  empty state with "Shop parts"). Demo store: same maths on the browser's orders with the demo catalogue's MRP.
- **Admin:** Settings → Store "Show “Your savings” to customers" (`customers.savings_enabled`, default on; off hides
  every surface, the ledger keeps being written); Content → "Savings wording" (`savings.order`, `savings.account`
  keep `{amount}`, `savings.cart`), en + hi. The "on its way" estimate line is not admin-editable yet.
- **Price history:** `variant_price_daily` written by the worker once per IST day.
- **Recap:** the monthly WhatsApp/email recap is designed only (QSV1 in `docs/questions-for-user.md`); nothing is
  sent.
- **Not done:** a back-fill of pre-0101 delivered orders (coupon/Coins/delivery parts only; QSV2), a per-customer
  monthly rollup table (the indexed query is enough at this scale), the recap itself.

## Approaches considered

- Segments as a new enum on products vs tags: chosen a many-to-many admin-editable segment table (bilingual, counts,
  extensible) over widening `VEHICLE_TYPES`, which is also used by vehicles/roadside/services.
- Suggestions: rule-based first (works with ~1,200 products and low traffic) vs collaborative filtering (needs data);
  rules now, co-view later.

## Process

Each phase: mechdost-advisor brief, TDD, Hindi, analytics events, admin control, screenshots to the founder before
shipping, full gates and e2e, migrations first.
