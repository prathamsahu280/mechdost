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

## catalogue-v2 import (2026-11-22)

Source: `autoparts/catalogue-v2/site` (`data/{lub,bat,car,tyr,flt}.json`, `data/img.json`, `img/*.webp`). Scope (user 2026-11-22): products of the price-list brands only (default `--brands castrol,gulf,exide,tata-green,kelvinn,cerafence,elvi`), own picture (no `r`), picture bytes present AND decodable (otherwise skipped, listed as `no_picture_bytes`), all packs; MRP where present, else none ("price on request"). Expected default run: **219 products, 740 packs, 695 with MRP** (Castrol 82, Gulf 72, KELVINN 32, Exide 17, Tata Green 15, CERAFENCE 1). Other brands later: `--brands castrol,motul,...`, no code change.

1. Apply migration 0079 first (`pnpm db:migrate`); a dry run before that works but reports `migrationApplied: false`.
2. Price lists: `python -I packages/db/scripts/extract-price-lists.py --dir <Downloads> --out price-lists.json` (PDFs and the xlsx are untrusted data; read only). Gulf, Exide, Tata Green, KELVINN and the Lube order form are read; the Castrol list is image-only (catalogue-v2 already holds all Castrol MRPs). Fills happen only on exact brand + product + pack matches, and never overwrite an MRP; each is reported with file and page.
3. Dry run (no write, no upload): `pnpm db:import:catalogue --dir <site> --dry-run --price-lists price-lists.json`. It writes `docs/catalogue/catalogue-v2-import-status.csv` (one row for every product of catalogue-v2: section, brand, range, product, packs, packs with MRP, MRP filled from price list, status `imported|updated|unchanged|skipped`, reason, detail, slug) and `.md` (counts), and prints the JSON report (`--report file`).
4. Real run: add `--staff-user <uuid>` (or `IMPORT_STAFF_USER_ID`); writes categories (sub-categories with en + hi names), brands, ranges, products (live; `hindi_machine` = true), packs, then photos (sharp variants, LQIP, EXIF stripped, private Storage; `--concurrency` 1-6, default 3; resumable: re-run uploads only products without a photo; `--skip-photos`, `--photos-only`), then Raipur admin price = MRP where the admin-price rule allows (it needs a shop that already sells the pack; none do, so they are counted as skipped; the import never creates shop offers). Records the run for Admin → Catalogue → Import status.
5. Re-running changes nothing that is unchanged; texts of products staff edited are never overwritten. Hindi: names/sub-categories/highlights come from a glossary (`catalogue-v2/glossary.ts`), descriptions only from `--translations file.json` (`{english: hindi}`; `--export-untranslated out.json` lists what is missing). Keep `catalogue.require_hindi_to_publish` off until the Hindi is reviewed.
6. The CLI is in `apps/api/src/cli/import-catalogue.ts` (it needs sharp and the Storage client).

### Re-applying the reviewed Hindi (2026-11-22)

`docs/catalogue/catalogue-v2-translations-hi.json` is a flat `{ "English text": "Hindi text" }` map. It now covers the 219 product names, range names, highlight values ("Non Aerosol", "Others", fitment "2-WHEELER") and the descriptions. Only brand, series, standard and unit names stay in Latin script (`packages/shared/src/catalogue-hindi.ts`); a unit test and the importer both check this, and a real run stops while any Hindi text still holds an English word.

