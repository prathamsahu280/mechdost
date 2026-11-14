# Workshop analytics: admin section and workshop portal (design)

Date: 2026-11-15 · Specs: 08 (Analytics, built 2026-11-14), 06, 07, 12 · Decisions: "2026-11-15 — Launch features
round" (workshop analytics: "Both") · Research: market-scan § 4

## Intent

MechDost needs to know which workshops serve customers well, and workshops need to see the value of the platform from
day one. Admin → Analytics today covers orders and shops; workshops are missing.

## Goals / non-goals / anti-goals

- Goals: a Workshops part in Admin → Analytics (city-scoped, IST date ranges, same cache and timeout rules as the
  existing dashboard) and a "Performance" view in the workshop portal for that workshop only.
- Non-goals: technician efficiency and effective labour rate (no per-technician data; P2); payouts (pending #9).
- Anti-goals: a workshop seeing another workshop's numbers (only anonymised city medians); customer personal data in
  any report; unbounded queries.

## Approaches

1. **Extend the existing analytics repo and route (chosen):** new aggregate functions in `packages/db/src/repo/analytics.ts`
   style over `service_requests`, `service_events`, estimate lines, bills, reviews, with the same range resolver
   (`resolveAnalyticsRange`), read-only transaction with statement timeout, single-flight cache. Portal endpoint reuses
   them with `workshopId` fixed from the session (actor-scoped).
2. A nightly rollup table: faster at scale, stale data and more moving parts; not needed at launch volume (revisit
   when a query passes the p95 budget). Not chosen.

## Decided (metrics)

For a range (≤ 180 days) and city (admin) or the workshop (portal):

- Requests: received, by mode (workshop/home), by status funnel requested → proposed → confirmed → received → estimate
  sent → approved → completed; cancelled/rejected by reason code.
- Speed: median time to propose (awaiting → proposed), median time from received to estimate sent, median job time
  (received → ready).
- Acceptance: share of offered requests proposed (not declined / timed out).
- Estimates: lines sent vs approved (count and ₹), share of requests with at least one declined line.
- Money: billed total, average bill (ARO), visit fees (home), paid online vs at workshop.
- Quality: average rating and count in range, comeback rate (same vehicle, same workshop, new request within 30 days of
  completion — "comeback" only, no blame), photos-attached share.
- Admin extra: a workshops table (sortable: requests, acceptance, median time to propose, approval rate, ARO, rating,
  comebacks) and the city medians.
- Portal extra: the workshop's numbers next to the anonymised city median for the same range; last 30 / 90 days
  presets; no other workshop's names.

## Decided (rules)

- Permissions: admin needs `analytics:read` in the city; portal needs a workshop role for that workshop (owner or staff
  with a new `workshop_reports:read`? — builder's call: reuse the workshop owner role if staff should not see money).
- Indexes: every range filter on an index (`service_requests (city_id, created_at)` exists, migration 0052); add
  `(workshop_id, created_at)` if missing.
- UI: SVG charts as in the existing analytics page (no Recharts dependency), en + hi, empty state "No requests in this
  range", state-audit rows (empty / one / many workshops, long Hindi names, 320–1920 widths).
- Analytics events: `workshop_analytics_viewed {range_days}`, `admin_analytics_tab {tab}`.

## Left to the builder

Query shapes, whether to split the dashboard response into tabs (lazy per tab), median computation (`percentile_cont`),
chart choices.
