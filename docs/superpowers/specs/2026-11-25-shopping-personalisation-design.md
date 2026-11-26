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
- **2026-11-26 (founder: "yes we can replace the old vehicle type drop down"):** the shop's 2W/3W/4W "Vehicle type"
  select is removed; the chips are the only vehicle filter. Old `/shop?vehicle=2W|3W|4W` links redirect (meta refresh + client replace; not an HTTP 308) to the
  matching segment (2W → two_wheeler, 3W → three_wheeler, 4W → car_suv) keeping the other filters. "Fits your
  vehicle" on multi-size products never used the select (it matches the saved vehicle's type, make and model against
  the size's fitment) and is unchanged. Spec 02 "Vehicle type select retired".

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

## As built: phases 2 and 3 (2026-11-26, branch of the personalisation agent; migrations 0102 + 0103, not applied)

Phase 2 — Recently viewed + Back keeps your place

- **Browser copy (everyone):** `localStorage` key `mechdost-recent` (slugs + UTC ms, newest first, one per product, at
  most `RECENT_MAX` = 10; `packages/shared/src/recently-viewed.ts`, Zod-free). Every read/write wrapped
  (`apps/web/src/lib/recently-viewed-store.ts`): blocked storage gives an empty list, never an error.
- **Account copy (signed in + consent):** new consent purpose `personalisation` (Account → Privacy row "Remember what I
  view on all my devices"; opt-in, never asked = off; notice `2026-11-26`). Table `recently_viewed` (user, product,
  `city_code`, `viewed_at` UTC, version; PK user+product, index user+viewed_at desc; RLS on, read-own mirror policy).
  Repo `repo/recently-viewed.ts`: consent checked on every call, writes under the user-row lock, one upsert per view
  that only moves `viewed_at` forward when the stored view is a minute older (idempotent per product per minute), future
  times clamped to now, cut to 10 in the same transaction. Withdrawing the consent deletes the rows in the same
  transaction (`recently_viewed_deleted { reason: 'consent_withdrawn' }`); the data export lists them.
- **API:** `GET / POST / DELETE /v1/me/recently-viewed` (signed in, `private, no-store`, per-user API limit plus
  `recent_write` 600/h on POST, strict body: ≤ 10 views + city). Without the consent: `{ stored: false, items: [] }`.
- **Merge at sign-in:** the lazy list sends the device's whole list once per browser session (so right after sign-in),
  then only the viewed product, and merges the answer (latest view per product) back into the device copy.
- **Where:** product page (records the view, lists the others), cart, empty search results (inside the "nothing found"
  card), account overview (with the "Remember products I view on this device" switch), home as a new admin-orderable
  section `recent` shown only with 2+ products. All through `RecentlyViewedLazy` (React.lazy): no page's first load
  carries the list, the store, the sync or the tracker. Cards are rendered on the server by the `recentCards` server
  action (compact row card, no client code).
- **Clear:** on every surface (focus moves to the heading, a polite status says it was cleared; the account copy is
  cleared too). **Off switch:** account overview (device), Privacy (account consent).
- **Back keeps your place:** the "Show more" pages were already in the address (`?pages=N`, server-rendered). New:
  `lib/list-place-runtime.ts` (loaded with `import()` after the shop list mounts) saves the scroll position per list
  address when a product is opened or the page is left, and gives it back once on Back/Forward
  (`list_position_restored { pages }`). Shop, category and search all use the same list.

Phase 3 — Suggestions on the product page

- **Similar options** (`slot=similar` of `GET /v1/recommendations`, repo `similarFor`): same category, a shared size
  (a variant's `size_compact`, or the tyre size in the specs) and, when the product has them, the same `saeGrade` and
  `capacityAh`; a vehicle segment in common when the product has segments; another brand; visible; a buyable offer in
  the city; up to 8; the reason carries the shared size ("Same size: 900 ml"). Nothing without a size or key spec (no
  guess). New index `product_variants_size_compact_eq_idx`. It replaces "More in <category>" when it finds anything.
  Demo store: the same rule from the spec text (`lib/catalogue/demo-similar.ts`). The page says "check the fit for your
  vehicle" (never "recommended for you").
- **Goes well with:** the existing admin rules (spec 11) now take a product as trigger and a product or the **workshop
  fitting link** as suggestion (`suggest_kind`), with CHECKs for one trigger and the suggestion shape and one unique
  index per trigger + kind + suggestion. The fitting link rides on the product slot as `fitting { label }` and shows
  as one quiet row linking to `/workshops`. Admin → Catalogue → "Goes well with" has the kind choices and a product
  picker (`GET /v1/admin/recommendation-products?q=`, catalogue staff only). Default pairs seeded by migration 0103
  (tyres → tubes & flaps, batteries → battery accessories, engine oils → oil filters, tyres/batteries → fitting).
- **Measured:** client events `reco_impression { surface, algo, count }` and `reco_click { surface, algo, slug, position }`
  for every surface (product, cart, search_empty, account, home) and algorithm (similar, rule, copurchase, fitting,
  recent), from a tracker in the lazy chunk reading `data-reco-*` attributes on the server-rendered sections. Add to
  cart and orders are joined to the click by session and slug (`recoFunnel`, `GET /v1/admin/analytics/reco-funnel`,
  all-city staff only after the security review). No order or cart table changes (phase 4 owns those screens).