To apply it to the products already in the database (texts only, no photos, nothing created or deleted; products staff edited keep their texts; a range keeps an admin's Hindi name):

```
pnpm --filter @mechdost/api import:catalogue --dir <catalogue-v2/site> --price-lists docs/catalogue/catalogue-v2-price-lists.json --translations docs/catalogue/catalogue-v2-translations-hi.json --skip-photos --staff-user <super_admin uuid>
```

Run it with `--dry-run` first: it lists the products it would update and prints `hindiLeftovers: 0` when every Hindi text passes. Add a translation by adding a key (the exact English name, value or description) to the JSON; a missing key falls back to the glossary.

## Exide import (exidecare scrape)

User, 2026-11-23: "Remove existing Exide batteries/products already listed and list the new ones with the proper info and exact model names ... we need exact part names, not generic names", then "list all the products from exide".

Source (read-only, outside the repo): `autoparts/exide_batteries/` with `exide_batteries.csv` (211 rows), `exide_vehicle_fitment.csv` (4,290 rows) and `pictures/…` (one file per row; the three combos list two, the first is used). `exide_vehicles.csv` is not read (it only lists vehicles; the fitment rows already carry make, model and fuel).

Command: `pnpm db:import:exide --dir <exide_batteries> [--plan-only | --dry-run] [--skip-photos] [--staff-user <uuid>] [--concurrency 1-6] [--status-dir <dir>]`

1. `--plan-only` needs no database: it plans from the files, checks the Hindi (a leftover English word stops a real run) and writes `docs/catalogue/exide-import-status.{md,csv}` (every source row: product type, range, model, name, slug, SKU, category, MRP or empty = price on request, warranty months, fitment count, picture, `photo_kind`).
2. `--dry-run` also reads the database and prints what a real run would create, update and archive (and writes `exide-import-archived.csv`). Writes nothing.
3. Real run (`--staff-user` or `IMPORT_STAFF_USER_ID`; `ALLOW_PROD_IMPORT=yes` under `NODE_ENV=production`): ONE transaction (advisory lock): (a) every existing product of brand `exide` that is not in the plan is ARCHIVED (conditional update on `version`, its packs archived, an audit row each); never deleted, because old orders and carts point at them; shop offers on them stay but are invisible. Other brands (for example `tata-green`) are never touched. (b) Each planned product is created, or updated in place when its SKU or slug already exists (an old catalogue-v2 row of the same slug is replaced: its old packs are archived, its MRP is replaced by the source MRP, it goes live). (c) An import run is recorded (audit `catalogue.v2_import_run`, event `admin_exide_imported`). Then the pictures go through the catalogue-v2 pipeline (sharp variants, LQIP, EXIF stripped, private Storage, bounded concurrency); a picture is skipped when the product already has one with the same source URL or the same content hash (resumable: re-run with the same command), and an old picture of a replaced product stays behind the new one. Pictures are per product (the range-photo files are separate copies; sharing one stored file between products would let one removal break another).
4. A re-run changes nothing. A product this importer made earlier that staff edited since (`hindi_machine = false`) keeps its texts; an MRP is only filled where the pack has none.

What a product becomes:

- **Exact names**: "Exide <Range> <MODEL>" with the model verbatim ("Exide Mileage ML55D23L", "Exide Xplore 12XL2.5L-C"); the combos are "Exide <model>" (their range is "Exide Home Inverter + Battery Combo"). Slug = the name slugified (unique across all 211; the two `IT900` rows of different ranges get distinct slugs and SKUs). One pack: SKU `EXIDE-<MODEL>`, options `{model}`, MRP incl. GST in paise (empty source MRP = price on request: the 3 combos), weight, net quantity 1 piece. Part number kind `mfr` = the model code.
- **Ranges** under brand `exide` (30 of them, so the admin can hide a range).
- **Categories**: vehicle batteries use the existing catalogue-v2 sub-categories under `batteries` (car-suv, cv (also special vehicle), two-wheeler, three-wheeler, tractor, genset). Inverter batteries, home UPS inverters, combos and the lithium-ion pack go into the NEW top-level category `home-power` ("Inverters & home UPS" / "इन्वर्टर और होम UPS"), created by the import and editable by the admin.
- **HSN and GST** (assumption, accountant to confirm): batteries 8507, inverters / home UPS / combos 8504, all 18 % (1800 bp).
- **Vehicle types**: two-wheeler 2W, three-wheeler 3W, car/SUV/MUV 4W; truck and bus, special vehicle, tractor, genset and home power have none (the CHECK allows only 2W/3W/4W).
- **spec** (typed, no empty values): `source: 'exidecare'`, `sourceUrl`, `pictureUrl`, `pictureType`, `photoKind` (`model` or `range`), `capacityAh`, `capacityRating`, `lengthMm`, `widthMm`, `heightMm` (a source 0 is dropped), `weightKg`, `terminalLayout`, `ccaEn`, `ccaSae`, `electrolyteL`, `chargingCurrentA`, `acidLevelIndicator` (`present|not_present|not_applicable`), `inverterType`, `inverterRating`, `inverterVa`, `acInput`, `voltage`, `batteryType` (`agm`, `lithium`), `warrantyMonths` (under 12, such as the source's "7 MONTH", is treated as a data fault and dropped), `freeReplacementMonths` + `proRataMonths` (only where they add up to the warranty), `otherSpecs` (the source's key/value rows, cleaned), `fitment`.
- **Texts**: `specSummary` (capacity or rating, warranty, terminal or size), up to 8 `highlights` (same count in Hindi), a description (features, specifications, Exide's warranty note). Hindi is real Hindi from templates and a reviewed dictionary of the 44 feature lines (`packages/db/src/exide/hindi.ts`); brand, range, model and vehicle names stay Latin; `hindi_machine = true`. A feature line with no dictionary entry is left out of both languages and fails the unit test.
- **Fitment**: the full list is in `spec.fitment` as `{type, make, model, fuel, yearFrom, yearTo, era}` (types `car_suv_muv|lcv_hcv|tractor|two_wheeler|three_wheeler|genset`; fuel `diesel|petrol|cng|lpg|ev|electric_start|kick_start|null`), sorted, de-duplicated, make and model as Exide writes them (the public product API leaves `spec.fitment` out of the page payload). `compatibility` / `compatibility_hi` (searchable) list the first 40 as "Make Model (Diesel, BS VI, 2020 onwards)" and "and N more" / "और N अन्य". Hindi words: डीज़ल, पेट्रोल, सेल्फ़ स्टार्ट, किक स्टार्ट; "नया मॉडल", "पुराना मॉडल", "फ़ेसलिफ़्ट"; "2020 से".
- **Model year / era**: Exide's site gives no year; the fitment CSV has the column "Model year / era (from the name)" (filled on 403 rows). Mapping: BS II 2005-2010, BS III 2010-2017, BS IV 2017-2020 (era `bs2|bs3|bs4`), BS VI 2020-open (`bs6`), "2023 onwards" 2023-open, "2022 model" 2022-2022, NEW / OLD / Facelift keep the years null and set era `new|old|facelift`; an unknown value is era null (never an error). A year written in the model text ("CRETA -2023 ONWARDS") is stripped from the shown model name and fills `yearFrom` / `yearTo` only where the column is empty. The shape is ready for years filled in later from another source: write `yearFrom` / `yearTo` (numbers, `yearTo` null = onwards) into the same `spec.fitment` entries; nothing else reads them yet.
- **Pictures**: all 211 are imported. 49 rows have only Exide's range photo (the same picture for every model of a range): they are live with `spec.photoKind = 'range'` and listed in the status report so the admin can replace the picture.
- **Not done on purpose (next step)**: nothing is written to `fitments` / the vehicle tables: their constraints do not fit this data (no years for most rows, kick/electric start, trucks, tractors, gensets). When "find the battery for my vehicle" is built, read `spec.fitment` (or map it into `vehicle_variants`).
- Words added to the Hindi allowlist (`packages/shared/src/catalogue-hindi.ts`): the Exide range names (Inva, Invamaster, Invatubular, Zen, Magic, Star, Powerbox, Nexcharge, Genplus, Gqp, Imtt) and the acronyms DSP, LED, LCD, ASIC, DOD, KVA, MUV, HCV. Vehicle makes and models are allowed in Latin script in the importer's own check only.
