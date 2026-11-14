# Payments runbook (Razorpay)

## Keys

- **Where they live:** the git-ignored `.env` only, never in code or commits.
  - `RAZORPAY_KEY_ID` (public, `rzp_test_…` during the build)
  - `RAZORPAY_KEY_SECRET` (server only)
  - `RAZORPAY_WEBHOOK_SECRET` (server only, set in Razorpay Dashboard → Webhooks)
  - Production uses Secret Manager and refuses `rzp_test_` keys.
- **When it switches on:** online payment is offered only when the key id and the secret are both set. Without them, `paymentMethod: 'online'` answers `422 PAYMENT_METHOD_UNAVAILABLE`.
- **Production** refuses to start with Razorpay keys but no webhook secret: without the webhook, a payment whose browser closed before the confirmation is never noticed.

## Test it from the website (local)

1. **Check the keys first.** Razorpay must accept the key id and secret in `.env`. An answer of `401 Authentication failed` means the keys are wrong or revoked: generate new ones in Dashboard → Test mode → Account & Settings → API Keys. Restart the API after changing `.env`.
2. **Start three processes:**
   - the Auth emulator: `pnpm emulators`, on port 9099, project `demo-mechdost`;
   - the API, with the emulator overrides `FIREBASE_PROJECT_ID=demo-mechdost`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and an empty `GOOGLE_APPLICATION_CREDENTIALS`;
   - the web, with `NEXT_PUBLIC_AUTH_MODE=firebase`, `NEXT_PUBLIC_API_URL=http://localhost:4000` and the `NEXT_PUBLIC_FIREBASE_*` emulator values. The web does not read the root `.env`.
3. **Sign up at `/login`.** The emulator's SMS code is **random**, not `123456`. Read it from the emulator log or from `GET http://127.0.0.1:9099/emulator/v1/projects/demo-mechdost/verificationCodes`.
4. **Verify the email.** Ordering needs a verified phone and a verified email. In the emulator, use the verification link it prints, or set `emailVerified` through the emulator's `accounts:update`.
5. **Pay.** Add a product to the cart, open `/checkout`, choose **Pay online now: UPI, cards, net banking (Razorpay)** and press **Continue to secure payment**.
   - Razorpay Checkout opens in test mode. Pay with a test card or the test UPI id `success@razorpay`.
   - The API verifies the payment before the order counts as paid.

**Without the website:** `POST /v1/checkout/quote`, then `POST /v1/orders` with `paymentMethod: 'online'` and an `Idempotency-Key`. After paying, call `POST /v1/payments/razorpay/verify`.

## Production refuses test keys

The API will not start in production with an `rzp_test_` key (`apps/api/src/config.ts`). A test payment is free and anyone can make one with Razorpay's public test cards, so an order could be marked paid and shipped with no money received. On 2026-11-14 the test keys were copied to the server, the API crash-looped (502) for about 6 minutes, and the lines were disabled in `/opt/mechdost/.env`. Live keys only on the server. Test keys belong on local machines and in the emulator setup.

## Webhook (Q75)

- Needs a public HTTPS URL to `POST /webhooks/razorpay`: the deployed API, or a tunnel while testing.
- Turn on the events `payment.captured`, `payment.failed` and `order.paid`.
- Put the secret in `.env`.
- Replays and out-of-order events are safe: each event id is recorded once, and the payment state only moves forward.

## Unpaid orders

The worker cancels online orders that are not paid within `checkout.online_payment_minutes` (default 30, an admin setting). The stock goes back on sale, and the order and payment show `expired`.

## A payment that needs a refund

If money is captured for an order that already expired, was cancelled, or was already paid through another payment, it is **not** marked paid:

- the audit log gets `payment.captured_needs_refund` (with the payment id and amount);
- the API logs `razorpay_webhook_needs_refund` (webhook) or `razorpay_verify_needs_refund` (checkout callback).

Refund it from the Razorpay Dashboard until automatic refunds exist (spec 05).

## Not yet

- Refunds for paid orders that are cancelled or rejected (spec 05).
- The hourly reconciliation job: fetch Razorpay orders stuck in `created`/`attempted`.
- Processing webhooks through pg-boss.
