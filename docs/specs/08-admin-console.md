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
- **Phase 1:** same screens on `content_blocks`, `site_sections` and per-city `settings` behind `/admin/*` RBAC with publish → revalidate; text served by the content API (no client islands). Known demo limits: changes live in one browser; FAQ, policies, menus, banners, catalogue, partners, promotions and staff/roles editors are still to build.

### Partner controls (2026-11-01)

`/admin/partners`: tabs Shops / Workshops / Mechanics (onboarded mechanic applications); per partner Pause / Suspend / Resume / Reactivate with a partner-visible reason (5–300 chars), status pill, last change and recent history. Effects (demo `apps/web/src/demo/partner-status.ts`, production `shops.status` + `partner_status_events`):

- **Paused:** excluded from routing and booking, banner in the portal, listed to customers as "not taking new bookings".
- **Suspended:** hidden from the finder and home, booking disabled, portal locked with the reason and the support number.
- **Guards:** routing, accepting, booking and reassignment are refused in the store too.

**Customer blocking (built 2026-11-03, API; console screen next).** Table `customer_blocks` (migration 0027; RLS on): `level` `cod_only` (must prepay) · `orders` (can browse and raise support requests, cannot order) · `full` (cannot sign in); `reason_code` from `CUSTOMER_BLOCK_REASONS` (`packages/shared/src/customers.ts`: cod_refused, fake_orders, payment_fraud, abusive_behaviour, policy_violation, account_security, other) + optional staff-only note (≤ 500) + optional end date; `created_by`; lifting sets `lifted_at/by/reason` (5–300 chars) with compare-and-set on `version`; rows are never deleted (history). Database rules: one active block per user and level (partial unique index), no self-blocks, complete lift fields, end after start. API: `GET /v1/admin/customers/{userId}/blocks` (`customers:read`), `POST …/blocks` and `POST /v1/admin/customers/blocks/{blockId}/lift` (`customers:block`, verified staff; today super admin only, Q65); audit rows `customer.blocked` / `customer.unblocked`. Enforcement: `full` → every signed-in request 403 `ACCOUNT_BLOCKED` (within the 60 s session cache, Q29); `orders` → `POST /v1/orders` 403 `ORDERS_BLOCKED`; `cod_only` → `COD_NOT_ALLOWED` with `reason: customer`. Not yet: the console screen + analytics events (`admin_customer_blocked {level, reason_code}`, `admin_customer_unblocked`), automatic COD-off after N refused deliveries, `blocked_entities` (phone/device/IP/PIN), wiping a fully blocked user's live inbox.

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
