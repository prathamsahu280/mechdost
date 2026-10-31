# 05 · Cancellations, returns, refunds, replacements (and P1 exchanges, disputes)

Status: decided; P1 pull-forward pending (register #2) · Phase 2 · Decisions: Post-purchase

## Goal

Self-serve post-purchase flows with clear policy windows, photo evidence, QC and automatic, never-duplicated refunds.

## User stories

- Cancel my order until it is packed (free); after that request cancellation (admin decides).
- Request a return or replacement within the window with reason and photos; see pickup scheduling and refund status.
- Raise a claim for wrong/defective item (refund or replacement).
- Get refunds to source (5–7 days) or wallet (instant, P1).

## States

Cancellation: `requested` → `approved|rejected` → refund. Return: `requested` → `approved` (pickup scheduled) | `rejected` → `picked_up` → `received` → `qc_passed` → `refunded` | `qc_failed` (returned to customer / partial refund). Replacement: as return + new sub-order `replacement_of` auto-routed to same shop. Refund: `pending` → `initiated` (Razorpay refund id) → `processed` | `failed` (retry/reconcile).

## Data

`order_cancellations` (order_id, requested_by role, stage, reason, status, decided_by), `returns` (order_item_id, type return|replacement|claim, reason code, photos[], status, pickup_slot, qc_result, resolution), `refunds` (order_id, payment_id, amount_paise CHECK>0, mode source|wallet|bank_upi, idem_key UNIQUE, razorpay_refund_id UNIQUE, status, approved_by), `credit_notes` (gapless series), `return_policies` (per category: window_days, returnable, replacement_only, conditions).

## API

`POST /orders/:code/cancel`, `POST /orders/:code/items/:id/return|replace|claim`, `GET /returns/:id`, admin `POST /admin/returns/:id/approve|reject|received|qc`, `POST /admin/refunds/:id/approve` (four-eyes above threshold), shop `POST /shop/returns/:id/received|qc`, webhook `refund.processed`.

## Rules

Windows per city/category (default return 7 days from delivery; lubricants opened and installed batteries non-returnable; electricals replacement-only); refund = stored line amounts (taxable + tax) + proportional shipping only on full cancel; one refund ledger per payment with remaining-balance check (`SELECT … FOR UPDATE`); COD refunds collect UPI id/bank via verified form; credit note issued for every refund of an invoiced item; customer messaging uses concept policy wording updated for real flows.

## Edge cases

Refund API fails after DB row → reconciliation job resends with same idempotency key; return photo upload too large → compress client-side; replacement item out of stock → convert to refund with consent; chargeback/dispute from gateway → ticket + freeze refund.

## Notifications

`cancellation.requested|approved|rejected`, `return.requested|approved|rejected|picked_up|received|qc_result`, `refund.initiated|processed|failed` → customer in-app + email; shop and admin queues.

## Analytics

`cancel_requested` (stage, reason), `return_requested` (type, reason), `refund_processed` (mode, days).

## Acceptance tests

Cancel allowed until packed and blocked after; refund never exceeds captured; double-click refund → one Razorpay call; credit note gapless; QC fail path; replacement sub-order routed to same shop.

## Open decisions

Register #2: pull exchanges, service reminders, disputes, order chat into launch (user leaning yes; decide 2026-11-01).

## P1/P2

Exchanges with price difference; warranty replacement with workshop inspection; disputes with evidence and admin ruling; order chat; open-box delivery for batteries/tyres; RTO scoring.
