# Product comparison: short design

User request (2026-11-13, decisions entry "Seller onboarding, price approval, buyer GSTIN, comparison", item 3): "compare different products like multiple engine oils, with cost and everything"; research it and propose extra features. The user said more detail may follow. Research: `docs/research/compare-gstin-onboarding.md` §1 (NN/g, Baymard, CarDekho, Flipkart, Legal Metrology).

## Intent

A rider choosing between three 2W engine oils, or two batteries, wants to see side by side what each costs, what it really costs per litre, whether it suits their vehicle, and how the specs differ. Today they open product pages one by one and remember. The comparison answers "which one should I buy?" and ends in "Add to cart".

**Goals:** same-category comparison of up to 4 products; price and **₹ per litre / per unit**; typed specs per category; "Only differences"; works on a phone; Hindi.
**Non-goals:** comparing across categories; comparing sellers of the same product (routing picks the shop); vehicle comparison (spec 17, later module).
**Anti-goals:** a "Best" badge we cannot back up (dark-pattern rules, 2027 consumer amendments); a tray that covers half the phone screen (Baymard: 51 % of the screen); rows full of "Not listed".

## What it does (MVP)

- **Add to compare:** a "Compare" toggle on each product card and on the product page. Same category only, at most 4, count visible. Adding a product from another category says "You can compare one category at a time" and offers "Start a new comparison" (replaces the list). Stored in the browser like the cart (no login needed).
- **Compare tray:** a small bar above the bottom tab bar (mobile) or bottom-right (desktop): "Compare (2)" with "Clear". Shown only when at least one product is picked. It opens the compare page.
- **Compare page `/compare?p=slug1,slug2,…`:** the URL holds the list, so it can be shared and opened on another phone. Server-rendered; prices for the shopper's PIN, like the catalogue.
  - Sticky top row per product: photo, name, brand, price, "Add to cart", "Remove".
  - Rows in groups: **Price** (price, MRP, **₹ per litre / kg / unit**, delivery days for the PIN) · **Fit** (vehicle types, compatibility) · **Specs** (category attributes, below) · **Warranty and origin** (warranty, country of origin) · **Ratings** (average, count).
  - **"Only differences"** hides rows where every product has the same value (a button with `aria-pressed`).
  - The lowest ₹ per unit is marked as a fact: "Lowest price per litre", never "Best".
  - A missing value shows "Not listed"; a row missing for every product is hidden.
  - Mobile: 2 columns visible, horizontal scroll-snap, the row label stays visible; semantic `<table>` with `<caption>` and `<th scope>`.
  - Empty or one product: one next action, "Add products from the shop".
- **Unit price:** each pack (variant, the SKU) carries a typed **net quantity** (whole number + unit: ml, g, piece, set, m). ₹ per litre / kg / unit is integer-paise maths, rounded half up to the paisa: `unitPaise = round(pricePaise × 1000 / ml)` for liquids (likewise g → kg). Legal Metrology rule 6(11) puts the unit price on packs; we show it online too. The same unit price also appears on the product card and page (extra 1).
- **Which pack is compared:** a product can have several packs. The table compares products, and each column's price, MRP and unit price all come from the **same pack**: the offer the catalogue already shows for that product and PIN (the read returns that pack's net quantity with its price). So ₹ per litre always matches the price beside it. Choosing another pack size on the compare page is a later extra.
- **Attributes per category (typed codes, rule 16), MVP for the three categories people compare most:**
  - **Engine oil:** SAE grade, API class, JASO class (MA / MA2 / MB), base type (mineral / semi-synthetic / synthetic).
  - **Battery:** voltage, capacity (Ah), type (flooded / VRLA / AGM / lithium), free-replacement months, pro-rata months.
  - **Tyre:** size, load index, speed symbol, tubeless, position (front / rear / both).
  - **Other categories** (brake pads, filters, bearings, spark plugs, accessories, tools, EV, and any category the admin adds later) can still be compared on the shared rows (price, unit price, fit, warranty, origin, ratings) and the free-text spec line, until definitions are added for them.
  - Labels and enum values in the locale files (English and Hindi); grades like 20W40, API SL, 12 V stay Latin (allowed on `/hi`).
