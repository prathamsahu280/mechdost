# Shop staff performance and earnings, and live pings for service requests — plan

Date: 2026-11-16 · Design: `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md` ("later tasks 4 to 6" in the shop tier 2
ledger entry) · Specs 06, 07, 10, 12, 13, 14, 16 · User: "the smaller items too" (2026-11-16)

Rules in force: actor-scoped repositories (404 for a shop the caller does not work at), permissions decided in the API from
the caller's own grants, indexed queries only, integer paise, IST day boundaries, en + hi, one next action on every empty
state, analytics events, no page that feels like a reload, every opened panel closable; live pings carry an id and a
version only and never replace the polling fallback. Targeted tests only (low-memory PC, other builders running).

## Rulings (with the cost if wrong)

1. **Attribution = the actor on the order timeline** (`order_events.actor_id` where `actor_type = 'shop'`), read from the
   shop's own assignments (`order_assignments.shop_id`, indexed) then the timeline (`(order_id, id)`, indexed). No new
   column, no migration for this half. Cost if wrong: a step done through an admin override is counted for nobody (it stays
   in the shop total); cheap to change later because the source is append-only history.
2. **Earnings = the payout ledger** (`shop_payout_entries`, what MechDost owes the shop: Coins and coupon discounts on
   delivered orders), summed by IST day and by kind; a person's share is the ledger on the orders they delivered. The shop's
   own sales are not in the ledger today (weekly payouts, Q11, come later) and the screen says what the figure is. Cost if
   wrong: the owner expects sales revenue; the lead text names the figure and the later payout work widens it.
3. **Staff see their own numbers** (user, 2026-11-16: "owner sees all staff, staff sees own"). This refines the design's
   anti-goal "staff do not see payouts/performance money": a staff member sees only the ledger on orders they delivered,
   never the shop total, never another person.
4. **Windows are IST days** (30 or 90, the window starts at midnight IST of its first day), not rolling hours.
5. **Live pings for requests: one `request` topic** (customer + workshop users holding the request + city staff with
   `service:read`), one trigger on `service_requests` (migration 0073 widens the topic check). The RTDB rules need no new
   path: the inbox is generic and read-only for its owner (rule-text test added). The pings are hints; polling stays.
6. **Staff view mounts for everyone, lazily** (a toggle in the shop profile, code loaded when opened).

## Tasks (test first, in order)

1. Shared: `live.ts` topic kind `request`; `shop-staff-performance.ts` (DTO, pure metrics); analytics event
   `shop_staff_performance_viewed`. Tests `live.test.ts`.
2. DB: migration `0073_live_service_requests` (topic check + trigger); `resolveLiveRecipients('request:…')`;
   `shop-staff-performance.ts` repository. Tests `live-requests.test.ts`, `shop-staff-performance.test.ts` (real order flow:
   accept, pack, hand over, deliver, give up; IST edge; role scope).
3. API: `GET /v1/shop/staff-performance/{shopId}?days=` (any member; scope by grants), publisher `request~uuid` nodes and
   the rule-text test. Tests `shop-staff-performance.test.ts` (role-leak matrix), `live.test.ts`.
4. Web: `use-live-pings` hook, `useApiList(…, liveKinds)`, customer request page, workshop feed and admin queue listen for
   `request`; the lazy staff screen (en + hi `shopTier2.staff*`); audit row `API-SHOP-STAFF` + fixtures + hook; checklist
   regenerated. Tests `live-request-wiring`, `shop-staff-performance-view`.
5. Docs and ledger: specs 06/07/10/12/14, decisions, data model note, progress, learnings.

Gate (targeted): the new tests, db/api/shared suites that touch live and shop, web unit for the touched files, eslint and
prettier on touched files, `tsc --noEmit` once per touched package. No Playwright, no `next build`, no `pnpm check`.
