# 07 · Partner portals (shop, workshop) & onboarding

Status: decided (commission pending) · Phase 1 (shop) / 2 (workshop) · Decisions: Partner KYC, Workshop slots, Tooling

## Goal

Mobile-first portals where partners accept work fast, manage catalogue/menus and stock, and see performance and payouts; onboarding from the concept's three "Apply as…" forms through admin approval.

## Onboarding

Public forms (concept `launchRequest` kinds Seller / Garage / Mechanic application with the same fields + light KYC uploads: GSTIN or declaration, PAN, bank, photos, location pin) → `partner_applications` → admin review checklist → approve creates `shops`/`workshops` + invites owner phone (OTP login gives `partner_id` claim) → owner completes profile → admin publishes. Rejected with reason; reapply allowed.

## Shop portal (`/partner/shop`)

- Order feed (spec 04) with countdown, accept/decline, pack/ship/deliver, print packing slip.
- Catalogue: map products to platform SKUs or submit new (approval queue), per-variant price/MRP/stock/active, CSV import/export (template, validation report, partial success, price/stock-only update), low-stock alerts, holiday/busy mode.
- Coverage pincodes with shipping and lead days.
- Returns handling (receive + QC).
- Payouts: ledger (sales, commission, TCS, refunds, penalties), weekly statements PDF/CSV (rates pending).
- Performance: acceptance %, time-to-accept, on-time %, defect/return %, rating.
- Staff: owner invites staff with roles (orders, catalogue, finance-view).

## Workshop portal (`/partner/workshop`)

- Request feed (propose/decline), calendar with hourly capacity, blackout dates, busy mode.
- Job card per request: vehicle received + odometer, estimate builder with saved line templates, photos, start/ready/bill, mark paid at workshop.
- Service menu CRUD (concept fields), hours, pickup toggle, photos, reviews reply, performance, payouts, staff (mechanic role sees assigned job cards only).

## Data

`partner_applications`, `shops`, `shop_users` (role owner|staff + permissions), `shop_pincodes`, `shop_inventory`, `shop_metrics`, `workshops`, `workshop_users`, `workshop_services`, `workshop_slots`, `payout_ledger` (entries with type, amount_paise, reference), `payout_runs`, `penalties`.

## API

`/partner/applications` (public POST), `/shop/*`, `/workshop/*` scoped by `partner_id` claim; admin `/admin/partners/*` (approve, suspend, publish, commission overrides).

## UI

Partner shell = concept admin shell (navy sidebar) in mobile-first layout; big tap targets; sound + badge on new assignment (PWA push in P1); Hindi toggle.

## Rules

Partner cannot act until approved and (for workshops) published + verified; busy mode removes from routing; staff permissions subset of owner; payouts only after delivery/completion + return window; penalties configurable.

## Edge cases

Owner phone changes → admin re-link; two shops same GSTIN → flag; CSV with 10k rows → async job with progress.

## Acceptance tests

Role leak tests (shop A cannot read shop B), CSV validation report, busy mode excludes from ranking, payout ledger sums match orders.

## Open decisions

Commission/payout rates (register #9).

## P1/P2

Full KYC (penny-drop, e-sign), multi-location inventory, bulk price tiers/B2B, seller coupons, seller analytics, mechanic app, pickup/drop driver management.

## Demo implementation (2026-11-01)

`/partner/shop` and `/partner/workshop` (`components/portal/*`), signed in with the seeded partner logins. Shop: offered orders with countdown, accept / decline with reason (stock, area, busy), then packed → out for delivery → delivered. Workshop: propose date + slot + cost range + note or decline (request returns to admin), then received → in progress → ready.

Public `/partners` page (2026-11-01): per partner type an emoji, three benefits and the application button, then "How joining works" (apply → we verify → set up → go live) and the support number. Copy in `pages.partners` (en + hi); becomes admin content blocks in Phase 1.

## Built: shop offers API (2026-11-03)

`packages/db/src/repo/shop-inventory.ts`, `apps/api/src/routes/shop-inventory.ts`.

- Shop owners/staff (`inventory:write`, verified, only their own shops; another shop → 404): `GET /v1/shops/{shopId}/inventory` (SKU, product, MRP, price, stock, reserved, free, lead days, on/off, version), `POST /v1/shops/{shopId}/inventory {sku, sellingPaise, onHand?, leadDays?, active?}` (live products with an active variant only; `ALREADY_LISTED`), `PATCH /v1/shops/{shopId}/inventory/{sku} {version, …}`.
- Staff (`partners:write`, shops in their cities; decision "admin sets prices per shop"): the same three under `/v1/admin/shops/{shopId}/inventory`.
- Rules: price > 0 and **never above the MRP** (`PRICE_ABOVE_MRP`; Legal Metrology); stock is an absolute count and **never below the units reserved by open orders** (`STOCK_BELOW_RESERVED`, re-checked inside the UPDATE); lead days 0–60; compare-and-set on `version` (`STALE_OFFER`; an incoming order's reservation also bumps it, so a shop editing at that moment reloads); strict bodies (`reserved` can never be set); audit `inventory.listed` / `inventory.updated` with before/after.
- Not yet: CSV import/export, low-stock alerts, coverage PIN editing, the portal screens on the API.
