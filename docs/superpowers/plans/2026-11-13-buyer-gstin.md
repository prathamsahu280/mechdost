# Buyer GSTIN at checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional "Business purchase (GST invoice)" at checkout that stores a checked GSTIN and business name on the order and shows them back to the customer, the shop and staff.

**Architecture:** One shared Zod schema (`BusinessPurchaseSchema`) validates the optional `business` object everywhere. The DB stores it on `order_groups.gstin` / `business_name` (columns exist) behind format CHECKs, and the place-order idempotency hash includes it. The checkout quote returns the delivery PIN's GST state code so the form can warn on a state mismatch; the website demo uses its single demo city's state.

**Tech Stack:** Zod 4 (`packages/shared`), Drizzle + PGlite tests (`packages/db`), Hono (`apps/api`), Next.js 16 demo store + Playwright (`apps/web`), next-intl en/hi.

**Spec:** `docs/superpowers/specs/2026-11-13-buyer-gstin-design.md` (approved by the user 2026-11-13).

## Global Constraints

- Optional: unticked checkout behaves exactly as today.
- `business` is `{ gstin, businessName }`, both or neither; Zod `.strict()`.
- GSTIN: 15 characters, checksum via `isGstin` (`packages/shared/src/gst.ts`); stored upper-case.
- Business name: 2–120 characters, trimmed.
- A GSTIN state that differs from the delivery state is a **note, never an error**; copy: "This GSTIN is registered in {state}. Goods delivered in {deliveryState} are invoiced with {deliveryState} as the place of supply."
- No GSTIN or business name in analytics: `purchase_submitted` gains `businessPurchase: boolean` only.
- Every string in en + hi locale files; state names for all GST state codes in both.
- No `<form>` inside a form (L83); check the GSTIN directly, not only via an object refinement (L84).
- Gates: `pnpm check`; e2e `--workers=1`; Hindi coverage crawl.

## Review Focus

- A GSTIN typed in lower case or with spaces → accepted after normalising (trim, remove spaces, upper-case), not refused.
- Only one of the two fields filled → an error next to the empty field; nothing placed.
- Same idempotency key replayed with a different GSTIN → refused as a different request (`IDEMPOTENCY_MISMATCH`), never the old order.
- A GSTIN from another state → the note shows the state names in the page's language (Hindi on `/hi`).
- Unticking the box after typing → the order carries no GSTIN.

---

### Task 1: Shared schema and state names

**Files:**

- Create: `packages/shared/src/business.ts` (export `"./business"` in `packages/shared/package.json`)
- Modify: `packages/shared/src/gst.ts` (add `GST_STATE_CODES`), `packages/shared/src/i18n/en.json`, `hi.json` (namespace `gstStates`: one key per code)
- Test: `packages/shared/test/business.test.ts`

**Interfaces:**

- Produces: `normaliseGstin(raw: string): string` (trim, drop spaces, upper-case) in `gst.ts` (no Zod, browser-safe); `GST_STATE_CODES: readonly string[]` (`'01'`–`'38'` as issued, plus `'97'`); `BusinessPurchaseSchema` = strict `{ gstin: string (normalised, isGstin), businessName: string (trim, 2–120) }`; `type BusinessPurchase`.

- [ ] **Step 1:** Tests: `normaliseGstin(' 22abvcs4888h1zl ')` → `'22ABVCS4888H1ZL'`; schema accepts `{ gstin: '22abvcs4888h1zl', businessName: ' Sahu Motors ' }` → normalised values; rejects a bad checksum (`22ABVCS4888H1ZM`), a 1-character name, an extra key; every code in `GST_STATE_CODES` has a non-empty `gstStates.<code>` in en and a Devanagari one in hi; `gstinStateCode` of the sample is in the list.
- [ ] **Step 2:** Run `pnpm --filter @mechdost/shared exec vitest run test/business.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): business purchase schema and GST state names`.

### Task 2: Database and repository

**Files:**

- Create: migration `packages/db/drizzle/0041_order_group_gstin.sql` (generated + hand edits)
- Modify: `packages/db/src/schema/orders.ts` (CHECKs), `packages/db/src/repo/checkout.ts`
- Test: `packages/db/test/checkout.test.ts`

**Interfaces:**

- Consumes: `BusinessPurchase` (Task 1).
- Produces: `PlaceOrderInput.business: BusinessPurchase | null`; `CheckoutQuote.deliveryStateCode: string` (GST state code of the delivery PIN, from `pincodes → states.gst_state_code`).

