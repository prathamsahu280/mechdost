# Admin catalogue + admin PIN prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin sets the customer price per pack for a city with optional PIN overrides (with nearest/lowest/highest shop suggestions), never above MRP nor below what a shop is paid. Catalogue, checkout and routing use that price, orders record the shop price for the margin, and a new Admin → Catalogue screen edits texts, vehicle types, specs, pack sizes and prices through the real API.

**Architecture:**

- **Prices:** a new `admin_prices` table (variant × city × optional PIN), resolved in the same SQL that picks the shop today.
- **Picking a shop:** the shop is still the nearest covering shop with stock, now limited to shops whose approved price is at or below the customer price.
- **Order items:** they add `shop_unit_paise`.
- **Screen:** a new admin section calls the API with the staff member's Firebase ID token (firebase sign-in mode); in demo sign-in mode it explains that it needs real sign-in.

**Tech Stack:** Drizzle + PGlite, Hono zod-openapi, Next.js 16, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-admin-catalogue-pin-prices-design.md` (approved by the user 2026-11-13).

## Global Constraints

- **Customer price:** PIN override, else city price, else **interim (Q83)** the chosen shop's approved price. Prices are integer paise.
- **Admin price rules:** at most MRP (`MRP_EXCEEDED`), and at least the lowest approved price among shops that deliver there with stock (`BELOW_SHOP_PRICE`). With no such shop, the save is refused (`NO_SHOP`).
- **Shop choice:** among shops covering the PIN with stock **and** `selling_paise <= customer price`, the nearest one wins (ties: price, id). This applies to the catalogue, quote and place, and routing suggestions.
- **Order items:** `unit_paise` holds the customer price; `shop_unit_paise` holds the chosen shop's approved price (nullable for older rows, CHECK `>= 0`, and `<= unit_paise` when set).
- **Writes:** compare-and-set on `version` (`STALE_PRICE`), audited (`price.set` / `price.cleared`, before and after). Permission `prices:write` goes to super_admin, ops_manager and finance (city_manager is city-scoped later).
- **Migration 0043:** `SET lock_timeout`; RLS on plus REVOKE for anon and authenticated; version and updated_at triggers; partial unique indexes (variant, city) where pincode is null and (variant, city, pincode) where it is not null.
- **Text:** Hindi everywhere (`portal` namespace keys `cat_*`); the admin screen is crawled by the Hindi suite in demo mode (its notice text).
- **JS budget:** the admin section loads its code only on `/admin/catalogue` (a separate client component); the shop routes are unaffected.

## Review Focus

1. A PIN override for a PIN no shop covers → refused (`NO_SHOP`), never saved silently.
2. The city price is raised above a shop's price while that shop holds an offered order → the order keeps its snapshot prices; only new quotes change.
3. Two staff save the same price at once → one gets `STALE_PRICE`, nothing is lost.
4. A shop raises its approved price above the customer price after the admin price was set → that shop stops being chosen; if no shop qualifies, the product shows "on request" at that PIN, never sold at a loss.
5. Demo sign-in mode on `/admin/catalogue` → a clear notice, no failed API calls, no crash.

---

### Task 1: Shared, permission, price rules, DTOs

**Files:** `packages/shared/src/rbac.ts` (add `prices:write`: "Set customer prices per city and PIN", granted to super_admin, ops_manager and finance), `packages/shared/src/admin-prices.ts` (Zod-free rules plus Zod DTOs in the API), tests `packages/shared/test/admin-prices.test.ts`.

**Produces:**

- `checkAdminPrice({ pricePaise, mrpPaise, lowestShopPaise }): null | 'MRP_EXCEEDED' | 'BELOW_SHOP_PRICE' | 'NO_SHOP' | 'BAD_PRICE'`. `lowestShopPaise` null → `NO_SHOP`; the price must be a positive integer.
- `resolveCustomerPrice({ pinPaise, cityPaise, shopPaise }): number | null` → pin ?? city ?? shop.

- [ ] Tests:
  - rules: equal to MRP is ok; MRP + 1 → `MRP_EXCEEDED`; below the lowest → `BELOW_SHOP_PRICE`; no shop → `NO_SHOP`; 0 or 1.5 → `BAD_PRICE`;
  - resolution order;
  - rbac: finance has `prices:write`, catalogue_manager does not.
- [ ] RED, implement, GREEN, commit.

### Task 2: Database, `admin_prices`, `order_items.shop_unit_paise`, repo

**Files:** schema (`catalogue.ts` `adminPrices`; `orders.ts` `shopUnitPaise`), `packages/db/drizzle/0043_admin_prices.sql`, `packages/db/src/repo/admin-prices.ts`, test `packages/db/test/admin-prices.test.ts`.

**Produces:**

- `getPriceBoard(db, { sku | productSlug, cityCode }) → { variants: [{ sku, mrpPaise, city: { pricePaise | null, version | null }, pins: [{ pincode, override: { pricePaise, version } | null, nearestShopPaise, lowestShopPaise, highestShopPaise }] }] }`. The pins are those covered by at least one shop in the city.
- `setAdminPrice(db, { sku, cityCode, pincode | null, pricePaise, expectedVersion | null, staffUserId })`. The rules come from Task 1, and `lowestShopPaise` is computed for that PIN (for a city price: the lowest of the per-PIN lowests).
- `clearPinPrice(db, { sku, cityCode, pincode, expectedVersion, staffUserId })`.
- Both use compare-and-set and audit.

- [ ] Tests:
  - the CHECKs (price > 0; shop_unit ≤ unit);
  - the unique indexes (a second city row for the same variant fails);
  - the board shows nearest/lowest/highest per PIN;
  - the rules refuse above MRP, below the shop price, and an uncovered PIN;
  - a stale version → `STALE_PRICE`;
  - clear;
  - audit rows.
- [ ] Migration in the safe form, then the full db suite. Commit and apply to dev.

### Task 3: Pricing in the catalogue, checkout and routing

**Files:** `packages/db/src/repo/catalogue.ts` (`offerLateral`), `checkout.ts` (quote shop pick + item insert), `routing.ts` (`rankShopsForOrder`), tests in `catalogue.test.ts`, `checkout.test.ts`, `routing.test.ts`, `product-compare.test.ts` as needed.

- [ ] `offerLateral` returns `price` = the customer price and `shop_price`, and only considers shops with `si.selling_paise <= coalesce(pin, city, si.selling_paise)`.
- [ ] Quote and place use the same resolution; the item insert writes `unit_paise` = customer price and `shop_unit_paise` = shop price.
- [ ] Routing ranks only shops whose approved price for each item is at or below the order item's `unit_paise`.
- [ ] Tests:
  - with a city price, the card shows it, and the shop chosen is the nearest with price ≤ it;
  - a PIN override beats the city price;
  - a shop priced above the customer price is skipped, and when none qualifies the offer is null;
  - placing stores both prices;
  - routing excludes the dearer shop;
  - Review Focus 2 and 4.
- [ ] Full db and API suites. Commit.

### Task 4: API routes

**Files:** `apps/api/src/routes/admin-prices.ts` (mounted like admin-catalogue), test `apps/api/test/admin-prices.test.ts`.

- [ ] `GET /v1/admin/prices/products/{slug}?city=RPR` (`prices:write` or `products:write`) → the board.
- [ ] `PUT /v1/admin/prices/{sku}` body `{ city, pincode | null, pricePaise, version | null }` (strict, `prices:write`) → 200 `{ version }`. Rule failures are 422 with the code; stale is 409.
- [ ] `DELETE /v1/admin/prices/{sku}/pins/{pincode}?city=RPR&version=N` (`prices:write`).
- [ ] Tests: 200, 422 (above MRP, below the shop price), 409, 403 (marketing), 404 (unknown SKU).
- [ ] Commit.

### Task 5: Admin → Catalogue screen

**Files:**

- `apps/web/src/lib/sections.ts` (add `catalogue`);
- `apps/web/src/lib/admin-api.ts` (a typed fetch with `currentIdToken`);
- `apps/web/src/components/portal/admin-catalogue.tsx` (list + editor with tabs Texts / Fit & specs / Prices; demo-mode notice);
- `admin-console.tsx` wiring;
- en/hi `portal.cat_*`;
- nav labels.

- [ ] Firebase mode: the list uses `GET /v1/admin/catalogue/products`; the editor uses the existing text, vehicle-type, attribute and net-quantity routes and Task 4's price routes. Errors show next to the field (rule codes translated); saves are compare-and-set.
- [ ] Demo mode: "Catalogue editing uses the real backend: available after the switch to real sign-in", with no API calls.
- [ ] Tests:
  - unit tests for the price-board view helpers;
  - e2e `admin-catalogue.spec.ts` (demo mode: the notice; Hindi crawl adds `/admin/catalogue`);
  - the API-mode e2e is added to `real-auth.spec.ts` (staff sets a city price → `GET /v1/catalogue/products/{slug}` returns it), run locally with the emulator.
- [ ] Budget: `measure-js` with the shop routes unchanged. Commit.

### Task 6: Docs

- [ ] Spec 02 (pricing rule), spec 08 (Catalogue section, prices), spec 04 (routing price filter), spec 13 (`prices:write`), the data model note, decisions entry, progress, runbook (grant `prices:write`).
- [ ] `pnpm check`, push, CI and CD green.
