# 08 · Admin console, CMS & analytics

Status: decided · Phase 1 (core) → 3 (full analytics) · Decisions: Admin control, Analytics, Reviews

## Goal

One console (concept admin shell) where the team routes work, runs operations, controls every piece of content and configuration, and sees impressive but calm analytics.

## Areas

1. **Overview dashboard**: KPI tiles (orders today, GMV, AOV, pending routing, median time-to-accept, acceptance rate, cancellation %, refunds ₹, active service requests, open tickets, avg rating); charts: orders & GMV trend, status funnel, category mix, service categories, orders by hour, cohort/repeat rate; map: orders and workshops by pincode (MapLibre heat); leaderboards; alerts.
2. **Queues**: Needs routing · Awaiting shop (timers) · Needs rerouting · Returns to review · Refunds pending (four-eyes; built 2026-11-15 as Admin → Refunds, spec 05 "Built: refunds": waiting, overdue by `refunds.approval_sla_hours`, being sent, needs checking, closed) · SR needs routing · Tickets · Review moderation · Product approvals · Partner applications · Deletion requests.
3. **Orders / Service requests**: lists with filters, saved views (P1), detail with timeline, route/reroute/reject, cancel, refund, notes, tags, resend notifications, print invoice/slip, manual order.
4. **Customers**: 360 (orders, bookings, vehicles, tickets, consents, events), block (incl. COD), notes; impersonate read-only (P1), merge (P1).
5. **Catalogue**: products & photos (concept editor + variants, fitment, part numbers), approval queue with diff, categories tree drag-drop, brands, attribute sets, vehicle master, HSN/GST master, media library, CSV import (concept importer UX kept), duplicate detection.
6. **Partners**: shops, workshops (concept 5-fieldset editor incl. coordinates-from-link parser and verification checklist), applications, staff links, commission overrides, payout runs, penalties, scorecards, announcements.
7. **Promotions**: coupons, automatic promos, free-shipping rules, banners linkage, usage reports.
8. **Content (complete control)**: every banner/headline/helper text/FAQ/policy string editable with preview and versioning; home sections show/hide/reorder; category tiles and icons; navigation menus; announcement bar; legal pages; en + hi side by side.
9. **Settings**: cities & pincodes (launch toggles), timeouts/windows/fees/COD caps per city, tax masters, shipping zones, couriers, payment gateways, notification templates (DLT ids) with per-event toggles, roles & permissions, staff (invite, scope, 2FA enforcement, sessions), API keys, webhooks, feature flags, maintenance mode, locales.
10. **Logs & exports**: audit log (searchable), webhook deliveries, notification log, payment log, security log; CSV exports as async jobs (concept dataset list), backups status.

## Data

`content_blocks` (key, locale, value, version, published_at), `site_sections` (order, visible), `settings` (scope city/global, key, value jsonb, version), `feature_flags`, `staff`, `roles`, `role_permissions`, `audit_log`, `export_jobs`, `metrics_daily` (rollups for charts).

## API

`/admin/*` behind RBAC; dashboard reads from `metrics_daily` + live counts; content served to the storefront via cached `GET /content?locale&city` with ISR revalidation on publish.

## UI

Concept admin shell (`05-page-admin.png`, `admin.css` tokens) with Manrope/DM Sans; Recharts; dataviz skill rules (text labels for every KPI, no colour-only meaning); dense density dial.

## Rules

Every mutation audited; four-eyes on refunds/payouts/commission above threshold; content publish creates a version and revalidates; settings changes take effect for new transactions only; staff scoped by city see only their cities.

## Analytics (admin usage)

`admin_action` events for every mutation (actor, entity, duration) feed ops analytics.

## Acceptance tests

RBAC matrix per endpoint; content publish updates storefront within revalidation; dashboard numbers reconcile with order tables; export job produces file and audit row.

## P1/P2

Saved views, version history diff, impersonation, merge customers, reports (GSTR-1 ready), outbound webhooks, theme editor (not planned), page builder (not planned).

## Demo implementation (2026-11-01)

`/admin/{overview|orders|services|quotes|applications|reviews|content|layout|settings}` (`components/portal/admin-console.tsx`): KPI tiles linking to queues, order routing, reassignment of declined service requests, bulk-quote desk (chat as MechDost + offer builder; discount vs list shown for information, price set by negotiation, Q20), partner application steps, review moderation. Data from the browser store; API + RBAC in Phase 1.

### Site customisation (demo, 2026-11-01 — user: "demo now, real later")

- **`/admin/content`**: announcement bar (2 messages) and home headline (small heading, 2 headline lines, introduction), English and Hindi side by side; empty = default text from the locale files (shown as the placeholder); character limits; reset to defaults.
- **`/admin/layout`**: reorder (↑/↓) and show/hide the 8 home sections below the hero (hero always first); category shortcuts — feature 3–6 of the 9 categories on the home page and set an emoji per category (validated as a single emoji; used on home tiles, shop chips and the empty cart).
- **`/admin/settings`**: shop acceptance time (5–120 min, default 15), bulk quote minimum (2–500 units, default 10, Q20), delivery fee (₹0–500, default ₹49) and free-delivery threshold (₹0–50,000, default ₹999). Values apply to **new** orders only: the timer is fixed into `expiresAt` when an order is offered, the fee is snapshotted on the order. Copy that mentions these numbers renders the live value (`<min>` rich-text tags + `SettingValue`).
- **Integrity (rule 3, demo form):** every value validated and clamped on read and on save; one **version per area** checked on save (a stale tab is refused, other areas are not blocked); every save/reset appended to an audit trail shown as "Recent changes" (who, what, when). Analytics: `admin_site_change {area, action, fields}`.
- **Performance (rule 6):** the home page stays a static Server Component. Section order/visibility and featured tiles are applied by a ~1 KB inline script in `<head>` (`SITE_LAYOUT_SCRIPT`, keys pattern-checked before they reach CSS) before first paint; text, emoji and numbers are tiny client islands (`components/site/site-overrides.tsx`) that render the server default first.
- Code: `apps/web/src/demo/site-config.ts` (store), `lib/site-layout.ts` (shared constants + script), `components/portal/admin-site.tsx` (editors). Tests: `test/site-config.test.ts` (validation, CAS, audit, CSS-injection guard), `e2e/admin-site.spec.ts` (content in en/hi, layout + categories, settings driving bulk minimum / delivery fee / timer copy, axe + overflow).
- **Settings API (built 2026-11-03):** one registry `packages/shared/src/settings.ts` (`OPERATIONAL_SETTINGS`: key → kind, min/max, default, nullable) is the single source of the keys, bounds and fallbacks that checkout (`CHECKOUT_SETTINGS`) and routing (`ROUTING_SETTINGS`) read. Keys: `checkout.cod_cap_paise` (₹0–1,00,000, default ₹5,000), `checkout.cod_fee_paise` (₹0–500, default ₹0), `checkout.free_delivery_min_paise` (nullable = no free delivery), `checkout.cod_reservation_minutes` (30–10,080, default 1,440), `orders.acceptance_timeout_min` (5–120, default 15, same as the demo screen), `catalogue.require_hindi_to_publish` (boolean, default off), `support.customer_messages_per_ticket_per_day` (5–100, default 20, global only; review B9), `assistant.daily_messages` (0–100,000, default 500, global only: the site-wide daily budget of AI assistant answers, 0 = off; security review 2026-11-14), `quotes.min_units` (2–500, default 10, Q20; the smallest bulk quote in units, read by `POST /v1/quotes`, spec 19), `quotes.cod_cap_paise` (₹0–10,00,000, default ₹50,000; the largest accepted bulk quote paid cash on delivery, spec 19), and the MechDost Coins rules (spec 20, 2026-11-14, global only, saving also needs `coins:rules`): `coins.value_paise` (₹1–10, default ₹1), `coins.max_redeem_bp` (0–5,000, default 1,000 = 10%), `coins.min_order_paise` (default ₹0), `coins.earn_order_bp` (0–2,000, default 0), `coins.first_order_bonus` and `coins.workshop_booking_bonus` (0–10,000 coins, default 0), `coins.workshop_reward_min_bill_paise` (default ₹500) and `coins.workshop_reward_cooldown_days` (0–365, default 30) against fake self-attested bookings, `coins.adjust_daily_cap` (default 5,000 coins per customer per IST day; adjustments are super admin only), `coins.unlock_days` (0–60, default 8), `coins.expiry_days` (30–1,095, default 180). A global value per key, optionally overridden per city (city wins).
  - `GET /v1/admin/settings?city=RPR` (`settings:read`): per key the default, the global row, the city row (each with `version`) and the value in effect. `PUT /v1/admin/settings/{key}` `{city|null, value, version|null}` and `POST /v1/admin/settings/{key}/clear` `{city, version}` (`settings:write`, super admin only today).
  - Scope: a global read or write needs an all-cities grant; a city needs a grant covering it; otherwise **404**. Writes are validated against the registry (422 `SETTING_TYPE` / `SETTING_RANGE`, unknown key 400), compare-and-set on `version` (409 `STALE_SETTING`), and audited (`setting.saved` / `setting.cleared`, before/after) in the same transaction. New values apply to new orders only (timer fixed in `expiresAt`, fees snapshotted).
  - Code: `packages/db/src/repo/settings-admin.ts`, `apps/api/src/routes/admin-settings.ts`. Tests: `packages/db/test/settings-admin.test.ts`, `apps/api/test/admin-settings.test.ts` (save/override/clear, read-only ops manager 403, city manager 404 outside their city, rate limit counted once).
  - Still to do: the demo `/admin/settings` screen switches to this API with the rest of the admin console (after Firebase sign-in); bulk-quote minimum and delivery fee join the registry when quotes and delivery fees move to the server.
