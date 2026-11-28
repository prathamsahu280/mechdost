# 07 · Partner portals (shop, workshop) & onboarding

Status: decided (commission pending) · Phase 1 (shop) / 2 (workshop) · Decisions: Partner KYC, Workshop slots, Tooling

## Goal

Mobile-first portals where partners accept work fast, manage catalogue/menus and stock, and see performance and payouts; onboarding from the concept's three "Apply as…" forms through admin approval.

## Onboarding

> **2026-11-26:** the Mechanic application is replaced by the Ustaad Network join (spec 23 § 4a): `/partners/apply/mechanic` renders the join flow, `/partners/status` shows a mechanic's verification progress, old mechanic applications are mapped to invites; Seller and Garage applications below are unchanged.

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
- **Sell another product, several shops (QA pass 4, 2026-11-16):** an owner of more than one shop gets one block per shop (heading "For {shop}" when there are several), each with its own state and requests; it no longer always targets the first shop.
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

## Shop portal tier 1: polish, busy toggle, team (2026-11-15, real API mode)

Design `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md` items (1) to (3); plan `docs/superpowers/plans/2026-11-15-shops-tier1.md`; assessment `docs/qa/vendor-portal-assessment-2026-11-15.md` items 2, 4, 5, 6 (item 1, live offers, came with the bell and push build).

