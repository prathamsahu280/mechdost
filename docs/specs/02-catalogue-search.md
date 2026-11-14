# 02 · Catalogue, fitment & search

Status: decided (vehicle master source pending) · Phase 1 · Decisions: Catalogue section, Search

## Goal

A fast, calm catalogue (concept "Explore products. Across India." layout) where every product shows fitment for the customer's vehicle, prices and delivery by pincode, and search that tolerates typos and Hinglish.

## Roles

customer (browse), seller (list products / offers), catalogue_manager (master data, approvals), admin.

## User stories

- Browse by category tiles, filter by brand/price/fitment/availability/seller/attributes, sort, paginate ("load more" on mobile).
- See a vehicle-type chip ("For two-wheelers / three-wheelers / cars"); filter the whole catalogue by my primary vehicle's **type**. "Fits your {vehicle}" is shown only for exact make/model/year fitment rows (decision 2026-11-12, Q76).
- Search by name, brand, part number (OE/cross-reference), with suggestions and zero-result fallback ("Request a product" sourcing form from the concept).
- Open a product page with gallery, spec table, fitment list, price by pincode, reviews, recommendations, "Add to cart" / "Buy with installation" / "Ask about this product".
- Get notified when an out-of-stock item is back (P1).

## Data

`categories` (tree, slug, icon, description from concept tiles, sort, hidden), `brands` (origin oem|oes|aftermarket), `attribute_sets` + `attributes` (typed), `products` (master: slug, name, brand, category, attribute_set, spec jsonb, description, hsn, gst_rate_bp, mrp_paise, country_of_origin, warranty, status draft|submitted|live|rejected|archived, created_by seller/catalogue), `product_variants` (sku, options jsonb, barcode, weight_g, dims), `product_photos` (order, alt, variants thumb/card/zoom, blurhash), `part_numbers` (variant_id, kind oe|mfr|xref, value, normalised), `vehicle_makes/models/variants` (vehicle master, type, years, fuel), `fitments` (variant_id × vehicle_variant_id, year_from, year_to, notes), `shop_inventory` (shop × variant: selling_paise, mrp override, on_hand, reserved, active, lead_days), `shop_pincodes` (coverage, shipping_paise, lead_days), `reviews` (status pending|approved|hidden), `search_synonyms`, `stock_alerts` (P1).

**Localised fields (hard rule 10, decision 2026-11-02 "Localised content columns").** Every customer-visible descriptive text has an English and a Hindi column side by side: `categories.name/name_hi`, `description/description_hi`; `products.name_hi` (generic words only — brand and model stay Latin, e.g. "फ़ुली सिंथेटिक इंजन ऑयल 5W-30 3.5 L"), `spec_summary/spec_summary_hi`, `compatibility/compatibility_hi`, `highlights/highlights_hi` (text[]), `description/description_hi`; `brands.name` is never translated; `attributes.label/label_hi` (values that are units or codes stay as entered). Columns exist since migration 0017 (`spec_summary`, `compatibility`, `highlights` + their `_hi`; `shops.name_hi`, `address_line_hi`); `missingHindi()` (packages/db) feeds the flags. A missing `_hi` value falls back to English and is flagged in the admin catalogue editor (en and hi edited side by side); a product cannot go `live` with a flagged Hindi field once launch-blocking checks are on. Reviews are user content and are not translated. Demo mirror: `apps/web/src/demo/i18n/hi.ts` (`PRODUCT_HI`) + `localize.ts`.

## Search

Launch: Postgres `tsvector` (name, brand, sku, part numbers, spec — **English and Hindi columns both**, so "बैटरी" and "battery" match on either locale; `simple` config for the Hindi part) + `pg_trgm` similarity + synonyms table; Redis cache 60 s per (city, query, filters). **Built (migration 0026):** generated column `products.search_vector` (name A, spec summary + compatibility B, description C; English text with the `english` config, Hindi with `simple`) + GIN index; brand and product names by trigram word similarity (`q <% name`, existing GIN trigram indexes); part numbers and SKUs exact after normalising (upper-case alphanumerics, ≥ 4 characters). Relevance = `ts_rank` + best word similarity + 1 for a part-number hit. Verified on the dev database (indexes used). **Planned upgrade: Meilisearch** behind the same `/search` API (index sync job, typo tolerance, facets, Hinglish synonyms, geo for workshops).