- **Content API (built 2026-11-04):** registry `packages/shared/src/content.ts` (keys `announcement.orders|workshops`, `hero.eyebrow|titleLine1|titleLine2|lead`; 80 characters, the lead 280; plain-text cleaner) shared with the demo editor (`demo/site-config.ts` re-exports it). Table `content_blocks`: per key × locale a global text optionally overridden per city, each with at most one `draft` and one `published` row.
  - Public `GET /v1/content?locale=en|hi&city=RPR` → `{content: {key: text}}` with only published text (city override first; keys missing = the locale-file default, so `/hi` never falls back to English); `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`.
  - Admin (verified staff): `GET /v1/admin/content?city=` and `PUT /v1/admin/content/{key}/{locale}` `{city|null, value, version|null}` need `content:write` (marketing, super admin; city managers for their city); `POST …/publish` `{city|null, version}` (draft version) and `POST …/unpublish` `{city|null, version}` (live version) need `content:publish` (marketing, super admin) — a city manager drafts, someone else publishes. Global text needs an all-cities grant, a city override a grant for that city (else 404). Compare-and-set everywhere (409 `STALE_CONTENT`), empty text 422 `CONTENT_EMPTY`, audit `content.draft_saved|published|unpublished` (before/after), server event `admin_content_published {key, locale, action}`.
  - Code: `packages/db/src/repo/content.ts`, `apps/api/src/routes/content.ts`, shared scope helper `apps/api/src/routes/city-scope.ts` (also used by settings). Tests: `packages/db/test/content.test.ts`, `apps/api/test/content.test.ts`.
  - **Policy pages (built 2026-11-04):** `policy.privacy`, `policy.returns`, `policy.delivery`, `policy.service` are structured documents on the same rows (registry `packages/shared/src/policy.ts`): `{title ≤ 80, lead ≤ 280, sections ≤ 20 × {heading ≤ 80, body ≤ 2000 (blank line = new paragraph), emoji?}, updatedOn YYYY-MM-DD}`. Plain text only; placeholders `{company}`, `{address}`, `{phone}` filled by plain replacement at render (official facts stay in one place); an unknown placeholder, bad date, non-emoji icon or empty section is 422 `POLICY_INVALID` with `details.problem`. Same draft → publish → unpublish rules and permissions as the short texts (`PUT /v1/admin/content/policy.privacy/{locale}` with the document as `value`). Public `GET /v1/content/policies/{key}?locale&city` → `{policy | null}` (null = the page shows its locale-file text; `/hi` never falls back to English), cacheable. A stored row that no longer validates is treated as missing, never rendered.
  - Storefront pages (2026-11-04): `/policies/company` (operator, registered office, GSTIN, phone/WhatsApp, complaints: acknowledged within 48 hours, resolved within one month — Consumer Protection (E-Commerce) Rules; grievance officer name follows Q15b), `/policies/privacy`, `/policies/delivery` (PIN check, GST-inclusive prices, shop confirmation, delivery code, cash on delivery, cancel until packed — admin-set amounts are "shown at checkout"), `/policies/returns`, `/policies/service-terms` (verified workshop, proposal, per-line approval, cancel until the vehicle is received, bill, pickup only where offered). Shared layout `components/ui/policy-sections.tsx`; en + hi copy in `policies.*`; all five linked from the footer's policy row; in the Hindi gate and the page audit.
  - Next: the storefront reads `GET /v1/content` (ISR, revalidate on publish) when the web switches to the API with sign-in.
- **Phase 1:** same screens on `content_blocks`, `site_sections` and per-city `settings` behind `/admin/*` RBAC with publish → revalidate; text served by the content API (no client islands). Known demo limits: changes live in one browser; FAQ, policies, menus, banners, catalogue, partners, promotions and staff/roles editors are still to build.

### Partner controls (2026-11-01)

`/admin/partners`: tabs Shops / Workshops / Mechanics (onboarded mechanic applications); per partner Pause / Suspend / Resume / Reactivate with a partner-visible reason (5–300 chars), status pill, last change and recent history. Effects (demo `apps/web/src/demo/partner-status.ts`, production `shops.status` + `partner_status_events`):

- **Paused:** excluded from routing and booking, banner in the portal, listed to customers as "not taking new bookings".
- **Suspended:** hidden from the finder and home, booking disabled, portal locked with the reason and the support number.
- **Guards:** routing, accepting, booking and reassignment are refused in the store too.

