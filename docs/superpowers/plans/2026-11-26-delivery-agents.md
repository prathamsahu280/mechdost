# Delivery agents (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Execution method chosen by the lead: **native** (one builder agent, backend only; a second agent builds the web
> screens after the contract commit).

**Goal:** MechDost delivery agents deliver prepaid shop sub-orders (apply → invite → documents → admin-assigned
offers → pickup code + photo → customer code + photo, or failed → retry / return to shop), with shop self-delivery
by admin approval.

**Architecture:** A `delivery_jobs` entity next to the sub-order with its own state machine (versioned CAS, one
active job per sub-order by partial unique index, order row locked first), offers in `delivery_job_offers` like
`order_assignments`, agents in `delivery_agents` (status history in `delivery_agent_events`). The order machine gains
`ready_for_pickup` and the terminal `returned`; actor `delivery_agent`. Everything city-scoped, behind the per-city
switch `delivery.agents_enabled` (default off).

**Tech Stack:** Zod (shared DTOs), Drizzle + Postgres/PostGIS (migrations 0105+), Hono + zod-openapi, PGlite tests
(Vitest), outbox notifications (email, WhatsApp, push), first-party analytics events.

**Spec:** `docs/superpowers/specs/2026-11-26-delivery-agents-design.md` (approved; Lead's calls 1–13),
`docs/research/delivery-agents.md`, codebase study (scratchpad `delivery/codebase-study.md`).

## Global Constraints

- Rule 3: every status change through a machine in `packages/shared/src/state` as a conditional UPDATE with `version`;
  order row first; append-only `*_events`; outbox for every message; actor-scoped repositories (404 for foreign ids).
- Rule 4: `deliveries:*` permissions for the agent role only (never `orders:*`); Zod `.strict()` on every body;
  Turnstile + IP + phone limits on the public apply form; code entry 20 / 10 min per user plus 5 tries per code.
- Rule 10: every new string en + hi (`delivery.*` namespace, email/WhatsApp/notice templates).
- Rule 16: reasons are codes (free text only as a note); integer paise; UTC timestamps; events with stable ids.
- No Aadhaar: document number fields refuse any 12-digit number.
- COD sub-orders are always shop-delivered (Lead's call 8). Agents never see the delivery code (decision 2026-11-14).
- Customers never see the shop or the agent's phone (decision 2026-11-22; Lead's call 7).
- Low-memory machine: prettier on changed files; vitest one package at a time `--maxWorkers=1`;
  `NODE_OPTIONS=--max-old-space-size=4096` for tsc; no web build, no e2e (web agent).

## Review Focus

1. Two admins offer the same job, or an agent accepts while the sweep expires the offer → exactly one wins (CAS +
   one-open-offer index); the loser gets 409.
2. An agent opens another agent's job id, or a job whose offer expired / was declined → 404, never contact data.
3. Pickup with the wrong shop code 5 times → locked; the order stays `ready_for_pickup`; admin override audited.
4. Deliver in the same request the customer cancels / admin overrides → order row lock serialises; one outcome.
5. COD sub-order at a shop in `agents` mode → stays `shop` mode end to end (no job is ever created).

---

### Task 1: Contract (shared) — "feat(delivery): contract"

**Files:** Create `packages/shared/src/delivery/codes.ts` (Zod-free codes, vehicle loads, refund rule, contact stage),
`packages/shared/src/delivery/api.ts` (Zod DTOs), `packages/shared/src/state/delivery.ts` (job + offer machines);
modify `state/machine.ts` (actor `delivery_agent`), `state/index.ts` (order machine), `rbac.ts`, `settings.ts`,
`package.json` exports, `i18n/en.json` + `hi.json` (`delivery.*`); tests `test/delivery.test.ts`,
`test/state.test.ts`, `test/rbac.test.ts`. Design doc gets the API route table.

**Produces:** `DELIVERY_JOB_STATES`, `deliveryJobMachine`, `DELIVERY_OFFER_STATES`, `deliveryOfferMachine`,
`DELIVERY_FAIL_REASONS`, `DELIVERY_DECLINE_REASONS`, `DELIVERY_GIVE_UP_REASONS`, `AGENT_STATUSES`,
`AGENT_STATUS_REASONS`, `AGENT_VEHICLE_TYPES`, `DEFAULT_VEHICLE_MAX_LOAD_G`, `LOAD_CLASSES`, `vehicleCarries()`,
`subOrderLoad()`, `returnRefundKind()`, `contactStage()`, `AGENT_DOCUMENT_KINDS`, `normaliseDocumentNumber()`,
`SHOP_DELIVERY_MODES`, `ORDER_DELIVERY_MODES`, DTOs per route (table in the design doc).

- [ ] Write failing tests: every allowed/forbidden job and offer edge; order machine `packed→ready_for_pickup` (shop),
      `ready_for_pickup→out_for_delivery` (delivery_agent only), `out_for_delivery→returned` (shop, admin),
      `out_for_delivery→ready_for_pickup` (system), `returned` terminal; refund rule table; load maths; Aadhaar refused;
      role `delivery_agent` holds only `deliveries:*`; settings defaults; i18n parity (existing test).
- [ ] Run `pnpm --filter @mechdost/shared exec vitest run --maxWorkers=1 test/delivery.test.ts test/state.test.ts` →
      FAIL; implement; → PASS; tsc shared 0.
- [ ] Commit "feat(delivery): contract".

### Task 2: Schema + migrations 0105/0106

**Files:** Create `packages/db/src/schema/delivery.ts`; modify `schema/orders.ts` (order status/reason CHECKs,
`delivery_mode`, events actor CHECK, shipments mode `agent`), `schema/catalogue.ts` (`shops.delivery_mode`,
`products.load_class`), `schema/platform.ts` (application kind), `schema/media.ts` (owner kinds), drizzle
generate → `0105_delivery_agents.sql` + hand SQL (RLS, revoke, version/updated_at + append-only triggers, order
event trigger actor); `test/rls-inventory.ts`; tests in `test/delivery-schema.test.ts`.

- [ ] Failing PGlite tests: one active job per order (second insert fails), one open offer per job, append-only
      events refuse UPDATE/DELETE, encrypted CHECKs, `returned` needs a fail reason code, schema invariants/RLS inventory.
- [ ] Generate + hand SQL, `drizzle-kit check`, journal `when` > 0104; tests PASS.

### Task 3: Repositories

**Files:** Create `packages/db/src/repo/delivery-agents.ts` (applications, invites, linking, documents, statuses,
online), `repo/delivery-dispatch.ts` (rank, offer, accept, decline, expire, withdraw, give up), `repo/delivery-jobs.ts`
(create job on ready-for-pickup, pickup, deliver, fail, failure decision, return hand-back, contact reveal, agent and
admin reads), `repo/shop-delivery-mode.ts` (requests, admin set, per-order switch); modify `shop-orders.ts`
(ready_for_pickup branch, COD → shop), `orders.ts` (returned side effects: coins, coupon, refund kind), `refunds.ts`
(parts-only amount), `routing.ts` (set `orders.delivery_mode` at routing; `cityScopeFrom` staff-only hardening),
`customer-orders.ts` (agent first name + vehicle, stage), `notify`/`order-notifications.ts`.

- [ ] Each behaviour test-first in `packages/db/test/delivery-*.test.ts`: concurrency (Promise.all accepts), role
      leak (agent A/B, other city, shop, customer), reveal by stage (audited), codes + lock, photo required setting, retry
      limit, return → refund kind, COD stays shop, self-delivery shop path unchanged.

### Task 4: API routes + worker

**Files:** Create `apps/api/src/routes/delivery-agent.ts`, `admin-delivery.ts`, `delivery-public.ts`; modify
`shop-orders.ts`, `app.ts` wiring, `worker.ts` (offer sweep), rate-limit rules; tests `apps/api/test/delivery-*.test.ts`
(permission matrix, 404s, RateLimit-Remaining drops by 1, Turnstile).

### Task 5: Notifications, analytics, docs

Templates (email catalogue, WhatsApp `partner_delivery_offer` + `partner_delivery_invite` files, notices) en + hi;
analytics events in `analytics.ts`; docs: spec 24 (new), 04, 05, 07, 08, 10, 12, 13, 14, decisions, questions,
progress, README index, learnings.

### Task 6: Verification

`website-testing` → `verification-before-completion`: prettier (changed files), tsc shared/db/api/web, eslint per
touched package, vitest shared/db/api one at a time.

## Advisor brief (mechdost-advisor, 2026-11-26, written before the first code edit)

```
ADVISOR BRIEF — Delivery agents backend
Context loaded: CLAUDE.md; docs/progress.md (head, 2026-11-26 entries); docs/decisions.md (2026-11-26 delivery
  entry); design doc (Lead's calls 1–13); docs/research/delivery-agents.md §0, §6; codebase study (all);
  mechdost-advisor checklist + learnings (latest 40); agent-brief.md; schema orders/catalogue/platform/media;
  shared rbac/settings/state/partners.
Areas: DB/schema · orders/state machines · auth/RBAC · payments (refund on return) · notifications · analytics ·
  i18n · security/abuse · uploads · multi-city.
Hard rules: ⚠️3 the order machine gains states → every Record<OrderStatus,…> in api/web must be completed (type-only;
  no UI); ⚠️4 cityScopeFrom treats any non-shop grant as staff city scope → agent permissions are new `deliveries:*`
  keys AND cityScopeFrom gets an isStaffGrant filter (defence in depth); ⚠️10 every template/notice en + hi;
  ⚠️16 every reason a code (fail, decline, give-up, status, document reject, shop-mode request).
Conflicts / corrections: (1) design says documents in a "private R2 docs bucket"; the repo's media host for private
  images is `media_objects` + the private Supabase Storage bucket through the API — use that (new owner kinds), R2
  stays Ustaad-only. (2) partner_applications.pincode is NOT NULL and the agent form has no PIN → nullable for
  kind `delivery_agent` only, with city + vehicle CHECKs. (3) partner_invites requires an email → own
  `delivery_agent_invites` table (email optional, phone-bound, 72 h). (4) design statuses applied|approved|active →
  agents row exists only after the invite is accepted: `onboarding → active ↔ paused → suspended / offboarded`;
  the application keeps new/approved/rejected. (5) Retry with another agent needs the parcel back at the shop: modelled
  as failed → returning → returned (hand-back code) → order back to ready_for_pickup + new job (retry) or order
  `returned` + refund (close).
Risks: (1) lock order — job moves that change the order must lock the order row first, then the job (spec 14);
  (2) partial refund keeping the delivery fee must go through the refund ledger with the remaining-balance check;
  (3) adding order states breaks exhaustive maps in web/api → run tsc web.
Improvements: P0 offer sweep in the worker with in-flight guard + attempt parking; P1 per-job code limit (5) separate
  from the per-user rate limit; P2 KPI view over delivery_job_events (time to assign/pickup/deliver).
Decisions needed (queued with defaults): reroute to another shop after a declined mode switch (default: not built,
  admin cancels with refund or reassigns an agent); vehicle change by the agent (default: admin only); document
  retention days after offboarding (default 180, setting).
Docs to update in this change: specs 04, 05, 07, 08, 10, 12, 13, 14, new 24; decisions; questions-for-user;
  progress; README index; whatsapp-templates runbook; rls-inventory; learnings.
Skills to run next: writing-plans (done) → test-driven-development → domain-modeling → drizzle-postgis-supabase +
  supabase-postgres-best-practices → firebase-phone-auth-rbac → hono → notifications-messaging → razorpay-payments →
  next-intl-hindi → website-testing → verification-before-completion.
Applicable learnings: L-USAGE1 (drizzle generate numbering / snapshots), L106 (journal `when` increasing), L-SAV2
  (advisory lock last for side ledgers), L-P23c (scope reports by permission), L-P23d (no multi-statement shell edits),
  L69 (atomic limit counting), L211 (no invisible characters).
```
