# Workshop analytics: implementation plan

Design: `docs/superpowers/specs/2026-11-15-workshop-analytics-design.md` (incl. "Builder check: coordinator calls").
Specs: 08 (Analytics → Workshops), 07 (Performance), 12 (events), 14 (migration 0062). Native plan, test first.

## Rulings (cost if wrong)

1. **One query shape, two callers.** `cityWorkshopAnalytics` (every workshop of a city, grouped, plus a grand-total row
   via grouping sets) and `ownWorkshopAnalytics` (same SQL with a `workshop_id` filter, using the new
   `(workshop_id, created_at)` index). Admin table and the portal's city medians read the same two-minute cache entry.
   Cost if wrong: if a city grows to hundreds of workshops the grouped query needs a rollup table (design approach 2).
2. **Cohort = requests created in the range.** Requests = assigned to the workshop now + requests it declined (a decline
   clears `workshop_id`, so declines are found in the timeline by `payload.declinedBy`). Cost: a request re-assigned
   away after a proposal counts for the new workshop only.
3. **Funnel from `service_events`** (a cancelled request keeps the steps it reached); times from the same timeline.
   Cost: a missing event (older data) lowers a step; no backfill needed, the timeline is append-only from 0044.
4. **Acceptance = proposed ÷ (proposed + declined).** Workshops have no response timer, so "timed out" does not exist
   (the design's "declined / timed out" reads as declined). Cost: if a timer is added, add an `expired` count.
5. **Paid online vs at workshop:** services are only paid at the workshop (cash/UPI/card), so the split is by method.
6. **Lines** from the latest estimate version, before GST. **Visit fees** = fees not waived on billed requests.
7. **City medians** = median of the workshops' own figures (not of all requests), only from 3 workshops with requests
   (k-anonymity); otherwise null and the screen says so. Cost: a city with 1-2 workshops shows no benchmark.
8. **Portal = `workshop_owner` grant only** (403 for workshop staff and for admins who own nothing); a foreign
   `?workshop=` id is 404. No new permission, so no `db:seed` at merge.
9. **Admin = `analytics:read`, one city at a time** (first in scope by default); another city is 404.
10. **Events:** `workshop_analytics_viewed {rangeDays}` (camelCase like every catalogue prop) and
    `admin_analytics_tab {tab}`.
11. **UI:** Admin tab strip inside the existing analytics page (Workshops chunk lazy); portal "Performance" is a quiet
    toggle under the workshop name (lazy wrapper, nothing in header/layout). No new portal section, so
    `model-api.ts` nav lists are unchanged.

## Steps (done)

1. DB: failing test, then `packages/db/src/repo/workshop-analytics.ts`; migration `0064_workshop_analytics` (index only).
2. Shared: DTOs, `workshopRates`, `workshopMedians` + tests.
3. API: `GET /v1/admin/analytics/workshops`, `GET /v1/workshop/analytics`, shared cache; role-leak, range, bypass tests.
4. Web: view helpers (+ import-graph test), stats view, admin tab, portal Performance; `workshopAnalytics` locale
   namespace (en + hi); events.
5. State audit: rows `API-ADM-WORKSHOPS`, `API-WS-PERFORMANCE`; checklist regenerated.
6. Docs and learnings.