- **Polish.** An offer leaves the list at its end time (client check against the clock, `liveOffers`), not at the next poll. A late accept answers `OFFER_EXPIRED` (the API reads the row after a failed compare-and-set) and the portal says "This offer expired. It has gone back to MechDost." Every accept, decline, pack, hand-over and delivery shows one calm confirmation line (`shopTier1.flash*`, a live region, sticky under the header) that lives in the page above the lists, so it survives the card leaving. The locked delivery code is server state: `GET /v1/shop/orders?view=active` carries `deliveryLocked` (from `shipments.delivery_code_attempts >= 5`), so a reload shows the lock with the support phone and a link to the support page. Empty lists carry one next action (offers: check stock and prices; active: see new offers; delivered: add a product).
- **Busy toggle.** `PUT /v1/shop/busy/{shopId}` (owner only): `{mode: 'closed_today'}` (until the next midnight IST), `{mode: 'hours', hours: 1..12}` or `{mode: 'clear'}`. It writes `shops.busy` and `busy_until`; every read of shops (ranker, suggestions, checkout, catalogue, my shop, admin list) tests `busy and (busy_until is null or busy_until > now())`, so the toggle ends by the clock and needs no job. Audited (`shop.busy_changed`), event `shop_busy_set`. `GET /v1/shop/me` and the admin shop rows/detail carry `busyUntil`; the admin list pill shows the end time. A busy shop keeps its accepted orders; it is only skipped for new offers.
- **Team.** `GET /v1/shop/team/{shopId}`, `POST .../invites` (name + Indian mobile), `DELETE .../invites/{inviteId}`, `DELETE .../members/{userId}`, all owner only (staff of the shop: 403 `OWNER_ONLY`; another shop: 404). An invite is bound to the phone (table `shop_staff_invites`, single use, expires after `partners.invite_days`, one open invite per phone per shop). Signing in grants nothing (security review 2026-11-15, consent). The invitee, whose verified phone the invite names, sees "Join {shop} as staff?" with Accept and Decline on their account overview (`GET /v1/me/shop-invites`, `POST /v1/me/shop-invites/{id}/accept|decline`). Accept (invitee only, phone must match, single use, not expired, compare-and-set on the invite's version) grants `seller_staff` for that shop plus the `shop_users` membership in one transaction; MechDost staff accounts are refused (`MEMBER_IS_STAFF`); decline closes the invite. Until accepted the owner sees only the name they typed in the invite, and afterwards still that name, never the account's own name. At most 10 people per shop (members + waiting invites, counted under the shop row lock, `TEAM_FULL`). Removing a member deletes the grant and the membership together and drops their cached session; other API instances follow within the 60 s session-cache period. Phones are masked to the last four digits everywhere.
- **No money for staff.** `GET /v1/shop/orders` returns `payoutPaise` and each line's `unitPaise` as null for shops where the caller lacks `payouts:read` (the owner has it; `seller_staff` does not). Cash to collect stays (the person at the door needs it).
- **Code and strings.** Web modules `shop-busy-api.tsx`, `shop-team-api.tsx`, `shop-flash.tsx`, `shop-empty.tsx`, `lib/shop-tier1.ts` (lazy real-mode portal chunk, nothing in the header); locale namespace `shopTier1` (en + hi).
- **Tests.** `packages/db/test/shop-tier1.test.ts`, `apps/api/test/shop-team.test.ts` (role-leak matrix), `packages/shared/test/shop-team.test.ts`, `apps/web/test/shop-tier1.test.ts`; state-audit row `API-SHOP-TIER1`.

## Workshop portal → Performance (built 2026-11-15, real API mode)

A quiet "Show performance" button under the workshop name opens **Performance** (lazy chunk, nothing in the header or layout): the owner's own numbers for the last 30 or 90 days (tiles for requests, offers answered with a proposal, median time to propose, estimate lines approved, average bill, rating; funnel; mode; speed; estimates; money; quality; cancelled and rejected by reason) with the **anonymised city median** beside the tiles. `GET /v1/workshop/analytics?from=&to=` is for the **`workshop_owner` grant only** (workshop staff and admins who own nothing get 403, because the figures are money; no new permission). The workshop comes from the grant; a foreign `?workshop=` id is 404; the answer never contains another workshop's name or figures, and the medians are null until three workshops have requests in the range. Shared definitions and tests: spec 08 "Analytics → Workshops". Event `workshop_analytics_viewed {rangeDays}`; audit row `API-WS-PERFORMANCE`.

## Built: offers to accept (shop-funded coupons, 2026-11-15)

A shop-funded coupon (spec 03 § Built: coupons) cannot be used until its shop has accepted the terms. The owner (not staff) sees **Offers to accept** on the shop portal (`/partner/shop`, real sign-in; hidden when the shop has none): the coupon's name, kind, value, cap, minimum, window, limits and conditions text, "You fund this discount", and Accept / Decline / Withdraw. `GET /v1/shop/offers/{shopId}`, `POST /v1/shop/offers/{shopId}/{couponId}/decision` (permission `inventory:write`, owner of that shop: staff 403 `OWNER_ONLY`, another shop 404). The decision is a compare-and-set on the terms row's version: when admin changes what the shop would pay the row goes back to `pending` and an old screen's accept fails with 409 `STALE_OFFER` (the shop never accepts terms it did not read). Withdrawing stops the coupon at once; orders already placed keep their discount, which the shop then funds. Audit rows `coupon.shop_accepted|declined`, event `shop_coupon_decided`.

## Built: "My workshop" (workshops tier 1, 2026-11-15)

- `GET /v1/workshop/profile` and `PUT /v1/workshop/profile/{workshopId}` (`service_menu:write`, scoped to the caller's workshop grants; another workshop is 404): profile text in English and Hindi (name, street, area), business phone, opening hours, busy mode, default capacity per hour and the menu (price ranges low to high, duration, on/off). Strict body: the pin, PIN code, GSTIN, `published` and `locationVerified` are rejected (400). Compare-and-set on the workshop `version` (`STALE_WORKSHOP`); audited (`workshop.profile_saved`); live at once.
- **Pin and GSTIN need staff.** `POST /workshop/profile/{workshopId}/changes {kind: 'location'|'gstin', ...}` files a request (table `workshop_change_requests`, one waiting per workshop and kind, 10 an hour per user); the live values stay until a staff member with `partners:approve` in the workshop's city decides (`GET /admin/workshop-changes`, `POST /admin/workshop-changes/{id}/decide {approve, note?, version}`; turning down needs a reason of 5 to 300 characters). Approving a pin applies it and marks the location verified; approving a GSTIN sets it and the GST-registered flag. A pin change may name a PIN code only inside the workshop's own city (`PINCODE_OTHER_CITY`, `PINCODE_NOT_SERVED`), checked at filing and again at decision (security review). The owner can withdraw a waiting request (`DELETE /workshop/profile/changes/{id}`).
- Web: `workshop-tier1-api.tsx` (My workshop card and the hour picker of the proposal form, lazy with the real-mode portal), `workshops/reschedule-api.tsx`, `workshops/tier1-error.tsx`; strings in `workshopTier1` (English and Hindi).
- **Not built:** a staff screen for the change requests (API only), photos from "My workshop" (job photos exist separately).

### Built 2026-11-15: shop portal next tier, part 2 (stock CSV, packing slip, performance, status lookup)

Design `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md` items 4 to 7; plan `docs/superpowers/plans/2026-11-15-shops-tier2.md`. No schema change (no migration): everything reads or writes existing tables.

- **Stock and price CSV** (`GET /v1/shop/csv/{shopId}/template`, `POST …/preview`, `POST …/apply`; `inventory:write`, own shop only, 404 otherwise; owner and staff). Columns `sku`, `stock`, `active` (yes/no), `requested_price` (rupees, optional); any subset with `sku`. Multipart `file`, at most 2,000 lines and 1 MB (own body limit; the global 1 MB limit skips this path), 30 uploads an hour per user. The file is parsed by the project's RFC 4180 parser (`catalogue-import.ts`, no new dependency) and checked against the shop's offers; the check lists changes and per-line errors with a code and column, never echoing cell text. A cell starting with `=`, `+`, `-` or `@` is treated as text and refused (`FORMULA_CELL`). Errors: unknown SKU, SKU not carried, bad numbers, stock below reserved, price above MRP, product not live, listing blocked by admin, duplicate SKU. **Apply re-checks from scratch inside one transaction and applies every change or none** (any line with an error refuses the whole file, `CSV_HAS_ERRORS`): stock and on/off go through `saveShopOffer` (version compare-and-set, audited per row), a price becomes a **price request** (`submitPriceRequest`), never a price; a price for a SKU the shop does not sell yet is a request to start selling and needs a stock count. One audit row `inventory.csv_applied` per file; events `shop_csv_previewed`, `shop_csv_applied`.
- **Packing slip** (`GET /v1/shop/slip/{code}`, `orders:fulfil`, only while the shop is fulfilling the order: confirmed to out for delivery; `SLIP_UNAVAILABLE` 409 otherwise, 404 for another shop's order). Data: order code, placed date, shop name, items and quantities (title, SKU), delivery PIN and area (Hindi area name on /hi), the customer's first name and the phone with all but the last four digits hidden (Q99: masked by default). No prices, street address, delivery code or full name; not an invoice (GST invoice waits on Q97). Page `/partner/shop/slip/{code}` prints on A5 (`@page`), with a QR of the order code drawn by `packages/shared/src/qr.ts` (own encoder, byte mode, level L, versions 1 to 4; loaded only when a slip opens); a link on each active order. Event `shop_packing_slip_viewed`.
- **Performance** (`GET /v1/shop/performance/{shopId}`, **owner only**: staff of the shop get 403 `OWNER_ONLY`, others 404). 30 and 90 days: offers accepted, median time to accept, orders given up after accepting, on-time hand-over (shipped within `SHOP_ON_TIME_HOURS` = 24 of accepting; Q118), approved reviews, each next to the **anonymous city median**: it leaves out every shop the owner holds, a metric needs at least `SHOP_BENCHMARK_MIN` = 5 other shops with a value (else hidden), and an owner with shops in two cities gets no median. Drawn as paired SVG bars with the numbers written beside them. Event `shop_performance_viewed`.
- **Public status lookup** (`/partners/status`, `POST /v1/partner-applications/status`). The applicant enters the reference and the phone they applied with; the page sends a one-time code (Firebase phone verification, same flow as sign-up), then the API verifies the ID token directly (no user row is created) and answers with the **stage only** (`new`, `in_review`, `approved`, `rejected`, kind and last-updated time; never the reviewer, note, reason, contacts or KYC). A wrong reference and a right reference with another phone give the same 404. Limits: 30 an hour per IP, 10 an hour per phone. A phone proved only for the lookup is signed out again; a visitor already signed in uses that phone (no second code). Demo builds match the reference and phone on the device. Event `partner_status_checked` (found yes/no only).
- **Code and strings.** Shared `shop-csv.ts`, `shop-performance.ts`, `shop-tools.ts` (DTOs), `qr.ts`; db `repo/shop-csv.ts`, `shop-slip.ts`, `shop-performance.ts`, `partner-status.ts`; API `routes/shop-tools.ts`; web `shop-csv-api.tsx`, `shop-performance-api.tsx`, `shop-slip-api.tsx`, `partner-status.tsx`, `lib/shop-tools-view.ts`, `lib/shop-tools-api.ts` (all in the lazy real-mode portal chunk or their own pages; nothing in the header); locale namespace `shopTier2` (en + hi). The shop portal page now also loads the `shopTier1` namespace, which tier 1 had left out of its `ClientMessages` list (its texts would have shown as keys).
- **Tests.** `packages/shared/test/shop-csv.test.ts`, `qr.test.ts`, `shop-performance.test.ts`; `packages/db/test/shop-tools.test.ts` (all-or-nothing, price requests, slip leaks, benchmark anonymity, status); `apps/api/test/shop-tools.test.ts` (role-leak matrix, multipart limits, hourly limit, status lookup); `apps/web/test/shop-tools-view.test.ts`; state-audit rows `API-SHOP-TIER2`, `API-SHOP-SLIP`, `API-PARTNER-STATUS`.
- **Not built:** a Turnstile on the status lookup (Q120); an editable on-time window (Q118); a real-scanner check of the QR (Q119); courier slips and the GST invoice (Q97); the Playwright run of the new rows and the print preview (by instruction).

### Built 2026-11-16: shop staff performance and earnings

Design `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md` (the "later tasks 4 to 6" of the tier 2 ledger entry); plan `docs/superpowers/plans/2026-11-16-shop-staff-live-pings.md`. **No new table**; the only migration of this change is the live trigger (`0073`, spec 10).

- **API** `GET /v1/shop/staff-performance/{shopId}?days=30|90` (`inventory:write`, i.e. owner and staff; default 30; other windows 400). A shop the caller does not work at is **404**, the same answer as a shop that does not exist. Who sees what is decided in `getShopStaffPerformance` from the caller's own grants: the **owner** gets every member, the whole-shop numbers and the payout ledger; a **staff member** gets only their own row (and `shop: null`, `earnings: null`). User ruling 2026-11-16: "owner sees all staff, staff sees own".
- **Numbers per person** (30 or 90 **IST days**, the window starts at midnight IST of its first day): orders accepted, packed, handed over, delivered, given up; median time to accept; on-time share (handed over within `SHOP_ON_TIME_HOURS` = 24 of accepting; a give-up is due and never on time, the same rule as the shop score). Attribution is the **actor on the order timeline** (`order_events.actor_id` with `actor_type = 'shop'`) read through the shop's own assignments, so an admin override or a person who has since left counts in the **whole shop** only.
- **Earnings** are the payout ledger (`shop_payout_entries`, integer paise, what MechDost owes the shop: Coins and coupon discounts on delivered orders): total, by kind and by IST day (newest first; days without entries left out). A person's share is the ledger on the orders **they delivered**. Shop sales revenue is not in the ledger until weekly payouts exist (Q11); the screen's lead text says what the figure is.
- **Screen**: Shop portal -> a quiet toggle "Team performance and earnings" (owner) / "My performance and earnings" (staff) opens the section on demand (`shop-staff-performance-lazy.tsx`, code loaded only when opened; the same button closes it). 30 / 90 day switch (the old numbers stay visible while the new ones load), earnings card with a bar per day (value always written beside the bar), one card per person, a whole-shop card; empty state with one next action ("Show 90 days", then "See new orders"); error with retry. `shopTier2.staff*` in en + hi.
- **Events**: server `shop_staff_performance_viewed` (`shopId`, `scope` owner or self, `days`); client `click` ids `shop_staff_perf_30` / `_90`, `data-track="shop_staff_performance_toggle"`.
- **Tests**: `packages/db/test/shop-staff-performance.test.ts` (the real order flow, IST window edge, role scope, other shop), `apps/api/test/shop-staff-performance.test.ts` (role-leak matrix), `apps/web/test/shop-staff-performance-view.test.ts`; audit row `API-SHOP-STAFF` (checklist regenerated, 4,253 items).
- **Not built**: a chart library (plain SVG bars); an owner view of one person's order list; payouts and statements (Q11); the browser run of the new audit row (no Playwright by instruction).

## Workshop bill payment and cancellation (2026-11-15)

The workshop still marks a bill paid at the workshop (cash, UPI, card); if the customer paid online first, the mark is refused (409, the request moved on); a capture after the mark is refunded by staff approval. A workshop cannot cancel a request after the visit is confirmed except through its existing `confirmed -> cancelled` edge; staff may cancel any live job (spec 06).

## Hindi stock-upload hint (2026-11-16, QA pass 3 bug 15)

Column names in the stock CSV hint stay in Latin as codes (`<code lang="en">`) and each is explained in Hindi (`shopTier2.csvRules`).

## Business applications: trade accounts and fleet enquiries (design 2026-11-22, item 3)

Separate from seller applications (their table is seller-shaped: GST status, address, map pin, products). Same ideas, own tables (migration `0078_business_applications`): `business_applications` (kind `trade` | `fleet`, code `BA-{CITY}-{YYYY}-{6}`), `business_application_events` (append-only), `trade_accounts` (one per user), `trade_account_events` (append-only).

- **Trade** (`POST /v1/me/trade-application`, signed in, phone verified; per-user 5/h): business name, type (`mechanic|garage|parts_retailer|other`), GSTIN optional (checksum when present), PIN (city derived; unserved PIN refused), spend band, category slugs. Contact is a snapshot of the account. One open application per account (partial unique index), refused when already verified.
- **Fleet** (`POST /v1/business-applications/fleet` signed out: Turnstile, 5/IP/h, 3/phone/day; or `POST /v1/me/fleet-application` signed in): company, vehicles 2W/3W/4W, needs (codes), optional 500-char note. A lead: review and close only (the DB refuses `approved`).
- **Status machine** `businessApplicationMachine`: new, in_review, approved, rejected, closed. Trade ends approved/rejected (reject needs an `APPLICATION_REJECT_REASONS` code); fleet ends closed. Conditional UPDATE on `(id, status, version)`.
- **Approving a trade application** (permission `partners:approve`) creates or restores the applicant's `trade_accounts` row (`verified`, saved business name and GSTIN) in the same transaction, with `trade_account_verified` event, audit and email. Staff can **revoke** with a reason code (`TRADE_REVOKE_REASONS`) and **restore** (`tradeAccountMachine`, version-checked): `POST /v1/admin/business-applications/{code}/trade-standing`.
- **Customer side**: `GET /v1/me` has `trade: { status: none|pending|verified|revoked }`; `GET /v1/me/trade` returns name and GSTIN only while verified. The account overview shows a "Trade account" pill; checkout pre-fills the optional buyer GSTIN and business name (nothing switched on, nothing required).
- **Admin**: Admin → Applications lists trade and fleet below the seller applications (kind filter; review, approve, reject, close, revoke, restore). Queue permission `applications:review`, city scope like seller applications.
- **Page** `/[locale]/business/apply?kind=trade|fleet` (en + hi; accessibility per the design: labelled fields, fieldsets, GSTIN hint, error summary with focus, focus to the success heading with the code). Demo sign-in builds show "applications open soon" (no demo store for accounts).
- Emails (spec 10): `trade_application_received`, `fleet_application_received` (signed-in applicants only; a typed address of a signed-out lead is never mailed), `trade_account_verified`. Staff get the existing `staff.new_application` bell notice.
- No rejection or revoke email yet (wording not approved).

## Roadside in the workshop portal (2026-11-24, spec 22)

`/partner/workshop` has a Roadside panel (permission `roadside:respond`, scoped to the caller's workshops): opt-in (on/off, radius 1 to 50 km, vehicle types, problem types, towing), offers with a countdown (accept, or decline with a reason code), and the job steps: on my way, the customer's arrival code (5 tries, then support), start, bill lines (kind, description, quantity, price), and "customer paid in cash". The customer's phone is never shown; calls go through MechDost support at launch.

## Delivery agents in the portals (2026-11-26, spec 24; screens not built yet)

- **Agent portal** (`/partner/delivery`, mobile first, en + hi): apply (public) and join by invite link; documents
  (PAN, driving licence, RC) with status; online toggle; offers with a countdown (accept, decline with reason); job
  screen by stage (shop details, pickup code + photo, customer details, delivery code + photo, or failed with reason +
  photo; give up before pickup); history; profile with own rating; payouts list (manual, no staff notes); support call
  as SOS. API: `/v1/agent/*`.
- **Shop portal:** "Ready for pickup" step and the pickup code for agent-mode orders; return code entry when an agent
  brings a parcel back; confirm or decline a "deliver it yourselves" switch (decline with reason); a "Deliver
  ourselves" request card (one pending per shop, withdraw). Self-delivery shops are unchanged.

## Delivery agents in the partner portals (2026-11-27, spec 24)

Shop portal for agent-mode shops (ready for pickup, pickup code, agent first name + vehicle, return code, switch
confirm/decline, "Who delivers your orders" requests) and the delivery agent portal `/partner/delivery`: spec 24
§ Web screens. Self-delivering shops are unchanged.

## Workshop portal tabs (2026-11-27 night, partner portals UI upgrade batch B)

Design: `docs/superpowers/specs/2026-11-27-partner-portals-ui-upgrade-design.md` § 6 and § 13 batch B; founder
answers 2026-11-27 (Q-PP-F1 own SVG charts, F2 split into tabs, F4 storefront header stays). Branch built against
local stand-ins for the partner kit (`_kit-shim.tsx`); **swapped for the real kit `components/partner/*`
(2026-11-28)**: the frame is now `PartnerFrame` (bottom bar under 1024 px, side rail above, icons per tab),
`KpiTile` has an icon chip and fires `partner_kpi_clicked` itself, `LaneTabs` takes `hrefFor` and fires
`partner_lane_viewed`, `StepRail` shows numbered circles, `BulletBar` carries its own label, value and "City middle"
line (the old `bulletScale` helper is gone; the kit's `bulletGeometry` replaces it).

- **Frame** (`app/[locale]/partner/workshop/layout.tsx` + `components/portal/workshop/workshop-frame.tsx`): guard,
  demo partner gate, message bundles (now incl. `partnerWorkshop`) and the tab bar live in the layout and stay
  mounted while tabs change. Tabs are links with `aria-current="page"` (48 px): **Today** `/partner/workshop`,
  **Jobs** `/partner/workshop/jobs`, **Numbers** `/partner/workshop/numbers`, **My workshop**
  `/partner/workshop/profile`. Calendar became a tab in Batch P (2026-11-28, below).
- **Today:** push prompt, name plate, four tiles counted from the `new` and `active` lists (no new API; "20+" when
  another page exists): New requests (amber, "Needs you" in words), Waiting for the customer, In the workshop, Ready
  or to bill; each tile links to its lane. Then New requests (propose or decline) and the roadside offers panel.
- **Jobs:** lane tabs with counts over `active` + `done`: Proposed · Confirmed · In the workshop
  (`vehicle_received`…`in_progress`) · Ready & bill (`ready`, `billed`) · Done (`paid`, `completed`, `cancelled`,
  `rejected`). `?lane=` keeps the lane (invalid or missing → first lane with work); `?job=SR-…` opens one job in
  place and keeps it open while it moves between lanes (ready → bill → paid), with "Back to jobs".
- **Job card:** a six-step rail (Received · Estimate · Work · Ready · Bill · Paid; "Step n of 6: name" in words,
  `aria-current="step"`) from `vehicle_received` on; estimate lines as rows with the state as a word badge
  (Approved green ✓, Waiting for the customer amber …, Declined grey ✕ struck through) and totals by state
  ("Approved ₹…" only once a line is approved, using the bill's maths; each group rounded on its own).
- **Proposal hour:** 48 px hour chips (radio buttons named `hour`) with free places in words ("2 free" / "Full",
  a full hour cannot be picked) instead of a select.
- **Numbers:** the Performance screen opens directly (the "Show performance" toggle is gone; still owner only,
  staff see why). Tiles get a bullet bar (your value in accent, the city middle as an ink marker only when ≥ 3
  workshops; both values written). Funnel bars in one blue (counts).
- **My workshop:** My workshop editor and Home servicing. Service menu rows show the price range and an amber
  **"Hindi name missing"** badge for a line without its Hindi title (hard rule 10; never blocks saving).
- **Old links:** stored notices (`rsa.offer`, `ustaad.attestation_requested`) open `/partner/workshop` = Today
  (roadside offers stay there); the old one-page anchors `#jobs-title` and `#completed-jobs` are forwarded to the
  Jobs tab (`legacyWorkshopTarget`, unit-tested in `apps/web/test/workshop-portal-view.test.ts`).
- **Demo builds:** Today and Jobs show the demo store's requests and jobs; Numbers and My workshop say they open
  with a real sign-in.
- Not built in this batch: master–detail at ≥ 1024 px, saved estimate line
  templates (P1), review replies (P2), state-audit row `WS-FRAME` (existing `API-WS-*` rows were pointed at the
  new tabs). Tiles count exactly the lane they open (decisions 2026-11-27 builder rulings).

## Partner portals leftovers, Batch P (2026-11-28)

- **Workshop Calendar tab** (`/partner/workshop/calendar`, `tab_calendar` Calendar / कैलेंडर; order Today · Jobs ·
  Calendar · Numbers · My workshop): read only. A seven-day strip of date chips (IST, today first; each chip is a link
  `?day=YYYY-MM-DD`, `aria-current="date"`, the visit count written for screen readers) and the chosen day's visits by
  hour (24-hour clock, "Time not set" last), each opening its job on the Jobs tab. Data = the workshop's `active`
  list; the rows gained additive `visitDate` (IST `YYYY-MM-DD`) and `visitHour` (0–23) from the **accepted**
  `service_proposals` row (subselects in `SUMMARY_SELECT`, indexed by `request_id`; null until a proposal is accepted
  and for hour-less older proposals; no migration). Counted statuses: `confirmed` … `billed` (paid, cancelled and
  declined visits drop out). Past-dated jobs still open stay on the Jobs tab, not on the strip. Empty day: one sentence
  and one action (See new requests). Event `partner_calendar_day_viewed` (spec 12). Demo builds: "opens with a real
  sign-in" like Numbers. Tests `workshop-calendar.test.ts`, `workshop-portal-view.test.ts`,
  `packages/db/test/workshops-tier1.test.ts`. Blackout dates and per-hour editing stay P2.
- **Rider job step rail:** the old 4-segment bar is the shared `StepRail`: Go to the shop · Pick up · Go to the
  customer · Hand over, "Step n of 4: name" in words, `aria-current="step"`. The step still comes from the real job state
  (`accepted` → `picked_up`) plus the rider's own "I'm there" tap (`agentStep`); test `rider-step-rail.test.ts`.
- **Kit a11y follow-ups:** the Hindi bottom-bar labels break inside their tile (`overflow-wrap:anywhere`) and the real
  bar height (two Hindi lines make it taller than 65 px) is measured by a `ResizeObserver` and set as
  `--partner-tabbar-h`, so scroll padding stays right at 320 px; after a user tab click focus goes to the new panel's
  first visible `h2`/`h3` (`tabIndex -1`, visible focus ring; waits up to 3 s for a tab body that loads late, never
  steals focus the partner already moved, falls back to the hidden `h1`).
- Not built: master–detail at ≥ 1024 px.

## Shop portal tabs (2026-11-28, partner portals UI upgrade batch A)

Design: `docs/superpowers/specs/2026-11-27-partner-portals-ui-upgrade-design.md` § 5 and § 13 batch A; founder answers
Q-PP-F2 (tabs), F3 (sound on by default), F4 (storefront header stays).

- **Frame** (`app/[locale]/partner/shop/(portal)/layout.tsx` + `components/portal/shop/shop-frame.tsx`): the layout is
  a route group so the packing slip `/partner/shop/slip/{code}` stays outside the frame. Guard, demo partner gate,
  navy strip (shop name and state in words: Taking orders / Busy / Closed now / Paused / Suspended / Waiting for
  approval; "{n} shops" for an owner of several), the kit's bottom tabs / side rail and the message bundles live in
  the layout and stay mounted while tabs change. Pure helpers and tests: `lib/shop-portal-view.ts`,
  `test/shop-portal-view.test.ts`.
- **Tabs** (links, `aria-current="page"`, 52 px bottom tiles): **Today** `/partner/shop` · **Orders**
  `/partner/shop/orders` · **Stock & prices** `/partner/shop/stock` · **Numbers** `/partner/shop/numbers` · **My shop**
  `/partner/shop/profile`.
- **Today:** push prompt, flash line, paused / suspended / pending banner, the four tiles (each links to its lane on
  Orders; compact chips while an offer is open), New orders with `OfferTimer`, the sound button and "Updated n min
  ago", then Orders in progress (packing slip, one next step, give up, delivery code or agent hand-over).
- **Orders:** `LaneTabs` with counts by real order state (`shopLaneOf`): Packing (`confirmed`, `packed`, `returned`…) ·
  Ready for pickup (agent shops only: `packed` in agent mode, `ready_for_pickup`) · Out for delivery (`shipped`,
  `out_for_delivery`) · Delivered · Given up or cancelled. `?lane=` keeps the lane (invalid or missing: first lane with
  work); `?order=CODE` opens one order in place with "Back to orders". Counts say "20+" when the list has another page.
- **Stock & prices:** Your prices, Sell another product, Update stock with a file (CSV), Offers to accept: moved
  unchanged. **Numbers:** How your shop is doing (owner; bullet bars), team or own performance and earnings (daily
  bars), Notes from MechDost. **My shop:** Seller agreement, availability, working hours, delivery area, who delivers
  your orders, photos, your team. Demo builds show Today, Orders, Stock and My shop from the demo store; Numbers says
  it opens with a real sign-in.
- **Old links:** every shop notice link in `notice-catalogue.ts` is a tab path (a test reads the catalogue): new
  warnings open Numbers, delivery-mode decisions open My shop, the rest open Today. Stored notices keep `/partner/shop`
  (= Today). Old one-page anchors are forwarded by the frame (`legacyShopTarget`): `#warnings`, `#shop-performance` →
  Numbers; `#prices-title`, `#new-product-title`, `#shop-csv`, `#shop-offers` → Stock; `#shop-team`,
  `#agreement-shop-title` → My shop; `#delivered-title` → Orders, lane Delivered.
- **Events** (spec 12, reused): `partner_tab_viewed`, `partner_kpi_clicked`, `partner_lane_viewed` with portal `shop`.
- **As built, Batch P (2026-11-28): "Delivered today".** The fourth tile counts today's delivered rows. `ShopOrder` gained an additive optional `deliveredAt` (ISO; from `orders.delivered_at`, set only on the `done` view's delivered rows, null elsewhere; no migration). The count is by IST business day (`istDateString`, never the device zone) over the first `done` page and reads "N+" when another page exists. String `partnerShop.kpi_delivered_today` ("Delivered today" / "आज पहुँचाए"); tests `shop-today.test.ts`, `packages/db/test/shop-orders.test.ts`. The older "Delivered" wording below is superseded.
- **As built, Batch P (2026-11-28): stock − / +.** Each "Your prices" row with an inventory row shows `ShopStockStepper` (44 px buttons, labelled with the product name, "{n} held for open orders"). One tap sends the next absolute `onHand` through the existing `PATCH /v1/shops/{shopId}/inventory/{sku}` (`saveShopOffer`, `{version, onHand}`: version compare-and-set, `STOCK_BELOW_RESERVED` guard), then loads the list again: nothing is shown before the server answers; a stale or below-reserved refusal (409) shows a plain message and reloads the row. Buttons are `aria-disabled` while busy (focus stays), the number is a polite `output`. Pure rules in `lib/shop-stock.ts`; event `partner_stock_stepped` (spec 12); strings `partnerShop.stock_*`; test `shop-stock-step.test.ts`.
- Not built in this batch: shop switcher and shop name on each card (needs the shop on `ShopOrder`, P1), per-row stock
  −/+ (P1), "Delivered today" count (needs a date on the row, P1), master–detail at ≥ 1024 px.

## Partner portals UI upgrade, batches 0 and A (2026-11-27 night; design `docs/superpowers/specs/2026-11-27-partner-portals-ui-upgrade-design.md`)

- **Kit accessibility fixes (2026-11-28):** lane scroller room for the focus ring, Home/End in `LaneTabs`, bottom-bar
  `scroll-padding-bottom` from `--partner-tabbar-h`, 12/13 px bar labels, focus to the page heading plus a polite
  status after a user tab click (`tabFocusPlan`, `PartnerFrame heading` prop; the rider layout keeps its own `h1`), and
  `focusHashTarget` for KPI hash links. Details in `docs/design-system.md` "Partner frame"; tests
  `apps/web/test/partner-kit-a11y.test.ts`, `partner-kit.test.ts`.
- **Layout shift and lane tabs (2026-11-28, batch C):** the partner frame root has `min-h-dvh` so the footer stays below the fold while a tab loads (live CLS 0.27-0.44, LV-6); `LaneTabs` take the V9 segmented look in light (`.lane-seg` track, white thumb; dark unchanged). Test `apps/web/test/layout-shift-frames.test.ts`.

- **Partner kit** (`apps/web/src/components/partner/`, batch 0 owns it; others import from `@/components/partner`):
  `PartnerFrame` + `PartnerStrip` (navy strip with the state in words and Help; bottom tab bar under 1024 px, navy
  side rail from 1024 px; lives in a portal's layout), `PartnerTabs`, `KpiTile`, `OfferTimer` (big countdown, tread
  bar from the server end time, "Hurry" under a minute, live region only at 5 min / 1 min / end), `LaneTabs`
  (`?lane=` links, the caller reads `searchParams`), `StepRail`, `BulletBar`, `DailyBars`/`DataTable` (re-exported),
  `useNewWorkAlert` + `OrderSoundButton` (Q-PP-F3: sound **on by default**; any tap unlocks audio, "Turn on order
  sound" shows only while the browser still blocks it; per-device choice in `localStorage`), `UpdatedAgo` (updated
  line + offline line). Pure maths in `apps/web/src/lib/partner-kit.ts` (`test/partner-kit.test.ts`). Strings in
  `partnerKit`; events `partner_*` (spec 12).
- **Shop (batch A, part 1):** the new-order card uses `OfferTimer` with the rule in words ("If you do not answer, the
  order goes back to MechDost"); the offers list has the order sound and the updated line; **Today tiles** (New ·
  Packing · Out for delivery, or Ready for pickup for agent shops · Delivered) above the offers, counted from the three
  existing lists (`lib/shop-today.ts`, "20+" when a list has more pages; "Delivered" counts the first page because
  the shop order rows carry no delivery date — "Delivered today" needs a date on `ShopOrder`, P1). Strings
  `partnerShop`.
- **Not built yet (batch A, part 2):** the split of `/partner/shop` into the five tabs (Today, Orders, Stock & prices,
  Numbers, My shop; Q-PP-F2) with the `#warnings` notice-link mapping, `BulletBar` on performance, `DailyBars` on
  staff earnings, price row with the MRP share, availability segmented choice and the weekday strip.
