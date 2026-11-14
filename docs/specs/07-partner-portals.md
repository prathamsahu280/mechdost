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

`/partner/shop` and `/partner/workshop` (`components/portal/*`), signed in with the seeded partner logins. Shop: offered orders with countdown, accept / decline with a reason code from `ASSIGNMENT_DECLINE_REASONS` (out of stock, outside delivery area, shop closed, too busy, price changed, other — the same codes as the API since 2026-11-03; older demo data with stock/area/busy still shows the right label), then packed → out for delivery → delivered. Workshop: propose date + slot + cost range + note or decline (request returns to admin), then received → in progress → ready.

Public `/partners` page (2026-11-01): per partner type an emoji, three benefits and the application button, then "How joining works" (apply → we verify → set up → go live) and the support number. Copy in `pages.partners` (en + hi); becomes admin content blocks in Phase 1.

## Built: shop offers API (2026-11-03)

`packages/db/src/repo/shop-inventory.ts`, `apps/api/src/routes/shop-inventory.ts`.

- Shop owners/staff (`inventory:write`, verified, only their own shops; another shop → 404): `GET /v1/shops/{shopId}/inventory` (SKU, product, MRP, price, stock, reserved, free, lead days, on/off, version), `POST /v1/shops/{shopId}/inventory {sku, sellingPaise, onHand?, leadDays?, active?}` (live products with an active variant only; `ALREADY_LISTED`), `PATCH /v1/shops/{shopId}/inventory/{sku} {version, …}`.
- Staff (`partners:write`, shops in their cities; decision "admin sets prices per shop"): the same three under `/v1/admin/shops/{shopId}/inventory`.
- Rules: price > 0 and **never above the MRP** (`PRICE_ABOVE_MRP`; Legal Metrology); stock is an absolute count and **never below the units reserved by open orders** (`STOCK_BELOW_RESERVED`, re-checked inside the UPDATE); lead days 0–60; compare-and-set on `version` (`STALE_OFFER`; an incoming order's reservation also bumps it, so a shop editing at that moment reloads); strict bodies (`reserved` can never be set); audit `inventory.listed` / `inventory.updated` with before/after.
- Not yet: CSV import/export, low-stock alerts, coverage PIN editing, the portal screens on the API.

## Built: seller onboarding, prices and agreement (2026-11-13)

Design `docs/superpowers/specs/2026-11-13-seller-onboarding-design.md`; decisions entry "Seller onboarding as built".

- **Apply as a seller** (`/partners/apply/seller`): name, mobile, email, business name (as on GST), shop name, GST status (GSTIN with checksum, or enrolment number), address, landmark, PIN, **shop location** (dialog: use my location; search on Search via `/api/geo/search` — Nominatim, India only, cached, 10 searches a minute per client; tap or drag the pin; works without the map) and a **tick-list of products** from the catalogue (prices are asked after approval). Validated with `SellerApplicationSchema` (shared with the API); all errors show at once next to their fields.
- **Invite link** (`/partners/invite/[token]`): the same form with name, email and mobile locked; single use, 7 days, per city; used, expired and withdrawn links say so.
- **Shop portal:**
  - **Seller agreement** card: the current version in the shop's language; accept with a tick; a newer version asks again.
  - **Your prices**: per product the live price, the MRP and any pending change; a new price is sent for approval and may not exceed the MRP; statuses "On sale at", "Waiting for approval", "Not approved: reason", "Taken off sale: reason". Replaces direct price edits (the inventory API answers `PRICE_NEEDS_APPROVAL`).
- **API:** public `POST /v1/partner-applications`, `GET /v1/partner-invites/{token}`, `POST /v1/partner-invites/{token}/application` (Turnstile; 5 applications and 30 invite opens per IP per hour, and 3 applications per mobile number per day; an invited submission takes name, email and mobile from the invite, so the form sends none); shop `GET|POST /v1/shop-onboarding/{shopId}/price-requests`, `POST …/price-requests/{id}/withdraw`, `GET|POST /v1/shop-onboarding/{shopId}/agreement` (owner or staff of that shop, 404 otherwise). Lists take `limit` and `cursor` and return `nextCursor` (newest first for the shop).
- **Data:** `partner_application_products`, `partner_invites`, `shop_price_requests`, `agreement_versions`, `shop_agreements` (append-only); `shops.gst_status`; `shop_inventory.admin_blocked` + `blocked_reason_code`; `partner_applications.owner_user_id` (migrations 0038, 0039).
- **Website status:** the screens run on the browser demo store (`demo/store.ts`, `demo/price-requests.ts`, `demo/agreements.ts`) until the data switch; the demo checkout still charges the catalogue price (the API prices from `shop_inventory`).
- **Tests:** `e2e/seller-onboarding.spec.ts` (16 tests: application, wrong GSTIN, invite, admin invites, review with delivery area, price queue, shop prices round trip, agreement); unit tests `demo-price-requests`, `demo-agreements`, `demo-applications`; DB and API suites `partner-applications`, `price-requests`, `partner-onboarding`.

## Demo: approved sellers reach their shop (2026-11-14, Q89)

Lifecycle QA found that in the browser demo an approved or invited seller could never sign in to a shop (the demo had a fixed list of four shops). Now, mirroring the API (`linkApplicantOwner` on sign-in, spec 01):

- An onboarded seller application (approved by the admin, or submitted through an invite) **is a shop**: `allShops()` in `apps/web/src/demo/shops.ts` = the fixed demo shops + one shop per onboarded application (slug `shop-<application code>`, name = shop name, place and map pin from the application, categories from the products the seller ticked — the seller form stores them as `categories`). Routing suggestions (`rankShops`), the admin partners list and price requests use it; a new shop has no acceptance history, so it ranks after established shops with the same categories.
- **Signing in with the application's phone** (sign-up with OTP, or password later) makes that account the shop's owner — once: a shop already claimed by another account stays with it, and staff/partner accounts are never changed (`linkApplicantShop` in `apps/web/src/demo/session.ts`).
- Test: `e2e/seller-onboarding.spec.ts` "approved seller reaches their shop" (an order routed by the admin to the new shop shows up in its portal; signing in again keeps the shop).
- Still demo-only gap: the storefront does not price by a new shop's approved prices (decision 2026-11-13 ruling; arrives with the data switch).

## Real API mode (2026-11-14, Stream C2)

With real sign-in a person whose `/v1/me` roles carry a `shopId` lands on `/partner/shop` (`demoRoleFor` → `shop`; staff still land on the admin console, workshop partners on the account area until the workshop portal moves to the API). The portal then runs on the API (details and gaps in spec 04 § Real API mode): offers with the 30 s poll, accept/decline, pack → out for delivery, the delivery code, recent delivered/cancelled orders, and **Your prices** on `GET /v1/shops/{shopId}/inventory` + `GET/POST /v1/shop-onboarding/{shopId}/price-requests` (a new price is always a request; the current stock is sent with it; price ≤ MRP checked before sending). The "stored on this device" note is hidden there. Not on the API yet: the shop header (name, area, acceptance stats), the paused/suspended banner (shop status is not exposed to the shop), the seller agreement card, and a way for a shop to pick a product it does not sell yet (staff add offers in Admin → Partners).

## Real API mode (2026-11-14)

Real sign-in builds (`AUTH_MODE === 'firebase'`) run seller onboarding on the API; demo builds are unchanged. Every
API screen is a separate module loaded with `next/dynamic` / `import()` only in that mode, so demo bundles do not grow.

- **Seller form** (`seller-application-form.tsx`): same checks, then Turnstile (`lib/auth/turnstile.ts`) and
  `POST /v1/partner-applications` (`lib/partner-public-api.ts`, plain fetch, no ID token). API refusals show next to
  the field (`APPLICATION_INVALID` `details.fields`, `PINCODE_NOT_SERVED`, `PRODUCTS`, `INVITE_CITY`) or above the form
  (bot check, rate limit, outage, invite state) — `applyErrorView` in `lib/partner-onboarding-view.ts`.
- **Invite link** (`invite-application-api.tsx`): `GET /v1/partner-invites/{token}` shows name and email locked and the
  mobile number masked (`••••••1234`); the submit omits name, email and phone (the API takes them from the invite).
- **Status page**: the API has no public status lookup, so it confirms the reference and says the team calls within
  2 working days (no invented timeline).
- **Admin** (`admin-onboarding-api.tsx`): applications (list + detail, approve with the delivery area typed as PIN
  codes + one charge + days, reject with a reason code never preselected + optional note), invites (create → link
  shown once to copy, list, revoke), price queue (approve / reject with reason), seller agreement (publish en + hi).
- **Shop** (`shop-onboarding-api.tsx`): "Your prices" from `/v1/shops/{shopId}/inventory` + the shop's price requests
  (send, withdraw), and the agreement card (accept the current version). The shop id comes from `GET /v1/me` roles.
- Response shapes: `@mechdost/shared/partner-api`. Tests: `apps/web/test/partner-onboarding-view.test.ts`.
- Gaps: no public application status route; the product picker still lists the demo catalogue (the API refuses
  slugs it does not have → "choose again" on the field); real shop accounts still land on the customer area
  (`demoRoleFor`) until the shop portal moves to the API, so the shop cards are wired but not yet reachable.
