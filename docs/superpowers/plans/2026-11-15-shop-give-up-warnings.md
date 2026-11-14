# Shop gives up an accepted order + partner warnings: implementation plan

> **For agentic workers:** native execution (executing-plans), one session; steps use checkboxes.

**Goal:** a shop can hand an accepted, unpacked order back to admin; staff can warn partners and are prompted to pause.

**Architecture:** one assignment status and one order transition through the existing state machines (conditional UPDATE
on status + version); one append-only table for warnings; reasons are code lists in `packages/shared`.

**Tech stack:** Drizzle + PGlite tests, Hono + zod-openapi, Next.js client components, next-intl (en + hi).

**Spec:** `docs/superpowers/specs/2026-11-15-shop-give-up-warnings-design.md`; specs 04, 07, 08, 12, 14.

## Global constraints

Integer paise; actor-scoped repositories (404 for foreign ids); Zod `.strict()` bodies; RLS + REVOKE on new tables; audit +
typed event per mutation; every string in `shopGiveUp` (en + hi); calm UI (one primary action, no stacked modals); no AI
attribution in commits; migration named `shop_give_up_warnings`, not applied to any live DB.

## Review focus

- Give-up racing a pack step, a second give-up and a staff cancel: one winner, stock restored once (`shop-give-up.test.ts`).
- A foreign shop, a packed order, a stale version, a made-up reason, a 301-character note (same file).
- Warnings outside the window, withdrawn warnings, paused shop, workshop id used as shop id (`partner-warnings.test.ts`).
- The customer must not see the step back (timeline event `visible_to_customer = false`).
- The shop never sees the threshold (API test: response has no `threshold`).

## Tasks

### Task 1: shared codes, machines, settings, events

- [x] Failing test: `packages/shared/test/state.test.ts` (give-up transitions, warning codes, "other" needs a note).
- [x] Add `ASSIGNMENT_GIVE_UP_REASONS`, `given_up`, `confirmed -> needs_rerouting`, `partner-warnings.ts`, settings keys, events.

### Task 2: schema and migration `0053_shop_give_up_warnings`

- [x] Columns on `order_assignments` + CHECKs; table `partner_warnings`; `drizzle-kit generate --name=shop_give_up_warnings`.
- [x] Append RLS, REVOKE, append-only trigger, customer-hiding status trigger. Not applied live.

### Task 3: give-up repository (TDD)

- [x] `packages/db/test/shop-give-up.test.ts` first (red), then `giveUpShopOrder`, `restoreCommittedStock`, routing/queue fields, shop history.

### Task 4: warnings repository (TDD)

- [x] `packages/db/test/partner-warnings.test.ts` first (red), then `partner-warnings.ts`.

### Task 5: API routes

- [x] `apps/api/test/shop-give-up.test.ts` first; routes in `shop-orders.ts` and `admin-shops.ts`; rate limit.

### Task 6: web

- [x] `shop-give-up.tsx`, `shop-warnings-api.tsx`, `admin-shop-warnings.tsx`, queue reason, settings labels, `shopGiveUp` strings.
- [x] `REAL_MODE_VIEWS` in the state-audit model + test; runbook section.

### Task 7: docs and gate

- [x] Specs 04/07/08/12/14, decisions, runbook, progress, questions, both learnings files; `pnpm check`.
