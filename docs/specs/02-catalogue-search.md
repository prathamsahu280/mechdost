# 02 · Catalogue, fitment & search

Status: decided (vehicle master source pending) · Phase 1 · Decisions: Catalogue section, Search

## Goal

A fast, calm catalogue (concept "Explore products. Across India." layout) where every product shows fitment for the customer's vehicle, prices and delivery by pincode, and search that tolerates typos and Hinglish.

## Roles

customer (browse), seller (list products / offers), catalogue_manager (master data, approvals), admin.

## User stories

- Browse by category tiles, filter by brand/price/fitment/availability/seller/attributes, sort, paginate ("load more" on mobile).
- See "Fits your {vehicle}" badge; filter the whole catalogue by my primary vehicle.
- Search by name, brand, part number (OE/cross-reference), with suggestions and zero-result fallback ("Request a product" sourcing form from the concept).
- Open a product page with gallery, spec table, fitment list, price by pincode, reviews, recommendations, "Add to cart" / "Buy with installation" / "Ask about this product".
- Get notified when an out-of-stock item is back (P1).

## Data

`categories` (tree, slug, icon, description from concept tiles, sort, hidden), `brands` (origin oem|oes|aftermarket), `attribute_sets` + `attributes` (typed), `products` (master: slug, name, brand, category, attribute_set, spec jsonb, description, hsn, gst_rate_bp, mrp_paise, country_of_origin, warranty, status draft|submitted|live|rejected|archived, created_by seller/catalogue), `product_variants` (sku, options jsonb, barcode, weight_g, dims), `product_photos` (order, alt, variants thumb/card/zoom, blurhash), `part_numbers` (variant_id, kind oe|mfr|xref, value, normalised), `vehicle_makes/models/variants` (vehicle master, type, years, fuel), `fitments` (variant_id × vehicle_variant_id, year_from, year_to, notes), `shop_inventory` (shop × variant: selling_paise, mrp override, on_hand, reserved, active, lead_days), `shop_pincodes` (coverage, shipping_paise, lead_days), `reviews` (status pending|approved|hidden), `search_synonyms`, `stock_alerts` (P1).

## Search

Launch: Postgres `tsvector` (name, brand, sku, part numbers, spec) + `pg_trgm` similarity + synonyms table; Redis cache 60 s per (city, query, filters). **Planned upgrade: Meilisearch** behind the same `/search` API (index sync job, typo tolerance, facets, Hinglish synonyms, geo for workshops).

## API

`GET /catalogue/categories`, `GET /catalogue/products?city&pincode&category&brand&q&vehicle&sort&cursor`, `GET /catalogue/products/:slug?pincode`, `GET /catalogue/suggest?q`, `GET /vehicles/master?make&model`, `POST /stock-alerts` (P1). Prices resolved per pincode from `shop_inventory` ∩ `shop_pincodes` (lowest price with stock; shows "From ₹" when no pincode).

## UI

Concept sections `#home-products`, `#catalogue`, `#find-parts`, product page (`05-page-product-*.png`); hero search; 6 category tiles with concept descriptions; "Check price & delivery for your area" panel; product card with `<details>` "Specification & fitment"; status lines copied from the concept; fitment badge green; "Request a product →" sourcing form (quick RFQ: brand, reference, photo optional → ticket kind Product sourcing).

## Rules

Only `live` products with an active, in-stock offer from an approved shop covering the pincode are purchasable; without pincode show "From ₹" of the lowest live offer in the selected city; country of origin and seller name displayed (E-Commerce Rules); MRP ≥ selling; GST-inclusive display; images AVIF/WebP, 3 variants, LQIP.

## Edge cases

No offers in pincode → "No eligible delivery offers for this PIN yet. Browse all products or request sourcing."; product without fitment data → neutral badge "Check fitment"; search with zero results → suggestions + sourcing CTA; catalogue load failure → retry copy from concept.

## Analytics

`search` (term, results_count, vehicle_selected), `view_item_list`, `select_item`, `view_item`, `select_vehicle`, `notify_me_clicked`, `filter_applied`.

## Acceptance tests

Fitment badge correctness, pincode price resolution picks lowest in-stock approved offer, unpublished/paused offers never appear, search typo "castrl" finds Castrol (trigram), cursor pagination stable under inserts, SEO JSON-LD present with Offer.

## Open decisions

Vehicle master source (register #4).

## P1/P2

Back-in-stock/price-drop alerts, Q&A, photo reviews, badges, collections, B2B price lists, related/upsell rules (part of recommendations), compare (P2), 360° media (P2), Meilisearch switch.