- **Analytics (rule 9):** `compare_added`, `compare_removed`, `compare_opened` (count, category), `compare_differences_toggled`, and `add_to_cart` with `source: 'compare'`. Product slugs and category only, no personal data.
- **Admin control (rule 8):** the catalogue manager edits a product's attributes and each pack's net quantity in the admin product editor, validated per category (strict). **Trade-off:** the attribute _list_ per category lives in shared code, so a new attribute, or attributes for a category the admin creates, needs a code change; the admin controls the values. Admin-editable definitions are extra 9. Recorded in decisions on approval.
- **Demo:** the demo catalogue gets typed attributes for every product and two or three more 2W engine oils, so "compare engine oils" works in the demo (indicative data, English and Hindi).

## Approaches considered

1. **Typed attribute definitions in shared code; values in `products.spec` (recommended).** One definition list per category (key, type, unit, group, label key) used by validation, the admin editor and the compare table. Values in the existing `products.spec` jsonb, checked by a per-category schema on every write; net quantity as typed columns on `product_variants` (the pack is the SKU). Small, fast, typed for ML. Cost: adding a new attribute is a code change.
2. **Admin-editable attribute tables** (`attribute_definitions` with Hindi labels, `product_attribute_values`). Full admin control of the attribute list, but a new admin screen, Hindi label editing and more joins, for 9 categories that change rarely. Better later, when sellers submit products at scale.
3. **Compare only what exists today** (price, MRP, brand, the free-text spec line, highlights, warranty, rating). Ships fastest, but "Only differences" is meaningless on free text and ₹ per litre would come from parsing text. Fails the "cost and everything" request.

## Extras (from the research), proposed

- **With the MVP:**
  - Extra 1: ₹ per litre / unit on product cards and pages too.
- **P1, next (each its own small change):**
  - Extra 2: "Compare with similar" on the product page (up to 3 same-category products, same vehicle type).
  - Extra 3: share the comparison (the link already works; a WhatsApp share button on phones).
  - Extra 4: **Fits my vehicle.** When the shopper has a saved vehicle, a "Suits your Activa" row, and a warning when a JASO MB oil is compared for a motorcycle with a wet clutch.
  - Extra 5: **Popular comparisons** on category pages, chosen by the admin (rule 8).
  - Extra 6: attribute definitions for the other categories (brake pads, filters, bearings, spark plugs, …).
- **P2:**
  - Extra 7: cost per km for oils and tyres (drain interval, tread life) once the data exists.
  - Extra 8: "Lowest price in the last 30 days" (2027 consumer rules) once price history exists.
  - Extra 9: admin-editable attribute definitions (approach 2); saved comparisons on the account.

## Rules

- Read-only feature: no order or stock change; prices are re-checked at checkout as today.
- Performance: the budget gate measures every route and `/cart` is at 177 of 180 KB, so the tray mounts only on the shop, product and compare pages (never the root layout). The tray and the toggle are small client components with no Zod (L79). The plan runs `scripts/measure-js.mjs` after the UI task.
- Hindi crawl opens `/hi/compare` **with seeded products** (three oils), so attribute labels and enum values are really checked, not an empty page; every new namespace is listed in the page's `ClientMessages` (L88).
- The demo DB seed and `demo-seed-fixture.test.ts` carry the same attributes and net quantities as the demo catalogue.
- `add_to_cart.source` is optional, so events from older open tabs still pass.
- Prices and delivery per city and PIN, like the catalogue (rule 7).

## Tests

- Shared: attribute schemas accept valid values and reject unknown keys and wrong units per category; unit price maths (900 ml at ₹440 = ₹488.89 per litre).
- DB/API: writing a product spec checks it against its category; compare read returns up to 4 same-category products and refuses mixed categories or more than 4.
- e2e: add 3 engine oils from the shop, open the tray, see ₹ per litre and the "Lowest price per litre" mark, toggle "Only differences", add to cart from the table; a battery added to an oil comparison offers "Start a new comparison"; a shared link opens the same table; mobile layout; axe; Hindi.

## Left to the builder

The tray's placement around the cart button, the indicative demo oils, and whether the API compare read is a new endpoint or several product reads.
