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

## Policy change (decision 2026-11-01): no returns, no exchanges

This supersedes the self-service return/replacement/exchange flows above; the refund ledger, cancellation and integrity rules stay.

- **Not accepted:** returns or exchanges for change of mind, wrong part ordered or no longer needed.
- **Faulty, damaged or wrong item delivered:** the customer opens a **support ticket** (spec 09) from the order with photos within the claim window (default 7 days from delivery, Q25). Support checks with the shop and resolves as **replacement** (new sub-order `replacement_of`, routed like any order) or **refund** (refund ledger, four-eyes above threshold). Ticket reason codes: `faulty`, `damaged_in_transit`, `wrong_item`, `missing_item`.
- **Cancellation:** free until the shop packs the order (Q25 default); after that only through support. Orders we cannot fulfil (rejected, no shop) are cancelled and the customer is owed a full refund; **since 2026-11-15 that refund is a request that waits for a finance approval, never automatic** (user: "All need approval"; see "Built: refunds").
- **Refund destination:** the original payment method; bank/UPI (stored encrypted, `refunds.destination_enc`) for COD orders. **Never** into coins or a wallet; coins used on the order are restored as coins (spec 20).
- **Disclosure** (Consumer Protection (E-Commerce) Rules 2020): the policy is shown before purchase on product pages, checkout and `/policies/returns` (footer link), in English and Hindi.
- **Demo:** policy page and notes are live; the support-ticket claim flow arrives with spec 09. Test: `e2e/coins-policy.spec.ts` "returns policy".

## Built: order cancellation API (2026-11-03)

`packages/db/src/repo/customer-orders.ts`, routes in `apps/api/src/routes/checkout.ts` (customer) and `admin-orders.ts` (staff).

- **Customer** `POST /v1/orders/{subOrderCode}/cancel {reasonCode, version}`: own orders only (404 otherwise), while the sub-order is `placed`, `awaiting_shop`, `needs_rerouting` or `confirmed` and not past its `cancellable_until_status` (default `confirmed`); packed or later → 409 `NOT_CANCELLABLE` ("contact support").
- **Staff** `POST /v1/admin/orders/{code}/cancel` (`orders:cancel`, city-scoped): anything the order machine allows for admin (also `packed`).
- **Reason codes** `ORDER_CANCEL_REASONS` (changed_mind, ordered_by_mistake, found_cheaper, delivery_too_slow, customer_unreachable, other); a cancelled order always has one (migration 0029 CHECK `orders_cancelled_explained`).
- **One transaction:** order → `cancelled` (CAS on version; races with a shop accept resolve to exactly one winner), an open shop offer → `withdrawn`, held stock released, stock already taken by an accept put back on the shelf, audit row `order.cancelled`. COD has nothing to refund; prepaid refunds come with online payment.
- **Tracking** `GET /v1/orders` (newest first, keyset-paged: `?limit=` ≤ 50, pass `nextCursor` back as `?cursor=`; a tampered cursor is 422 `INVALID_CURSOR`) and `GET /v1/orders/{groupCode}`: per sub-order status, items, the customer-visible timeline, the seller once accepted, the rejection message, the 4-digit delivery code while out for delivery, and `canCancel`.
- Not yet: cancellation window by time, fees after dispatch, faulty-part tickets → replace/refund flow, notifications on cancel.

### Demo screens (2026-11-03, same rules as the API)

- Customer order page (`apps/web/src/components/commerce/order-view.tsx`): "Cancel this order" until the shop packs it (`customerMayCancel`: placed → confirmed), with a reason (`ORDER_CANCEL_REASONS` minus `customer_unreachable`) and a plain note (COD: nothing to refund; coins come back). "Keep my order" backs out. A cancelled order shows who cancelled, when and why.
- Admin order card (`admin-console.tsx`): "Cancel order" while not closed and at most packed (`staffMayCancel`), with a reason code; the card shows "Cancelled by the customer/MechDost on … · reason"; routing and reject disappear. New queue "Cancelled". Reject now also asks for a **reason code** (`ORDER_REJECT_REASONS`) besides the message, matching `POST /v1/admin/orders/{code}/reject`.
- Store (`apps/web/src/demo/store.ts`): `cancelDemoOrder` withdraws an open shop offer; closed orders (`isClosed`: rejected or cancelled) never move forward (demo controls, shop steps, delivery code). Shop portal drops cancelled orders from its active list. Coins used on the order are restored.
- Tests: `e2e/order-cancel.spec.ts` (desktop + mobile).

