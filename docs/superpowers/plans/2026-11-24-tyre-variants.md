# Tyre variants (one product per pattern, sizes as variants) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CEAT, MRF and Apollo tyres are listed as one product per tread pattern with each size a variant; the storefront shows a size picker with per-size price and stock, and the cart, orders, compare and admin work per variant.

**Architecture:** The import writer and planners take `variants[]` per planned product (batteries keep one). The product API already returns all variants with per-variant offers; the web `apiProduct` view, product page, browser cart, cards, compare and admin editor are extended to carry and select a variant (sku). Server prices stay authoritative per variant.

**Tech Stack:** Drizzle/PGlite tests (`packages/db`), Hono (`apps/api`), Next.js 16 + React 19 (`apps/web`), Vitest, Playwright state-audit.

**Spec:** `docs/specs/02-catalogue-search.md`, `docs/runbooks/catalogue-import.md` ("CEAT and MRF tyre imports"), `docs/decisions.md` (2026-11-24 CEAT and MRF tyre imports, later rulings), investigation in `docs/progress.md` (top bullet).

## Status (update after every step; resume from here)

- 2026-11-24 evening: Tasks A1 (writer N variants) and A2 (CEAT and MRF one product per pattern) are committed (a174caa6). Task A3 (Apollo adapter) is in progress in a background agent: WIP files (`packages/db/src/apollo/`, `repo/apollo-import.ts`, `apps/api/src/cli/import-apollo.ts`, `tyre-import/features-hi-apollo.ts`, tests `apollo-plan.test.ts`, `apollo-import.test.ts`, `docs/catalogue/apollo-import-*`) are committed as a WIP snapshot and may not pass gates yet. `apps/api/src/cli/tmp-apollo-images.ts` is a throwaway image-size script: delete it once the numbers are in the status report.
- NOT started: B1 (size picker and `apiProduct`), B2 (cart by sku, order size label + migration 0084, cards, compare, fitment, admin variant editor), E (screenshots in `scratchpad/size-picker/`, final gates, docs). Run the UI skill chain (accessibility-lead, ui-ux-pro-max, shadcn-component-discovery, frontend-design, web-design-guidelines, shadcn-component-review) before B1 and B2.
- Full gates (prettier, tsc x4, eslint x3, vitest shared/db/api/web; db and api take about 15 min each) are NOT yet re-run after A1-A3: run them one at a time in the morning.

## Global Constraints

- One product per tread pattern, each size a variant with own SKU, MRP or price on request (null MRP), EAN (`product_variants.barcode`), `options.size`, load/speed, TL/TT and fitment. Batteries stay one product per model and keep every test green.
- Names: pattern product "CEAT Milaze X3"; variant label = size text exactly as the maker writes it ("145/70R12 69T TL"). Slug from the pattern name; SKU `CEAT-<sku>` / `MRF-<normalised name>` / `APOLLO-<sku>`, globally unique.
- Prices come server-side per variant; cart, order, inventory reference the variant; the cart stores sku and qty only.
- India only for Apollo: drop `source == "Shop only"` (179 rows incl. 95 Vredestein) and the 21 brochure-only sizes, each listed with its reason in `docs/catalogue/apollo-import-status.*`. Hindi leftovers 0 (hand-checked dictionaries). Never touch other brands; archive old `apollo`/`vredestein` products not in the plan.
- Every string in en and hi; analytics events in spec 12 in the same change; product-page JS under 180 KB gz (measure before: about 170-173 KB, after); WCAG 2.2 AA light and dark; mobile first.
- Run gates one at a time (low memory); no `.env` printing, no killing node by name; do not run `--dry-run` or a real import; no DB writes.

## Review Focus

- Two sizes of one product in the cart are two lines (not one line with qty 2).
- A size with no MRP shows "price on request", cannot be added to the cart, and never shows a price.
- `?size=` with an unknown or archived size falls back to the default size without an error.
- Removing or archiving one size does not affect the others' cart lines, offers or stock.
- A planner row whose SKU already belongs to another brand's product stops the import (never moves it).

---

### Task A1: Writer and planner support N variants (stage a)

**Files:** Modify `packages/db/src/battery-import/types.ts` (add `variants: PlannedVariant[]` and keep `variant` = first for batteries), `packages/db/src/repo/battery-import.ts`, `packages/db/src/tyre-import/build.ts`; Test `packages/db/test/battery-import-variants.test.ts`.

**Interfaces:**

- Produces: `PlannedVariant { sku; model; mrpPaise: number|null; weightG: number|null; netQuantity; options: Record<string,string>; barcode: string|null; partNumbers: {kind:'mfr';value;normalised}[]; fitment? }`; `PlannedProduct.variants: PlannedVariant[]` (length 1 for batteries).

- [ ] Write failing tests: a two-variant product creates 2 packs with barcodes and part numbers; a re-run changes nothing; a removed size archives only that variant; a SKU owned by another brand throws `SLUG_TAKEN`; a null MRP is stored as null; an existing staff MRP is not lowered.
- [ ] Run them (fail), implement: flatten SKUs for `bySku`; upsert loop per variant; stale = variants whose sku is not in `p.variants`; write `barcode`; part numbers per variant id; counts per variant.
- [ ] Run battery suites (exide, amaron, tatagreen, tyre-import) and the new test; commit.

