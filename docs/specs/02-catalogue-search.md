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

**Smart search (design 2026-11-22 item 4, built on branch worktree-agent-a2da6d50c0ba40914, migration `0080_search_synonyms`, not applied).**

- **Query understanding** (`packages/shared/src/search`, pure, shared by the API and the demo; property-tested): viscosity grades in any spelling (`20w40`, `20 w 40`, `20W-40` → `20W-40`; only real grades, so "4w 20" stays text); pack sizes (`900ml`, `0.9 l`, `1 ltr`, `5 litre`, `500 gm`, `1 kg` → net quantity in ml or g); battery `35ah` and voltage `12v`; tyre sizes (`90/90-12`, `145/80 R12` → `145/80R12`, `2.75-17`); part numbers and models (letters and digits mixed, at least 4 once compacted); vehicle intent (bike, scooter, scooty, car, suv, e-rickshaw, auto, Hindi बाइक, स्कूटर, गाड़ी, कार → 2W/3W/4W, removed from the text; truck, bus, tractor are only a text hint); category intent (engine oil, mobil oil, gear oil, coolant, grease, brake fluid, battery, tyre, filter, polish, shampoo, spray …; read on the words **and their synonym expansions**, longest phrase first); Hinglish/Hindi synonyms (`tel`/`तेल` → oil, `baitri`/`बैटरी` → battery, `tyer`/`टायर` → tyre, `gaadi` → car …). Hindi text is NFKC-normalised so `ड़` has one spelling.
- **Vocabulary table `search_synonyms`** (term, locale en/hi/hinglish, kind synonym/category/vehicle, `expands_to[]`, active, version; unique per (kind, term)); migration 0080 seeds it from `DEFAULT_SEARCH_VOCAB` (the same list is the fallback when the table is empty and the demo's). Admin → Catalogue → **Search words** (lazy admin chunk): list, filter, add, switch on/off; `products:write`, version-checked, audited (`search_synonym.created/enabled/disabled`); a change reaches every API instance within 30 s (per-instance cache, dropped on write).
- **Matching** (`packages/db/src/repo/search-sql.ts`): every text word must be found as the word or one of its synonyms in `search_vector` (English + Hindi columns; the last word is a prefix while typing), or as a typo of the product or brand name (`word <% name`, the existing GIN trigram indexes); or a part number / SKU matches exactly. With no words left (a bare `900ml`, `bike`) the parsed attributes and vehicle are the filter. A word that is the category's own name (battery, tyre, filter …) also matches every product of that category (a bike battery named only "Exide Xplore XLTZ4A" is found); other category words (coolant, oil) are a boost only. Attributes are matched on the generated column **`products.search_compact`** (upper-case letters and digits of name + spec summary + compatibility, GIN trigram index): `20W40`, `35AH`, `90/90-12` match however the name spaced them; pack size through `product_variants.net_qty/net_unit`.
- **Ranking** (`SEARCH_WEIGHTS`, one table for SQL and the demo): `ts_rank` + best name/brand similarity, then +1.5 viscosity, +0.8 pack size, +1 Ah, +0.5 voltage, +1 tyre size, +1 part number, +1.5 vehicle intent (product tagged for that type), +0.4 category intent, +0.2 buyable now. Hidden/draft products never appear (the listing's live filter; `TODO(visibility)` seam for the brand/range switches).
- **Suggestions** `GET /v1/search/suggest?q=&locale=&city=` → ≤ 8 items: brands (≤ 2), ranges (≤ 2, through the `RangeSuggester` seam in `routes/search.ts`, not wired until `product_ranges` exists), categories (≤ 2), then the best products from the same listing (name, brand, photo thumb). Public, per-IP 120/min (`search_suggest_ip`), one answer per (city, language, words) cached 60 s per instance + `Cache-Control: public, max-age=60`; under 2 characters → empty. When nothing matched it also returns `didYouMean` (closest live brand, category or product name by trigram similarity ≥ 0.35; zero-result path only).
- **Web:** the shop search box is a WAI-ARIA combobox (list autocomplete, manual selection; ↑ ↓ Enter Esc, `aria-activedescendant`, polite live count, closes on Esc / click away / Tab / a pick / Enter or the form submit, and stays closed for those words until different words are typed; fixed 2026-11-25) whose panel is a **lazy chunk loaded on the first focus**; demo mode runs the shared parser over the demo catalogue (also lazy), API mode calls the endpoint. Nothing of it is in the first load of `/`, `/shop`, `/cart` (guard `apps/web/test/search-budget.test.ts`). Zero-result state: "Did you mean …?" button + the `search_zero_results` event (spec 12). Messages `catalogue.suggest*`, `catalogue.didYouMean`, `portal.syn_*` (en + hi, every placeholder given a value because messages are precompiled).
- **Not in the header:** there is no header search box today (the home hero and `/shop` have the only search fields); the combobox is on `/shop`. The home hero form stays a plain GET form (a client island there would add first-load JS to `/`).
- Tests: `packages/shared/test/search.test.ts` (66, incl. fast-check), `packages/db/test/smart-search.test.ts` (21), `apps/api/test/search.test.ts` (8), `apps/web/test/smart-search-demo.test.ts`, `search-budget.test.ts`.

## API

`GET /catalogue/categories`, `GET /catalogue/products?city&pincode&category&brand&q&vehicle&sort&cursor`, `GET /catalogue/products/:slug?pincode`, `GET /catalogue/suggest?q`, `GET /vehicles/master?make&model`, `POST /stock-alerts` (P1).

**Price for a PIN (decision 2026-11-01 "Pincode-wise prices", Q26 default; corrected here 2026-11-03, this spec said "lowest").** The customer sees one price: the offer of the **nearest shop that covers the PIN and has free stock** (distance from the shop's location to the PIN centroid; ties → lowest price → shop id, so the answer is stable). Without a PIN: "From ₹" = the lowest buyable offer in the city. A buyable offer = live product, active variant, active inventory with `on_hand − reserved > 0`, shop `approved` and not busy (paused/suspended shops are never `approved`), and for a PIN an active `shop_pincodes` row (its `shipping_paise` and lead days are shown). Unknown PIN → `pincodeKnown: false`, no prices.

**Built 2026-11-03 (API, `apps/api/src/routes/catalogue.ts`, repo `packages/db/src/repo/catalogue.ts`):**

- `GET /v1/catalogue/categories?locale`: visible categories in admin order with live product counts.
- `GET /v1/catalogue/products?city&pincode&category&brand&q&sort&available&cursor&limit&locale`: sorts `relevance` (default with `q`) · `newest` (default) · `price_asc` · `price_desc` (unpriced last). A category includes its child categories. `available=true` keeps buyable products only. Keyset cursor on (sort key, id), opaque base64url, validated (tampered → 422 `INVALID_CURSOR`); page size ≤ 48.
- `GET /v1/catalogue/products/{slug}?city&pincode&locale`: each active variant's best offer with the **seller name** (E-Commerce Rules), photos, OE/manufacturer part numbers, spec, country of origin, GST rate; drafts/unknown → 404.
- Public, no sign-in; per-IP limits (global 600/min + `catalogue_ip` 240/min on listings); `Cache-Control: public, max-age=30, stale-while-revalidate=120` (categories 300 s). Responses carry no internal ids. City defaults to `DEFAULT_CITY_CODE` (RPR). Hindi fields with the English fallback per `locale`.
- Demo data: `pnpm db:seed:demo` loads the web demo catalogue (Hindi included) for the API; removed before launch with `--remove` (Q21, `docs/runbooks/demo.md`).
- **Vehicle types (2026-11-12, Q76 default):** `products.vehicle_types` (2W/3W/4W, empty = fitment not listed; migration 0037, CHECK + GIN index). `GET /v1/catalogue/products?vehicle=3W` keeps only tagged products; cards and product pages return `vehicleTypes`; staff set them with `PUT /v1/admin/catalogue/products/{slug}/vehicle-types` (`products:write`, version, audited `product.vehicle_types_updated`). Web: the card chip shows the codes ("2W · 3W", screen readers hear "Vehicle type:"), untagged shows "Fitment not listed"; the shop had a "Vehicle type" select kept in the URL (`?vehicle=`), event `shop_vehicle_<type>` — **retired 2026-11-26** (founder ruling, see "Vehicle type select retired" below); the API parameter `?vehicle=` stays for other clients. Demo/seed tags come only from the demo `fits` values (EV is a fuel: no type).
- Not yet: exact make/model/year fitment and "Fits your {vehicle}" (Q76/Q10), Redis cache, Meilisearch (`suggest` and the synonyms table are built, see "Smart search" above); web pages still read the demo catalogue until Phase 1 wiring.

## Web on the API (built 2026-11-10, behind `NEXT_PUBLIC_DATA_MODE`, Q70)

Plan `docs/superpowers/plans/2026-11-10-catalogue-on-api.md`. Off (`demo`) on every deploy until cart + checkout use the API too: the demo cart's prices are not the API's nearest-shop offers.

- **One view model** (`apps/web/src/lib/catalogue/view.ts`: `CardView`, `ProductView`), two sources: `demo-source.ts` (demo data) and `api-source.ts` (server-only). DTOs come from `@mechdost/shared/catalogue` (moved out of the API route, one definition).
- **API source:** every response parsed; `fetch` with `revalidate` 30 s (listing) / 60 s (product) and tags `catalogue`, `product:<slug>`; 3 s timeout; failures throw (Next keeps the last good page; first visits show the shop's retry message, `app/[locale]/shop/error.tsx`); 404 → product 404; a tampered cursor restarts at page 1. Always `city=RPR` (until the city selector) and the page locale.
- **Product pages:** no build-time API calls (`generateStaticParams` returns nothing in api mode); rendered on first visit, then cached. Shows the seller and the country of origin (in Hindi on `/hi`, from the browser's country names; the column is English text today — an ISO code would be cleaner, rule 16). No reviews section or star row until the reviews API.
- **Listing:** the server filters, searches and pages (24 per page); changing a filter navigates (`scroll: false`); "Load more" is a server function returning server-rendered cards (no catalogue code in the browser), focus moves to the first new card and a polite status announces it. It continues exactly the list the server rendered (never the on-screen filters), fetches only the next page (cursor), appends it de-duplicated by slug and updates the address to `?pages=N` (≤ 10) with `history.replaceState` (no router round trip, so no re-render of the whole list; fixed 2026-11-22, it measured 370 KB at 5 pages). A fresh load or Back to `?pages=N` server-renders the N pages once. While loading the list and button are `aria-busy`, the button is `aria-disabled` and reads "Loading more products…"; a failure shows a retry message; the end shows "You have seen all N products."; focus goes to the first new card with `preventScroll` (no jump). Logic: `lib/catalogue/load-more.ts`. Quick-details ids are `info-<list>-<slug>` (unique across "Load more" pages).
- **Facts the source does not know are left out** (a11y review 2026-11-10, `.a11y-history/2026-11-10-catalogue-view-model`): no price → no price block and no add to cart, the product page offers "Ask about this product" (WhatsApp); no rating → no star row; no fit data → "Fitment not listed"; empty highlights or specification rows → no heading or blank row.
- **Not yet:** category chips and URL categories from `GET /v1/catalogue/categories` (today the web's nine demo categories, whose slugs match the seed; an admin-made or child category would show all products — to fix with the switch milestone), API product photos (artwork stays the category icon), home "popular products" from the API, on-demand revalidation when the admin edits (tags are ready), PIN price check on the web.
- **Blocker before the switch goes on anywhere:** the web's server-side calls come from one IP, so the API's per-IP limits would throttle every shopper together (spec 16).

## UI

Product card actions and the compare control: spec 21 § "Redesign 2026-11-14" ("☐ Compare" checkbox under the price — user ruling 2026-11-15 — and an action row with only "Add to cart" or the stepper at full width; no message ever inside a card; the compare tray asks). Concept sections `#home-products`, `#catalogue`, `#find-parts`, product page (`05-page-product-*.png`); hero search; 6 category tiles with concept descriptions; "Check price & delivery for your area" panel; product card with `<details>` "Specification & fitment"; status lines copied from the concept; fitment badge green; "Request a product →" sourcing form (quick RFQ: brand, reference, photo optional → ticket kind Product sourcing).

## Rules

Only `live` products with an active, in-stock offer from an approved shop covering the pincode are purchasable; without pincode show "From ₹" of the lowest live offer in the selected city; country of origin and seller name displayed (E-Commerce Rules); MRP ≥ selling; GST-inclusive display; images AVIF/WebP, 3 variants, LQIP.

## Edge cases

No offers in pincode → "No eligible delivery offers for this PIN yet. Browse all products or request sourcing."; product without fitment data → neutral chip "Fitment not listed" (a11y review 2026-11-10: "Check fitment" read as a command on non-interactive text); search with zero results → suggestions + sourcing CTA; catalogue load failure → retry copy from concept.

## Analytics

`search` (term, results_count, vehicle_selected), `view_item_list`, `select_item`, `view_item`, `select_vehicle`, `notify_me_clicked`, `filter_applied`.

## Acceptance tests

Fitment badge correctness, pincode price resolution picks the **nearest covering** in-stock approved offer (not the cheapest; `packages/db/test/catalogue.test.ts`), unpublished/paused/busy offers never appear, search typo "castrl" finds Castrol (trigram), cursor pagination stable under inserts, SEO JSON-LD present with Offer (`apps/web/test/seo.test.ts`: INR offer from paise, rating only with reviews, no item for on-request products; verified on the API-mode build 2026-11-17).

## Built: SEO (2026-11-17)

Decisions 2026-11-17 "SEO", runbook `docs/runbooks/seo.md`. Product pages: title "{brand} {name} – Buy Online in
{city}", description from spec + fitment, canonical + hreflang, product photo as the share image, `BreadcrumbList`
(Home › Shop › category › product) always, `Product` + `Offer` + `AggregateRating` in API data mode only. The shop with
one category (`/shop?category=…`) is a landing page with its own canonical, title and description; other parameters
canonicalise to it; search results are `noindex, follow`. `sitemap.xml` lists every product and category page in both
languages.

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

## Trust line on the product page (2026-11-15)

Near the price, one line: "Genuine {brand} part from a verified shop" (no brand: "Genuine part from a verified shop"),
admin-editable and hideable per language (spec 08 "Trust lines"). It is wording, not a guarantee. **"GST bill" is added
only beside a GST-registered selling shop**; the product page does not know the shop, so it is left out. No "sealed pack".
Rule for scarcity labels: "Few left" and "Popular" exist only on the demo catalogue's static data; the real catalogue source
never sets them. If they are ever shown for real data they must come from real stock or real sales (and a number must be the
real stock), never from an admin switch (dark-pattern audit F4, `docs/research/dark-patterns-audit-2026-11.md`).

## Built: product photos and wishlist (2026-11-15, design `docs/superpowers/specs/2026-11-15-catalogue-storefront-next-tier-design.md` items 1 and 5; migration `0067_photos_cart_wishlist`)

**Product photos.**

- Max **8 live photos per product**, explicit `sort` 0..7 (0 = cover; CHECK), uuid v7 ids. Each has alt text in **English and Hindi** (both required, 3 to 160 characters; Zod at the boundary, CHECK in the table). `product_photos` (existing since 0001, never written before) was reshaped in place: `media_id` (the 1600 and 320 WebP live on its `media_objects` row, `owner_kind = 'product_photo'`), `path640`, `lqip` (a 16 px WebP data URL, at most 2000 characters), `status` pending|approved, `submitted_by_shop_id`, review fields, `reject_reason`, soft delete, `version`.
- Upload gate = the job-photo pipeline (`processProductPhoto`: first bytes decide the type, JPEG/PNG/WebP only, HEIC/SVG/GIF refused, EXIF applied then dropped, original never kept) cut into **320 / 640 / 1600 px WebP** plus the placeholder. Keys are random (`product/{productId}/{mediaId}[-thumb|-640].webp`) in the same private bucket.
- **Who:** staff with `products:write` upload, list, reorder (by id list; "earlier/later" buttons, no drag), edit descriptions (compare-and-set), remove (Admin → Catalogue → product → Photos tab). Shops (`inventory:write`, own shops) may add photos to a product they sell **only while the setting `catalogue.shop_photo_uploads` is on** (default off, global); the photo is `pending` and counts against the same limit of 8. Staff with `products:publish` approve or refuse (reason code `not_this_product|low_quality|text_or_watermark|other`) in the queue; a refusal removes the photo and its files. A shop may remove only its own pending photo.
- **Limit and order under races:** every photo change locks the product row (`FOR UPDATE`), then counts live rows; removal compacts positions; reorder must name exactly the live ids.
- **Public serving (ruling 2026-11-15):** `GET /v1/product-photos/{id}/{320|640|1600}` through the API, `Cache-Control: public, max-age=31536000, immutable`, only for **approved photos of live products**; anything else is 404 unless the URL carries a valid 10-minute HMAC (the previews staff and shops see, `previewUrl`). The bucket stays private (a removed or refused photo stops being served at once; the object is deleted best-effort). Rate limit 1200/min per IP (long cache keeps real traffic far below). Put a cache in front of this path on the server (Q131).
- **Storefront:** catalogue answers carry `photo` / `photos` (`path` = photo id, localised `alt`, `width`, `height`, `lqip`). The web renders them on the server with `next/image`'s `getImageProps` and a loader that maps the requested width onto the stored variants (no optimizer round trip, no client JavaScript); width/height set, the placeholder as background, lazy loading, **`preload` only for the first photo on the product page**. Product page: cover plus thumbnails that open the 1600 px copy in a new tab. Cards fall back to the category artwork when a product has no photo.
- **Without Storage keys (Q112):** every upload answers 503 `PHOTOS_UNAVAILABLE` and writes nothing.
- Events: `product_photo_added`, `product_photo_removed`, `product_photo_reviewed`, `product_photos_reordered` (spec 12). Tests: `packages/db/test/product-photos.test.ts` (12), `apps/api/test/product-photos.test.ts` (11).
- Not built: per-variant photos (the column exists), drag-and-drop, image crop, a photo-removal confirmation or undo, revalidating the cached product page on a photo change (the 60 s window applies).

**Wishlist.** `wishlist_items` (user, product; unique pair), **at most 100 per customer**, held under the customer's user-row lock (parallel adds cannot pass it); adding what is there or removing what is not changes nothing and writes no event. API (real sign-in only): `GET /v1/me/wishlist`, `PUT|DELETE /v1/me/wishlist/{slug}` (limit answer 422 `WISHLIST_FULL`; unknown product 404; 240 writes an hour). Web: a heart on the card and a "Save" button on the product page (lazy chunk, signed-out press goes to sign-in and comes back), Account → Wishlist (empty state with one next step, remove with live announcement). The demo build has no wishlist (it lives on the server). Event `wishlist_toggled` (client) and `wishlist_changed` (server). Tests: `packages/db/test/cart-wishlist.test.ts`, `apps/api/test/storefront.test.ts`, `apps/web/test/storefront-next-tier.test.ts`.

- Not built: "notify on price drop" (later), prices on the wishlist page, sharing.

**Wishlist on shared devices:** the cached list is keyed by the signed-in uid and reset on sign-out or a uid change (see spec 03 "Shared devices").

## Audit batch 1a (2026-11-16)

Product card: the badges (Bestseller, vehicle type, fitment not listed) are a wrapping row under the picture (`data-slot="card-badges"`), never over it, so they cannot cover the SKU. Workshop finder (spec 07 listing): the service list under each workshop wraps, no ellipsis.

- **Reviews (2026-11-16):** the write-a-review form (product page, order and service screens) has a visible Cancel next to Submit, closes on Escape and returns focus to "Write a review"; unsent text is discarded by Cancel. Event `review_cancel_<target>`.

- **Card offer carries the sku (2026-11-16, real-API bug):** `CatalogueOfferSchema.sku` is the offered variant's sku (list, search, home ranges, recommendations and wishlist cards all come from `listCatalogue`; the product page's per-variant offer has it too). The web `apiCard` reads `offer.sku`; a card without an offer (on request) has no sku and shows no "Add to cart". Before this, every card "Add to cart" stored a line without a sku and the real cart dropped it. Tests: `packages/db/test/catalogue.test.ts`, `apps/web/test/catalogue-api-source.test.ts`.

## Built: real catalogue, brand/range switches, optional MRP (2026-11-22, migration 0079, design `docs/superpowers/specs/2026-11-22-real-catalogue-and-smart-search-design.md`)

- **One visibility rule** (`repo/visibility.ts` `productVisible(alias)`): product `live` AND brand not hidden AND range not hidden AND category and parent neither hidden nor archived. Used by the shop list, product page, search, category counts, recommendations and co-purchase, cart add and prune, checkout, quotes, compare (via the list), wishlist, reviews and partner applications. Guard test `packages/db/test/catalogue-groups.test.ts` fails when a storefront repository reads `p.status = 'live'` elsewhere. Hiding never rewrites `products.status`. The RLS mirror follows the brand switch (`brands_read`, `products_read`); ranges are API-only.
- **Brands** gained `hidden`, `hidden_reason` (code), `version`; new **`product_ranges`** (brand, slug, name, name_hi, hidden, reason, version); `products.range_id`, `products.hindi_machine` (Hindi made by the importer; cleared when staff edit any Hindi field), `product_photos.photo_source` (admin only, never granted to the Data API).
- **MRP is optional**: `product_variants.mrp_paise` may be NULL = "price on request", not sellable. No offer is priced for it (`BUYABLE_OFFER`), cart add and checkout treat it as unavailable, quotes cannot pick it, shops cannot price it (`MRP_MISSING`), the admin price board shows "not set" and `setAdminPrice` refuses (`MRP_MISSING`). Public API: `variants[].mrpPaise` is nullable.
- **MRP shown without an offer (2026-11-22, user: "use the same MRP price for now"):** cards and the product DTO carry `mrpFromPaise` (lowest MRP among the product's active packs, with or without a shop offer; null = none) and `mrpVaries` (packs differ). With no shop offer the card, product page and compare column show "MRP ₹x" ("MRP from ₹x" when packs differ; Hindi "MRP ₹x से") beside the existing "Confirmed on request" status and "Ask about this product" action: no add to cart, no discount badge, no unit price, no JSON-LD `offers`. No MRP at all renders exactly as before (no ₹0, no blank). The MRP is a reference, never a selling price: it creates no offer, `BUYABLE_OFFER` and the admin-price `NO_SHOP` guard are untouched. The product page has no per-pack price list yet, so nothing per pack to show. Tests: `packages/db/test/catalogue-groups.test.ts`, `apps/web/test/catalogue-api-source.test.ts`.
- **Adding products from catalogue-v2**: CLI `pnpm db:import:catalogue` (runbook `catalogue-import.md`, section "catalogue-v2 import"). User scope 2026-11-22: only the price-list brands (Castrol, Gulf, Exide, Tata Green, KELVINN, CERAFENCE, ELVI; `--brands` changes it), own photo (no `r`) whose picture bytes decode, all packs.
- **Battery brand imports (2026-11-23/24)**: Exide, Amaron and Tata Green come from their own scrape folders through one shared importer (`pnpm db:import:exide|amaron|tatagreen`, runbook `catalogue-import.md`): one live product per source row, MRP in the pack, the maker's own price terms in a private `spec.*Price` key (never in the public page payload, like `spec.fitment`), full fitment in `spec.fitment`, Hindi from a reviewed dictionary, old products of the brand archived. Tata Green (2026-11-24) adds evened-out photos (square canvas, same padding, no watermark or logo removal) and `--skip-photos-for`; a product with no usable picture is planned as a draft.
- **Tyre imports (2026-11-24)**: CEAT and MRF come from their scrape folders through the same importer (`pnpm db:import:ceat|mrf`, runbook `catalogue-import.md` "CEAT and MRF tyre imports"): one live product per tyre size (CEAT 336, MRF 918 incl. 247 tubes and flaps), exact maker names in title case, eight sub-categories of `tyres` for the admin (`car-suv-tyres`, `two-wheeler-tyres`, `three-wheeler-tyres`, `light-commercial-tyres`, `truck-bus-tyres`, `farm-tyres`, `otr-tyres`, `tubes-flaps`; `category=tyres` still lists all of them), typed tyre spec (size, load, speed, construction, tube type, front/rear, ply) with the attribute-set keys, vehicle fitment in the private `spec.fitment`, HSN 4011/4012/4013 at 18 % GST. Only the price shown on the maker's page is the MRP; CEAT's hidden site-data price is kept in the private `spec.ceatPrice.siteData` and the tyre is "price on request" (user ruling). Pictures are per pattern and stored once for all sizes (`attachSharedProductPhoto`, migration 0083: unique `(product_id, media_id)`); removing a photo keeps the stored image while another product still uses it.
- **Tyre imports, per pattern (2026-11-24 evening)**: CEAT (71 products, 336 sizes), MRF (225, 918) and Apollo (131, 468; India only, `pnpm db:import:apollo`) are one product per tread pattern with each size a variant: name = pattern ("CEAT Milaze X3"), variant label = the maker's size text ("145/70R12 69T TL"), `options` `{ size, loadIndex, speedRating, construction, tlTt, ply, frontRear }`, own SKU, MRP or price on request, EAN `barcode`. Size data, fitment and CEAT's hidden price are private under `spec.variantSpecs[sku]` (`PRIVATE_SPEC_KEYS`). Apollo adds `industrial-tyres`; `otr-tyres` takes earthmover tyres. The product page shows the sizes through the API's per-variant offers (the size picker is the storefront task of the plan `docs/superpowers/plans/2026-11-24-tyre-variants.md`).
- **HP and BPCL MAK lubricants (2026-11-25, automotive only; runbook "HP and BPCL MAK lubricant imports")**: `pnpm db:import:hp` and `pnpm db:import:bpcl`. One product per oil and grade ("HP Racer 20W-40", "BPCL MAK Alpha Zenith 5W-40"), each pack a variant (`options` `{ label }` "1 L", "900 ml"; `netQuantity` ml or g so the price per litre works; MRP or price on request; unique SKU). Typed spec like Castrol (`saeGrade`, `apiClass`, `jasoClass`, `baseType`) plus `grade`, `standards`, `specificationsMet`, `properties` (viscosity, flash and pour point, TBN) and the private `sourceDocs` (data sheet, picture and page URLs; in `PRIVATE_SPEC_KEYS`). BPCL "Rs 354/-" is the MRP; HP has no prices and no pack sizes, so each HP product has one "Standard pack" at price on request. A generic or another product's photo is never used: the product is a draft with `spec.draftReason` (`generic_photo_only`, `photo_of_another_product`, `no_photo_on_site`). Categories are the existing `lubricants` children; products of the brand not in the plan are archived.
- **IOCL Servo (2026-11-25)**: `pnpm db:import:servo`: only automotive products with a picture (12), IndiaMART seller photos, no MRP (seller prices are asking prices), pack sizes only from High-confidence listings, brand `servo` (maker in `spec.maker`), same typed spec as Castrol; the rest of the 167 rows are listed in the status report, not imported. HP packs come from `--packs <csv>` (sizes only, no MRP by default, `--packs-mrp on|off`).
- **Live audit fixes (2026-11-22, real mode):** (1) `/shop?category=` takes a top-level slug **or a sub-category slug** (the product breadcrumb, JSON-LD and compare "back to" link use the product's own sub-category): the page resolves it through `GET /v1/catalogue/categories`, filters to that sub-category (the API already matches a category or its children), keeps the parent selected in the category select and chips, shows a removable sub-category chip (`catalogue.removeSub`), and uses the sub-category name in the title and canonical; an unknown slug filters nothing; demo mode knows only the nine slugs (`apps/web/src/lib/catalogue/shop-state.ts`). (2) **Hindi of imported text:** `--translations` (a flat `{ English: Hindi }` map) now also covers product names, range names, highlight values and the fitment text, not only descriptions; a re-run replaces importer-written Hindi (products with `hindi_machine`; ranges whose Hindi is still what a glossary-only import wrote) and never an admin's edit. Only brand, series, standard and unit names may stay Latin (`packages/shared/src/catalogue-hindi.ts`); the importer prints every Hindi text that still holds an English word and a real run stops on any (`--allow-english-hindi` overrides). (3) Product photos are never drawn larger than their stored size (frame keeps its aspect ratio, picture centred). (4) Compare: the "start a new comparison" question and the "up to 4" notice already existed (`compare-tray.tsx`); unit tests now pin them for sub-category slugs. (5) Product pages without a shop offer emit a `Product` JSON-LD (name, brand, image, sku, description) with **no `offers`** and no rating. (6) Home "Browse our product range" in API mode shows the newest live products that have a photo, one per brand first (`home-range.ts`), nothing when there are none; an admin-chosen featured list is not built yet. (8) Spec summary writes grades as `5W-40`; the "Part reference" row shows the SKU only for a single-pack product, else the first real OE/maker part number, else nothing.

## Product photo gallery (2026-11-24)

The product page's photo area is `ProductGallery` (decision 2026-11-24): a fixed square frame with a scroll-snap track of all photos (the first `priority`, the rest lazy), a thumbnail strip of **all** photos as buttons (active one ringed, `aria-current`), prev/next arrows (always visible on touch, on hover or focus elsewhere, disabled at the ends, no wrap), a counter "2 / 5" with a polite screen-reader status, one 44px enlarge button (top right; a click on the picture opens it too, so no button sits under the arrows), Left/Right keys, swipe, and a full view (`ProductPhotoViewer`, native dialog, lazy chunk loaded on first open, 1600 px copy via the shop image loader). One photo: no strip or arrows, still opens the full view. No photo: `ProductVisual`. No link or new tab to the image API. Events: `product_photo_selected`, `product_photo_viewer_opened` (spec 12). Tests: `apps/web/test/product-gallery.test.ts`; state-audit row `API-PDP-GALLERY` (none, one, two, many photos with very long descriptions, viewer closed or open).

## Search by size (2026-11-25, user: "does it show even if i search any of the size and it would open that product? … tell that the product exists so the customer wont be confused and also improve the way in which u show them"; migration `0086_variant_size_search`, not applied)

Bug it fixes (live): "90/90-12", "3.50-10", "175/65 R14" found nothing although a product has that size, because `products.search_compact` is built from name, spec summary and compatibility only and variants were never searched.

- **Data.** `product_variants.size_compact` = every option value (the `size` first) plus the pack (`net_qty` + `net_unit`) with only A-Z and 0-9 kept ("90/90-12 54J TL" → `909012...`). Kept by the `product_variants_size_compact` trigger (BEFORE INSERT, and UPDATE of options / net_qty / net_unit) from the immutable function `variant_size_compact`; never written by the app. Migration 0086 backfills with the user triggers disabled around the UPDATE, so `version` and `updated_at` do not move. Trigram GIN index `product_variants_size_compact_trgm_idx` (rule 14).
- **Parser.** `parseSearchQuery` also reads "90 90 12", "175 65 r14" (plausible width 60-400, aspect 30-100, rim 8-24) next to "90/90-12", "175/65R14", "175/65 R14", "3.50-10". `tyreSizeKeys(size)` gives the compact spellings with and without `R` ("90/90-12" also finds "90/90 R12").
- **Match and rank** (`search-sql.ts`, `sizeMatchCondition`): the tyre-size attribute is true when the product's text has the size or any **active** variant's `size_compact` has it; a query that is only a size filters on it (before: nothing). Pack sizes ("3.5 l", "3500ml") use `net_qty`/`net_unit` of active variants. `SEARCH_WEIGHTS.tyreSize` went from 1 to 3 so a size match outranks a brand-only match ("90/90-12 ceat" lists the CEAT with that size first, then the other CEAT tyres). SKU search is unchanged. Archived sizes never match.
- **API.** `CatalogueCard.matchedSizes: [{ label, sku }]` (max 3, `[]` when the query names no size; computed for the page rows only, after the page is cut) and `SuggestItem.matchedSize: { label, sku } | null`. The product detail payload has no `matchedSizes`.
- **Card.** A link chip "Size 90/90-12 54J TL available" (hi: "साइज़ … उपलब्ध है"; `sizesAvailable` text on hover and for screen readers when several matched) in the card's rating row; the photo, name and "Choose size" links carry `?size=<sku>`. The header search palette and the shop box show the matched size under the product and open `?size=<sku>`. The canonical URL of the product page does not change.
- **Product page picker** (`size-buy-box.tsx`, restyle of the existing picker only): 2-3 column tiles (min 56 px high), selected tile = thick accent border, tinted fill and a check icon (not colour alone); each tile shows the size, price with struck MRP, "Price on request", or "MRP ₹x · Out of stock"; more than 6 sizes with at least 2 rims are grouped by rim, smallest first ("12 inch", `groupSizesByRim` in `lib/catalogue/size-select.ts`), others under "Other sizes"; packs are never grouped. A `?size=` link shows "Showing size …". The choice is written to the URL with `replaceState`; native radios, so arrow keys and screen readers are the browser's own.
- **Analytics:** `search_size_match_clicked` (spec 12). Existing `product_size_selected` with `source: link` fires on arrival.
- **Not built:** the card line "4 sizes · 3.50-10 to 90/90-12" (needs a size-range field from the API; the card keeps "from ₹X · N sizes").
- Tests: `packages/shared/test/search-size.test.ts`, `packages/db/test/smart-search-sizes.test.ts` (spacing variants, archived excluded, trigger on edit, ranking, matched sizes, suggestions, index plan), `apps/api/test/search.test.ts`, `apps/web/test/size-groups.test.ts`.

## Sizes as variants (2026-11-24, user: "just like amazon lists two items that just vary in packing size like 500 ml and 1 L")

One product per tread pattern (or oil grade, battery model), each size a **variant** with its own SKU, `options` (`size`, `loadIndex`, `speedRating`, `construction`, `tlTt`, `ply`, `frontRear`; importers also use `label`, `model`), MRP (null = price on request), barcode and stock. Data contract with the tyre importer (plan `docs/superpowers/plans/2026-11-24-tyre-variants.md`): per-size private data lives in `spec.variantSpecs[sku]` (`PRIVATE_SPEC_KEYS` hides `variantSpecs` like `fitment`).

- **Label.** `variantLabel(options)` (`@mechdost/shared/variants`) builds "145/70 R12 69T TL" (size, load index + speed rating, TL/TT, each only if the size text lacks it; else `label`, `model`, or the values joined). The API sends it as `variants[].label`; the web, the order snapshot and the admin editor use the same function.
- **API.** `GET /v1/catalogue/products/{slug}` already returned every active variant with its own offer; it now adds `label`. Cards carry `sizeCount` (active variants) next to the best offer (the lowest customer price in the city list). `GET /v1/me/vehicles/fit?product=<slug>` (signed in, own vehicles only, 404 for a product that is not live) answers `{ fitsVariantSku, vehicle: { make, model } | null }`: the first size whose private fitment (`variantSpecs[sku].fitment`: vehicleType, make, model) lists one of the caller's saved vehicles (make + model compared ignoring case and punctuation, within the 2W/4W type; years are not compared). The fitment lists never leave the server.
- **Product page.** One size renders exactly as before. Several sizes render the `SizeBuyBox` island (`components/catalogue/size-buy-box.tsx`, loaded only on those pages): native radio group (browser arrow keys), 44 px targets, the chosen size filled. Price, MRP, saving, unit price, stock, delivery and add-to-cart follow the chosen size. A size with an MRP but no shop offer stays selectable and is marked "Out of stock" (dashed chip, MRP shown, no price, no add button, "Ask about this product" on WhatsApp, naming the size); a size with no MRP is marked "Price on request" and shows no amount at all. The page opens on the size with the lowest offered price (the one the card says "from"), else the first. `?size=<sku or size text>` opens a size (unknown or archived = the default, no error); a tap writes it back with `history.replaceState`; the canonical URL stays the product URL. Signed in with a saved vehicle and a matching size, that size is preselected (unless the link named one) and its chip says "Fits your <vehicle>". JSON-LD becomes an `AggregateOffer` (lowPrice, highPrice, offerCount over the sizes a shop can sell now).
- **Cards.** Several sizes: "from ₹X · N sizes" (X = lowest offered price; "N sizes" alone when none can be bought) and "Choose size" (a link to the product page) in place of "Add to cart", because a card cannot know which size is wanted. One size is unchanged.
- **Browser cart.** A line is one size: `lineKey = sku ?? slug`, so two sizes of one product are two lines; `setQuantity`/`removeFromCart` take that key. Old lines saved by slug only become the product's first size (`upgradeLegacyLines`, applied when the cart page opens in demo data and when the product's default size is added). The server cart is already SKU-keyed (SKU is globally unique and maps to one `variant_id`), so sync sends SKUs and the server resolves the variant.
- **Orders.** `order_items.variant_label` (migration 0084) holds the size when the product is sold in several; the snapshot `title` / `title_hi`, the checkout quote line `name` and bulk-quote line titles end with " · <size>" (so customer, shop and admin order pages, invoices and e-mails show it with no extra code). A single-size product is never named with a size.
- **Compare.** `?p=slug:SKU` compares one size; without `:SKU` the default size. The column head shows the size. (The compare tray stores slugs only, so adding from the product page compares the default size unless the link carries `:SKU`.)
- **Admin.** Catalogue editor tab "Sizes": each size's label, MRP (empty = price on request), barcode, archive / restore, and "Add a size". API (`products:write`; archive and restore need `products:publish`): `POST /v1/admin/catalogue/products/{slug}/variants`, `PATCH /v1/admin/catalogue/variants/{sku}` (strict bodies, only the known option keys). `product_variants.version` (migration 0084): every change is a conditional update (`STALE_VARIANT` 409), audited with before and after (`variant.added|updated|archived|restored`), event `admin_variant_changed`. An MRP is never lowered under a price a shop or the admin already set (`MRP_BELOW_PRICE`); the last active size of a live product cannot be archived (`LAST_VARIANT`); a taken SKU is `SKU_TAKEN`. Archiving leaves the other sizes' offers, stock and cart lines alone.
- **Demo.** The demo tyre `car-tyre-185-65-r15` ("Milaze X3 passenger car tyre") has three sizes (175/65 R14, 185/65 R15, 195/55 R16 with no stock).
- **Not done / follow-ups.** Preselecting the compare size from the product page (the tray keeps slugs only); photos per size; editing load/speed/TL fields of a size separately in the admin editor (the size label field edits `size`, the other keys are kept as they are).

## Staff edit shortcut on cards and the product page (2026-11-25)

The product card and the product page carry a staff-only "Edit" link after hydration (never in the cached server HTML); see spec 08 "Storefront edit shortcut". It sits at the picture's top right on cards (the ⓘ and ♡ buttons stay on the category line) and beside the title on the page.

## Vehicle type select retired (2026-11-26, founder: "yes we can replace the old vehicle type drop down"; Q-segments)

- The shop's 2W/3W/4W "Vehicle type" select is gone (web, demo and API mode); the "Kind of vehicle" chips are the only
  vehicle filter. The filter form is search · category · sort · Search (`tab`: search on its own row; `nav`: one row).
- **Old links keep working:** `/shop?vehicle=2W|3W|4W` (and `/hi/shop?…`) answer **308** to the same URL with the
  matching segment added to any chosen ones (2W → `two_wheeler`, 3W → `three_wheeler`, 4W → `car_suv`; shared order)
  and every other parameter kept (`q`, `category`, `sort`, `pages`); an unknown value is dropped. Code
  `legacyVehicleRedirect` (`apps/web/src/lib/catalogue/shop-state.ts`), unit test
  `apps/web/test/shop-vehicle-dropdown-retired.test.ts`, e2e `demo-flows.spec.ts` "Kind of vehicle chips".
- **Results differ slightly from the old filter, on purpose:** the segment comes from the category first, then the
  vehicle types (a CV battery tagged 4W is `truck_bus`, not `car_suv`; a general product tagged 2W is `two_wheeler`).
- **"Fits your vehicle" is unaffected:** the per-size fit (`GET /v1/me/vehicles/fit`, `fitsFitment`) compares the saved
  vehicle's type, make and model with the size's private fitment lines; it never read the shop select, so nothing
  moves. The saved vehicle's 2W/3W/4W type maps to segments with `SEGMENT_OF_VEHICLE_TYPE` wherever a segment is
  needed.
- **Analytics:** the click ids `shop_vehicle_<type>` stop; vehicle filtering is `shop_segment_filtered` (spec 12).
- `VEHICLE_TYPES` (2W/3W/4W) stays for My vehicles, roadside and service requests; locale keys
  `catalogue.vehicleLabel` / `catalogue.vehicleAll` removed (en + hi).

## Vehicle segments (2026-11-25, design `docs/superpowers/specs/2026-11-25-shopping-personalisation-design.md` phase 1; migration `0087_vehicle_segments`, not applied)

User: "we have products for trucks and tractors etc as well right? if yes then add filters and tags for those too"; segments approved ("yeah the segments are fine go ahead").

- **Segments** (closed codes in `packages/shared/src/vehicle-segments.ts`; names, Hindi names, descriptions, order and on/off in table `vehicle_segments`, staff-edited): `two_wheeler` Two-wheeler / दोपहिया, `three_wheeler` तिपहिया, `car_suv` Car & SUV / कार और एसयूवी, `light_commercial` हल्के व्यावसायिक वाहन, `truck_bus` ट्रक और बस, `tractor_farm` ट्रैक्टर और खेती, `construction_otr` निर्माण और ओटीआर, `not_vehicle` Not a vehicle / वाहन के लिए नहीं (inverters, home power, gensets, tools). `VEHICLE_TYPES` (2W/3W/4W) is unchanged and still serves My vehicles, roadside and service requests.
- **Data:** `vehicle_segments` (code PK, name_en, name_hi, description_en/hi, sort, active, version), many-to-many `product_vehicle_segments (product_id, segment_code)` with index `(segment_code, product_id)`, and the reviewed mapping table `category_default_segments (category_slug, segment_code)`. RLS on, anon/authenticated revoked, version and updated_at triggers. A product has zero or more segments; none = not tagged (shown in no chip, no tag).
- **Defaults (SQL `product_default_segments`, same logic as `defaultSegmentsFor`):** the category's mapping; a diesel or heavy-duty oil whose name/spec/compatibility says tractor also gets `tractor_farm`; a category with no mapping takes the segments of the product's vehicle types (2W to two_wheeler, 3W to three_wheeler, 4W to car_suv), else none. An AFTER INSERT trigger on `products` applies it to every new product (admin create, CSV, all importers), so imports need no change; `backfill_product_segments()` applied it to the existing products once (idempotent, skips products that already have a row, so staff choices are never overwritten).
- **Segment backfill mapping (reviewed 2026-11-25):**

| Category slug                                                                                                                                                                              | Segments                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| two-wheeler-tyres, two-wheeler-batteries, motorcycle-oil                                                                                                                                   | two_wheeler                                                                          |
| three-wheeler-tyres, three-wheeler-batteries, e-rickshaw-batteries                                                                                                                         | three_wheeler                                                                        |
| car-suv-tyres, car-suv-batteries, car-engine-oil, car-care-products                                                                                                                        | car_suv                                                                              |
| light-commercial-tyres                                                                                                                                                                     | light_commercial                                                                     |
| truck-bus-tyres                                                                                                                                                                            | truck_bus                                                                            |
| cv-batteries, diesel-engine-oil, heavy-duty-oils                                                                                                                                           | truck_bus + light_commercial (+ tractor_farm for an oil that says tractor)           |
| farm-tyres, tractor-batteries, tractor-agri-oils                                                                                                                                           | tractor_farm                                                                         |
| otr-tyres, industrial-tyres, earth-moving-batteries                                                                                                                                        | construction_otr                                                                     |
| home-power, genset-batteries, industrial-batteries, workshop-tools                                                                                                                         | not_vehicle                                                                          |
| greases, gear-oils, speciality-oils, coolants, brake-fluid-fork-oil, aerosol-sprays, polishes-waxes, cleaners-shampoos, tubes-flaps, spare-parts, filters, accessories, bearings, coatings | none: from the product's vehicle types if it has any, else untagged (staff set them) |

- **Preview on the real database (read only, run in the SQL editor before applying):**

```sql
-- counts per segment the backfill would give (live products); the "(no segment)" row lists the categories left untagged
with m as (select * from (values
 ('two-wheeler-tyres','two_wheeler'),('two-wheeler-batteries','two_wheeler'),('motorcycle-oil','two_wheeler'),
 ('three-wheeler-tyres','three_wheeler'),('three-wheeler-batteries','three_wheeler'),('e-rickshaw-batteries','three_wheeler'),
 ('car-suv-tyres','car_suv'),('car-suv-batteries','car_suv'),('car-engine-oil','car_suv'),('car-care-products','car_suv'),
 ('light-commercial-tyres','light_commercial'),('truck-bus-tyres','truck_bus'),
 ('cv-batteries','truck_bus'),('cv-batteries','light_commercial'),('diesel-engine-oil','truck_bus'),('diesel-engine-oil','light_commercial'),
 ('heavy-duty-oils','truck_bus'),('heavy-duty-oils','light_commercial'),
 ('farm-tyres','tractor_farm'),('tractor-batteries','tractor_farm'),('tractor-agri-oils','tractor_farm'),
 ('otr-tyres','construction_otr'),('industrial-tyres','construction_otr'),('earth-moving-batteries','construction_otr'),
 ('home-power','not_vehicle'),('genset-batteries','not_vehicle'),('industrial-batteries','not_vehicle'),('workshop-tools','not_vehicle')
) t(slug, seg)),
d as (
  select p.id, c.slug, coalesce(m.seg, case v when '2W' then 'two_wheeler' when '3W' then 'three_wheeler' when '4W' then 'car_suv' end) as seg
  from products p join categories c on c.id = p.category_id
  left join m on m.slug = c.slug
  left join lateral unnest(p.vehicle_types) v on m.seg is null
  where p.status = 'live'
  union
  select p.id, c.slug, 'tractor_farm' from products p join categories c on c.id = p.category_id
  where p.status = 'live' and c.slug in ('diesel-engine-oil','heavy-duty-oils')
    and (p.name || ' ' || coalesce(p.spec_summary,'') || ' ' || coalesce(p.compatibility,'')) ~* '(tractor|ट्रैक्टर)')
select coalesce(seg, '(no segment)') as segment, count(distinct id) as products,
  string_agg(distinct slug, ', ') filter (where seg is null) as untagged_categories
from d group by seg order by 2 desc;
```

The PGlite fixture test proves the same mapping (`packages/db/test/vehicle-segments.test.ts`).

- **API:** `GET /v1/catalogue/products?segment=truck_bus,tractor_farm` (any of; unknown code = 400). Every card has `segments: [{code, name}]` (active only, staff order, page language); the first page has `facets.segments: [{code, name, count}]`, counts for the current search, category, brand, vehicle and availability, ignoring the segment filter itself (so a chip shows what choosing it adds); later pages have none. `GET /v1/catalogue/segments?locale=` lists the active segments with live counts (home tiles; counts use `productVisible`, so hidden brands and categories are never counted). Admin: `GET /v1/admin/catalogue/segments`, `PATCH /v1/admin/catalogue/segments/{code}` (version compare-and-set, strict body), `PUT /v1/admin/catalogue/products/{slug}/segments` (product version compare-and-set, audited `product.segments_updated`); permission `products:write`.
- **Search words:** a new vocabulary kind `segment` (admin-editable like the others, table `search_synonyms`, migration 0087 adds the check value and the words and turns the old plain-word truck / bus / tractor vehicle entries into segment entries). English, Hindi and Hinglish: truck, lorry, bus, tipper, trailer, ट्रक, बस; tractor, kisan, farm, agri, ट्रैक्टर, किसान; tempo, pickup, mini truck, lcv, टेम्पो; jcb, earthmover, excavator, loader, otr, जेसीबी; inverter, genset, ups, इन्वर्टर. The word leaves the text match and boosts products in that segment (`segmentIntent` 1.5, same as vehicle intent); with no other word left it is the filter ("tractor" lists tractor products). Demo ranker and SQL agree.
- **Web:** `/shop` shows the vehicle chips (`data-slot="segment-chips"`) under the category chips: toggle buttons with `aria-pressed`, several at once (any of), the count of each for the current search and category, "All vehicles" clears; zero-count chips are hidden unless chosen; 44 px high; the row scrolls sideways inside its own box. URL `?segment=truck_bus,tractor_farm` (valid codes, shared order). Cards carry one tag (`data-slot="card-segment"`) in the badge row under the picture: the product's first segment in staff order; the "Fitment not listed" badge is dropped when a segment tag is shown. The product page lists "Suitable for ..." in its specification table. Home has a section "Shop by vehicle" (layout key `vehicles`, after the categories; the admin orders or hides it like the others) with tiles Truck & bus, Tractor & farm, Construction & OTR linking to `/shop?segment=...`; names, descriptions and counts come from the segment table (API) or the built-in texts (demo); no tiles, no section. Demo mode: the demo catalogue has heavy-vehicle, tractor, OTR and inverter products; the demo admin keeps renames and order in this browser and applies them to the chips only.
- **Analytics (spec 12):** `shop_segment_filtered { segments, count }`, `home_segment_tile_clicked { segment }`, `admin_site_change` area `segments`.
- **Tests:** `packages/db/test/vehicle-segments.test.ts`, `packages/shared/test/vehicle-segments.test.ts` and `search.test.ts`, `apps/api/test/catalogue-segments.test.ts` (+ role-leak rows in `admin-catalogue-role-leak.test.ts`), `apps/web/test/segments.test.ts`, `apps/web/e2e/segments.spec.ts`, state-audit rows `SHOP-SEGMENT-CHIPS`, `SHOP-SEGMENT-TAG`, `HOME-VEHICLE-TILES` and two routes of `SHOP-FILTERS`.
