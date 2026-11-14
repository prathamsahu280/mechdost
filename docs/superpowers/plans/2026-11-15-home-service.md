# Home servicing Implementation Plan

> **For agentic workers:** native execution (one implementer), tasks in order; steps are checkboxes.

**Goal:** a workshop mechanic services the vehicle at the customer's home: opt-in workshop settings, a home booking mode with an upfront visit fee, an arrival code at the door, a visit-fee bill line, and an offer to move the job to the workshop.

**Architecture:** `service_requests.service_mode` (`workshop|home`) on the existing request flow and `serviceRequestMachine`; a side record `service_moves` for the move offer; settings on `workshops` / `workshop_services`; per-city max fee in `OPERATIONAL_SETTINGS`. Customer, workshop and admin surfaces reuse the existing routes/components.

**Tech Stack:** Drizzle + PostGIS (PGlite tests), Hono zod-openapi, Next.js (api + demo modes), next-intl-style JSON locale files.

**Spec:** `docs/superpowers/specs/2026-11-15-home-service-design.md` (+ spec 06, 07, 12, 14, 15).

## Global Constraints

- Integer paise; fee 0 to 50000 paise (hard DB cap), per-city max `service.home_fee_max_paise` (default 50000); radius 1 to 25 km (default 5); default fee 9900.
- State changes only through `serviceRequestMachine` (conditional UPDATE on status and version). New edge: `vehicle_received -> no_work_approved` by customer (move declined), recorded in spec 06.
- Arrival code: 4 digits, encrypted like the delivery code (customer must re-read it), 5 attempts then locked, admin override audited with a reason.
- Pickup only in `workshop` mode (CHECK). Home mode needs a pinned saved address owned by the customer.
- en + hi strings under namespace `homeService` only. Every new table: RLS on, grants revoked, bump_version + touch_updated_at triggers.

## Review Focus

- Workshop changes its fee between the customer seeing it and booking: booking is refused with `FEE_CHANGED`.
- Address pinned at the radius edge: listed at exactly the radius, not beyond (`ST_DWithin`, own radius per workshop).
- Two parallel wrong-code guesses: the attempt counter is reserved first (never more than 5 comparisons).
- Customer declines the move while the estimate is open: the estimate is superseded; the visit fee is billed once (or waived).
- Admin reassign of a home request to a workshop that does not travel there: refused.

---

### Task 1: Schema, migration, shared contracts

**Files:** `packages/db/src/schema/services.ts`, `packages/db/drizzle/NNNN_home_service.sql` (drizzle-kit), `packages/shared/src/state/index.ts`, `packages/shared/src/service-requests.ts`, `packages/shared/src/settings.ts`, `packages/shared/src/service-bill.ts`.
**Interfaces:** produces `SERVICE_MODES`, `MOVE_REASONS`, `MOVE_TRANSPORTS`, `VISIT_FEE_WAIVE_REASONS`, schemas `ProposeSchema.mechanicName`, `ReceiveVehicleSchema.arrivalCode`, `MoveProposalSchema`, `MoveDecisionSchema`, `WaiveVisitFeeSchema`, `HomeSettingsSchema`; setting `service.home_fee_max_paise`; `computeServiceBill(..., { visitFee })`.

- [ ] Failing tests: state machine edge; bill with visit fee (registered 18 %, unregistered 0 %, waived 0 line); DB CHECKs (pickup in home mode refused, radius 26 refused, home needs location).
- [ ] Implement, generate migration `home_service`, run db tests.

### Task 2: Repositories (db)

**Files:** `packages/db/src/repo/home-service.ts` (new: settings, arrival code, moves, waive), edits in `service-requests.ts`, `service-jobs.ts`, `workshops.ts`, `service-routing.ts`.

- [ ] Failing tests (`packages/db/test/home-service.test.ts`): listing none/some/edge, booking validations (fee changed, not pinned, foreign address, out of radius, service not home_available), arrival code right/wrong/locked/override, odometer with arrival, bill with fee, waive, move propose/accept/decline, foreign 404.
- [ ] Implement; run.

### Task 3: API routes

**Files:** `apps/api/src/routes/{service-requests,workshop-portal,workshops,admin-service-requests,service-schemas}.ts`, `packages/shared/src/analytics.ts` (events).

- [ ] Failing API tests (`apps/api/test/home-service.test.ts`): permissions, rate limits inherited, wrong-code response, override needs `service:route`.
- [ ] Implement; run.

### Task 4: Web (api mode) + demo

**Files:** booking form, finder, request view, workshop job, workshop portal settings card, admin workshop form, address pin step, locale files (`homeService`), view-model tests.

- [ ] Failing view tests; implement; state-audit rows; checklist regenerated.

### Task 5: Docs and gates

- [ ] Spec 06/07/12/14/15, decisions, progress, both learnings files; `pnpm check`.
