# 21 · Product comparison

Shoppers compare up to 4 products of one category side by side: price, MRP, ₹ per litre / kg / unit, delivery, fit, typed specs, warranty, origin and ratings, with "Only differences".

- **Design:** `docs/superpowers/specs/2026-11-13-product-comparison-design.md`.
- **Decision:** 2026-11-13 "Product comparison: typed attributes in code" (user, Q80: option 1).
- **Plan:** `docs/superpowers/plans/2026-11-13-product-comparison.md`.
- **Research:** `docs/research/compare-gstin-onboarding.md` §1.

## Goal

A rider choosing between engine oils (or batteries, tyres) sees what each costs, what it costs per litre, what it suits and how the specs differ, then adds the right one to the cart.

## Flows

1. **Pick:** the "Compare" button on a product card (shop list and related products, not the home page) or on the product page. One category at a time, at most 4. Another category shows "You can compare one category at a time." with **Start a new comparison**; a fifth product shows "You can compare up to 4 products. Remove one first."
2. **Tray:** "Compare (n)" and "Clear" at the bottom left (above the tab bar on phones, clear of the assistant button); only on shop pages and only while something is picked.
3. **Compare page `/compare?p=a,b,c`:** server-rendered from the URL, so the link can be shared. The page:
   - keeps valid, distinct slugs, at most 4;
   - keeps only the first product's category and notes when anything was left out;
   - with fewer than 2 products, shows one action, "Add products from the shop".
4. **Table:** a real `<table>` with a caption, sticky product headers (name, price, Add to cart, Remove) and sticky row labels, in one scroll box. Two product columns fit a 390 px phone; more scroll sideways with snap.
   - **Row groups:**
     - Price: price, MRP, unit price, delivery days;
     - Fit: vehicle type, "Suits";
     - Specs: the category attributes;
     - Warranty and origin;
     - Ratings.
   - **Missing values:** a missing value shows "Not listed"; a row nobody has is dropped.
5. **Only differences:** a pressed button hides rows where every product has the same value.
6. **Lowest price per litre:** the lowest unit price is marked "Lowest price per litre" (or kg / piece / metre).
   - Ties are all marked.
   - There is no mark with fewer than two prices.
   - It is never "Best".

## Data

- **Attribute definitions (code):** `packages/shared/src/product-attributes.ts`, keyed by category slug. Each definition has a key, a kind, the allowed values or a range, a unit, a prefix, whether it is translated, and a group.
  - **lubricants:** SAE grade, API class, JASO class, base oil.
  - **batteries:** voltage, capacity (Ah), type, free-replacement months, pro-rata months.
  - **tyres:** size, load index, speed rating, tubeless, wheel position.
  - **Other categories:** the shared rows only.
  - **Subcategories:** use their parent's definitions (`attributeSetFor`).
- **Values:** `products.spec` (jsonb, CHECK `products_spec_object`).
  - **Writes are strict:** `validateAttributes` rejects unknown keys (`UNKNOWN_KEY`) and bad values (`BAD_VALUE`).
  - **Reads are tolerant:** `readAttributes` keeps valid, known values only.
- **Pack size:** `product_variants.net_qty` + `net_unit` (`ml`, `g`, `piece`, `m`).
  - **CHECKs:** both or neither; 1–1,000,000; a known unit (migration 0042).
  - **Same pack as the price:** the catalogue offer carries the net quantity of the very variant it prices (`offer.netQuantity`), so the unit price always matches the price beside it.
- **Unit price:** `unitPrice(pricePaise, pack)`. It is integer paise, rounded half up: `round(pricePaise × 1000 / qty)` per litre (ml) or per kg (g), and price ÷ qty per piece (only when qty > 1) or per metre. The same figure shows on product cards and the product page (Legal Metrology rule 6(11) puts it on packs).
- **Compare list (browser):** `localStorage` key `mechdost-compare` = `{ category, slugs }`. It is validated on read and kept in sync across tabs (`apps/web/src/lib/compare/store.ts`, Zod-free).
- **Demo:** typed attributes and pack sizes live in `apps/web/src/demo/product-specs.ts`. That file is server-only, so they never ship to the browser. The demo adds three 2W engine oils (Motul 3100 4T 10W30 1 L, Shell Advance AX7 10W30 1 L and HP Racer4 20W40 900 ml), as indicative data. The DB seed fixture carries the same data.

