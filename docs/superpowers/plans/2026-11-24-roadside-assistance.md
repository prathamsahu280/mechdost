# Roadside assistance Implementation Plan

> **For agentic workers:** native execution (one implementer), tasks in order, test first; steps are checkboxes. Commit per layer: docs + plan, shared, db, api, web, docs.

**Goal:** a signed-in customer asks for roadside help, pays an advance online, MechDost dispatches an opted-in workshop, the responder arrives (arrival code), enters the bill, and the customer pays the balance (online or cash) or is refunded the difference.

**Architecture:** a new entity `rsa_requests` with its own machine (`packages/shared/src/state/rsa.ts`), offers in `rsa_offers` (one active per request, partial unique index; `responder_type` column so mechanics slot in later), append-only `rsa_events`, `rsa_bill_lines`, per-city `rsa_city_settings` (typed row, version CAS, audit; the int/boolean `OPERATIONAL_SETTINGS` registry cannot hold lists or enums), workshop opt-in `rsa_responders`, arrival codes in `rsa_arrival_codes` (same encrypted-code module, parametrised by table). Money reuses `payments` (new purposes `rsa_advance`, `rsa_balance`, target `rsa_request_id`) and the refund ledger (`refunds.rsa_request_id`).

**Spec:** `docs/superpowers/specs/2026-11-24-roadside-assistance-design.md`, spec 22 (new), specs 06, 08, 10, 12, 14, 15.

## Rulings and deviations this plan settles

- **Vehicle types: 2W and 4W only at launch** (user, 2026-11-24). `VEHICLE_TYPES` keeps 3W; a per-city setting `vehicleTypes` (default 2W and 4W) decides what is offered. The API refuses a type that is not offered; the UI renders from the settings response. 3W is added later by an admin edit (plus an advance amount for it), no code change.
- **Pre-payment status.** The design has no state before the advance is paid. Added `awaiting_payment` (hidden from every queue; `system` cancels it after the payment window). `requested` = advance paid.
- **Refunds stay approval-first** (decisions 2026-11-15, 2026-11-23). The system raises the refund request automatically (cancel, or total below advance), idempotent per payment and reason; finance approves as for every refund. Copy never promises an instant refund. Q223 asks whether roadside refunds may auto-approve.
- **Two payments per request** (advance, balance), so `service_bills` (one success per bill) is not reused. `payments` gets `rsa_request_id`; purpose/target CHECKs and partial unique indexes are per (request, purpose).
- **Balance 0 or total below advance:** the request completes without a Razorpay order (`payments_amount_positive`); any difference is a refund request.
- **Single arbiter:** the request row is locked first by every writer (cash mark, balance capture, cancel); lock order request -> payment -> refund.
- **Amounts** are asserted against the snapshot on the request (`advance_paise`, `total_paise`), never the live setting.
- **Deferred to phases 2/3:** auto routing (mode stored now), live map, share status, SOS beyond the phone link, mechanic accounts and portal, customer line approval, `towing` step, `rsa_line_approved` / `rsa_share_opened` events.

## Review focus

- Double accept of one offer, accept racing the timeout sweep, double cancel, double refund request, cash mark racing an online capture.
- Capture of the advance after the request was cancelled (late capture: refund request, request stays cancelled).
- Foreign customer or workshop id on any endpoint: 404.
- Location outside the active pincodes or hours: 422 with a clear code, before any Razorpay order exists.

---

## Phase 1 (this change)

### Task 1: Docs and plan

- [ ] Plan (this file), design doc header + 2W/4W ruling, spec 22, spec 17 pointer, decisions entry, Q216 closed, Q223 queued.

### Task 2: Shared contracts (`packages/shared`)

**Files:** `src/state/rsa.ts` (+ export from `state/index.ts`), `src/rsa.ts` (constants, Zod DTOs, money, hours), `src/i18n/en.json`, `hi.json` (`roadside` namespace), `src/analytics.ts` (events), refund source/reason additions.

