# Adding products: form and CSV import

Built 2026-11-14 (plan `docs/superpowers/plans/2026-11-14-real-api-launch.md`, Stream B; specs 02 and 08). The
production database starts with categories but **no products or brands**; staff add them here.

## Where

Admin → Catalogue (real sign-in only) → **Add product** (one product with its first pack) or **Import CSV** (many).
Who: staff with `products:write` (form) or `products:import` (CSV) — today the `catalogue_manager` role and
`super_admin`. Ticking **Publish right away** also needs `products:publish`; otherwise products start as **drafts**
and are published from the product's page. A product shows on the storefront only when it is live **and** a shop
sells it with an approved price (spec 02).

## The import, step by step

1. Download the **column template** on the import screen (header row only), or start from
   `docs/runbooks/catalogue-import-sample.csv` (four sample rows; SKUs start with `SAMPLE-`, do not import them
   into production).
2. Fill one row per product. Save as **CSV UTF-8** (Excel: "CSV UTF-8 (Comma delimited)"), so Hindi survives.
3. **Check file**: a dry run. Nothing is written. You see how many products are ready and which SKUs are already in
   the catalogue (they are skipped), or a table of problems by row and column.
4. Fix the problems in the spreadsheet and check again. If **any** row has a problem, **nothing** is imported.
5. **Import N products**: every ready row is added in one transaction (all or nothing). Re-running the same file is
   safe: existing SKUs are reported as skipped, never duplicated.

Limits: 500 rows and 300,000 characters per file (split larger files); 30 checks or imports per person per hour.

## Columns

Header names are exact (lower case). Order does not matter; unknown or repeated columns refuse the file. Empty
optional cells are left out. Lists use `|` between items.

| Column             | Required | What to put                                                                                  |
| ------------------ | -------- | -------------------------------------------------------------------------------------------- |
| `category`         | yes      | Category code (slug), e.g. `lubricants`, `batteries`, `tyres`, `filters`, `spare-parts`.     |
| `brand`            | yes      | Brand name as shown, e.g. `Castrol`. A new brand is created on the way (audited).            |
| `name`             | yes      | English name, 3–160 characters.                                                              |
| `name_hi`          |          | Hindi name (brand and model names stay in Latin script).                                     |
| `slug`             |          | Web address: lower-case letters, digits, hyphens. Empty = made from brand + name.            |
| `spec_summary`     |          | Short spec line, up to 200 characters (`_hi` column for Hindi).                              |
| `compatibility`    |          | Which vehicles it fits, up to 300 characters (`_hi` column for Hindi).                       |
| `description`      |          | Up to 4,000 characters (`_hi` column for Hindi).                                             |
| `highlights`       |          | Up to 8, each up to 120 characters: `Sealed\|Maintenance free`.                              |
| `highlights_hi`    |          | Hindi highlights: none, or exactly one per English highlight in the same order.              |
| `vehicle_types`    |          | `2W`, `3W`, `4W`, e.g. `2W\|3W`.                                                             |
| `attributes`       |          | Typed specifications for comparison, `key=value\|key=value` (list below).                    |
| `sku`              | yes      | Pack code, unique in the catalogue: letters, digits, `.`, `_`, `-` (stored in upper case).   |
| `mrp_rupees`       | yes      | MRP of the pack in rupees, e.g. `440` or `440.50` (stored as integer paise).                 |
| `hsn`              | yes      | HSN code, 4–8 digits.                                                                        |
| `gst_rate_percent` | yes      | GST slab: `0`, `5`, `12`, `18`, `28` or `40`.                                                |
| `net_qty`          |          | Net quantity of the pack, a whole number (with `net_unit`; used for the price per litre/kg). |
| `net_unit`         |          | `ml`, `g`, `piece` or `m`.                                                                   |

Attributes per category (`packages/shared/src/product-attributes.ts`; sub-categories use their parent's list):

- `lubricants`: `saeGrade` (`0W20` … `20W50`), `apiClass` (`SL`, `SN`, `CI4` …), `jasoClass` (`MA`, `MA1`, `MA2`,
  `MB`), `baseType` (`mineral`, `semi_synthetic`, `synthetic`).
- `batteries`: `voltage` (whole V, 2–48), `capacityAh` (0.5–300, one decimal), `batteryType` (`flooded`, `vrla`,
  `agm`, `lithium`), `freeReplacementMonths`, `proRataMonths` (0–120).
- `tyres`: `size` (e.g. `90/90-17`), `loadIndex` (20–150), `speedSymbol` (`J` … `Y`), `tubeless` (`yes`/`no`),
  `position` (`front`, `rear`, `both`).
- Other categories have no attributes yet (leave the column empty).

## Problem codes

`REQUIRED` (empty required cell) · `INVALID` (wrong format: rupees, per cent, HSN, SKU, slug, vehicle type) ·
`TOO_LONG` · `UNKNOWN_CATEGORY` · `ATTRIBUTE_UNKNOWN` (key not in the category's list) · `ATTRIBUTE_VALUE` ·
`SLUG_TAKEN` (another product has that web address: change the name or give a `slug`) · `SLUG_REPEATED` /
`SKU_REPEATED` (twice in the file) · `HIGHLIGHTS_HI_ALIGNED` · `NET_QUANTITY` · `HINDI_MISSING` (publishing while
setting `catalogue.require_hindi_to_publish` is on). File problems: `MALFORMED` (an unclosed quote), `EMPTY`,
`TOO_MANY_ROWS`, `HEADER` (missing/unknown columns listed).

## API (for scripts)

- `POST /v1/admin/catalogue/products` — JSON body: `categorySlug, brand, name, nameHi?, slug?, specSummary(Hi)?,
compatibility(Hi)?, description(Hi)?, highlights?, highlightsHi?, vehicleTypes?, attributes?, sku, mrpPaise,
hsn, gstRateBp, netQuantity?{qty,unit}, publish?`. 201 `{slug, sku, status, version}`; 409 `SKU_TAKEN` /
  `SLUG_TAKEN`; 422 with the problem code (`details.errors`); 400 `VALIDATION` for a malformed body.
- `POST /v1/admin/catalogue/import` — `{ csv, dryRun?, publish? }`. 200 `{dryRun, status, created:[{row, slug, sku}],
skipped:[{row, sku, reason:"SKU_EXISTS"}]}`; 422 `IMPORT_ROWS_INVALID` (`details.errors:[{row, field, code}]`,
  nothing written) or `IMPORT_FILE` (`details.reason`, `missing`, `unknown`); 429 over the hourly limit.

Every product is audited (`product.created`, plus `brand.created` for new brands) and emits
`admin_product_created`; each committed import emits `admin_catalogue_imported` (spec 12).
