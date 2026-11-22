# Real catalogue import, brand/range switches and smart search — design (2026-11-22)

User (2026-11-22): "these are all the price lists … only list the products which have pictures already for now and
have it properly categorized too like brand wise etc so admin can easily turn off a bunch of items all together if he
wants from admin portal and u can use the same mrp price for now but make sure its properly and nicely done and also
build the smart search too". Source: the folder the user pointed at, `Desktop/autoparts` — **use the latest
`catalogue-v2/site`** (user: "the v2 latest version"; README there). The seven price-list PDFs/XLSX in Downloads are
the MRP sources that catalogue-v2 was built from (each product carries `src`).

## Source data (catalogue-v2/site)

`data/{lub,bat,car,tyr,flt}.json` → `products[]`: `co` company, `b` brand, `k` category, `s` range/series, `n` name,
`d` description, `i` picture index into `data/img.json` (byte ranges inside `img/*.webp` packs: `[thumb, full]`),
`iu` picture source URL, `u` maker page, `src` data source, `r: 1` = **representative** picture (a similar product),
`v[]` = variants `[pack/model/size, MRP rupees incl. GST or "", specs "k: v; …"]`.

## Selection rule (user 2026-11-22: "only list the products which have pictures already" + "its fine even if the mrps are lacking as long as we have images, the admin can set the mrps also u can check the pdf files for the mrps")

Import every product that has **its own photo** (`r` absent), with **all** its variants, MRP or not. A pack without an
MRP is imported with **no MRP** ("price on request", not sellable) and the admin sets it later (Admin → Catalogue,
single and bulk edit). Before import, **re-check the seven price lists** (Downloads: Castrol `MRP 08-10-26.pdf`, Gulf
`Price List Circulation- 05.07.2026 - revised.pdf`, Exide `MRCP … 1stOctober26.pdf`, Tata Green `TGY_MRP 4W …` and
`TGY_MRP TT_HUPS …`, KELVINN `… 13th June-2026 ….pdf`, `Lube order Form … (E2).xlsx`) and fill MRPs that
catalogue-v2 missed (match on brand + product + pack; only exact matches, every fill listed in the report with its
source page). Counted 2026-11-22 (own photo):

| Section    | Products  | Packs     | Packs with MRP        | Brands                                                                     |
| ---------- | --------- | --------- | --------------------- | -------------------------------------------------------------------------- |
| Lubricants | 389       | 761       | 480                   | Motul 102, Castrol 82, Gulf 72, Valvoline 52, Savsol 47, ENEOS 25, SERVO 9 |
| Batteries  | 60        | 322       | 163                   | Amaron 20, Exide 17, Tata Green 15, Amara Raja 7, PowerZone 1              |
| Auto care  | 33        | 52        | 52                    | KELVINN 32, CERAFENCE 1                                                    |
| Tyres      | 891       | 5,441     | 0                     | BKT 422, MRF 240, Apollo 140, CEAT 83, Vredestein 6                        |
| Filters    | 859       | 920       | 0                     | Fleetguard 418, Leyparts 411, VALUEPARTS 30                                |
| **Total**  | **2,232** | **7,496** | **695** (+ PDF fills) | 22 brands                                                                  |

Left out: 1,154 products whose only picture is representative (Q209).

## What gets built

1. **Grouping the admin can switch off in bulk** (hard rule 8):
   - **Brands** get `hidden` + `hidden_reason` + `version` (audited, `brand_events` or audit_log): hiding a brand hides
     every product of that brand from the storefront, search, sitemap, recommendations, cart add and checkout
     (existing cart lines become "not available" like an unpublished product); unhiding restores them. Product
     `status` is **not** rewritten (switching back is lossless).
   - **Product ranges** (new `product_ranges`: brand + name/nameHi + slug + hidden + reason + version; products get
     `range_id`): e.g. "Castrol CRB", "Exide Premio", "Tata Green SLV". Same visibility rule as brands.
   - **Categories** already have `hidden` — reuse; the catalogue's categories map to existing top-level categories
     (Lubricants, Batteries, Accessories/Car care …) with **sub-categories** (`parent_id`) per source `k`
     (Diesel Engine Oils, Motorcycle Oil, Car/SUV Battery, Aerosol Sprays …), en + hi names.
   - Admin → Catalogue: a **Brands & ranges** screen (list with product counts, live counts, a switch per brand and per
     range with a reason code, confirm step showing "N products will be hidden"), plus **bulk select** on the
     product list (publish / unpublish selected, ≤ 500 per call, one audited batch).
   - One rule in one place: a single SQL predicate/view "product is visible" used by every storefront query (guard
     test greps for direct `status = 'live'` reads outside it).
