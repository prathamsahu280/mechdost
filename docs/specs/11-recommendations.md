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

## Built 2026-11-15 (catalogue tier 2, item 4; migration 0068)

- **Tables:** `recommendation_rules` (trigger category, suggested category, reason in English and Hindi, priority 1 to 100, on/off, `version`; unique per pair; a category cannot suggest itself) and `copurchase_pairs` (product A, product B, count, computed_at; no user column, rebuilt as a whole). RLS on, no grants, version/updated_at triggers on the rules.
- **Order of suggestions (cap 4, `RECO_MAX`):** (1) active admin rules whose trigger category is the product's category or its parent, lower priority number first, newest products first within a rule; (2) co-purchase pairs by count. Products already on the page or in the cart are never suggested; only products with a buyable offer today are (same `BUYABLE_OFFER` rule and card query as the catalogue, `availableOnly`). Unknown slugs and failing calls give an empty list, never an error page.
- **Co-purchase job (worker, `recomputeCopurchase`):** from DELIVERED order items, two products count as bought together when delivered parts of one checkout (order group) held both; a pair needs 3 different checkouts (`RECO_MIN_SUPPORT`); the strongest 20 per product are kept. Runs once a night (03:00 IST, checked hourly) and once a minute after the worker starts. Delete and insert are one transaction under an advisory lock, so a repeat gives the same table and two workers never overlap. Product level (not pack/variant): a 900 ml and a 1 l oil count as the same product.
- **API:** public `GET /v1/recommendations?slot=product|cart&slugs=a,b&city&locale` (per-IP 240/min, `Cache-Control: public, max-age=300`, up to 20 slugs); admin `GET/POST /v1/admin/recommendation-rules`, `PUT/DELETE /v1/admin/recommendation-rules/{id}` (version check, 409 `STALE_RULE` / `DUPLICATE_RULE`), `GET /v1/admin/recommendation-categories`, all with `categories:write` (catalogue manager, super admin; no new permission). Every rule change writes `audit_log` (`recommendation_rule.created|updated|deleted`) and the server event `admin_reco_rule_saved`.
- **Web:** `RecommendationsSection` is a Server Component (no client code of its own). Product page: "Goes well with this", catalogue cards, streams in behind Suspense, real data mode only. Cart: "Add before checkout" with a lean card (artwork, name, price, link; no add button or compare toggle, so the cart bundle does not grow). The cart page is a Server Component and cannot read the browser cart, so the browser mirrors the product slugs (no quantities, no person) into the cookie `mechdost-cart-slugs` (`demo/store.ts`); the server cart (item 3) replaces this. Reason line under each card: the admin's wording (en/hi) or "Bought together N times".
- **Admin:** Admin -> Catalogue, below the catalogue editor, "Goes well with: rules" (real sign-in builds).
- **Not built:** checkout and order-confirmation slots, fitment source, bundles, best-sellers fallback, impressions table (`reco_*` events), per-slot pin/exclude. Client click tracking is the generic `data-track` hook only.

## Built 2026-11-26: Similar options, product pairs, workshop fitting, measurement (personalisation phase 3; migrations 0102, 0103)

Design and details: `docs/superpowers/specs/2026-11-25-shopping-personalisation-design.md` § "As built".

- **Slot `similar`** on `GET /v1/recommendations` (first slug only, at most `RECO_SIMILAR_MAX` = 8): same category,
  shared size (`product_variants.size_compact` or the spec size), same `saeGrade` / `capacityAh` when set, a common
  vehicle segment when the product has segments, another brand, visible, buyable in the city. Reason
  `{ source: 'similar', size }`. Product page section "Similar options" replaces "More in <category>" when non-empty.
- **Rules:** `recommendation_rules` gains `trigger_product_id`, `suggest_kind` (`category` | `product` |
  `workshop_fitting`), `suggest_product_id`; both category columns nullable; CHECKs `recommendation_rules_one_trigger`,
  `_suggest_shape`, `_suggest_kind_valid`, `_distinct_product`; unique index on coalesced trigger + kind + suggestion.
  The input keeps the old category shape valid. The product slot answers `fitting: { label } | null` (first active
  fitting rule by priority); the page shows one link to `/workshops`.
- **Admin:** kind choices and a product picker (`GET /v1/admin/recommendation-products?q=`, `categories:write`); audit
  rows name trigger, kind and suggestion by slug.
- **Defaults:** migration `0103_personalisation_default_pairs` (data only, by slug, idempotent).
- **Measurement:** `reco_impression` / `reco_click` (spec 12) from the lazy tracker; `recoFunnel` joins add-to-cart and
  orders to clicks by session and slug; `GET /v1/admin/analytics/reco-funnel?days=` (`analytics:read`, all-city scope
  only: client events carry no city).
- **Still not built:** checkout and order-confirmation slots, fitment source, bundles, best-sellers fallback, per-slot
  pin/exclude, co-view.
