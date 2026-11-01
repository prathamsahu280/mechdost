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

`/admin/{overview|orders|services|quotes|applications|reviews}` (`components/portal/admin-console.tsx`): KPI tiles linking to queues, order routing, reassignment of declined service requests, bulk-quote desk (chat as MechDost + offer builder; discount vs list shown for information, price set by negotiation, Q20), partner application steps, review moderation. Data from the browser store; API + RBAC in Phase 1.
