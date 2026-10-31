---
name: razorpay-payments
description: Use for any MechDost payment work — creating Razorpay orders, checkout, payment verification, webhooks, refunds, reconciliation, COD handling, payment-related state and money maths. Encodes the idempotency, raw-body HMAC, event dedupe, monotonic state, amount assertion and refund-ledger rules from docs/research/data-integrity.md §4.
---

# Razorpay payments (MechDost)

Status: test mode only until inbox Q2/Q8 are answered. Payment method mix is a pending decision (COD + Razorpay leaning).

## Flow
1. **Create**: `POST /v1/checkout/sessions/:id/place` with an `Idempotency-Key` header. Server re-prices from the DB,
   writes `order_groups` + sub-orders + reservations, then creates a Razorpay order with `amount = total_paise`,
   `currency: 'INR'`, `receipt = order group code` (≤ 40 chars), and stores `payments.provider_order_id` (UNIQUE)
   **before** responding. The client never sends an amount.
2. **Checkout**: client opens Razorpay Checkout with `key_id` (public), `order_id`, prefill name/phone/email.
3. **Verify (client callback)**: server checks `HMAC_SHA256(order_id + "|" + payment_id, key_secret)` with
   `timingSafeEqual`; marks attempt `attempted`; **do not fulfil on the callback alone** — wait for the webhook or
   fetch the payment from the API.
4. **Webhook** `POST /v1/webhooks/razorpay`:
   - Read the **raw body** (`await c.req.text()`) and verify `X-Razorpay-Signature` = HMAC-SHA256(raw, webhook secret).
     During secret rotation accept old or new secret for 24 h.
   - `INSERT INTO webhook_events(id = x-razorpay-event-id) ON CONFLICT DO NOTHING`; duplicate → 200 and stop.
   - Enqueue a pg-boss job in the same transaction; respond 200 in < 5 s.
   - Worker: load the order by `provider_order_id`; assert `payment.amount === total_paise` and `currency === 'INR'`
     (else mark `amount_mismatch`, alert, do not mark paid); apply `paymentMachine` transitions (monotonic —
     a late `payment.failed` after `paid` is a no-op); treat `order.paid` and `payment.captured` as the same fact;
     unknown order → park as orphan and retry; write outbox notifications in the same transaction.
5. **Reconcile** (hourly job): Razorpay orders `created/attempted` > 20 min → fetch payments; refunds `pending` > 1 h →
   fetch status. Webhooks are hints; the API fetch is the truth.

## Refunds
- One transaction: `SELECT payment FOR UPDATE` → remaining = captured − Σ(refunds not failed) → reject if over →
  insert `refunds` row with `idem_key = 'rf_' + id` → commit → call Razorpay with header `X-Refund-Idempotency: idem_key`.
- Four-eyes approval above `settings.approval_threshold_paise` (requester ≠ approver).
- Refund amounts come from stored per-line amounts (Fowler-allocated discounts), never recomputed from live prices.
- `refund.processed` webhook updates status; reconciliation resends with the same key if the API call failed.

## COD
- Separate `payment_method = 'cod'`, `payment_status = 'cod_pending' → 'cod_collected'` on delivery.
- COD rules: per-city cap (default ₹5,000), OTP confirmation, blocked pincodes/customers, category exclusions.

## Money
- Integer paise end-to-end; Razorpay amounts are paise already. GST split via `@mechdost/shared/money`.

## Testing (website-testing catalogue §E)
Webhook chaos suite: replay ×3, out-of-order, orphan, tampered amount, wrong/rotated secret; concurrent refunds;
idempotent place; reconciliation after simulated API failure. Sign test payloads locally; never hit Razorpay in CI.

## Secrets
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` server-only (Secret Manager in prod). Only `key_id` may be public.
Never log request bodies containing card/UPI details; Razorpay hosted checkout keeps us out of PCI scope.

## Tools
Razorpay MCP (`razorpay/razorpay-mcp-server`) can generate Standard Checkout code and inspect test orders — use test
keys only (inbox Q8). Not connected yet.
