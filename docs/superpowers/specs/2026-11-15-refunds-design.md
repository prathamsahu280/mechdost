# Refunds for prepaid orders — design (2026-11-15)

Status: approved by the user ("plan out on this and work on this"). Specs: 05, 14, 20, 08, 03. Skills: mechdost-advisor,
domain-modeling, razorpay-payments, drizzle-postgis-supabase, supabase-postgres-best-practices. (`grill-me` is not installed here.)

## User rulings (fixed)

1. **All need approval.** Every refund (rejected or cancelled order, unfulfilled sub-order, support claim, part refund)
   is a _refund request_ in a finance queue. Razorpay is called only after approval by staff with `refunds:approve`
   (finance, super_admin). Where a staff member requested it, the approver must be someone else (four-eyes, a DB CHECK).
   System-created requests (order rejected/cancelled) need approval too. This supersedes spec 05's "automatic refund".
2. Refunds go to the original payment method only (no wallet). Coins: restored/cancelled as spec 20 says.

## Model (domain-modeling)

- **Refund request** = a claim for money back against one captured **payment**, optionally tied to one **sub-order**.
  Not a wallet entry. The existing table `refunds` (never written so far) is expanded, not replaced.
- States (`refundMachine`): `requested` -> `approved` | `rejected`; `approved` -> `initiated` (Razorpay refund id stored)
  | `processed` | `failed` | `needs_reconciliation`; `initiated` -> `processed` | `failed` | `needs_reconciliation`;
  `needs_reconciliation` -> `initiated` | `processed` | `failed`; `failed` -> `processed` (a webhook is the truth).
  `rejected` and `processed` are terminal. An unsure refund holds its amount: only a confirmed absence at Razorpay fails it.
- Cash on delivery (Q104): `mode = bank_upi`, no payment, encrypted destination, finance pays by hand and records the UTR.
  (`approved -> processed` exists because the webhook may beat our own write of the Razorpay refund id.)
- Sources (`REFUND_SOURCES`): `order_rejected`, `order_cancelled`, `unfulfilled`, `support_claim`, `part_refund`, `other`.
  Reason codes (`REFUND_REASONS`) and reject codes (`REFUND_REJECT_REASONS`) are enums; free text is only a note.
- Ledger: `payments.refund_reserved_paise` = sum of refunds in requested/approved/initiated/processed and
  `payments.refunded_paise` = sum of processed; CHECK `0 <= refunded <= reserved <= amount`. Reserved by a conditional
  UPDATE under the payment row lock, released on rejected/failed. Per sub-order the sum may not exceed its cash total.
- Events: `refund_events` append-only (`forbid_update_delete`), one row per change, plus `audit_log`.
- Lock order: order -> group -> payment -> refund. Notifications through `notification_outbox` (dedupe key per refund + status).

## Flow

1. Request: system (inside `transitionOrder`: order cancelled/rejected and its group paid online) or staff
   (`POST /v1/admin/refunds`, `refunds:initiate`, `Idempotency-Key`). COD: 422 `REFUND_NOT_ONLINE`.
2. Approve (`refunds:approve`, CAS on status + version, approver != requester) then dispatch: Razorpay
   `POST /payments/:id/refund` with `X-Refund-Idempotency: <idem key>` and `receipt` = refund id. Two finance users
   approving at once: only one UPDATE matches, so exactly one Razorpay call. The worker re-dispatches `approved`
   refunds (crash between approve and call) with the same key; 4xx -> `failed`, 5xx/timeout retries (cap 8).
3. Webhook `refund.processed` / `refund.failed`: event dedupe, refund found by Razorpay refund id (or by the refund id we
   put in `notes` while the id is not stored yet), amount + payment id asserted, state moves forward only. Processed
   sets the payment `partially_refunded` / `refunded` and cancels the order's pending coin rewards (full-order refund).
4. Customer order page: requested -> approved/processing -> refunded (only after Razorpay confirms; "5-7 working days"),
   or declined / failed with "contact support". No copy promises an automatic or instant refund.
5. Approval SLA: setting `refunds.approval_sla_hours` (default 24, admin editable); older queue items are flagged
   `overdue`; the list returns `counts {waiting, overdue}`; the Overview can read it from there (hook, see "Not built").

## Rulings of mine (cost if wrong)

- No public code for refunds; admin uses the uuid. Cost low (add `RF-` code with a backfill later).
- Reserve at request time, so a second request cannot over-commit. Cost low (rejection frees it).
- Captured-after-close payments (`needs_refund`) stay audit-only, no request yet. Cost medium, queued follow-up.
- COD refunds (bank/UPI form, manual payout) not built. Cost low: nothing to refund online.
- Customer sees `failed` as "contact support" rather than hiding it. Cost low.
- Coin rewards cancelled only when the order is refunded in full (partial refund keeps the reward). Cost low.