- [ ] **Step 1:** Tests:
  - placing with `business: { gstin: '22ABVCS4888H1ZL', businessName: 'Sahu Motors' }` stores both on the group;
  - placing without it stores nulls;
  - the same idempotency key with a different GSTIN → `IDEMPOTENCY_MISMATCH` (`ValidationError`);
  - a raw insert with `gstin = 'BAD'` → CHECK violation; with a GSTIN and no business name → CHECK violation;
  - `quoteCheckout` for PIN 492001 → `deliveryStateCode: '22'`.
- [ ] **Step 2:** Run `pnpm --filter @mechdost/db exec vitest run test/checkout.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** CHECKs `order_groups_gstin_format` (same regex as `shops_gstin_format`), `order_groups_business_pair` (`(gstin is null) = (business_name is null)`), `order_groups_business_name_len` (2–120); migration adds them `NOT VALID` then `VALIDATE`, `SET lock_timeout = '5s'`. `requestHash` includes `[business?.gstin, business?.businessName]`. Insert values carry them. Quote selects `s.gst_state_code`.
- [ ] **Step 4:** Run again, then the whole db suite. Expected: PASS.
- [ ] **Step 5:** `pnpm db:migrate` (dev), Supabase advisors; commit `feat(db): business GSTIN on order groups`.

### Task 3: API

**Files:**

- Modify: `apps/api/src/routes/checkout.ts` (`PlaceBody.business: BusinessPurchaseSchema.nullable().optional()`; quote schema `deliveryStateCode`; order read returns `business`)
- Test: `apps/api/test/checkout.test.ts` (or the file that already covers `POST /v1/checkout/orders`)

- [ ] **Step 1:** Tests: place with `business` → 201 and the group stores it; bad checksum → 400 with the field path `business.gstin`; `business: { gstin }` alone → 400; quote includes `deliveryStateCode`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; pass `business ?? null` to `placeOrder`.
- [ ] **Step 4:** Run the api suite. Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): optional business GSTIN on checkout`.

### Task 4: Website

**Files:**

- Modify: `apps/web/src/components/commerce/checkout-form.tsx`, `apps/web/src/demo/store.ts` (`DemoOrder.business?: { gstin; businessName } | null`; `placeDemoOrder` takes it), `apps/web/src/lib/payments/pay-online.ts` (passes `business`), `apps/web/src/components/commerce/order-view.tsx`, `apps/web/src/components/portal/shop-portal.tsx` (`OrderLines`), the admin order card in `admin-console.tsx`; `packages/shared/src/analytics.ts` (`purchase_submitted.businessPurchase`); en/hi `checkout` namespace.
- Create: `apps/web/src/demo/city.ts` (`DEMO_CITY = { code: 'RPR', gstStateCode: '22' }`, the single demo city; the API mode uses `quote.deliveryStateCode`).
- Test: `apps/web/e2e/checkout-business.spec.ts`

- [ ] **Step 1:** e2e:
  - unticked: place a COD order as today; the order page has no "GST invoice" line;
  - ticked: empty fields → errors next to both; bad GSTIN → "Check the GSTIN: 15 characters, as on the business's GST certificate."; a Maharashtra GSTIN `27AAPFU0939F1ZV` → the note names "Maharashtra" and "Chhattisgarh" and the order still places; the order page shows "GST invoice for Sahu Motors (27AAPFU0939F1ZV)";
  - the shop portal order card shows the same line;
  - on `/hi`, the note names "महाराष्ट्र".
- [ ] **Step 2:** Run with `--workers=1`. Expected: FAIL.
- [ ] **Step 3:** Implement: a checkbox under the address (not a nested form); two fields shown when ticked; checked with `BusinessPurchaseSchema` plus a direct `isGstin(normaliseGstin(..))`; the note under the GSTIN field once it is valid; `purchase_submitted` sends `businessPurchase`.
- [ ] **Step 4:** Run this spec, `hindi-coverage.spec.ts`, the existing checkout specs. Expected: PASS.
- [ ] **Step 5:** `pnpm check`; commit `feat(web): business purchase with GSTIN at checkout`.

### Task 5: Docs

- [ ] Spec 03 (§ checkout: business purchase, quote `deliveryStateCode`), spec 12 (`businessPurchase`), design doc "as built" note, `docs/progress.md`; `pnpm check`; commit `docs: buyer GSTIN`.
