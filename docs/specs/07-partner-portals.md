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

With real sign-in a person whose `/v1/me` roles carry a `shopId` lands on `/partner/shop` (`demoRoleFor` → `shop`; staff still land on the admin console, workshop partners on the account area until the workshop portal moves to the API). The portal then runs on the API (details and gaps in spec 04 § Real API mode): offers with the 30 s poll, accept/decline, pack → out for delivery, the delivery code, recent delivered/cancelled orders, and **Your prices** on `GET /v1/shops/{shopId}/inventory` + `GET/POST /v1/shop-onboarding/{shopId}/price-requests` (a new price is always a request; the current stock is sent with it; price ≤ MRP checked before sending). The "stored on this device" note is hidden there. Since the shop management change (section "Shop management on the API" below), the shop header, the paused/suspended banner, the working hours, "Sell another product" and the seller agreement card are on the API too.

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
- Gaps: no public application status route. Closed since: the product picker lists the live API catalogue in this
  mode (shop management, below); real shop accounts land on `/partner/shop` (Stream C2).

## Shop management on the API (2026-11-14)

Decision "Shop management and shop hours on the API" (2026-11-14). Migration **0051**: `shops.free_delivery_min_paise`,
`shops.hours`, `partner_status_events.reason_code`. Real sign-in only; the demo screens are unchanged.

**Admin → Partners → Shops**

- Screen: `admin-shops-api.tsx`, loaded with `next/dynamic` by `admin-partners.tsx`. The demo shop tab is hidden in
  this mode.
- API: `apps/api/src/routes/admin-shops.ts`. Repositories: `packages/db/src/repo/shops-admin.ts` and
  `setShopStanding` in `partners.ts`.
- Permissions, city-scoped (a shop in another city is 404):
  - `partners:read`: the list and the detail, and the shop's offers.
  - `partners:write`: the profile, the delivery area and the offers.
  - `partners:approve`: standing, portal access and GSTIN changes, all in the shop's own city.
- **List** `GET /v1/admin/shops?status&cursor&limit`: by name, keyset cursor. Each row shows the status, open now or
  closed, busy, GST enrolment only, PIN count, products on sale and missing Hindi texts.
- **Detail** `GET /v1/admin/shops/{id}`: the profile, hours, coverage per PIN, the last 20 standing changes (reason
  code + note) and portal members (role, last 4 digits of the phone).
- **Profile** `PATCH /v1/admin/shops/{id}`: only the fields sent, compare-and-set on `version` (`STALE_SHOP`),
  audited `shop.updated`.
  - Editable: name and address in English and Hindi, legal name, phone, email, GSTIN, minutes to accept (5–120, empty
    = city), free delivery from ₹ (empty = city, 0 = always free) and hours.
  - A GSTIN is checksum-checked and must match the shop's state. Setting one makes an enrolled shop `registered`.
- **Delivery area** `PUT /v1/admin/shops/{id}/coverage {version, upsert[], remove[]}`:
  - charge ₹0–₹10,000 and 0–60 days per PIN;
  - PIN codes of the shop's own city only (`PINCODE_OTHER_CITY`, `PINCODE_UNKNOWN`);
  - one compare-and-set on the shop's version, audited `shop.coverage_changed`.
- **Standing** `POST /v1/admin/shops/{id}/standing {status, reasonCode, note, pausedUntil?, version}`:
  - pause, suspend or reactivate;
  - the reason code comes from `STAFF_STANDING_REASONS` and is never preselected; the note (5–300 characters) is
    what the shop reads;
  - a pause end date must be in the future;
  - history in `partner_status_events`, with the worker writing `pause_ended`. Pending shops go live by themselves
    and cannot be moved by hand (`STATUS_TRANSITION`).
- **Portal access** `POST /v1/admin/shops/{id}/members {phone, role}`:
  - the person must have signed up (404 otherwise) and must not be a staff account (`MEMBER_IS_STAFF`);
  - this writes the role grant and `shop_users`, which is what the live pings read. The owner link on sign-in
    (`linkApplicantOwner`) now writes `shop_users` too.
- **Products** `GET|POST /v1/admin/shops/{id}/inventory`, `PATCH …/inventory/{sku}`: these routes moved to the admin
  shop router (reading needs `partners:read`). Staff pick a live product with the catalogue picker, then set the
  price (≤ MRP), stock and on/off. They edit price, stock and on/off per row.
- **Going live:** a pending shop goes live (`maybeGoLive`) when staff add a PIN code or a product, as well as on
  price approval or the agreement.

