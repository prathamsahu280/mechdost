# Workshops next tier, part 1: implementation plan (2026-11-15)

Design: `docs/superpowers/specs/2026-11-15-workshops-next-tier-design.md` items 1 to 4. Specs 06, 07, 12, 14.

Order (each step: failing test first, then code, then docs):

1. **Schema** (`workshops_tier1`): `workshops.slot_capacity`; table `workshop_slots` (unique workshop+date+hour,
   CHECK `0 <= booked <= capacity`); `service_proposals.slot_hour` + `slot_released_at`; `service_requests.reschedule_count`
   (CHECK 0..2); table `workshop_change_requests` (location / GSTIN re-verification, one pending per kind).
2. **State machine**: `confirmed -> awaiting_workshop` by the customer (reschedule); timeout reuses
   `awaiting_workshop -> needs_routing` by system.
3. **Slots repo** (`workshop-slots.ts`): hours check, on-demand row creation, conditional decrement, idempotent release;
   release hooked once into `transitionRequest`.
4. **Propose with an hour**; **reschedule** (`rescheduleMyServiceRequest`); **timeout sweep** (`expireDueRequests`) +
   setting `service.acceptance_timeout_min` + worker loop; acceptance `expired` count in the workshop's stats.
5. **My workshop** self-edit repo + API (`/workshop/profile`, hours, menu, busy, capacity, slots) and change requests
   with staff decision.
6. **Web**: lazy "My workshop" card, hourly picker in the proposal form, customer "Change time".
7. **Docs, events, i18n, state-audit rows, learnings.**

Tests: `packages/db/test/workshops-tier1.test.ts` (parallel proposals into the last slot: exactly one wins; release on
cancel / reschedule / decline; timeout; stale accept), shared machine test, API role-leak + rate limits.