- [ ] Failing tests: machine edges and actors; `rsaBalance` (total > advance, = advance, < advance, 0); hours window incl. overnight and 24x7; DTO strictness (unknown keys rejected, problem type nullable, `unknown` accepted).
- [ ] Implement.

### Task 3: Schema and migration `0082_roadside_assistance`

**Files:** `src/schema/roadside.ts`, `schema/index.ts`, `schema/orders.ts` (payments/refunds columns and CHECKs), `drizzle/0082_*.sql` (generated, then hand-appended RLS, REVOKE, triggers; RLS inventory in `test/rls-inventory.ts`).

- [ ] Failing DB tests: second active offer refused; bill line total CHECK; payments purpose/target CHECK; refunds exactly-one-target CHECK; events append-only; advance snapshot positive.
- [ ] `drizzle-kit generate`, fix script, append SQL.

### Task 4: Repositories (`packages/db/src/repo/roadside*.ts`)

- [ ] `roadside-settings.ts`: get (defaults when no row), save (version CAS, audit, pincodes validated against the city's active PINs), serviceability (pincode + hours in IST).
- [ ] `roadside.ts`: create (awaiting_payment, advance snapshot from settings, location, pincode, vehicle snapshot), transition (conditional UPDATE, event row, audit), customer view/list (actor scoped), cancel.
- [ ] `roadside-dispatch.ts`: queue, ranked suggestions (PostGIS distance, then accept rate), send offer (timer from settings), accept/decline (workshop scoped), timeout sweep, double-accept safe.
- [ ] `roadside-bill.ts`: lines, total, balance, complete-at-zero, refund when below advance, cash mark.
- [ ] `roadside-payments.ts`: Razorpay order for advance/balance, `applyRsaPayment` (advance capture -> requested; late capture -> refund; balance capture -> completed), dispatched from `applyRazorpayPayment`.
- [ ] Refund ledger: `lockLedger` third branch, `requestRefundForRsa`.
- [ ] Arrival code module parametrised by table; `rsa_arrival_codes`.
- [ ] Notices through the outbox (customer: accepted, arrived, bill ready, refunded; workshop: offer).
- [ ] Tests (PGlite): lifecycle, two parallel accepts (one wins), accept vs sweep, double cancel makes one refund, cash vs capture, late capture, amount mismatch, scope 404s, hours/pincode refusal, settings audit + stale version.

### Task 5: API (`apps/api`)

- [ ] Routes `roadside.ts` (customer), `admin-roadside.ts` (queue, offer, cancel, settings), `workshop-roadside.ts` (opt-in, offers, accept/decline, en route, arrival code, lines, cash); rate limits on every public surface; staff permission for roadside.
- [ ] `verifyCheckout` fallback for RSA orders; webhook applies through `applyRazorpayPayment`.
- [ ] Worker: offer timeout sweep, awaiting_payment expiry.
- [ ] Tests: role leaks (customer vs customer, workshop vs workshop, staff scope), validation, idempotency key reuse, webhook replay.

### Task 6: Web (`apps/web`)

- [ ] `/roadside` request page, `/roadside/[code]` tracking page, admin section (queue, settings, cancel), workshop portal roadside tab (opt-in, offers, lines). Demo-mode data and store, en + hi strings, events, state-audit rows + regenerated checklist.
- [ ] Web unit tests; Hindi coverage keys; no new heavy dependency.

### Task 7: Docs and gates

- [ ] Spec 22, spec 12 events, spec 14 map, progress ledger, decisions, runbook note; prettier, tsc x4, lint x4, vitest x4 (one at a time).

## Phase 2 (not built here)

Workshop opt-in polish, minimal mechanic portal and onboarding (`responder_type = 'mechanic'`), mechanic-to-workshop link.

## Phase 3 (not built here)

Auto routing (`auto`, `auto_then_manual` using the stored mode and `max_auto_attempts`), live map via the live hub, share status, SOS flow, towing step, customer line approval.