**Customer blocking (built 2026-11-03, API; console screen next).** Table `customer_blocks` (migration 0027; RLS on): `level` `cod_only` (must prepay) · `orders` (can browse and raise support requests, cannot order) · `full` (cannot sign in); `reason_code` from `CUSTOMER_BLOCK_REASONS` (`packages/shared/src/customers.ts`: cod_refused, fake_orders, payment_fraud, abusive_behaviour, policy_violation, account_security, other) + optional staff-only note (≤ 500) + optional end date; `created_by`; lifting sets `lifted_at/by/reason` (5–300 chars) with compare-and-set on `version`; rows are never deleted (history). Database rules: one active block per user and level (partial unique index), no self-blocks, complete lift fields, end after start. API: `GET /v1/admin/customers/{userId}/blocks` (`customers:read`), `POST …/blocks` and `POST /v1/admin/customers/blocks/{blockId}/lift` (`customers:block`, verified staff; today super admin only, Q65); audit rows `customer.blocked` / `customer.unblocked`. Enforcement: `full` → every signed-in request 403 `ACCOUNT_BLOCKED` (within the 60 s session cache, Q29); `orders` → `POST /v1/orders` 403 `ORDERS_BLOCKED`; `cod_only` → `COD_NOT_ALLOWED` with `reason: customer`. **Targets and scope (security review 2026-11-03):** only customers can be blocked: a user with any staff role → 403 `BLOCK_NOT_CUSTOMER` (staff access is removed by revoking roles, spec 13); shop/workshop users can get `cod_only`/`orders` but not `full` (`BLOCK_PARTNER_FULL`: suspend the partner instead). The block API requires an **all-cities** grant (`SCOPE_REQUIRED` for city-scoped holders) until customers carry a home city (Q65). **Console screen (demo, built 2026-11-03):** Admin → **Customers** (`/admin/customers`, `apps/web/src/components/portal/admin-customers.tsx`, store `apps/web/src/demo/customer-blocks.ts`, same rules as the API): customer accounts only (staff and partners never listed or blockable), masked numbers, current blocks as pills with their effect, reason, end date, who and when; Block… (level, reason code, optional end date, staff note) and Lift (reason); earlier blocks under a disclosure. Enforced in the demo: checkout refuses `orders` and — because the demo takes cash on delivery only — `cod_only` (also when the blocked number is typed in signed out), sign-in refuses `full` (told only after the right password) and a fully blocked session ends. Client event `admin_customer_block {action, level, reasonCode?}`. Tests: `apps/web/test/customer-blocks.test.ts`, `e2e/customer-blocks.spec.ts` (desktop + mobile, axe, Hindi). Not yet: automatic COD-off after N refused deliveries, `blocked_entities` (phone/device/IP/PIN), wiping a fully blocked user's live inbox.

Next (research/admin-console.md, adopted): availability vs standing, scorecards, reason codes, pause end dates (Q28). Tests: `e2e/partners-admin.spec.ts`, `packages/db/test/integrity.test.ts` "partner standing".

### Notifications and map default (2026-11-03)

User 2026-11-02: "all these options need to be with the admin too".

- **`/admin/notifications`**:
  - Status card (WhatsApp off until the Meta setup, Q50–Q63).
  - One card per WhatsApp event (`packages/shared/src/whatsapp.ts` catalogue): on/off switch, English and Hindi text side by side with a live preview (sample codes), and the same checks as the API. The checks are `bodyProblem`: no offer/discount/coupon wording in utility templates, exactly the `{{1}}…{{n}}` placeholders, ≤ 1,024 characters. Default texts come from the locale files (`notifyTemplates`, read raw because `{{n}}` is Meta syntax, not ICU).
  - Compare-and-set per event, change history.
  - Monthly WhatsApp budget alert (₹, whole rupees) with this month's estimated spend.
  - Demo store: `apps/web/src/demo/notification-settings.ts`. Production: `GET|PUT /v1/admin/notifications/templates`, `GET /v1/admin/notifications/whatsapp`, `PUT /v1/admin/notifications/whatsapp/budget` (verified staff with `notifications:manage`).
- **Layout → "Workshop map: default view"**: satellite (default) or plain map, stored in `site-config` `layout.mapDefault`. A viewer's own switch on their device still wins (`savedMapMode(fallback)`).
- **Hindi content editing** (product/workshop `_hi` fields) arrives with the catalogue admin and the `_hi` columns (decision 2026-11-02).
- **Emails tab (2026-11-15, real sign-in builds; `admin-emails-api.tsx`, loaded on demand)**: a tab bar (WhatsApp | Emails) on Admin → Notifications. The Emails tab lists every email by audience (customers, partners) with its purpose, "default text / edited / off" and an on/off switch (switching a transactional email off asks first, inline). **Edit** opens one email at a time: English | Hindi tabs, subject, heading, body and button label (prefilled with the text in effect), placeholder chips that insert at the cursor, a live preview of the real layout with sample data (sandboxed iframe), **Save text**, **Send a test to me**, **Reset to default**. Unknown placeholders, HTML and over-long text are refused locally and by the API. Audited; compare-and-set on `version`. Actions in the event: `saved | enabled | disabled | reset | test_sent`. Spec 10 has the data and API.
- **Events**: `admin_notifications_change {target, action}`, `admin_site_change {area: layout}`.
- **Tests**: `e2e/admin-notifications.spec.ts`, `test/notify-defaults.test.ts`, `apps/api/test/admin-notifications.test.ts`, `packages/db/test/notification-admin.test.ts`; the Hindi gate covers `/hi/admin/notifications` (ADMIN_SECTIONS).

### Support inbox (2026-11-03)

`/admin/support`: requests from the website and WhatsApp with deadlines, overdue flags, masked numbers, replies, internal notes and resolve/reopen (details in spec 09).

### Seller onboarding queues (2026-11-13)

