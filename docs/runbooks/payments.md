# Payments runbook (Razorpay)

## Keys

- **Where they live:** the git-ignored `.env` only, never in code or commits.
  - `RAZORPAY_KEY_ID` (public, `rzp_test_…` during the build)
  - `RAZORPAY_KEY_SECRET` (server only)
  - `RAZORPAY_WEBHOOK_SECRET` (server only, set in Razorpay Dashboard → Webhooks)
  - Production uses Secret Manager and refuses `rzp_test_` keys.
- **When it switches on:** online payment is offered only when the key id and the secret are both set. Without them, `paymentMethod: 'online'` answers `422 PAYMENT_METHOD_UNAVAILABLE`.

## Try it before the website's pay button exists

1. **Start the API** with the test keys in `.env` (`pnpm dev`).
2. **Sign in.** You need a verified customer and its token; see `docs/runbooks/firebase.md`.
3. **Get the totals.** `POST /v1/checkout/quote {pincode, lines}` and note `onlineTotalPaise`.
4. **Place the order.** `POST /v1/orders` with `Idempotency-Key`, `paymentMethod: 'online'` and `expectedTotalPaise: onlineTotalPaise`.
   - The answer holds `razorpay.orderId` and `keyId`.
5. **Pay in Razorpay Checkout.** Open it with that order id (any page with `checkout.js`, or the Dashboard's test tools).
   - Use a test card or a test UPI id from the Razorpay test-mode docs.
   - Checkout returns `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`.
6. **Confirm the payment.** `POST /v1/payments/razorpay/verify {razorpayOrderId, razorpayPaymentId, razorpaySignature}`.
   - Expect `outcome: "paid"`. The order then shows `paymentStatus: "paid"` and enters the admin routing queue.

## Webhook (Q75)

- Needs a public HTTPS URL to `POST /webhooks/razorpay`: the deployed API, or a tunnel while testing.
- Turn on the events `payment.captured`, `payment.failed` and `order.paid`.
- Put the secret in `.env`.
- Replays and out-of-order events are safe: each event id is recorded once, and the payment state only moves forward.

## Unpaid orders

The worker cancels online orders that are not paid within `checkout.online_payment_minutes` (default 30, an admin setting). The stock goes back on sale, and the order and payment show `expired`.

## A payment that needs a refund

If money is captured for an order that already expired or was cancelled, it is **not** marked paid:

- the audit log gets `payment.captured_needs_refund` (with the payment id and amount);
- the API logs `razorpay_webhook_needs_refund`.

Refund it from the Razorpay Dashboard until automatic refunds exist (spec 05).

## Not yet

- Refunds for paid orders that are cancelled or rejected (spec 05).
- The hourly reconciliation job: fetch Razorpay orders stuck in `created`/`attempted`.
- Processing webhooks through pg-boss.