**Shop portal** (`shop-profile-api.tsx`, inside `shop-portal-api.tsx`)

- `GET /v1/shop/me` (`orders:read`; the shops in the caller's grants) returns:
  - name and address;
  - status, with the standing (reason code, note, pause end);
  - hours and open now;
  - coverage summary (PIN count, cheapest and dearest charge, free-delivery override);
  - products on sale and the last 30 days' accepted / answered offers;
  - `isOwner`.
- The portal shows a header, a paused or suspended banner (reason in the shop's language, the staff note, the end
  date), the hours card and the delivery area. A pending shop sees what it needs to go live.
- **Working hours** (user 2026-11-14): only the owner sets them, with `PUT /v1/shop/hours/{shopId} {version, hours}`
  (staff of the shop get 403 `OWNER_ONLY`). The value is one window on chosen weekdays in IST; closing "24:00" means
  open until midnight. Default 09:00–21:00, Monday to Saturday. See spec 04 for what the hours do in routing.
- **Sell another product:** the shop searches the live catalogue, picks a pack and sends a price + stock request
  (`POST /v1/shop-onboarding/{shopId}/price-requests`). Staff approve it in the price queue, and the approval creates
  the listing. Waiting requests for products not on the board yet are listed.
- **Offer deadline:** under two hours it shows a countdown; otherwise "accept by {weekday, time}" (an offer made while
  the shop was closed).

**Seller application product picker** (`product-picker-api.tsx`, `React.lazy` because this is a customer page)

- In real sign-in builds (the mode in which the form posts to the API) the tick-list comes from
  `GET /v1/catalogue/products`: live products, `q` search, 24 per page, "Show more", grouped by category.
- The dialog has no nested form (the search runs on Enter or the button).
- The demo keeps the demo catalogue. The real submit path never reads `DEMO_PRODUCTS`; only the demo's `categories`
  does.

**Response shapes and tests**

- Shapes: `@mechdost/shared/shop-api` (request schemas strict). Form logic: `apps/web/src/lib/admin-shop-form.ts`
  (only changed fields; rupees → paise; coverage diff). Catalogue calls from the browser:
  `lib/catalogue-public-api.ts`.
- Strings: `portal.shops_api_*`, `apply.picker_api_*` (en + hi).
- Events: client `click` ids `admin_shop_saved`, `admin_shop_coverage_saved`, `admin_shop_offer_added`,
  `admin_shop_offer_saved`, `admin_shop_{status}`, `admin_shop_member_added`, `shop_hours_saved`,
  `shop_new_product_requested`. Server: `admin_shop_updated`, `admin_shop_coverage_changed`,
  `admin_partner_standing_changed`, `admin_shop_member_added`, `shop_hours_changed`.
- Tests:
  - db `shops-admin.test.ts` (scope, cursor, compare-and-set, GSTIN approval, coverage city, go-live, standing codes
    and pricing exclusion, members, own profile, hours), `routing.test.ts` (per-shop timer, open shops first,
    closed-shop deadline), `checkout.test.ts` (free-delivery chain), `partner-applications.test.ts` (owner in
    `shop_users`);
  - API `admin-shops.test.ts` (role matrix, strict bodies, rate-limit count, owner-only hours);
  - shared `shop-hours.test.ts`, `free-delivery.test.ts`;
  - web `admin-shop-form.test.ts`.
  - Playwright on the real API is not run yet (no emulator run in this change).
- **Gaps:**
  - no PIN-code list endpoint for the coverage editor (staff type PIN codes; another change adds PIN admin);
  - workshop standing still takes free text without a reason code;
  - the application's ticked products are not offered as quick picks in "Sell another product";
  - removing someone's portal access needs `pnpm db:grant-role`-style tooling (no endpoint).

**Code review fixes (2026-11-14, user rulings)**

- **List cursor:** carries the last row's name and id. It is compared directly and never looked up by id: the old
  look-up could read a shop in another city (security review), and a rename between pages skipped rows.
- **Migration 0051** backfills `shop_users` from the shop grants in `user_roles`. The owner wins when a person
  holds both roles; it is idempotent and only covers shops that exist.
- **GSTIN:** a GSTIN already held by another shop, or by a seller application that is not this shop's own and not
  rejected, is refused with 409 `GSTIN_TAKEN` (blind index with the API keyring).
- **Pending shops:**
  - A pending shop may be **suspended** to keep it dark while its PIN codes and products are set up.
  - The coverage and products panels warn that saving publishes a pending shop.
  - Reactivating it later is an explicit staff decision to go live.
- **Active PIN codes only:**
  - Coverage counts and the go-live check include only active PIN codes (`pincodes.active`).
  - A shop serving only switched-off PIN codes stays pending.
- **Audit:** going live after the shop accepts the agreement is audited as the shop, not staff.
- **Portal access:**
  - An owner is never downgraded to staff (409 `ALREADY_OWNER`).
  - Deactivated accounts are refused (409 `ACCOUNT_NOT_ACTIVE`).
- **Hindi times:** shown on the 24-hour clock (no Latin am/pm).
- **Closing soon:** an offer whose timer would run past closing counts as closed (spec 04).

## Give up an order and "Notes from MechDost" (2026-11-15, real API mode)

- **Can't fulfil this order:** on an order in progress that is still `confirmed`, one quiet button opens an inline form
  (reason code required, optional note) with one primary action "Give up this order" and "Keep this order". No modal. The
  order leaves "Orders in progress" and appears in "Delivered" history as "Given up" with the reason. Errors: stale/other
  step reload the list; reason and note errors show under the form.
- **Notes from MechDost:** a section (`#warnings`) after the history: each warning with its reason (en/hi), date and the
  staff note, withdrawn ones marked; "N in the last 30 days"; empty is one sentence. Calm and factual: the shop never sees
  the threshold or the word "pause" here. `GET /v1/shop/warnings` (`orders:read`, scoped to the shop's grants).
- Strings: locale namespace `shopGiveUp`. Spec 04 and 08 carry the rules.

## "Genuine parts only" clause (2026-11-15, Q102)

- A clause in English and Hindi (`packages/shared/src/seller-clause.ts`, **draft, pending legal review, Q110**): the
  shop lists only genuine products, legally sourced and in their original packaging; if MechDost confirms that a
  product sold is fake or counterfeit, the product is taken off sale and the shop can be paused or suspended.
- It is **part of the agreement text, not a separate tick**: the admin presses "Add the Genuine parts only clause" in
  Admin → Partners → Agreement (adds it once to both texts), reviews, and publishes a new version; every shop then
  accepts that version (`partners.agreement_required` flow unchanged). The full agreement text still comes from the user
  (Q77).
- Consequence code: `counterfeit_confirmed` in `PARTNER_STANDING_REASONS` (CHECK `partner_status_events_reason_code_valid`
  in migration 0058); staff choose it when pausing or suspending, the shop reads "Counterfeit product confirmed" (en/hi).
- Seller pitch on `/partners`: "Sell genuine parts to {city} customers" (trust line `trust.partner`, admin-editable).
- Workshops: while the labour promise is on, the demo application form asks for the acceptance tick (spec 06
  "Labour promise").

## Home servicing in the workshop portal (2026-11-15, real API mode)

The owner (`service_menu:write`) sees a "Home servicing" card per workshop at the top of `/partner/workshop`: on/off, travel radius (1 to 25 km), visit fee (rupees, up to the city maximum shown under the field) and a tick list of the active menu lines done at home. Workshop staff (no menu permission) see no card. A new home request asks for the visiting mechanic's first name. A confirmed home job's next step is "Mechanic arrived": the customer's 4-digit arrival code plus the odometer (a wrong answer says how many tries are left; after 5 the form locks and points to MechDost support). After arrival the card offers "Offer to move the job to your workshop" (reason, and how the vehicle gets there) and "Waive the visit fee" (reason code); a declined offer turns the next step into "Bill the visit fee". Detail: spec 06 § Built: home servicing.

## Workshop portal → Performance (built 2026-11-15, real API mode)

A quiet "Show performance" button under the workshop name opens **Performance** (lazy chunk, nothing in the header or layout): the owner's own numbers for the last 30 or 90 days (tiles for requests, offers answered with a proposal, median time to propose, estimate lines approved, average bill, rating; funnel; mode; speed; estimates; money; quality; cancelled and rejected by reason) with the **anonymised city median** beside the tiles. `GET /v1/workshop/analytics?from=&to=` is for the **`workshop_owner` grant only** (workshop staff and admins who own nothing get 403, because the figures are money; no new permission). The workshop comes from the grant; a foreign `?workshop=` id is 404; the answer never contains another workshop's name or figures, and the medians are null until three workshops have requests in the range. Shared definitions and tests: spec 08 "Analytics → Workshops". Event `workshop_analytics_viewed {rangeDays}`; audit row `API-WS-PERFORMANCE`.
