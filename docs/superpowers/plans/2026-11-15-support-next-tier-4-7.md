# Support next tier, items 4 to 7 Implementation Plan

> **For agentic workers:** executed inline (executing-plans). Steps use checkboxes.

**Goal:** Inbox tools (assignment, canned replies, notes, SLA), auto-close, guest tickets, account deletion request.

**Architecture:** extend `support_tickets` (migration 0066), repos `support-sla.ts`, `support-inbox.ts`, `support-guest.ts`, `support-deletion.ts`; Hono routes in `routes/support.ts` and `routes/support-guest.ts`; worker timer; admin/account/guest screens in the existing API-mode components.

**Spec:** `docs/superpowers/specs/2026-11-15-support-next-tier-design.md`, `docs/specs/09-support.md`, `01`, `13`, `12`.

## Global Constraints

- IST business hours; support hours default 9:00 to 21:00; first reply 2 working hours; auto-close 7 days (admin settings).
- Internal notes never reach the customer or a guest. Guest key stored hashed, shown once; never email or message an address or number a guest typed.
- en + hi for every string and canned reply; analytics event for every new UI action; no Playwright, no `pnpm check`.

## Review Focus

- Guest key guessing: per-IP and per-code limits, wrong key and unknown code answer identically (404).
- Customer reply racing the auto-close sweep: version compare-and-set, reply wins.
- A second deletion request while one is open: refused by the partial unique index.
- Deletion with open orders/service jobs/refunds: blocked with a code.

### Task 1 (item 4 + 5): db + API + worker + admin inbox UI. Tests: `packages/db/test/support-inbox.test.ts`, `apps/api/test/support-inbox.test.ts`, `packages/shared/test/support-sla.test.ts`.

### Task 2 (item 6): guest tickets. Tests: db `support-guest.test.ts`, api `support-guest.test.ts`.

### Task 3 (item 7): deletion request. Tests: db `support-deletion.test.ts`, api.

### Task 4: docs, state-audit rows, learnings.
