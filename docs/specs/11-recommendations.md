# 11 · Recommendations (cart, product page, checkout)
Status: decided · Phase 1 · Decisions: Catalogue, recommendations

## Goal
Useful, explainable suggestions that raise basket size without clutter: rules + our own co-purchase statistics now, data model ready for a learned ranker later.

## Sources (ranked, deduped, max 4 per slot)
1. **Fitment**: items that fit the customer's primary vehicle in the same or complementary category.
2. **Complement rules** (admin-editable table `recommendation_rules`: trigger category/brand/sku → suggested category/sku, label, priority): oil → oil filter; battery → fitting service; tyre → alignment/balancing; brake pads → brake fluid; chain kit → chain lube.
3. **Frequently bought together**: nightly job computes co-purchase counts and lift from `order_items` (min support 3), stored in `copurchase_pairs`.
4. **Admin bundles**: curated bundles with optional bundle discount.
5. **Fallback**: category best-sellers in the city.

## Slots
Product page ("Goes well with", "Fits your vehicle too"), cart drawer ("Add before checkout"), checkout review ("Don't forget"), order confirmation ("Book fitting at a nearby workshop").

## Data
`recommendation_rules`, `copurchase_pairs` (a_variant, b_variant, count, lift, computed_at), `bundles`, `recommendation_impressions` (slot, candidate, shown, clicked, added) for evaluation.

## API
`GET /recommendations?slot&variant_ids&vehicle_id&city` (cached 10 min per key).

## Rules
Never recommend out-of-stock or non-serviceable items; respect fitment (exclude non-fitting); explain why ("Fits your Activa 6G", "Bought together 42 times"); admin can pin/exclude per slot.

## Analytics
`reco_impression`, `reco_click`, `reco_add_to_cart` with slot and source; attach `reco_source` to order items for attribution.

## Acceptance tests
Rule precedence, fitment exclusion, co-purchase job idempotent, attribution recorded.

## P1/P2
Learned ranker (gradient boosted on impressions/adds), personalised home, "buy with fitting" price bundles, email recommendations.
