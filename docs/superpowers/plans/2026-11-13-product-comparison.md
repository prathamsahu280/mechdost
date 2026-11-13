# Product comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shoppers compare up to 4 products of one category side by side (price, MRP, ₹ per litre / kg / unit, delivery, fit, typed specs, warranty, origin, ratings) with "Only differences", in demo and API data modes, English and Hindi.

**Architecture:** Attribute definitions per category live in a Zod-free shared module (validator + tolerant reader + unit-price maths) used by the DB repo, the API and the web. Values are stored in `products.spec`; each variant (pack) gets a typed net quantity. The web keeps the compare list in localStorage (own tiny store), renders `/compare?p=…` server-side from the existing catalogue sources, and uses two small client islands (toggle + tray, "Only differences").

**Tech Stack:** TypeScript, Drizzle + PGlite tests, Hono zod-openapi, Next.js 16 App Router, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-product-comparison-design.md` (decisions 2026-11-13 "Product comparison: typed attributes in code").

## Global Constraints

- Same category only, at most 4 products; the count is visible.
- Unit price: integer paise, rounded half up, `unitPaise = round(pricePaise × 1000 / qty)` for `ml` (per litre) and `g` (per kg); `piece` / `m` per piece / metre only when `qty > 1` or unit is `m`. Always from the same pack as the price shown.
- Wording: "Lowest price per litre" (fact), never "Best". Fit row keeps the type-level wording ("For two-wheelers"), never "Fits your vehicle".
- MVP attribute definitions: lubricants, batteries, tyres only; other categories compare on shared rows.
- Hindi everywhere (labels and translated enum values in the locale files); grades/codes/units stay Latin.
- JS budget 180 KB gz on every route; tray mounts only in the shop layout (shop list + product page), never the root layout; no Zod in client islands (L79).
- Analytics: `compare_added`, `compare_removed`, `compare_opened`, `compare_differences_toggled`; `add_to_cart.source` optional (`'compare'`). No personal data.
- Every new client namespace listed in the page's `ClientMessages` (L88). e2e with `--workers=1`.

## Review Focus

1. A shared link with a bad, unknown, duplicate or 5th slug, or mixed categories → the page still renders the valid same-category products (first slug's category) and says what was left out; never a 500.
2. A product without a buyable offer (no price) in the comparison → price rows show "Not listed", no unit price, no "Lowest" mark, no add-to-cart in that column.
3. Two products tie on the lowest unit price → both carry the mark.
4. Stored `products.spec` with an old or invalid value → the reader drops that value ("Not listed"), the page never crashes.
5. localStorage blocked (private mode) → toggle reports the failure like the cart (`save_failed`), tray absent, compare page from a shared link still works.

---

### Task 1: Shared attributes, unit price, analytics events

**Files:**

- Create: `packages/shared/src/product-attributes.ts` (Zod-free), `packages/shared/test/product-attributes.test.ts`
- Modify: `packages/shared/package.json` (export `"./product-attributes"`), `packages/shared/src/analytics.ts`

**Interfaces — Produces:**

- `NET_UNITS = ['ml','g','piece','m'] as const`; `type NetUnit`; `interface NetQuantity { qty: number; unit: NetUnit }`; `isNetQuantity(v: unknown): v is NetQuantity` (qty integer 1..1_000_000).
- `type UnitBasis = 'litre' | 'kg' | 'piece' | 'metre'`; `unitPrice(pricePaise: number, pack: NetQuantity | null): { paise: number; per: UnitBasis } | null`.
- `type AttrValue = string | number | boolean`; `interface AttributeDef { key: string; kind: 'enum' | 'int' | 'decimal' | 'text' | 'boolean'; values?: readonly string[]; min?: number; max?: number; pattern?: RegExp; unit?: 'V' | 'Ah' | 'months'; prefix?: 'API' | 'JASO'; translate?: boolean; group: 'specs' | 'warranty' }`.
- `ATTRIBUTE_DEFS: Readonly<Record<string, readonly AttributeDef[]>>` keyed by **category slug**:
  - `lubricants`: `saeGrade` enum `0W20 0W30 5W30 5W40 10W30 10W40 15W40 15W50 20W40 20W50`; `apiClass` enum `SG SJ SL SM SN SP CF4 CH4 CI4 CK4` (prefix API); `jasoClass` enum `MA MA1 MA2 MB` (prefix JASO); `baseType` enum `mineral semi_synthetic synthetic` (translate).
  - `batteries`: `voltage` int 2..48 unit V; `capacityAh` decimal 0.5..300 (one decimal) unit Ah; `batteryType` enum `flooded vrla agm lithium` (translate); `freeReplacementMonths` int 0..120 unit months (group warranty); `proRataMonths` int 0..120 unit months (group warranty).
  - `tyres`: `size` text pattern `/^[0-9][0-9./ R-]{2,18}$/`; `loadIndex` int 20..150; `speedSymbol` enum `J K L M N P Q R S T H V W Y`; `tubeless` boolean; `position` enum `front rear both` (translate).
- `attributeDefs(categorySlug: string): readonly AttributeDef[]` (empty for unknown).
- `validateAttributes(categorySlug: string, input: Record<string, unknown>): { ok: true; values: Record<string, AttrValue> } | { ok: false; key: string; code: 'UNKNOWN_KEY' | 'BAD_VALUE' }` — strict: unknown key or bad value fails; empty object always ok.
- `readAttributes(categorySlug: string, stored: unknown): Record<string, AttrValue>` — tolerant: keeps only valid known keys.
- Analytics: `compare_added {slug, category, count}`, `compare_removed {slug, count}`, `compare_opened {count, category}`, `compare_differences_toggled {on: boolean}`; `add_to_cart` gains `source: z.enum(['compare']).optional()`.

- [ ] **Step 1: Write failing tests** (`product-attributes.test.ts`):
  - `unitPrice(44_000, {qty: 900, unit: 'ml'})` → `{paise: 48_889, per: 'litre'}`; `unitPrice(52_000, {qty: 1000, unit: 'ml'})` → `{52_000,'litre'}`; `unitPrice(1, {qty: 2, unit: 'g'})` → `{paise: 500, per: 'kg'}` (half up); `unitPrice(100_000, {qty: 1, unit: 'piece'})` → `null`; `unitPrice(50_000, {qty: 5, unit: 'piece'})` → `{10_000,'piece'}`; `unitPrice(x, null)` → `null`.
  - `validateAttributes('lubricants', {saeGrade:'20W40', apiClass:'SL', jasoClass:'MA2', baseType:'mineral'})` ok; `{viscosity:'x'}` → `UNKNOWN_KEY` `viscosity`; `{saeGrade:'99W99'}` → `BAD_VALUE`; batteries `{capacityAh: 2.55}` → `BAD_VALUE`, `{capacityAh: 3}` ok; tyres `{tubeless:'yes'}` → `BAD_VALUE`; `validateAttributes('bearings', {a:1})` → `UNKNOWN_KEY`; `validateAttributes('bearings', {})` ok.
  - `readAttributes('lubricants', {saeGrade:'20W40', apiClass:'XX', junk:1})` → `{saeGrade:'20W40'}`; `readAttributes('tyres', null)` → `{}`; `readAttributes('tyres', [1])` → `{}`.
  - analytics: `add_to_cart` parses with and without `source`.
- [ ] **Step 2:** `pnpm --filter @mechdost/shared test product-attributes` → FAIL (module missing).
- [ ] **Step 3:** Implement as specified above.
- [ ] **Step 4:** `pnpm --filter @mechdost/shared test` → PASS.
- [ ] **Step 5:** Commit `feat(shared): product attributes, unit price, compare events`.

### Task 2: Database — net quantity, spec check, repos, demo seed

**Files:**

- Create: `packages/db/drizzle/0042_product_compare.sql` (via drizzle-kit, named), `packages/db/test/product-compare.test.ts`
- Modify: `packages/db/src/schema/catalogue.ts` (variants `netQty integer`, `netUnit text`), `packages/db/src/repo/catalogue.ts` (offer + product variants carry `netQuantity`), `packages/db/src/repo/catalogue-admin.ts`, `packages/db/src/demo-seed.ts`

**Interfaces:**

- Consumes: Task 1 `validateAttributes`, `isNetQuantity`, `NET_UNITS`, `NetQuantity`.
- Produces: `CatalogueOffer.netQuantity: NetQuantity | null` (from the **same variant** the lateral picked; `offerLateral` selects `v.net_qty, v.net_unit`); `CatalogueVariant.netQuantity: NetQuantity | null`;
  `setProductAttributes(db, {slug, expectedVersion, attributes: Record<string, unknown>, staffUserId}): Promise<{version: number; attributes: Record<string, AttrValue>}>` (ValidationError code `ATTRIBUTES` with the failing key in the message; ConflictError `STALE_PRODUCT`; audit `product.attributes_updated` before/after);
  `setVariantNetQuantity(db, {sku, netQuantity: NetQuantity | null, staffUserId}): Promise<{sku: string; netQuantity: NetQuantity | null}>` (NotFoundError for unknown sku; audit `variant.net_quantity_updated`);
  `DemoFixture.products[]` gains `attributes?: Record<string, AttrValue>` and `netQuantity?: NetQuantity` (seeded into `products.spec` and the variant).
- Migration: `SET lock_timeout = '5s'`; variants CHECKs `product_variants_net_pair` ((net_qty is null) = (net_unit is null)), `product_variants_net_qty_range` (net_qty between 1 and 1000000), `product_variants_net_unit_valid` (net_unit in ('ml','g','piece','m')); products CHECK `products_spec_object` (`jsonb_typeof(spec) = 'object'`) added `NOT VALID` then `VALIDATE`.

- [ ] **Step 1: Failing tests** (`product-compare.test.ts`, `createTestDb()`): CHECKs refuse `net_unit='l'`, qty without unit, `qty=0`, `spec='[]'`; `setProductAttributes` saves valid oil attributes and bumps version, refuses `{saeGrade:'99W99'}` (ValidationError), refuses stale version (ConflictError); `setVariantNetQuantity` sets and clears; `listCatalogue` with a PIN returns `offer.netQuantity` of the offered variant (two variants 900 ml / 1000 ml, only the 1000 ml one stocked → `{qty:1000,unit:'ml'}`); `getCatalogueProduct` variants carry `netQuantity`; demo seed writes attributes + net quantity.
- [ ] **Step 2:** `pnpm --filter @mechdost/db test product-compare` → FAIL.
- [ ] **Step 3:** Schema + `pnpm --filter @mechdost/db exec drizzle-kit generate --name=product_compare`, run the fix script, hand-edit to the safe form above; repo functions as specified.
- [ ] **Step 4:** `pnpm --filter @mechdost/db test` → PASS (all files).
- [ ] **Step 5:** Commit `feat(db): net quantity per pack and typed product attributes`. Apply to dev with `pnpm db:migrate` (dev only) and run Supabase `get_advisors`.

### Task 3: API — catalogue DTO and admin routes

**Files:**

- Modify: `packages/shared/src/catalogue.ts` (`CatalogueOfferSchema.netQuantity`, variant `netQuantity`, both `{qty:int, unit:enum(NET_UNITS)}.nullable()`), `apps/api/src/routes/admin-catalogue.ts`, `apps/api/test/admin-catalogue.test.ts`, `apps/api/test/catalogue.test.ts`

**Interfaces:**

- Consumes: Task 2 repo functions.
- Produces: `PUT /v1/admin/catalogue/products/{slug}/attributes` body `{version, attributes: record}` strict → 200 `{version, attributes}`; 400 `VALIDATION`/`ATTRIBUTES`; 409 `STALE_PRODUCT`. `PUT /v1/admin/catalogue/variants/{sku}/net-quantity` body `{netQuantity: {qty, unit} | null}` strict → 200. Both behind `products:write` (existing prefix middleware covers `/admin/catalogue/*`). Catalogue card/product responses carry `netQuantity`.

- [ ] **Step 1: Failing tests:** attributes PUT 200 for catalogue_manager, 400 for `{saeGrade:'99W99'}`, 403 for a role without `products:write`, 409 stale; net-quantity PUT 200 and 400 for `unit:'l'`; `GET /v1/catalogue/products?pincode=…` card offer has `netQuantity`.
- [ ] **Step 2:** `pnpm --filter @mechdost/api test admin-catalogue catalogue` → FAIL.
- [ ] **Step 3:** Routes in the existing `vehicleTypes` pattern (OpenAPI names `AdminProductAttributes`, `AdminVariantNetQuantity`).
- [ ] **Step 4:** `pnpm --filter @mechdost/api test` → PASS.
- [ ] **Step 5:** Commit `feat(api): admin product attributes and pack net quantity`.

### Task 4: Web data — demo attributes, more oils, views

**Files:**

- Modify: `apps/web/src/demo/catalogue.ts` (`DemoProduct.attributes?`, `netQuantity?`; values for every lubricant, battery and tyre; `netQuantity` on every product where a pack size is known; **3 new 2W oils**: `motul-3100-4t-10w30-1l` (Motul 3100 4T 10W30 1 L, semi-synthetic, API SM, JASO MA2, ₹520 / MRP ₹560), `shell-advance-ax7-10w30-1l` (Shell Advance AX7 10W30 1 L, semi-synthetic, API SM, JASO MA2, ₹470 / ₹499), `hp-racer4-20w40-900ml` (HP Racer4 20W40 900 ml, mineral, API SL, JASO MA2, ₹330 / ₹350); fits `2W`, in stock, lead 1 day; indicative), `apps/web/src/demo/i18n/hi.ts` (Hindi for the 3 oils), `apps/web/src/lib/catalogue/view.ts`, `demo-source.ts`, `api-source.ts`, `packages/db/seed/raipur-demo.json` (regenerated), `apps/web/test/catalogue-view.test.ts`, `apps/web/test/demo-seed-fixture.test.ts`
- Check: any e2e asserting demo product counts or category lists still passes (grep `apps/web/e2e`).

**Interfaces:**

- Produces: `CardView.pack: NetQuantity | null` (demo: `netQuantity`; API: `offer.netQuantity`); `ProductView.attributes: Record<string, AttrValue>` (demo: `attributes`; API: `readAttributes(category.slug, p.spec)`); `ProductView.warranty: string | null` (API `warranty`; demo `null`).

- [ ] **Step 1: Failing tests:** `catalogue-view.test.ts`: demo card for Castrol has `pack {900,'ml'}`; demo product has `attributes.saeGrade === '20W40'`; `apiCard` maps `offer.netQuantity`; `apiProduct` drops an invalid stored attribute. Fixture test: regenerated fixture matches (run with `UPDATE_DEMO_SEED=1` once after the data change, then without).
- [ ] **Step 2:** `pnpm --filter @mechdost/web exec vitest run test/catalogue-view.test.ts` → FAIL.
- [ ] **Step 3:** Implement; regenerate the fixture.
- [ ] **Step 4:** `pnpm --filter @mechdost/web test` → PASS.
- [ ] **Step 5:** Commit `feat(web): demo attributes and pack sizes for comparison`.

### Task 5: Web — compare store, toggle, tray, unit price on cards

**Files:**

- Create: `apps/web/src/lib/compare/store.ts` (no imports from `@/demo/store`; no Zod), `apps/web/src/components/catalogue/compare-toggle.tsx`, `apps/web/src/components/catalogue/compare-tray.tsx`, `apps/web/src/components/catalogue/unit-price.tsx` (server), `apps/web/test/compare-store.test.ts`
- Modify: `product-card.tsx` (prop `compare?: boolean`, default `true`; home `product-range.tsx` passes `false`), `shop/[slug]/page.tsx` (toggle + unit price under the price), `shop/layout.tsx` (mounts `CompareTray`), `add-to-cart-button.tsx` (prop `source?: 'compare'` → `track('add_to_cart', {slug, qty, source})`), `packages/shared/src/i18n/en.json` + `hi.json` (`compare` namespace: toggle/tray/page strings, `attr.<key>`, `value.<key>.<value>`; `catalogue.unitPrice_litre|kg|piece|metre`)

**Interfaces:**

- Produces: `COMPARE_MAX = 4`; key `mechdost-compare` storing `{category: string, slugs: string[]}`; `addToCompare(slug, category): 'added' | 'full' | 'other_category' | 'save_failed'`; `startNewComparison(slug, category): 'added' | 'save_failed'`; `removeFromCompare(slug): void`; `clearCompare(): void`; `useCompare(): {category: string | null; slugs: readonly string[]}` (useSyncExternalStore, server snapshot empty); `compareHref(slugs): string` → `/compare?p=a,b`.
- Toggle: labels via props (no i18n runtime); pressed state `aria-pressed`; `other_category` shows an inline message with a "Start a new comparison" button; announces via `aria-live`. Fires `compare_added` / `compare_removed`.
- Tray: hidden when empty; "Compare ({count})" link + "Clear"; on mobile sits above the bottom tab bar and must not cover the assistant launcher or the add-to-cart button (check at 390 px).

- [ ] **Step 1: Failing tests** (`compare-store.test.ts`, jsdom): add 4 lubricants → 5th `full`; battery after oil → `other_category`, list unchanged; `startNewComparison` replaces; remove/clear; duplicate add is idempotent; storage throwing → `save_failed`; `compareHref(['a','b'])` = `/compare?p=a,b`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement store, toggle, tray, unit price. **Step 4:** `pnpm --filter @mechdost/web test` → PASS; `pnpm --filter @mechdost/web typecheck`.
- [ ] **Step 5:** Commit `feat(web): compare toggle, tray and unit price`.

### Task 6: Web — compare page

**Files:**

- Create: `apps/web/src/lib/compare/rows.ts`, `apps/web/test/compare-rows.test.ts`, `apps/web/src/app/[locale]/compare/page.tsx`, `apps/web/src/components/catalogue/compare-table.tsx` (server), `apps/web/src/components/catalogue/differences-toggle.tsx` (client), `apps/web/src/components/catalogue/compare-remove.tsx` (client), `apps/web/e2e/compare.spec.ts`
- Modify: `apps/web/e2e/hindi-coverage.spec.ts` (visit `/hi/compare?p=` three oils), sitemap/robots if pages are listed there (`noindex` for `/compare`), axe suite if pages are listed

**Interfaces:**

- Consumes: `ProductView` (Task 4), `unitPrice`, `attributeDefs`, store (Task 5).
- Produces: `parseCompareParam(p: string | undefined): string[]` (split on `,`, trim, slug regex, dedupe, first 4); `buildCompareRows(items: CompareItem[]): CompareGroup[]` where `CompareItem = ProductView`, `CompareGroup = {key: 'price'|'fit'|'specs'|'warranty'|'ratings'; rows: CompareRow[]}`, `CompareRow = {key: string; cells: (CellValue | null)[]; same: boolean; lowestIdx?: number[]}`; rows where every cell is null are dropped.
- Page: loads products (demo `findProduct`, API `fetchCatalogueProduct` in parallel); keeps those in the first product's category; lists dropped slugs in a note; `<table>` with `<caption>`, `<th scope="col">` per product (sticky), `<th scope="row">` labels (sticky left); 2 columns visible at 390 px with scroll-snap; "Only differences" button `aria-pressed` toggling a `data-diff-only` attribute (CSS hides `tr[data-same]`); remove button updates URL (`router.replace`) and store; empty or one product → one action "Add products from the shop" link; `compare_opened` fired once by the differences-toggle island on mount; metadata `robots: noindex`. Namespaces in `ClientMessages`: none needed if islands take labels as props — state it in a comment.

- [ ] **Step 1: Failing unit tests** (`compare-rows.test.ts`): three oils → `unitPrice` row with `lowestIdx` the cheapest per litre; tie → both indices; product without price → null cells and excluded from lowest; `saeGrade` row `same: false`, `vehicleTypes` row `same: true`; all-null row dropped; `parseCompareParam('a,a,B!,b,c,d,e')` → `['a','b','c','d']`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement rows + page + islands. **Step 4:** unit tests PASS.
- [ ] **Step 5: e2e** (`compare.spec.ts`, desktop + mobile projects): add 3 engine oils from `/shop?category=lubricants`, tray shows "Compare (3)", open → table with ₹ per litre and "Lowest price per litre" on HP Racer4 (₹366.67/litre); "Only differences" hides "For two-wheelers" row; add to cart from the table; battery toggle on a product page with oils listed → "Start a new comparison" replaces the list; shared link `/compare?p=…` in a fresh context shows the same table; mixed-category link shows the note; axe clean. Run `pnpm --filter @mechdost/web exec playwright test compare hindi-coverage --workers=1` → PASS.
- [ ] **Step 6:** Budget: build and `node scripts/measure-js.mjs http://localhost:3101` → every route ≤ 180 KB gz; record `/shop`, `/shop/[slug]`, `/compare` numbers in the ledger.
- [ ] **Step 7:** Commit `feat(web): product comparison page`.

### Task 7: Docs

**Files:** Create `docs/specs/21-product-comparison.md` (as built, acceptance tests); Modify `docs/specs/02-catalogue-search.md` (compare built; unit price; attributes), `docs/specs/08-admin-console.md` (attribute + net quantity endpoints), `docs/specs/12-analytics-events.md` (4 events + `add_to_cart.source`), `docs/specs/README.md`/`docs/README.md` index, design doc "As built", `docs/progress.md`, advisor learnings.

- [ ] **Step 1:** Write docs; `pnpm check` → PASS. **Step 2:** Commit `docs: product comparison as built`; push; check CI.
