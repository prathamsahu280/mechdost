# Refund follow-ups: plan (2026-11-16)

Goal: build every item of spec 05 "Not built (follow-ups)" (user, 2026-11-16: "we can work on building the refunds").
Rulings and costs: `docs/decisions.md` 2026-11-16 "Refund follow-ups built". Constraints: money in paise, state changes
by conditional UPDATE with `version`, lock order order, group, payment, refund; audit + append-only events; outbox;
actor-scoped repositories; en + hi; analytics events with the change.

## Order of work (red first, one commit)

1. **Read what exists.** The ticket payout form (item 1) and the service-bill late capture are already built: verify,
   do not rebuild. Remaining gaps: items 2 to 5.
2. **Shared:** refund machine edge `needs_reconciliation -> processed|failed` for `admin`; payment edge `expired -> paid`
   (system); `payment_after_close` source and reason; settle outcomes and reason codes; `SettleRefundBody`;
   `splitCreditNote`; analytics event types; `staff.refund_alert` notice (en + hi).
3. **Schema + migration** `refund_followups`: `refunds.settled_by`, `settle_reason_code`, `settle_note` (CHECKs, four-eyes),
   `invoices.refund_id` (unique), credit-note link CHECKs and FK, source and reason CHECKs widened.
4. **Tests first** (`packages/db/test/refund-followups.test.ts`, 18 cases): settle outcomes, four-eyes (code and CHECK),
   stale version, one winner of two, late capture once and replayed, alerts once, Overview counts, credit notes
   (gapless, linked, exact remainder, none without invoice). Run: red (no `settleUnsureRefund`).
5. **Repositories:** `settleUnsureRefund`, `recordLateCapture`, `alertFinance` inside `auditMismatch`,
   `credit-notes.ts`, Overview counts. Run: green.
6. **API:** `POST /admin/refunds/{id}/settle` (`refunds:approve`), Overview fields; HTTP tests (permissions, role leak,
   validation, four-eyes, bell).
7. **Web:** settle form (`refund-settle-form.tsx`: closes with Cancel and Escape, focus returns), credit-note and settle
   lines, Overview tiles, view helpers with tests, en + hi strings, UI state audit rows and fixtures, regenerated checklist.
8. **Docs:** spec 05, 08, 10, 12, 14, runbook payments, decisions, progress, questions (Q174 to Q176), learnings.
9. **Gates (targeted only on this PC):** vitest per package, eslint on touched files, prettier, `tsc --noEmit` once per package.