## API

- **`GET /v1/catalogue/products`:** each card's `offer.netQuantity`.
- **`GET /v1/catalogue/products/{slug}`:**
  - `attributeSet` (the category whose definitions apply, or null);
  - `attributes` (typed, only valid values);
  - `variants[].netQuantity` and `variants[].offer.netQuantity`.
- **`PUT /v1/admin/catalogue/products/{slug}/attributes`** (`products:write`):
  - body `{ version, attributes }`, strict;
  - replaces the set;
  - a value the category does not accept is **422 `ATTRIBUTES`**;
  - a stale version is 409 `STALE_PRODUCT`;
  - audited `product.attributes_updated`.
- **`PUT /v1/admin/catalogue/variants/{sku}/net-quantity`** (`products:write`):
  - body `{ netQuantity: { qty, unit } | null }`;
  - audited `variant.net_quantity_updated`.
- **Compare page reads:** in API data mode the compare page reads each product (up to 4 in parallel, cached like the product page); there is no separate compare endpoint.

## Rules

- Read-only: no order or stock changes; prices are re-checked at checkout as usual.
- Hindi everywhere: labels and translated values (`compare` namespace, `catalogue.unitPrice_*`). Grades, codes and units (20W40, API SL, JASO MA2, 12 V, 45 Ah, AGM, MRP) stay Latin.
- The fit row uses the type-level wording ("Bikes & scooters (2W)"), never "Fits your vehicle" (decision 2026-11-12).
- JS budget:
  - the islands (toggle, tray, "Only differences", remove) take their labels as props and ship no Zod and no i18n runtime;
  - the tray mounts only in the shop layout;
  - `/compare` is excluded from search engines (`noindex`).

## Analytics events

| Event                         | Props                              |
| ----------------------------- | ---------------------------------- |
| `compare_added`               | slug, category, count              |
| `compare_removed`             | slug, count                        |
| `compare_opened`              | count, category                    |
| `compare_differences_toggled` | on                                 |
| `add_to_cart`                 | gains optional `source: 'compare'` |

- **Clicks:** `compare_tray_open`, `compare_tray_clear`.
- No personal data in any of them.

## Acceptance tests

- **Shared, `product-attributes.test.ts`:**
  - unit price maths (900 ml at ₹440 = ₹488.89 per litre; half up; single piece has none);
  - strict and tolerant attribute checks;
  - the compare events.
- **DB, `product-compare.test.ts` and `demo-seed.test.ts`:**
  - the CHECKs;
  - `setProductAttributes` (valid, bad value, stale);
  - `setVariantNetQuantity`;
  - the offer carries its own pack (1 L in stock, 900 ml not);
  - product attributes and packs;
  - the seed writes them.
- **API, `admin-catalogue.test.ts`:** 200, 422, 403 and 409 on attributes; 400 on an unknown unit; the catalogue returns the pack and attributes.
- **Web unit:**
  - `compare-store.test.ts`: max 4, one category, start new, tampered storage, storage refused;
  - `compare-rows.test.ts`: lowest mark, ties, no price, same rows, dropped rows, slug parsing;
  - `catalogue-view.test.ts`;
  - `catalogue-api-source.test.ts`.
- **e2e, `compare.spec.ts`** (desktop and mobile):
  - three oils from the shop → tray → table with ₹ per litre and the lowest mark;
  - "Only differences" hides identical rows;
  - add to cart from the table;
  - another category → start a new comparison;
  - shared, mixed and bad links;
  - empty page;
  - remove updates the link;
  - axe WCAG 2.2 AA.
- **Hindi crawl:** `hindi-coverage.spec.ts` opens `/hi/compare` empty and with oils, batteries and tyres.

## P1/P2 extensions

- **P1:**
  - "Compare with similar" on the product page;
  - a WhatsApp share button;
  - a "Suits your vehicle" row and a JASO MA/MB wet-clutch warning, once vehicle fitment allows it;
  - popular comparisons chosen by the admin;
  - attribute definitions for brake pads, filters, bearings and spark plugs;
  - an admin editor screen for attributes and pack sizes (the API exists).
- **P2:**
  - cost per km;
  - "lowest price in the last 30 days";
  - saved comparisons;
  - admin-editable attribute definitions;
  - choosing another pack size in the table.