## Customer self-cancel is an admin rule, off by default (2026-11-13, Q25)

- **User's answer:** "Only through support". Faulty, damaged or wrong items can be claimed within **7 days** of delivery.
- **Settings (split 2026-11-14, user: "cancellation on online paid orders or cancellation on cod orders each should be configurable"):**
  - `orders.customer_self_cancel_cod` and `orders.customer_self_cancel_online`: booleans, both default **false**, city override allowed (`@mechdost/shared/settings`).
  - Checkout copies the rule for the order's payment method onto the order (`cancellable_until_status`).
  - Test: `packages/db/test/customer-orders.test.ts`, "COD and online self-cancel are separate settings".
- **Snapshot:** checkout copies it onto each order as `orders.cancellable_until_status`: `confirmed` when on, `none` when off. A change applies to orders placed afterwards only.
- **API:** `cancelMyOrder` answers 409 `NOT_CANCELLABLE` for `none`; staff cancel (`cancelOrderAsStaff`) is unchanged.
- **Website:** the order page shows "To cancel this order, contact support." with a link to the support form for that order, instead of the cancel button.
- **Admin:** a checkbox in Admin → Settings → Order rules. In the demo it is stored in the browser (`apps/web/src/demo/order-rules.ts`) and copied onto demo orders the same way (`DemoOrder.selfCancel`).
- **Tests:**
  - db `customer-orders.test.ts` "by default the customer cannot cancel";
  - web `demo-store.test.ts` (default off, snapshot);
  - e2e `order-cancel.spec.ts` (support link by default; the admin turns the rule on).

## Built: refunds for prepaid orders and cash-on-delivery payouts (2026-11-15)

User rulings (decisions "2026-11-15 — Launch features round"): **every refund needs approval** (rejected or cancelled order, unfulfilled part, support claim, part refund); Razorpay is called only after a staff member with `refunds:approve` (finance, super admin) approves, and not the one who asked (four-eyes, also a CHECK); refunds go to the original payment method only; coins follow spec 20; Q104: cash-on-delivery refunds are paid by hand. Design note: `docs/superpowers/specs/2026-11-15-refunds-design.md`. This **supersedes** the "automatic refund" wording above: no customer copy promises an automatic or instant refund, and the order page never says "refunded" before Razorpay confirms.

### Model