### Task A2: Tyre planners per pattern (stage c)

**Files:** Modify `packages/db/src/tyre-import/build.ts` (`planTyreRows` groups rows by pattern + kind into one product with variants), `packages/db/src/ceat/plan.ts`, `packages/db/src/mrf/plan.ts`; Test `packages/db/test/tyre-plan.test.ts`, `tyre-import.test.ts` (update).

**Interfaces:** Consumes `PlannedVariant` (A1). Produces product name = pattern ("CEAT Milaze X3"), spec holds pattern-level data, each variant `options: { size }`, `spec` per-variant keys under `variantSpecs[sku]` (load, speed, tubeless, ply, position, fitment) so public payloads stay hidden (`PRIVATE_SPEC_KEYS` gets `variantSpecs`).

- [ ] Update the plan tests to the per-pattern expectations (counts by category, names, price on request per variant, hidden CEAT price per variant, drafts only when the pattern has no photo, fitment per variant); run red; implement; run green; regenerate the status reports (`--plan-only`); commit.

### Task A3: Apollo adapter (stage d)

**Files:** Create `packages/db/src/apollo/{plan,read,report,hindi,index}.ts`, `packages/db/src/tyre-import/features-hi-apollo.ts`, `packages/db/src/repo/apollo-import.ts`, `apps/api/src/cli/import-apollo.ts`; Modify `kinds.ts` (`industrial` kind -> `industrial-tyres`; earthmover -> `otr`), `repo/index.ts`, `package.json` scripts, `analytics.ts` (`admin_apollo_imported`), `catalogue-hindi.ts`; Test `packages/db/test/apollo-plan.test.ts`.

- [ ] Tests (red first): India-only filter and the dropped list with reasons (shop only 179, brochure only 21); MRP only from shop rows; EAN in the variant barcode; duplicates merged; industrial to `industrial-tyres`, earthmover to `otr-tyres`; 0 Hindi leftovers; archive brand `apollo` and `vredestein` only.
- [ ] Implement; image size report script (before and after bytes, 1600 px WebP variants); contact sheets in `scratchpad/tyre-sheets/apollo/`; `--plan-only`; docs (runbook, status report, decisions, spec 12); commit.

### Task B1: Storefront data and picker (stage b)

**Files:** Modify `apps/web/src/lib/catalogue/view.ts` (`ProductView.variants`), `api-source.ts` (`apiProduct`), `apps/web/src/app/[locale]/shop/[slug]/page.tsx`; Create `apps/web/src/components/catalogue/size-picker.tsx` (client island), locale strings `packages/shared/src/i18n` (en, hi), analytics `product_size_selected` in `packages/shared/src/analytics.ts` and spec 12.

**Interfaces:** `VariantView { sku; label; options; pricePaise|null; mrpPaise|null; priceOnRequest: boolean; inStock: boolean; leadDays }`; picker props `{ variants: VariantView[]; initialSku: string; slug: string }`, deep link `?size=<sku or label>`.

- [ ] Run the UI skill chain (accessibility-lead, ui-ux-pro-max, shadcn-component-discovery, frontend-design) before editing; write failing component and view tests; implement the island (radio-group semantics, keyboard, 24 px targets); measure JS with `apps/web/scripts/measure-js.mjs` before and after; commit.

### Task B2: Cart, orders, cards, compare, fitment, admin (stage b)

**Files:** Modify `apps/web/src/demo/store.ts` (cart lines keyed by `slug+sku`), `components/catalogue/add-to-cart-button.tsx`, cart page, `product-card.tsx` ("from ₹X · N sizes"), `lib/compare/rows.ts`, order item label (`packages/db/src/schema/orders.ts` option label column + migration 0084, `checkout.ts` snapshot), `packages/db/src/repo/catalogue-admin.ts` (+ `apps/api/src/routes/admin-catalogue.ts`: list, patch options/MRP/barcode, archive variant), `apps/web/src/components/admin-catalogue-editor.tsx`.

- [ ] Failing tests first: two sizes = two cart lines; checkout prices per variant; concurrent checkouts on one variant's last unit (conditional decrement); order item stores the size label; card text; compare per size; admin variant edit/archive with version checks and audit rows; fitment picks the size from `spec.variantSpecs[*].fitment`.
- [ ] State-audit rows (PDP-BUYBOX with several sizes, CART two sizes) in `apps/web/e2e/state-audit/model.ts`, regenerate `docs/qa/ui-state-checklist.md`; run affected rows locally on a free port (not 4100); commit.

### Task E: Screenshots, gates, docs (stage e)

- [ ] Local build on a free port; screenshots (CEAT Milaze X3 product page with picker, card with "from ₹X · N sizes", cart with two sizes, admin variant editor) at 390 and 1440, light and dark, en and hi, into `scratchpad/size-picker/`.
- [ ] `--plan-only` for CEAT, MRF, Apollo; gates one at a time: prettier, tsc (shared, db, api, web), eslint per package, vitest full (shared, db, api, web); `website-testing` and `verification-before-completion` as skills; docs (decisions, runbook, specs 02/12, CLAUDE.md commands, progress, learnings); commit.