## API

`GET /catalogue/categories`, `GET /catalogue/products?city&pincode&category&brand&q&vehicle&sort&cursor`, `GET /catalogue/products/:slug?pincode`, `GET /catalogue/suggest?q`, `GET /vehicles/master?make&model`, `POST /stock-alerts` (P1).

**Price for a PIN (decision 2026-11-01 "Pincode-wise prices", Q26 default; corrected here 2026-11-03, this spec said "lowest").** The customer sees one price: the offer of the **nearest shop that covers the PIN and has free stock** (distance from the shop's location to the PIN centroid; ties → lowest price → shop id, so the answer is stable). Without a PIN: "From ₹" = the lowest buyable offer in the city. A buyable offer = live product, active variant, active inventory with `on_hand − reserved > 0`, shop `approved` and not busy (paused/suspended shops are never `approved`), and for a PIN an active `shop_pincodes` row (its `shipping_paise` and lead days are shown). Unknown PIN → `pincodeKnown: false`, no prices.

**Built 2026-11-03 (API, `apps/api/src/routes/catalogue.ts`, repo `packages/db/src/repo/catalogue.ts`):**

- `GET /v1/catalogue/categories?locale`: visible categories in admin order with live product counts.
- `GET /v1/catalogue/products?city&pincode&category&brand&q&sort&available&cursor&limit&locale`: sorts `relevance` (default with `q`) · `newest` (default) · `price_asc` · `price_desc` (unpriced last). A category includes its child categories. `available=true` keeps buyable products only. Keyset cursor on (sort key, id), opaque base64url, validated (tampered → 422 `INVALID_CURSOR`); page size ≤ 48.
- `GET /v1/catalogue/products/{slug}?city&pincode&locale`: each active variant's best offer with the **seller name** (E-Commerce Rules), photos, OE/manufacturer part numbers, spec, country of origin, GST rate; drafts/unknown → 404.
- Public, no sign-in; per-IP limits (global 600/min + `catalogue_ip` 240/min on listings); `Cache-Control: public, max-age=30, stale-while-revalidate=120` (categories 300 s). Responses carry no internal ids. City defaults to `DEFAULT_CITY_CODE` (RPR). Hindi fields with the English fallback per `locale`.
- Demo data: `pnpm db:seed:demo` loads the web demo catalogue (Hindi included) for the API; removed before launch with `--remove` (Q21, `docs/runbooks/demo.md`).
- **Vehicle types (2026-11-12, Q76 default):** `products.vehicle_types` (2W/3W/4W, empty = fitment not listed; migration 0037, CHECK + GIN index). `GET /v1/catalogue/products?vehicle=3W` keeps only tagged products; cards and product pages return `vehicleTypes`; staff set them with `PUT /v1/admin/catalogue/products/{slug}/vehicle-types` (`products:write`, version, audited `product.vehicle_types_updated`). Web: the card chip shows the codes ("2W · 3W", screen readers hear "Vehicle type:"), untagged shows "Fitment not listed"; the shop has a "Vehicle type" select kept in the URL (`?vehicle=`), demo and API mode, event `shop_vehicle_<type>`. Demo/seed tags come only from the demo `fits` values (EV is a fuel: no type).
- Not yet: exact make/model/year fitment and "Fits your {vehicle}" (Q76/Q10), `suggest`, synonyms table, Redis cache, Meilisearch; web pages still read the demo catalogue until Phase 1 wiring.

## Web on the API (built 2026-11-10, behind `NEXT_PUBLIC_DATA_MODE`, Q70)

Plan `docs/superpowers/plans/2026-11-10-catalogue-on-api.md`. Off (`demo`) on every deploy until cart + checkout use the API too: the demo cart's prices are not the API's nearest-shop offers.

- **One view model** (`apps/web/src/lib/catalogue/view.ts`: `CardView`, `ProductView`), two sources: `demo-source.ts` (demo data) and `api-source.ts` (server-only). DTOs come from `@mechdost/shared/catalogue` (moved out of the API route, one definition).
- **API source:** every response parsed; `fetch` with `revalidate` 30 s (listing) / 60 s (product) and tags `catalogue`, `product:<slug>`; 3 s timeout; failures throw (Next keeps the last good page; first visits show the shop's retry message, `app/[locale]/shop/error.tsx`); 404 → product 404; a tampered cursor restarts at page 1. Always `city=RPR` (until the city selector) and the page locale.
- **Product pages:** no build-time API calls (`generateStaticParams` returns nothing in api mode); rendered on first visit, then cached. Shows the seller and the country of origin (in Hindi on `/hi`, from the browser's country names; the column is English text today — an ISO code would be cleaner, rule 16). No reviews section or star row until the reviews API.
- **Listing:** the server filters, searches and pages (24 per page); changing a filter navigates (`scroll: false`); "Load more" is a server function returning server-rendered cards (no catalogue code in the browser), focus moves to the first new card and a polite status announces it. It continues exactly the list the server rendered (never the on-screen filters), then sets `?pages=N` (≤ 10) so the server renders all open pages and Back from a product returns to the whole list. Quick-details ids are `info-<list>-<slug>` (unique across "Load more" pages).
- **Facts the source does not know are left out** (a11y review 2026-11-10, `.a11y-history/2026-11-10-catalogue-view-model`): no price → no price block and no add to cart, the product page offers "Ask about this product" (WhatsApp); no rating → no star row; no fit data → "Fitment not listed"; empty highlights or specification rows → no heading or blank row.
- **Not yet:** category chips and URL categories from `GET /v1/catalogue/categories` (today the web's nine demo categories, whose slugs match the seed; an admin-made or child category would show all products — to fix with the switch milestone), API product photos (artwork stays the category icon), home "popular products" from the API, on-demand revalidation when the admin edits (tags are ready), PIN price check on the web.
- **Blocker before the switch goes on anywhere:** the web's server-side calls come from one IP, so the API's per-IP limits would throttle every shopper together (spec 16).

## UI

Product card actions and the compare control: spec 21 § "Redesign 2026-11-14" (an `@container` action row — "Add to cart" first, Compare beside it as an icon or a word, stacked on narrow cards; no message ever inside a card; the compare tray asks). Concept sections `#home-products`, `#catalogue`, `#find-parts`, product page (`05-page-product-*.png`); hero search; 6 category tiles with concept descriptions; "Check price & delivery for your area" panel; product card with `<details>` "Specification & fitment"; status lines copied from the concept; fitment badge green; "Request a product →" sourcing form (quick RFQ: brand, reference, photo optional → ticket kind Product sourcing).

## Rules

Only `live` products with an active, in-stock offer from an approved shop covering the pincode are purchasable; without pincode show "From ₹" of the lowest live offer in the selected city; country of origin and seller name displayed (E-Commerce Rules); MRP ≥ selling; GST-inclusive display; images AVIF/WebP, 3 variants, LQIP.

## Edge cases

No offers in pincode → "No eligible delivery offers for this PIN yet. Browse all products or request sourcing."; product without fitment data → neutral chip "Fitment not listed" (a11y review 2026-11-10: "Check fitment" read as a command on non-interactive text); search with zero results → suggestions + sourcing CTA; catalogue load failure → retry copy from concept.

## Analytics

`search` (term, results_count, vehicle_selected), `view_item_list`, `select_item`, `view_item`, `select_vehicle`, `notify_me_clicked`, `filter_applied`.

## Acceptance tests

Fitment badge correctness, pincode price resolution picks the **nearest covering** in-stock approved offer (not the cheapest; `packages/db/test/catalogue.test.ts`), unpublished/paused/busy offers never appear, search typo "castrl" finds Castrol (trigram), cursor pagination stable under inserts, SEO JSON-LD present with Offer.

## Open decisions

Vehicle master source (register #4).

## P1/P2

Back-in-stock/price-drop alerts, Q&A, photo reviews, badges, collections, B2B price lists, related/upsell rules (part of recommendations), 360° media (P2), Meilisearch switch.

## Home page sections (2026-11-02)

Hero, trust strip, category tiles, popular products, order-route band, workshop service steps, top-rated workshops, FAQ (+ FAQPage structured data), partner teaser — see decisions 2026-11-02. Popular products and top workshops come from the catalogue/workshop APIs (ranked per city) in Phase 1.

## Built: admin catalogue editor API (2026-11-03)

`packages/db/src/repo/catalogue-admin.ts`, `apps/api/src/routes/admin-catalogue.ts`; product states `productMachine` (`packages/shared/src/state`): draft → submitted (shop/admin) · draft/submitted → live (admin) · submitted → rejected (reason for the shop) · rejected → draft · live → archived · archived → draft.

- `GET /v1/admin/catalogue/products?status&missingHindi=true&after` (`products:write`, verified staff): slug order, keyset `after`; every product carries `missingHindi` (name, specSummary, compatibility, description, highlights: English present, Hindi empty). The filter runs in SQL, so pages are full.
- `GET/PATCH /v1/admin/catalogue/products/{slug}`: English and Hindi texts side by side; strict body (texts only — never price, HSN, GST or status); compare-and-set on `version` (`STALE_PRODUCT`); the English name is required; Hindi highlights empty or one per English highlight (`HIGHLIGHTS_HI_ALIGNED`, same as the DB CHECK); the audit row holds exactly the changed fields (before/after).
- `POST …/{slug}/status {to, version, rejectionReason?}` (`products:publish`): through the machine; going live needs an active variant (`NO_VARIANT`) and, when setting `catalogue.require_hindi_to_publish` is `true` (the launch-blocking check; off until the catalogue team is ready), complete Hindi (`HINDI_MISSING` with the fields).
- Not yet: the console screen (en/hi side by side, gap badges), category and brand editors, photos, variants and fitment editing, shop submissions.

## Built: adding products — form and CSV import (2026-11-14)

Plan `docs/superpowers/plans/2026-11-14-real-api-launch.md` (Stream B); runbook `docs/runbooks/catalogue-import.md` (columns, codes, sample file).

- `POST /v1/admin/catalogue/products` (`products:write`, verified staff): category slug, brand name (created if new), English name (+ Hindi), optional slug (default brand + name), texts en/hi, highlights, vehicle types, typed attributes (strict per category, parent category's list for sub-categories, spreadsheet text such as `"12"` or `yes` typed first), and the first pack: SKU (upper-cased, unique), MRP paise, net quantity; HSN and GST rate on the product. Starts as `draft`; `publish: true` needs `products:publish` and goes draft → live through `productMachine` (with the Hindi rule when that setting is on). 201 `{slug, sku, status, version}`; 409 `SKU_TAKEN` / `SLUG_TAKEN`.
- `POST /v1/admin/catalogue/import` (`products:import`): `{ csv, dryRun?, publish? }`, ≤ 500 rows. All rows checked first; any problem → 422 `IMPORT_ROWS_INVALID` with `{row, field, code}` per problem and nothing written; existing SKUs skipped and reported; the rest inserted in one transaction.
- Code: `packages/shared/src/catalogue-import.ts` (CSV reader, columns, codes), `packages/shared/src/admin-catalogue.ts` (`NewProductFields`, report schemas), `packages/db/src/repo/catalogue-create.ts`, `apps/api/src/routes/admin-catalogue.ts`. Tests: `packages/shared/test/catalogue-import.test.ts`, `packages/db/test/catalogue-create.test.ts`, `apps/api/test/admin-catalogue.test.ts`.

## Built: comparison, typed attributes and unit price (2026-11-13)

Spec 21 (`21-product-comparison.md`). Typed attributes per category in `products.spec` (definitions in `@mechdost/shared/product-attributes`), a net quantity per pack (`product_variants.net_qty` / `net_unit`, migration 0042), the catalogue offer's `netQuantity` (the pack it prices), and "₹ … per litre / kg / piece / metre" on cards and the product page. Admin endpoints: `PUT /v1/admin/catalogue/products/{slug}/attributes`, `PUT /v1/admin/catalogue/variants/{sku}/net-quantity`.

## Customer price: admin prices per city and PIN (built 2026-11-13/14, Q26)

Design `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md`; plan `docs/superpowers/plans/2026-11-13-admin-catalogue-pin-prices.md`.

- **What the customer pays** for a pack at a PIN: the admin's **PIN price**, else the admin's **city price**, else (interim, Q83) the chosen shop's approved price. Integer paise; resolved in the same SQL that picks the shop (`packages/db/src/repo/catalogue.ts`, `checkout.ts`), shared rule `resolveCustomerPrice` in `packages/shared/src/admin-prices.ts`.
- **Rules for an admin price** (`checkAdminPrice`, checked in the screen and again in the API): at most the MRP (`MRP_EXCEEDED`); at least the lowest approved price among shops that deliver there with stock (`BELOW_SHOP_PRICE`), so MechDost never sells below what a shop is paid; no such shop → refused (`NO_SHOP`).
- **Which shop**: among shops covering the PIN with stock **and** an approved price at or below the customer price, the nearest one (ties: price, then id). A shop that later raises its price above the customer price stops being chosen; with no shop left, the product shows "on request" at that PIN — never sold at a loss.
- Set from Admin → Catalogue → Prices (spec 08) or `PUT /v1/admin/prices/{sku}` (`prices:write`).

## Reviews (built 2026-11-14)

Decision 2026-10-31 (verified purchase only, staff approve before publish) built on the API; rulings in
`docs/decisions.md` "2026-11-14 — Customer reviews on the API". Workshop reviews follow the same rules (spec 06).

- **Data** (migration `0046_reviews`, table `reviews`): `user_id`, `city_id` (of the purchase, for city-scoped
  moderation), `order_id` (the delivered **sub-order**) or `service_request_id` (FK, paid/completed request),
  `target_type` product | workshop, `target_id`, `rating` 1–5, `body` (plain text ≤ 1000, null = stars only), `status`
  pending | approved | hidden (`reviewMachine`, `@mechdost/shared/reviews`), `hidden_reason` (code: spam, abusive,
  personal_data, off_topic, not_genuine, other; set exactly while hidden), `moderation_note` (staff-only ≤ 300),
  `moderated_by/at`, `version`, `created_at/updated_at`. Checks: product ⇒ order, workshop ⇒ service request; one row
  per customer, target and purchase (unique, nulls not distinct). RLS on, no direct client access. Indexes: public
  list `(target_type, target_id, status, created_at, id)`, queue `(status, created_at, id)`, daily limit
  `(user_id, created_at)`, every FK.
- **Who may review:** the customer of a **delivered** sub-order containing the product, or of a service request in
  `paid` / `completed` at that workshop. Anything else: foreign/unknown order or request → 404; not delivered/paid or
  not in that purchase → 422 `REVIEW_NOT_ELIGIBLE`; second review → 409 `REVIEW_EXISTS`; more than **5 in 24 h**
  (spec 13) → 422 `REVIEW_DAILY_LIMIT` (counted inside the transaction under a per-customer advisory lock).
- **Text:** plain text — control and invisible format characters removed (ZWJ/ZWNJ kept for Hindi), whitespace
  collapsed, ≤ 1000 characters (API refuses longer bodies with 400). Rendered as text by React (no HTML). User
  content: never translated (`data-user-content`), never logged, never in analytics props.
- **Moderation** (`reviews:moderate`: super admin, catalogue manager, marketing; verified staff; city-scoped like
  other admin queues, other cities' ids → 404): pending → approved | hidden, approved → hidden, hidden → approved;
  compare-and-set on `version` (409 `STALE_REVIEW`), illegal move 409 `ILLEGAL_TRANSITION`, hide without a reason
  code 422. Each change writes `audit_log` (`review.submitted`, `review.moderated` with the reason) and a server
  event (`review_submitted`, `admin_review_moderated`; ids and codes only).
- **Ratings:** only approved reviews count. Workshops: `rating_avg` / `rating_count` recomputed in the moderation
  transaction after locking the workshop row. Products: computed live from the approved rows (catalogue
  `cardExtras`; same numbers as the review section).
- **API:** `GET /v1/reviews/{product|workshop}/{slug}?cursor&limit≤20` (public; live product / published workshop,
  else 404; approved only, newest first, keyset cursor; summary avg (1 decimal) / count / distribution 5★…1★;
  reviewer shown as "First L."; `Cache-Control: public, max-age=60, stale-while-revalidate=300`; 120/min/IP) ·
  `GET /v1/my-reviews/eligible?order=MD-…|service=SR-…&locale` and `POST /v1/my-reviews` (strict body: exactly one
  of `orderCode` / `serviceCode`, `targetType`, `targetSlug`, `rating`, optional `body`; verified account; 20
  attempts/hour/user on top of 120/min) · `GET /v1/admin/reviews?status&cursor` (pending oldest first, others newest
  first) · `POST /v1/admin/reviews/{id}/moderate {to, reasonCode?, note?, version}`. Response schemas for the web:
  `@mechdost/shared/reviews-api`.
- **Web (real data mode):** product and workshop pages stream `ReviewsApiSection` (server component, no client JS,
  `<Suspense>` with a skeleton): summary card, distribution, newest 10 reviews with the verified badge; empty → "No
  reviews yet" with one next action (Your orders / Your services); failure → a short note (never the error
  boundary). The product page's star row shows in real mode too (catalogue rating = approved reviews). The order
  page (any delivered part) and the service page (`paid` / `completed`) lazy-load `WriteReviewApi`: what this
  purchase lets the customer review, one form open at a time, stars required, text optional with a counter, status
  of a sent review (waiting / published / not published), API codes → `reviews.api_err_*`. Admin → Reviews with real
  sign-in loads `admin-reviews-api.tsx` (tabs Waiting / Published / Hidden, approve, hide with a reason and a staff
  note, stale → reload with a message). Strings `reviews.api_*` (en + hi).
- **Tests:** `packages/shared/test/reviews.test.ts` (machine every pair, text cleaning, schemas),
  `packages/db/test/reviews.test.ts` (eligibility, not-a-buyer, duplicate, daily limit, pending not public,
  moderation CAS / illegal / other city, workshop aggregate, cursor, audit + events exactly once, DB checks),
  `apps/api/test/reviews.test.ts` (HTTP: 401/403/404/409/422/429, verification, strict bodies, cache header, shared
  schemas parse the answers), `apps/web/test/reviews-api.test.ts`; review routes added to the middleware-bypass
  suite. Playwright not run in this change (low-memory machine): run the order/service/admin flows at merge.
- **Not built yet:** staff edit of the text and delete (decision 2026-10-31 "edit, hide, remove": hide covers
  removal from public view), partner reply (`reply` column unused), photo reviews (P1), notifying the customer when
  a review is approved or hidden, "load more" on public pages (newest 10 only), on-demand revalidation of the
  product/workshop page when a review is approved (pages refresh within 60 s).

### Review findings (2026-11-14, before merge)

- **Fixed:** a product delivered in two parts of one order at different times could be reviewed twice. Test: "one review per product per purchase…".
- **Known, not fixed yet:**
  - Moderating a workshop review bumps `workshops.version`, so an admin profile form open at the same time gets a stale-version 409.
  - A workshop can be reviewed after `no_work_approved → completed`, with no paid bill. Spec 06 says "after the bill is paid"; to confirm.
  - Line breaks in review text are collapsed.
  - The 1000-character limit is checked before cleaning.
  - Public review fetches by the web server share its single IP's rate-limit bucket.