- **`refunds`** (the old, never-written table, expanded; migration `0055_refunds`): status `requested → approved → initiated → processed`, or `rejected` / `failed`, or `needs_reconciliation` (see below); `source` (`order_rejected`, `order_cancelled`, `unfulfilled`, `support_claim`, `part_refund`, `other`), `reason_code`, optional note, `requested_by` (null = the system asked), `approved_by`, `rejected_by` + `reject_reason_code`, `provider_refund_id` (unique), `idem_key` (unique; also Razorpay's `X-Refund-Idempotency`), `dispatch_attempts` / `next_attempt_at` (backoff), `mode` (`source` = Razorpay, `bank_upi` = by hand), `destination_enc`, `manual_reference` (UTR), `provider_reported_paise`. CHECKs: four-eyes, approved before dispatch, Razorpay id when sent, mode ⇔ payment, UTR when a manual payout is paid.
- **Ledger:** `payments.refund_reserved_paise` (requested + approved + initiated + processed + unsure) and `refunded_paise` (processed), CHECK `refunded ≤ reserved ≤ captured`; reserved by a conditional UPDATE under the payment row lock at request time, freed when a request is rejected or a refund fails. Per sub-order the held refunds may not exceed what the customer paid for it (`orders.total_paise`, already net of coins).
- **`refund_events`** append-only (`forbid_update_delete`) + `audit_log` rows `refund.*`; alerts are `refund.alert.*` (needs_reconciliation, processed_after_failed, ledger_full, unexpected_provider_refund) and `refund.amount_mismatch`.
- Lock order: order → group → payment → refund (spec 14 rule 10). Code: `packages/db/src/repo/refunds.ts`, `packages/shared/src/refunds-api.ts` + `state/index.ts` (`refundMachine`), `apps/api/src/payments/refunds.ts`, `apps/api/src/routes/admin-refunds.ts`.

### Flow

1. **Request.** The system asks inside `transitionOrder` when a sub-order of an online, paid group is cancelled or rejected (amount = what was paid for it minus refunds already held; none for COD or unpaid orders). Staff ask with `POST /v1/admin/refunds` (`refunds:initiate`, `Idempotency-Key`, source + reason code + amount; a repeat with the same key and body returns the same request, a different body is 409). Each request emails the customer "we are reviewing it" (outbox, `refund_requested`).
2. **Approve / decline.** `POST /v1/admin/refunds/{id}/approve|reject` (`refunds:approve`, city-scoped, `version`). Approve is one conditional UPDATE on (status, version): two finance users at once → one wins, one 409, so one Razorpay call. Decline needs a reason code, frees the amount and emails the customer (`refund_declined`).
3. **Send.** The approving request sends the refund at once (`POST /payments/{id}/refund`, header `X-Refund-Idempotency`, our refund id as receipt and in notes); the worker sweeps `approved` refunds every 30 s (a crash after the approval, or backoff retries 30 s doubling to 1 h, eight tries).
4. **Settle.** Webhooks `refund.processed` / `refund.failed` (raw-body HMAC, event dedupe, amount + payment id asserted). Processed: the payment becomes `partially_refunded` / `refunded`, the customer is emailed (`refund_processed`: the bank takes 5–7 working days) and a fully refunded order's pending coin rewards are cancelled (spec 20). Coins used on a cancelled or rejected part are restored by the order transition, as before.
5. **Uncertain outcomes never free the money** (security review 2026-11-15). A timeout can mean Razorpay did create the refund. After any failed call the refund is looked up at Razorpay (our refund id in `notes`/`receipt`; **every page** of the payment's refunds is scanned with `skip`, at most 10 pages: a partial scan, the page cap or a failing page call is "unknown", never "absent"): found → recorded (and settled if already processed), never created twice; confirmed absent after a refusal (4xx) → `failed`, amount freed; absent after a temporary error → retried; lookup unanswered, an amount different from ours, or eight timeouts → `needs_reconciliation` (amount stays reserved, audit alert). The worker re-checks unsure refunds without a Razorpay id hourly (found → recorded; confirmed absent → failed and freed). A processed webhook for a refund we had failed or were unsure about (matched by Razorpay id, else by our id in notes, once sent at least once) moves it to processed, holds the amount again (the CHECK still caps the sum; if the ledger filled meanwhile: refused with `refund.alert.ledger_full`) and alerts; one of our own ids is never silently parked.
6. **Customer view.** `GET /v1/orders/{code}` returns `refunds[]` per part: `under_review`, `processing` (approved, sent or unsure), `refunded` (only after Razorpay confirms), `declined`, `failed` (the last two link to support). Website: line under the part on the order page (real API mode).
7. **Admin → Refunds** (section `refunds`, real sign-in only): views waiting (oldest first), overdue, being sent, needs checking, closed; one primary action per refund (Approve; Decline with a reason inline; Mark as paid for a manual payout). The approval limit is the admin setting `refunds.approval_sla_hours` (default 24, city override); older waiting requests are flagged overdue. The list returns `counts {waiting, overdue, attention}` for the Overview tile (hook; not wired into the Overview screen).

### Cash on delivery (Q104)

Only after delivery (the cash was collected). Staff enter the customer's UPI id or bank details from the support ticket (`destination`, Zod-validated); stored encrypted with the data keyring (`refunds.destination_enc`, AAD `refunds.destination_enc`), shown masked, shown in full only to an approver once the refund is approved (`GET /v1/admin/refunds/{id}/destination`, audited `refund.destination_viewed`). Same approval queue and four-eyes. Never sent to Razorpay: finance pays by hand and records the UTR (`POST /v1/admin/refunds/{id}/mark-paid`) → `processed`.

### Tests

`packages/db/test/refunds.test.ts` (ledger cap, four-eyes, double approve, idempotency, webhook chaos, unsure outcomes, coins, scope, manual payout, views), `apps/api/test/refunds.test.ts` (HTTP: permissions, one Razorpay call, signed webhooks, outage, timeout lookup, refusal confirmed absent, unsure, reconciliation sweep, failed-then-processed), `packages/shared/test/state.test.ts`.

### Not built (follow-ups)

- Refund creation screen for staff in the website (the API and the ticket button exist; Admin → Refunds approves, settles and pays).
- A PDF / print view of credit notes (no tax invoice has a renderer yet either; the `invoices.pdf_path` column is empty). Who issues the customer's GST invoice is Q97, so credit notes only exist for orders that already have a `tax_invoice` row.
- A duplicate capture on a group that was already paid through another Razorpay order is still only flagged (`payment.captured_needs_refund`): the one-captured-payment-per-group index means no second payment row can hold it. Finance refunds it from the Razorpay dashboard (runbook payments.md).
- State audit rows for the refund screens run in the API-mode audit (mocked API, runbook ui-test-catalogue § 9.7); `API-ADM-REFUNDQ` now also covers the settle form, the credit-note line and the after-close source (2026-11-16).

### Built: refund follow-ups (2026-11-16, builder rulings in decisions.md)

Migration `0073_refund_followups` (not applied; the coordinator renumbers at merge).

1. **Ticket-side payout form** (was already built 2026-11-15, see "COD refund from the support ticket" below and spec 09): the customer gives the UPI id or bank details on their own support thread (Zod `RefundDestination`, encrypted `support_tickets.refund_destination_enc` + a mask, rate limited, locked once a manual refund exists); staff create the `bank_upi` refund from the ticket (`POST /v1/admin/support/tickets/{code}/refund`). Staff views show only the mask; the full destination is revealed to an approver once the refund is approved, audited (`refund.destination_viewed`). Purpose-bound: the details are used only to pay that refund (retention after payout: Q115, default 30 days after the ticket closes, purge job not built). Events `support_refund_destination_saved`, `support_refund_from_ticket`; en + hi copy in the locale files.
2. **Settling `needs_reconciliation` by hand.** `POST /v1/admin/refunds/{id}/settle` (`refunds:approve`, city-scoped), `settleUnsureRefund`. Finance looks at the Razorpay dashboard and says what happened: `refunded_full` (our amount; Razorpay refund id `rfnd_...` required unless we already stored one), `refunded_other_amount` (the amount Razorpay really refunded, typed; equal to what it reported when we know it; the refund takes that amount and the payment ledger moves to match, never above the capture), `not_refunded` (frees the amount; refused with `PROVIDER_HOLDS_REFUND` when Razorpay already reported a refund id). A **reason code** (`dashboard_checked`, `provider_support_confirmed`, `bank_statement_checked`, `duplicate_found`, `other`) and a **written note** (10 to 300 characters) are required and stored on the refund (`settled_by`, `settle_reason_code`, `settle_note`, CHECKs), in `refund_events` (kind `processed` / `failed`, actor `admin`, payload outcome and reason) and in `audit_log` (`refund.reconciled`). **Four-eyes:** whoever asked for the refund cannot settle it (403 `FOUR_EYES`, and CHECK `refunds_settle_four_eyes`); the same rule as an approval, with no money threshold (every refund already needs approval, decision 2026-11-15). One conditional UPDATE on (status, version) decides between two people at once (409 `STALE_REFUND` / `NOT_UNSURE`); lock order payment then refund. Processed: the payment becomes `partially_refunded` / `refunded`, the customer is emailed once, coin rewards follow spec 20, a credit note is issued. The refund machine gained `needs_reconciliation → processed|failed` by `admin`. Website: Admin → Refunds, "Needs checking" view, "Settle by hand" opens an inline form (one primary action; "Never mind" and Escape close it and focus returns to the button). Analytics `refund_reconciled`.
3. **Captured after close.** A capture that arrives after the payment window ended or after the order was cancelled (`applyRazorpayPayment`, outcome `needs_refund`) is now recorded: the payment row becomes `paid` (new payment-machine edge `expired → paid` for the system; `payment.paid_after_close` audit), and each closed sub-order of the group gets ONE approval-first refund request, source and reason `payment_after_close`, idempotent per sub-order (`sys_late_<order id>`), so a replayed webhook asks for nothing more. The order itself is never completed by it, the customer gets the normal "we are reviewing your refund" email, and the request waits in the finance queue like any other. Analytics `refund_requested_after_close`. (Service bills already did this since 2026-11-15, spec 06.)
4. **Overview tile and staff alert.** Every `refund.alert.*` and `refund.amount_mismatch` audit row also rings the bell of the finance staff of the refund's city (`staff.refund_alert`, permission `refunds:approve`, once per refund and alert, link Admin → Refunds; same transaction as the alert; spec 10). The Overview shows two tiles (`refundsWaiting`, `refundsNeedChecking`; null without `refunds:read`, city-scoped; `GET /v1/admin/overview`).
5. **Credit notes.** When a refund becomes `processed` (Razorpay webhook, settle by hand or manual payout) and its sub-order has an issued `tax_invoice`, `issueCreditNoteForRefund` writes a `credit_note` row in the same transaction: its own gapless series `CN/<FY>/<6 digits>` (`allocateInvoiceNumber`, in a savepoint so a failure releases the number, never undoes the money, and raises `credit_note.alert.not_issued`), `credit_note_for` the invoice, `refund_id` the refund (unique index: one credit note per refund; a replayed webhook finds it). The invoice row is locked, so credit notes together never exceed it; the amount splits across taxable value and CGST = SGST (or IGST) proportionally with exact integer maths (`splitCreditNote` in `@mechdost/shared/invoice`), and the note that uses up the invoice takes each component's exact remainder. CHECKs: a credit note always points at an invoice; only a credit note carries a refund. The refund screens show the credit-note number. No PDF yet (see Not built). Analytics `credit_note_issued`.

Tests: `packages/db/test/refund-followups.test.ts` (settle outcomes, four-eyes, one winner, late capture, alerts, Overview counts, credit notes), `apps/api/test/refunds.test.ts` (settle over HTTP: permissions, role leak, validation, four-eyes, Overview, bell), `packages/shared/test/invoice.test.ts` (`splitCreditNote`), `state.test.ts`, `apps/web/test/refund-views.test.ts` (form to body, error keys, en + hi strings).

### COD refund from the support ticket (built 2026-11-15)

The customer gives the UPI id or bank account on their own support thread (spec 09 "Order and request threads, photos and the COD refund destination"); staff create the `bank_upi` refund from the ticket instead of retyping it (`POST /v1/admin/support/tickets/{code}/refund`, needs `tickets:reply` and `refunds:initiate`). The destination is copied (re-encrypted under `refunds.destination_enc`) into the refund at creation, after which the ticket's copy is locked (`DESTINATION_LOCKED`). Finance approval, four-eyes, the order-total cap, delivered-only and the masked reveal are unchanged.

## Service bill refunds (2026-11-15)

Refunds of a service bill use the same queue, ledger, four-eyes approval, Razorpay refund with idempotency and webhooks as order refunds; `refunds.bill_id` replaces the group, the finance queue shows the request code (`SR-...`) in the order column's place and the payment method "online", and the city scope comes from the request. Sources `service_cancelled` (staff cancelled a request with a captured payment) and `duplicate_payment` (a capture after the bill was settled another way). The refund request is idempotent per payment and source (`sys_svc_<source>_<payment id>`). The processed email uses the request code and raises no coin or order logic.