- **`/admin/applications`:** seller cards show the GSTIN or enrolment number, address, location (map link), product count, an "Invited" badge, and a warning when another open application has the same GSTIN. Sellers at verification get **Approve with delivery area** (the city's PIN codes all ticked; charge and days pre-filled from `partners.default_shipping_paise` and `partners.default_lead_days`). Every application is rejected with a reason code (`APPLICATION_REJECT_REASONS`).
- **`/admin/partners`:** **Invite a seller** (name, email, mobile → link; open, copy, revoke; status waiting, application received, revoked or expired), **Price requests** (shop, asked price, MRP; approve, or reject with a reason code from `PRICE_REJECT_REASONS`; needs `prices:approve`) and **Seller agreement** (publish a new version in English and Hindi; every version is kept).
- **API:** `GET /v1/admin/partner-applications`, `GET …/{code}`, `POST …/{code}/approve` (with the delivery area), `POST …/{code}/reject`; `GET|POST /v1/admin/partner-invites`, `POST …/{id}/revoke`; `GET /v1/admin/price-requests`, `POST …/{id}/decide`; `GET /v1/admin/agreements/current`, `POST /v1/admin/agreements`. All scoped to the staff member's cities; lists take `limit` and `cursor` and return `nextCursor` (invites and applications newest first, the price queue oldest first).

## Catalogue: attributes and pack sizes (2026-11-13)

Staff with `products:write` set a product's typed attributes (`PUT /v1/admin/catalogue/products/{slug}/attributes`, strict per category, versioned, audited) and each pack's net quantity (`PUT /v1/admin/catalogue/variants/{sku}/net-quantity`, audited). The attribute list per category is code (decision 2026-11-13); the values are the admin's. The editor screen comes with the admin catalogue UI (spec 21 P1).

## Order rules (2026-11-13)

Admin → Settings → **Order rules**: "Customers may cancel their own order until the shop confirms it", one switch for cash on delivery (`orders.customer_self_cancel_cod`) and one for online-paid orders (`orders.customer_self_cancel_online`). Both off by default (Q25; split 2026-11-14). The browser demo keeps one switch for both. Spec 05.

## Partner pauses end by themselves (2026-11-13, Q28)

- **End date:** a pause may carry an optional end date (`shops.paused_until`). The worker's sweep (`resumeEndedPauses`, every 60 s) resumes shops whose date has passed, with:
  - a compare-and-set on the version;
  - a history row (`paused → approved`, "The pause ended", credited to the staff member who set the pause);
  - a system audit entry `partner.pause_ended`.
- **Pauses without a date:** they stay until resumed by hand.
- **Q28 answers:** no fixed warn → pause → suspend ladder (the admin decides each time); one admin may offboard.
- Test: db `partner-pause.test.ts`.

## Admin → Catalogue screen (2026-11-14, plan 2026-11-13 admin catalogue + PIN prices, Task 5)

`/admin/catalogue` (section `catalogue` in `apps/web/src/lib/sections.ts`). Real backend only: in the browser demo it says "Catalogue editing uses the real backend: available after the switch to real sign-in" and makes no API calls (test `e2e/admin-catalogue.spec.ts`; the Hindi crawl covers `/hi/admin/catalogue`). With real sign-in the editor loads on demand (`admin-catalogue-editor.tsx`, so its code and Zod schemas stay out of other admin sections):

- **List**: every product (cursor "Show more"), filter "Missing Hindi", status and how many Hindi texts are missing.
- **Texts**: English and Hindi name, short spec, fits, description — only changed fields are sent, with the product `version` (a stale save reloads and says so).
- **Fit & specs**: vehicle types (2W/3W/4W); pack size per SKU (quantity + unit); specifications shown read-only (edited through the catalogue import for now).
- **Prices**: city code (default RPR, any city), the city price per SKU with its floor (lowest shop price) and the MRP checked before sending, then each PIN: what customers pay and why (PIN price / city price / nearest shop), best-case margin, one-click suggestions (nearest, lowest, highest shop price) and a PIN price that can be removed.
- Responses are validated with the shared schemas `@mechdost/shared/admin-catalogue`; calls go through `apps/web/src/lib/admin-api.ts` (Firebase ID token, error codes translated as `portal.cat_err_*`).

## Admin → Orders on the API (2026-11-14, Stream C2)

With real sign-in `/admin/orders` loads `admin-orders-api.tsx` on demand (other sections unchanged): routing queue, ranked shops from the API (paused, suspended, busy and already-tried shops never offered), one-click routing, reject with a reason code and customer message, cancel with a reason code, delivery override with a written reason. Details and remaining gaps: spec 04 § Real API mode.

## Real API mode (2026-11-14)

Stream D of the real-API launch (`docs/superpowers/plans/2026-11-14-real-api-launch.md`). In real sign-in builds (`AUTH_MODE === 'firebase'`) these admin sections call the API through `apps/web/src/lib/admin-api.ts`; each API screen is a separate component loaded with `next/dynamic`, so demo bundles are unchanged and demo mode works as before. Answers are validated with `@mechdost/shared/admin-config-api`, `support-api` and `partner-api`; API error codes become field messages or the shared `portal.api_common_err_*` messages (`apps/web/src/lib/api-error-key.ts`), and every list has loading, error-with-retry and empty states.

- **Notifications** (`admin-notifications-api.tsx`): see spec 10.
- **Support** (`admin-support-api.tsx`): see spec 09.
- **Settings** (`admin-site-api.tsx` `SettingsApi`): every key of the `@mechdost/shared/settings` registry with its default and range; money is typed in whole rupees and stored in paise; checked with `settingProblem` before sending; one Save sends `PUT /v1/admin/settings/{key}` (global value, compare-and-set) for the changed keys. The demo's yes/no "order rules" card is not shown: `orders.customer_self_cancel` is in the list. City overrides are API-only for now.
- **Site content** (`ContentApi`): the live text of the announcement and home headline keys per language. "Save and publish" writes the draft (`PUT /v1/admin/content/{key}/{locale}`) and publishes it; an emptied field is unpublished (the default text shows). Policy pages are not edited here yet (API supports them).
- **Customers** (`admin-customers-api.tsx`): the API has no customer search, so staff open a customer by account id, then block (level, reason never preselected, optional end day in IST and staff note) or lift with a reason; history shown. The block reason select starts empty (the demo still preselects one).
- **Partner applications, invites, price requests, seller agreement** (`admin-onboarding-api.tsx`): see spec 07 "Real API mode". Layout editor, coins and quotes are still demo-only.
- **Partners → Shops** (`admin-shops-api.tsx`, 2026-11-14): the city's shops with standing, open now/closed, PIN and
  product counts; per shop: profile (English + Hindi, GSTIN with approval rights, minutes to accept, free delivery
  from ₹, working hours), delivery PIN codes (charge, days, on/off), products (add from the live catalogue with
  price ≤ MRP, stock and on/off; edit per row), pause / suspend / reactivate with a reason code (never preselected)
  and a note, an optional pause end, history, and portal access by phone. The demo shop tab is hidden in real
  sign-in. Details: spec 07 "Shop management on the API".
- **Settings:** new key `orders.closed_shop_grace_min` (15–240 min, default 60, per city): how long after a closed
  shop opens it still has to accept an order routed to it while closed (spec 04).
- **Reviews** (`admin-reviews-api.tsx`, 2026-11-14): moderation queue on the API (Waiting / Published / Hidden; approve, hide with a reason code and staff note; compare-and-set). Details: spec 02 § Reviews.
- **Services** (`admin-services-api.tsx`) and **Partners → Workshops** (`admin-workshops-api.tsx`), Stream E: route or reject service requests; add/edit workshops (English + Hindi, hours, menu), publish / verify location, pause / suspend / reactivate with a reason, portal access by phone. The demo workshop tab is hidden in real sign-in. Details and gaps: spec 06 § Real API mode (web).
- **Service area** (`admin-pincodes-api.tsx`, under Settings; built 2026-11-14): a city's PIN codes — add, edit (centroid, English + Hindi area, free-delivery threshold), switch off with a reason code or on; `settings:read` to see, `cities:manage` to change. The seller approval form can fill in the city's active PIN codes. Details: spec 15 "PIN codes".
- **Gaps:** no customer search/list endpoint; no audit-history endpoint for the "Recent changes" cards (not shown in API mode).
- **Add product** and **Import CSV** (built 2026-11-14, plan 2026-11-14 Stream B; runbook `docs/runbooks/catalogue-import.md`): above the list. The form asks for the category first (it decides the specification fields: selects for codes, numbers for V/Ah/months), then brand, English and Hindi texts, highlights (one per line), vehicle types, the first pack (SKU, MRP in rupees, HSN, GST slab, pack size) and "Publish right away"; a new product opens in the editor. The import offers the column template, a file input, **Check file** (dry run: ready count, skipped SKUs, or a table of problems by row and column) and then **Import N products**. Strings `portal.cat_add_*` / `portal.cat_import_*` (en + hi); form logic in `apps/web/src/lib/admin-catalogue-add.ts` (unit-tested). Events: `admin_catalogue_product_added`, `admin_catalogue_import_checked`, `admin_catalogue_imported` (click), server `admin_product_created`, `admin_catalogue_imported`.

## Analytics (built 2026-11-14)

User (2026-11-14): "i want to be able to view them in our website for the admin" — a built-in Analytics page from our
own data (not embedded PostHog). Real sign-in builds only (`AUTH_MODE === 'firebase'`); the browser demo has no
Analytics section.

- **API** (`apps/api/src/routes/admin-analytics.ts`, repo `packages/db/src/repo/analytics.ts`, response schemas
  `@mechdost/shared/admin-analytics-api`, ranges `@mechdost/shared/analytics-range`):
  - `GET /v1/admin/analytics/dashboard?city=&from=&to=` — verified staff with `analytics:read`; `from`/`to` are IST
    calendar dates (inclusive), default the last 30 days, at most 180 days, `from` not in the future (400
    `RANGE_INVALID` / `RANGE_TOO_LONG`; unknown query parameters 400). `city` is a city code inside the caller's
    analytics scope (another city is 404); without it, every city in scope — always passed to SQL as an explicit
    city-id list (never "every row"), so the `(city_id, created_at)` indexes serve the all-cities view too. Cached per
    (cities, traffic, range) for 2 min on the instance (`TtlCache`, 200 entries; concurrent misses for one key share
    one load) and `Cache-Control: private, max-age=60`. The whole report runs in **one read-only, repeatable-read
    transaction** with `SET LOCAL statement_timeout = '10s'` (`readOnlyReport`): one pooled connection, one
    consistent snapshot, queries one after another; a timeout (Postgres 57014) answers **503 `QUERY_TIMEOUT`** and
    the page says "choose fewer days or one city".
  - `GET /v1/admin/overview` — live queue counts for the Overview: orders to route / waiting for a shop / on their
    way (`orders:read`), service requests to route (`service:read`), open support (`tickets:read`), reviews to
    moderate (`reviews:moderate`), applications (`applications:review`, all-cities grant only: applications have no
    city), price requests (`prices:approve`), and today's orders and value (`analytics:read`). Each count is limited
    to the cities of its own permission and is null without it; no permission at all → 403. Not cached (live).
- **What the dashboard shows** (all integers: counts, paise):
  - KPIs: orders, order value (GMV), average order, cash-on-delivery share (count split), cancelled and rejected
    order parts with their reason codes (labels from `order.cancelReason_*` / `rejectReason_*`), online payments not
    completed, customers / new / repeat, service requests / confirmed / completed / cancelled, shop acceptance and
    median time to accept.
  - Charts per IST day (orders, order value, service requests, visitors), the funnel, most ordered / viewed
    products, top searches with "no match", orders and bookings by PIN code (area name in Hindi on /hi), shop
    performance (offers, accepted, declined, timed out, median time to accept), workshop performance (requests,
    confirmed, completed, cancelled, median time to the first proposal).
- **Definitions** (also in the repo's header): an **order** is a checkout that became one — cash on delivery, or
  online and paid (the routing queue's rule); unpaid online checkouts are counted only as "online payments not
  completed". **GMV** = value of order parts not cancelled or rejected; **AOV** = GMV ÷ orders with a live part.
  **New customer** = first order in the selected cities is in the range; **repeat** = more than one order in those
  cities up to the range's end (other cities' orders are never read, so a city manager learns nothing about them). Shop
  acceptance = accepted ÷ (accepted + declined + timed out), over offers made in the range (same rule as the routing
  ranker). Bookings "confirmed" = an explicit list of `confirmed` and the later working states
  (`BOOKED_SERVICE_STATES`, independent of the state array's order); "completed" = paid or completed. The funnel shows
  "% of the step before" only up to 100 %; a larger visitor step (add to cart from a list without a product page)
  reads "More than the step before" instead.
- **Traffic is site-wide**: web events carry no city yet (spec 12), so visitors, visits, product views (`page_view`
  on `/shop/<slug>`), searches, the funnel's visitor steps (distinct visitor ids: product view → add to cart →
  checkout started) and top searches are computed only for staff whose analytics grant covers every city, and are
  null for city-scoped staff (the page says why). The order steps (placed → delivered) count orders, so the funnel
  never divides visitors by orders.
- **Privacy** (rule 16): no personal data in responses — ids, codes, product/shop/workshop/area names and aggregated
  search phrases; a phrase is listed only when at least three distinct visitors searched it (k-anonymity of 3), already
  scrubbed of phone numbers and emails on both ends. "No match" = the phrase finds no live product right now
  (`catalogueHasMatch`, the catalogue's own text search).
- **Indexes** (migration `0052_analytics_indexes`): `service_requests (city_id, created_at)` (replaces the
  single-column `city_id` index it leads with) and `order_assignments (offered_at)`. Everything else uses existing
  indexes: `order_groups (city_id, created_at)` → `orders (group_id, sub_no)` → `order_items (order_id)`;
  `order_groups (user_id, created_at)` for new/repeat; `events (event, occurred_at)` on the partition key (only the
  range's monthly partitions are read); `service_proposals (request_id)`; Overview counts use each queue's
  `(status, …)` index.
- **Web**: Admin → Analytics (`admin-analytics-api.tsx`, charts `analytics-charts.tsx`, helpers
  `lib/admin-analytics-view.ts`, calls `lib/admin-analytics-api.ts`), loaded with `next/dynamic` only in real
  sign-in. Presets 7 / 30 / 90 days, From / To (IST dates), city picker (the API's list of the caller's cities), one
  primary "Show"; loading skeleton, error with "Try again", empty state "No data yet — it appears once customers use
  the site". Charts: decision 2026-11-14 "Analytics charts in SVG". Admin → Overview with real sign-in reads
  `GET /v1/admin/overview` (`admin-overview-api.tsx`) instead of the browser demo store. Strings
  `portal.analytics_api_*` + `portal.nav_analytics` (en + hi). Click ids `admin_analytics_preset_{7|30|90}`,
  `admin_analytics_apply`, `admin_analytics_retry`.
- **Tests**: `packages/db/test/analytics.test.ts` (IST bucketing at 00:30 / 23:59 IST, city filter, unpaid online
  checkouts, GMV, new/repeat, funnel, top products, k-anonymous searches with "no match", areas, shops, workshops,
  Overview scopes), `packages/shared/test/analytics-range.test.ts`, `apps/api/test/admin-analytics.test.ts`
  (401/403/verification, city scope 404, no traffic for city staff, range 400s, cache header, Overview per
  permission), `apps/api/test/ttl-cache.test.ts`, the bypass suite, `apps/web/test/admin-analytics-view.test.ts`.
- **Not yet**: quotes requested/accepted and coins (their tables are not on main); `metrics_daily` rollups (live
  queries are enough at launch volume — revisit at ~1M events/month or when the dashboard's p95 passes 1 s); traffic
  per city (needs `city_id` on web events); refunds ₹, ratings and an orders-by-hour chart from the Overview list
  above; CSV export.

## Admin → Errors (2026-11-14, decision "Monitoring")

- **Who:** verified staff with an all-cities `settings:read` grant (super admin, operations manager); a city manager gets 404, other roles 403. Real sign-in builds only (`ADMIN_SECTIONS` drops `errors` when `AUTH_MODE` is demo); the screen is `components/portal/admin-errors-api.tsx`, loaded with `next/dynamic`.
- **What:** the latest 25 unresolved Sentry issues per project — website (`mechdost-api`) and server (`mechdost-api-actual`) — for the configured environment: title (scrubbed), level, events in the last 24 h and in total, people affected, first/last seen, and "Open in Sentry". One action: Refresh. States: loading, failed (with retry), "not connected" (one next step: add the read token, monitoring runbook), "Sentry could not be reached" per project, "No unresolved problems".
- **API:** `GET /v1/admin/errors` → `{ connected, environment, fetchedAt, projects: [{ project, ok, issues }] }` (`@mechdost/shared/admin-errors-api`). The API calls `https://de.sentry.io/api/0/projects/{org}/{project}/issues/?query=is:unresolved environment:<env>&statsPeriod=24h` with the read-only `SENTRY_API_TOKEN`, keeps only whitelisted fields (no user emails, IPs, tags or event payloads), links only to `*.sentry.io`, caches 60 s per instance (15 s after a failure). The token never reaches the browser.
- **Analytics:** clicks `admin_errors_refresh`, `admin_errors_open`.
- **Tests:** `apps/api/test/admin-errors.test.ts` (roles, PII and token never in the answer, not connected, EU URL, cache, failing project).
- **Later:** a dedicated `errors:read` permission (needs the RBAC sync on production), resolve/ignore from the panel.

## Warnings to partners (2026-11-15)

- **Model:** `partner_warnings` (append-only): `issued` and `withdrawn` rows, reason code (`PARTNER_WARNING_REASONS`: missed
  offers, gave up orders, late deliveries, quality complaints, pricing issue, policy violation, other), optional note (5 to 300
  characters, required for "other"), real FKs `shop_id` / `workshop_id` (exactly one). The repository works for shops and
  workshops; **HTTP routes and screens exist for shops only** (workshops: next).
- **Admin → Partners → Shops → a shop → Warnings tab:** issue form (reason, note), the warnings in the window with a
  Withdraw action (note required; the original stays, marked withdrawn), the count, and the **pause prompt**: when live
  warnings in the window reach the threshold and the shop is still approved, a banner appears above the tabs and in the tab
  ("This shop has N warnings in the last 30 days. You may want to review its standing.") with a button to the Standing
  panel. Nothing is paused automatically.
- **Settings (Admin → Settings, global only):** `partners.warning_threshold` (default 3), `partners.warning_window_days`
  (default 30; a rolling 30 x 24 h window in UTC).
- **API:** `GET/POST /v1/admin/shops/{id}/warnings`, `POST .../warnings/{warningId}/withdraw`; read needs `partners:read`,
  issue and withdraw need `partners:approve` in the shop's city (404 elsewhere); strict bodies; audit
  `partner.warning_issued` / `partner.warning_withdrawn`; events `admin_partner_warning_issued` / `_withdrawn`.
- **Reroute queue:** an order a shop gave up shows the reason line and the shop's "gave this order up before" tag (spec 04).
- **Tests:** `packages/db/test/partner-warnings.test.ts`, `apps/api/test/shop-give-up.test.ts`.

## Trust lines and the labour promise setting (2026-11-15)

Design: `docs/superpowers/specs/2026-11-15-trust-wording-design.md`; plan `docs/superpowers/plans/2026-11-15-trust-wording.md`.

- **Trust lines** are eight admin-editable texts, one per placement, in **Admin → Content → "Trust lines"** (a fourth
  group after the announcement bar and the home headline). They are ordinary content keys (`trust.homeGenuine`,
  `trust.homeBill`, `trust.homeEstimates`, `trust.product`, `trust.checkout`, `trust.emailFooter`, `trust.workshop`,
  `trust.partner`; registry `packages/shared/src/content.ts`), so the same rules hold: English and Hindi are edited and
  published separately, empty means the locale-file default (`trust` namespace, en + hi), one draft and one live text
  per key and language, compare-and-set on `version`, audit `content.draft_saved|published|unpublished`.
- **Hide a line** in one language by publishing the text `-` (a dash); the editor says so under the group heading and
  the field shows "Hidden". Removing the text brings the default back. The product line may use `{brand}`; an override
  that needs a brand the page does not have falls back to the default (`trustLineText`).
- **Where they show** (Server Components read the published text, cached 60 s with the tag `content`; the demo build
  also applies the browser-stored override in a tiny island, so no new client code on product pages):
  home hero (three lines under the search), product page near the price (brand from the product; **"GST bill" only for a
  GST-registered selling shop, left out when unknown, which is always on the product page today**), cart and checkout
  under the title, workshop page header and the partner page's seller card, and the order emails' footer line
  (`trust.emailFooter`, order templates `order_*` only, read by the worker at send time; the default for Raipur lives in
  `email-layout.ts` and a test keeps it equal to the locale text).
- **Default wording** (en): "100% genuine parts from verified {city} shops" · "Bill with every order" · "Clear
  estimates, you approve every line" · "Genuine {brand} part from a verified shop" · "Only original parts from verified
  shops. Pay online or cash on delivery." · "Genuine parts from verified {city} shops." · "Verified workshop · you
  approve every line of the estimate" · "Sell genuine parts to {city} customers". Truthful-claims rules: no "sealed
  pack", no blanket "GST bill".
- **Event:** `trust_line_edited {placement, locale, action}` (server, written with the publish or unpublish, besides
  `admin_content_published`).
- **Job photo settings** (Admin → Settings, site-wide, 2026-11-15): `service.photos_required` (default on: a before photo to receive the vehicle, an after photo to mark it ready), `service.photos_public` (default off: show completed jobs' photos on the workshop page; the admin alone decides) and `service.photos_max_per_stage` (6, 1 to 12). Labels: `portal.api_set_service_photos_*`. Spec 06 "Built: job photos".
- **Labour promise settings** (Admin → Settings, site-wide): `service.labour_promise_enabled` (default off) and
  `service.labour_promise_days` (7–90, default 30). The demo settings screen has one field, `labourPromiseDays`
  (0 = off, 1–6 are raised to 7).
- **Agreement clause:** Admin → Partners → Agreement has an "Add the Genuine parts only clause" button that appends the
  clause (en + hi, `packages/shared/src/seller-clause.ts`, **draft pending legal review**) to both texts once; the admin
  reviews and publishes a new version. Standing reason code `counterfeit_confirmed` ("Counterfeit product confirmed")
  joins the pause/suspend reasons.
- Tests: `packages/shared/test/trust.test.ts`, `packages/db/test/content.test.ts` (events), `apps/api/test/email.test.ts`
  (footer), `apps/web/test/trust-content.test.ts`, `site-config.test.ts`, UI state rows `trust=…` and `promise=…`,
  `API-ADM-CONTENT`.

## Staff, customer search and audit log screens (built 2026-11-15)

Design `docs/superpowers/specs/2026-11-15-admin-next-tier-design.md` items 1 to 3; plan `docs/superpowers/plans/2026-11-15-admin-tier1.md`. Real sign-in only (new sections `staff` and `audit` are in `REAL_SIGN_IN_ONLY`); every screen is en + hi under the `adminPeople` locale namespace.

- **Admin → Staff** (`staff:manage`, all-cities, in practice the super admin): `GET /v1/admin/staff` lists staff (role, city, last completed staff sign-in, phone-code state `ready`/`phone_missing`, phone and email masked). One primary action, "Give a role": phone (the person signs up first), role, city for city roles, a reason (5 to 300 characters). Each role has "Remove role" with a reason. Rules live in `repo/staff-admin.ts`: only staff roles scoped global or one city; **nobody changes their own roles** (403 `STAFF_SELF_CHANGE`, also hides the buttons); only a super admin grants or removes `super_admin` and `finance` (403 `ROLE_SUPER_ADMIN_ONLY`); the **last super admin cannot be removed** (409 `LAST_SUPER_ADMIN`, an advisory lock makes two simultaneous removals safe); a second identical grant is 409 `ROLE_ALREADY_HELD`. Each change writes `audit_log` (`role.granted` / `role.revoked`, with reason) and the event `admin_staff_role_changed` in the same transaction. After a change the person's cached session on that instance is dropped; a removal also ends their Firebase sessions (`revokeRefreshTokens`, best effort), and other instances follow within the 60 s session cache. "Last sign-in" comes from one `auth.staff_signed_in` audit row written when a staff sign-in completes (password plus fresh phone code). The CLI `pnpm db:grant-role` stays for the first admin.
- **Admin → Customers** (`customers:read`, all-cities): `GET /v1/admin/customers/search?q=` finds by 10-digit phone (last 10 digits, any format), email, order / checkout / request / ticket code, or name prefix (at least 2 letters); at most 20 results, contact always masked (`••••••1234`, `a•••@example.com`); 422 `SEARCH_QUERY` for weak queries; 30 searches per minute per user. `GET /v1/admin/customers/{id}` shows profile, orders, service requests, tickets, refunds, coins, consents (latest per purpose) and the existing blocks panel. Phone and email are unmasked only with `customers:read_pii` (super admin); **each unmasked view writes an audit row `customer.pii_viewed`** and the screen says so. A section whose permission the role lacks (`orders:read`, `service:read`, `tickets:read`, `refunds:read`, `coins:read`) is `null` and shows "Not available for your role", never an empty list.
- **Admin → Audit log** (`audit:read`, all-cities: super admin, finance): `GET /v1/admin/audit` newest first, filters entity type, entity id, an order/request/ticket code (resolved to the entity id), actor id, action (exact), IST date range (inclusive days); keyset cursor on `id`, 30 per page in the screen (max 100). Rows open to the reason and a before/after list (added / removed / changed, labelled in words). `before`/`after` are redacted for everyone: phone and email keys masked, address and bank keys `[hidden]`. Read-only.
- Admin events: `admin_staff_screen`, `admin_customer_search`, `admin_audit_search` (client; kinds and counts only), `admin_staff_role_changed`, `admin_customer_viewed` (server).
- Not built here: staff invite by email, editing a city scope in place (remove and give again). (Exports were built the same day, below.)

## CSV exports (built 2026-11-15, admin next tier item 4)

- **Admin → Exports** (real sign-in builds; `exports:run` plus the dataset's own read permission). Pick a dataset, a city (not for customers) and up to **180 days** (IST days, both inclusive); one primary action, **Download CSV**. The screen offers only the datasets and cities the viewer may export (`GET /v1/admin/exports/options`).
- **Datasets:** orders (checkouts), sub-orders (shop orders), refunds, service requests, partners (shops and workshops), customers. Dataset permission: orders and sub-orders `orders:read`, refunds `refunds:read`, service requests `service:read`, partners `partners:read`, customers `customers:read` (all-cities only, they have no city yet). Roles: super admin, ops manager, city manager (own cities), finance (orders, sub-orders, refunds, partners). Support agents, catalogue managers, marketing, shops, workshops and customers get 403.
- **Columns:** stable snake_case header; times `*_ist` as `YYYY-MM-DD HH:MM:SS` in Indian time; every amount as a pair `<x>_rupees` (two decimals, built from integer paise by string maths) and `<x>_paise` (exact integer); codes and ids only. Never exported: bank/UPI destinations, address text, notes, vehicle text. Customers: phone and email masked (`••••••1234`, `a•••@example.com`) unless the viewer holds `customers:read_pii`.
- **File format:** UTF-8 with a BOM (Excel opens Hindi correctly), CRLF, RFC 4180 quoting, and CSV-injection protection: a text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.
- **Flow (ruling, see decisions 2026-11-15 exports):** `POST /v1/admin/exports` validates (range, scope), counts rows (capped), writes `audit_log` `export.requested` (actor, dataset, range, city, row count, masked) and the event `admin_export_run`, and returns a signed download path valid **10 minutes**, bound to that staff member. `GET /v1/admin/exports/download?t=` authenticates the caller again, compares the user, re-checks the permissions and city scope, streams keyset pages (1,000 rows) and writes `export.downloaded` (rows actually sent) and `admin_export_downloaded`. Nothing is stored. More than 50,000 rows: 422 `EXPORT_TOO_LARGE` (never truncated silently). 40 calls an hour per staff member.
- **Data:** migration `0066_export_indexes` (orders `(city_id, placed_at, id)`, refunds `(created_at, id)`, users `(created_at, id)` where not deleted). Service requests, checkouts reuse existing `(city_id, created_at)` indexes; shops and workshops are small and use their city index.
- Code: `packages/shared/src/exports.ts`, `packages/db/src/repo/exports.ts`, `apps/api/src/routes/admin-exports.ts`, `apps/api/src/exports/token.ts`, `apps/web/src/components/portal/admin-exports-api.tsx`. Tests: shared `exports`, db `exports` (11), api `admin-exports` (17), web `admin-exports-view`.
- Not built: events dataset export (design said "events (pseudonymous)": left out until the analytics event store has an owner for it), stored files and a job (Q121), a history list of past exports (the audit log viewer shows them: entity `export`), a browser run of the new audit row.

## Policy pages, home layout, city values and company details (built 2026-11-15, admin next tier part 2)

Design `docs/superpowers/specs/2026-11-15-admin-next-tier-design.md` items 5 to 8; plan `docs/superpowers/plans/2026-11-15-admin-tier2.md`. All four are real sign-in screens (no demo twin except the layout editor, which keeps its browser store). **No new permission** (so no `db:seed`): content screens use `content:write` (read, draft) and `content:publish` (publish, restore, layout save); company details use `settings:read` and `settings:write`, all-cities grants only.

- **Policy page editor** (Admin -> Content, under the trust lines). Pick one of the four policies (privacy, returns, delivery, workshop bookings) and a language; "Start from the current text" copies the built-in text (`builtInPolicy`, tested to be a valid document in both languages); title, lead, "last updated" date, up to 20 sections (heading, text, emoji, move, remove); preview rendered with the real section cards and the company placeholders filled; Save draft, **Publish** (saves the draft, then publishes it), "Use the built-in text" (unpublish). **History:** every publish and restore appends a row to `content_versions` (append-only, numbered per key + language + city); the list shows version, IST date, who, and "restored from N"; **Restore** (inline confirm, no modal) puts an old text live again as a **new** version after re-checking it with today's rules. The public pages (`/policies/privacy|delivery|returns|service-terms`) show the published text when there is one (title and description in the page metadata too) and the built-in text otherwise, plus the grievance officer card when filled.
- **Home layout on the API** (Admin -> Home layout in a real build): section order and visibility, 3 to 6 category tiles with emoji overrides, workshop map default, optionally per city (a city without its own row inherits the all-cities layout, shown as such; "Use the all-cities layout" removes the override). Stored as one jsonb document per scope in `settings` (key `site.home_layout`), compare-and-set on `version`, audited (`layout.saved` / `layout.reset`), **live on save** (no draft). The home page (`/`) reads `GET /v1/site/home-layout?city=RPR` on the server (cached 60 s, tag `site-layout`) and renders the visible sections in order; the category tiles get `featured` and `emoji` as props. **No client JavaScript was added to the home page**; the demo's pre-paint script and browser store are untouched. The map default is stored and served but **not yet applied** to the workshop map (not done).
- **City values** (Admin -> Settings): a city picker (cities in the staff member's `settings:write` scope: super admin today) switches the numeric settings to that city: only settings the system reads per city are listed (the `globalOnly` ones are not), each shows "Same as all cities" or "Set for this city", an overridden one has "Use the all-cities value" (the existing clear route). Saving writes city overrides (existing `PUT /admin/settings/{key}` with `city`). New: `GET /admin/settings/cities`; server event `admin_setting_city_changed`.
- **Company details** (Admin -> Settings, below the PIN codes): legal name, CIN, GSTIN, registered address, grievance officer name, email, phone; names and address also in Hindi. One jsonb document (`settings` key `company.details`, global), formats checked (CIN 21 characters, GSTIN 15, email, phone), audited `company.saved`. **Shown only when filled:** the footer's legal block (server-rendered, zero client JS) adds the CIN and a "Grievance officer" line; the policy pages and "Company and contact" page add the grievance officer card and the CIN; order and other emails use the grievance line from the setting (`Name · email · phone`), with `EMAIL_GRIEVANCE_CONTACT` as the fallback. **Legal name, GSTIN and address keep their built-in (user-confirmed, Q15) values until the admin fills them**; the Hindi pages never fall back to the admin's English text.
- **Refreshing the website:** after a publish, restore, layout save or company save the API calls the website's `POST /api/revalidate` (header `x-revalidate-secret` = `REVALIDATE_SECRET` on both; constant-time compare; only the tags `content`, `site-layout`, `company`; answers 404 when no secret is set). Best effort; the 60-second cache window is the fallback, so a missing secret only delays a change by up to a minute.
- **Tests:** shared `company-layout` (10), db `admin-tier2` (6: history numbering and append-only trigger, restore, layout city override and reset, company, city setting events, picker scope), api `admin-tier2` (8, with role-leak checks: support cannot read the history, a city manager cannot restore or reach the global text, finance cannot read or save the layout, ops manager reads but cannot save company details, marketing cannot read them), email grievance fallback, web `admin-tier2` (revalidate check, built-in policy text is valid in en and hi, lists agree with the demo editor), state-audit rows `API-ADM-POLICIES`, `API-ADM-LAYOUT`, `API-ADM-COMPANY` (and `API-ADM-CONTENT` now also mocks the policy history).

## Analytics → Workshops (built 2026-11-15, design `docs/superpowers/specs/2026-11-15-workshop-analytics-design.md`)

- **API:** `GET /v1/admin/analytics/workshops?city=&from=&to=` (`analytics:read`, verified staff; same IST range rules, ≤ 180 days; one city at a time, default the first city in the caller's scope; another city is 404). Answer: `totals` (all workshops of the city), `medians` (city medians over workshops with requests, null below three), and a row per workshop of the city (quiet ones too). Cached two minutes per (city, range) with single flight, `Cache-Control: private, max-age=60`; one read-only transaction with the 10 s statement timeout (503 `QUERY_TIMEOUT`).
- **Metrics:** requests received (assigned now + declined), by mode (workshop / home), funnel (requested, proposed, confirmed, received, estimate sent, approved, completed) read from `service_events`, cancelled and rejected by reason code, offers proposed vs declined (acceptance), median minutes to propose / to estimate / job time (`percentile_cont`), estimate lines sent vs approved (count and paise before GST, latest version), estimates with a declined line, billed total, average bill, home visit fees, paid cash / UPI / card, unpaid bills, rating (tenths) and count, "Returned within 30 days" (same customer + vehicle + workshop; not blame), jobs with photos attached.
- **Web:** a tab strip (Overview | Workshops) inside Admin → Analytics; the Workshops tab (`admin-workshop-analytics-api.tsx`, lazy chunk) shows the totals with the city median, then a table sortable by name, requests, acceptance, time to propose, lines approved, average bill, rating and returned (rows without a value last). Strings `workshopAnalytics.*` (en + hi). Events `admin_analytics_tab {tab}`; click ids `admin_analytics_tab_{overview|workshops}`, `admin_workshop_analytics_sort`, `admin_workshop_analytics_retry`.
- **Tests:** `packages/db/test/workshop-analytics.test.ts`, `apps/api/test/workshop-analytics.test.ts`, `packages/shared/test/workshop-analytics-api.test.ts`, `apps/web/test/workshop-analytics-view.test.ts` (incl. the JS-budget import graph), bypass suite rows; audit row `API-ADM-WORKSHOPS`.

## Built: Coupons (Promotions, 2026-11-15)

Admin → Coupons (real sign-in builds; `coupons:write`, held by marketing and super admin; city scope from the grant: a coupon outside it is a 404, "every city" needs an all-cities grant). Create and edit in place (no modal), pause with a reason (3–300 characters) and resume; the list shows one status word per row (live, paused, waiting for the shop, declined by the shop, scheduled, ended, fully used), the conditions, uses, and who funds it. Fields: code (4–20 letters and digits, case-insensitive, unique), name and conditions in English and Hindi, kind, value, cap, minimum, start, end, total limit, per-customer limit, city, funder and shop (approved shops only, in the coupon's city). Edits compare-and-set on `coupons.config_version` (admin edits and pauses only, so redemptions do not make a busy coupon un-editable). Kind, funder and shop lock once the coupon has been used. Changing what a shop-funded coupon gives (kind, value, cap, minimum, window, limits, first-order rule, city) re-asks the shop. Audit rows `coupon.created|updated|paused|resumed` with before and after; events `admin_coupon_saved`, `admin_coupon_paused`. API: `GET|POST /v1/admin/coupons`, `PUT /v1/admin/coupons/{id}`, `POST /v1/admin/coupons/{id}/pause`. Nothing here is hard-coded: Hindi text, limits and rules are all admin data.

## Catalogue tier 2 panels (2026-11-15)

Admin -> Catalogue: "Goes well with: rules" (add, edit, switch off, delete; both languages; priority; version-checked; `categories:write`). Admin -> Settings: "Waiting for a PIN code" (read only launch checklist; `cities:manage`, city scoped). Real sign-in builds only (they read the API). State-audit rows `API-ADM-RECO` and `API-ADM-DEMAND`.