2. **Import** — a repeatable script `pnpm db:import:catalogue --dir <catalogue-v2/site> [--dry-run]` (in
   `packages/db`, uses the existing repo functions, idempotent on SKU/slug: re-running updates MRP/texts, never
   duplicates; prints a report). Per product: brand, range, sub-category, name (Latin brand/model names stay Latin),
   Hindi name/description/spec lines (hard rule 10 — translated, marked `machine` for admin review), description,
   typed attributes where the category defines them (viscosity grade, Ah, voltage, warranty months, pack size →
   `net_qty`/`net_unit`), HSN + GST rate per section (defaults below), country India, vehicle types inferred
   (motorcycle oil → 2W, PCMO → 4W, CV/tractor → CV/agri, battery category), SKU = brand code + normalised pack
   code (stable), MRP paise = MRP rupees × 100 (integer) or **none** (schema allows a variant without MRP = not sellable,
   "price on request"; every price check treats missing MRP explicitly). Photo: the full-size webp from the pack → the existing
   upload pipeline (Supabase Storage, sharp variants, LQIP, EXIF stripped) as the product's primary photo; the source
   URL kept in an admin-only `photo_source` field. Status `live` (published) unless a check fails.
   - HSN/GST defaults (ruling, Q210): lubricants 2710 · 18 %; lead-acid batteries 8507 · 18 %; Li-ion 8507 · 18 %;
     polishes/waxes 3405 · 18 %; cleaners/shampoos 3402 · 18 %; paints 3208 · 18 %; aerosols/greases 3403 · 18 %;
     tools/cloths 8205/6307 · 18 % — admin-editable per product.
3. **Price** (user: "use the same MRP price for now"): MRP shown on card and product page; **admin city price for
   Raipur = MRP** for every imported pack (the existing admin-price rule needs a shop with an approved price ≤ it to be
   sellable; until a shop stocks the pack it shows "price on request" with the MRP — we never invent shop prices,
   Q208).
   - Admin MRP editing: bulk "set MRP" for selected packs and a "Missing MRP" filter (count per brand).
4. **Smart search** (spec 02; Postgres now, Meilisearch later behind the same API):
   - Query understanding before SQL: viscosity grades in any spelling (`20w40`, `20 w 40`, `20W-40`) → normalised
     token matched against the viscosity attribute; pack sizes (`900ml`, `1 ltr`, `1l`, `5 litre`) → net quantity;
     battery capacity (`35ah`, `35 ah`) and models/part numbers (exact, normalised); vehicle intent (`bike`, `scooter`,
     `car`, `truck`, `tractor`, `e-rickshaw`, Hindi `बाइक`, `गाड़ी`) → vehicle-type boost; category intent (`engine
oil`, `mobil` → engine oils, `coolant`, `grease`, `battery`/`baitri`/`बैटरी`, `polish`, `shampoo`).
   - **Synonyms table** (admin-editable, en/hi/Hinglish: `tel`→oil, `mobil oil`→engine oil, `baitri`→battery,
     `gaadi`→car …), seeded; typo tolerance via trigram on brand/range/name; ranking = text rank + attribute matches
     - vehicle/category intent boost + in-stock/live; hidden brands/ranges never returned.
   - **Suggestions while typing**: `GET /v1/search/suggest?q=` → top brands, ranges, categories and products (≤ 8),
     cached 60 s, rate-limited; the header search shows them (keyboard navigable combobox, en/hi, lazy-loaded — no
     first-load JS on `/`, `/shop`, `/cart`; budget).
   - "Did you mean" for zero results (closest brand/range/category by trigram) and a zero-result event for analytics.
   - Demo mode: the same query understanding runs on the demo catalogue (shared module), so search behaves the same.

## Rulings (defaults while the user decides)

- R1 Selection = own photo (above); MRP optional (admin sets it); representative-picture products wait (Q209).
- R2 Imported products go live immediately (the user asked to put them on the site); Hindi text is machine-made and
  flagged for review in Admin.
- R3 Existing demo/seed products stay in the database untouched until the user says (Q211); the import never deletes.
- R4 Photo licensing: many photos come from maker sites, some from marketplaces (Flipkart/Amazon/IndiaMART); we keep
  the source per photo (admin-only) and queue the question (Q212).

## Acceptance

Dry run reports 2,232 products / 7,496 packs (≥ 695 with MRP, PDF fills listed) and zero errors; a second import changes nothing; every imported product has
a photo, brand, range, sub-category, HSN/GST and Hindi texts; hiding Castrol removes all 82 Castrol products from
shop/search/sitemap and blocks add-to-cart/checkout for them, unhiding restores them; hiding a range does the same
for its products only; all switches audited with reason; search finds "20w40 bike oil", "castrol 900ml", "exide
35ah", "baitri", "बैटरी", "tel" correctly; suggestions keyboard accessible; JS budget unchanged on `/`, `/shop`,
`/cart`; Hindi coverage crawl passes on the new pages and product data.
