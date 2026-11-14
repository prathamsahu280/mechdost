# 08 · Admin console, CMS & analytics

Status: decided · Phase 1 (core) → 3 (full analytics) · Decisions: Admin control, Analytics, Reviews

## Goal

One console (concept admin shell) where the team routes work, runs operations, controls every piece of content and configuration, and sees impressive but calm analytics.

## Areas

1. **Overview dashboard**: KPI tiles (orders today, GMV, AOV, pending routing, median time-to-accept, acceptance rate, cancellation %, refunds ₹, active service requests, open tickets, avg rating); charts: orders & GMV trend, status funnel, category mix, service categories, orders by hour, cohort/repeat rate; map: orders and workshops by pincode (MapLibre heat); leaderboards; alerts.
2. **Queues**: Needs routing · Awaiting shop (timers) · Needs rerouting · Returns to review · Refunds pending (four-eyes) · SR needs routing · Tickets · Review moderation · Product approvals · Partner applications · Deletion requests.
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
- **Settings API (built 2026-11-03):** one registry `packages/shared/src/settings.ts` (`OPERATIONAL_SETTINGS`: key → kind, min/max, default, nullable) is the single source of the keys, bounds and fallbacks that checkout (`CHECKOUT_SETTINGS`) and routing (`ROUTING_SETTINGS`) read. Keys: `checkout.cod_cap_paise` (₹0–1,00,000, default ₹5,000), `checkout.cod_fee_paise` (₹0–500, default ₹0), `checkout.free_delivery_min_paise` (nullable = no free delivery), `checkout.cod_reservation_minutes` (30–10,080, default 1,440), `orders.acceptance_timeout_min` (5–120, default 15, same as the demo screen), `catalogue.require_hindi_to_publish` (boolean, default off), `support.customer_messages_per_ticket_per_day` (5–100, default 20, global only; review B9), `assistant.daily_messages` (0–100,000, default 500, global only: the site-wide daily budget of AI assistant answers, 0 = off; security review 2026-11-14). A global value per key, optionally overridden per city (city wins).
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

Admin → Settings → **Order rules**: "Customers may cancel their own order until the shop confirms it" (`orders.customer_self_cancel`, off by default, Q25). Spec 05.

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
