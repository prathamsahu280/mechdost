# Razorpay checkout — backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can place an order paid online with Razorpay Standard Checkout: the API places the order, creates the Razorpay order, verifies the payment (signature + server fetch), accepts Razorpay webhooks, and expires unpaid orders. The website's pay button comes with the "checkout on the API" task (user chose option 1, 2026-11-12).

**Architecture:** The order is placed exactly like COD (one transaction, idempotent, re-priced from the DB) with `payment_method = 'online'`, `payment_status = 'created'`, no COD fee and a short stock hold. A small API service then creates (or reuses) the Razorpay order for that group and stores it in `payments` (unique provider order id) before answering. Payment facts from the checkout callback (after an HMAC check + a server fetch) and from webhooks (raw-body HMAC + event dedupe) go through one repository function that asserts amount/currency and moves the payment state machine monotonically. Unpaid online orders are never routed and are cancelled by the worker after the hold.

**Tech Stack:** Hono + zod-openapi, Drizzle (PGlite tests), plain `fetch` to `https://api.razorpay.com/v1` (no SDK: two calls, dependency policy).

**Spec:** `docs/specs/03-cart-checkout.md`, `docs/specs/05-cancellations-returns-refunds.md` (refunds later), `.claude/skills/razorpay-payments/SKILL.md`, `docs/research/data-integrity.md` §4, Razorpay docs (integration steps, verified 2026-11-12).

## Global Constraints

- Integer paise; the client never sends an amount (server re-prices; `expectedTotalPaise` only guards a stale screen).
- `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` server-only; `RAZORPAY_KEY_ID` is public. Online payment is offered only when key id + secret are set; the webhook route answers 404 until the webhook secret is set.
- Signature: `HMAC_SHA256(our provider_order_id + "|" + razorpay_payment_id, key_secret)`, compared with `timingSafeEqual`. A valid signature alone never marks paid: the server fetches the payment and requires `status = captured`, `order_id` = ours, `amount` = `payments.amount_paise`, `currency = INR`.
- Webhook: raw-body HMAC (`X-Razorpay-Signature`, webhook secret), dedupe on `x-razorpay-event-id`, record + apply in one transaction, 200 fast.
- Payment status moves only through `paymentMachine` (monotonic; a late failure after paid is a no-op).
- Unpaid online groups are never in the routing queue and cannot be routed.
- Tests never call Razorpay: a fake gateway; webhook payloads signed locally.
- Commit through `pnpm check`; no AI attribution.

## Review Focus

1. A retried place (same idempotency key) must not create a second Razorpay order.
2. A verify call for someone else's order is a 404, and nothing changes.
3. A captured payment for a different amount never marks the order paid.
4. `payment.failed` after `payment.captured` (any order) leaves the order paid.
5. An online order that is never paid gives its stock back and never reaches a shop.

---

### Task 1: Place an online order (db)

**Files:** `packages/db/src/repo/checkout.ts` (`placeOrder(db, input & { method: 'cod' | 'online' })`, `placeCodOrder` kept as a wrapper; quote gains `onlineTotalPaise`), `packages/shared/src/settings.ts` (`checkout.online_payment_minutes`, int 10–120, default 30), `packages/shared/src/state/index.ts` (`placed → cancelled` also by `system`). Test: `packages/db/test/checkout.test.ts`.

- [ ] Failing tests: `'an online order has no COD fee, status created and a short stock hold'`; `'the same key replays an online order without a second group'`; quote returns `onlineTotalPaise = subtotal + shipping`.
- [ ] Implement; PASS; commit `feat(db): place orders paid online`.

### Task 2: Payments repository (db)

**Files:** create `packages/db/src/repo/payments.ts`:

- `openPaymentForGroup(db, groupId)` → the latest payment in `created|attempted|failed` or null.
- `recordRazorpayOrder(db, { groupId, providerOrderId, amountPaise })`.
- `applyRazorpayPayment(db, { providerOrderId, providerPaymentId, status: 'captured' | 'authorized' | 'failed', amountPaise, currency, method })` → `{ outcome: 'paid' | 'failed' | 'attempted' | 'unchanged' | 'mismatch' | 'unknown_order' }`.
  - Locks the payment row and asserts amount and currency (mismatch: audit `payment.amount_mismatch`, no state change).
  - Moves the state machine, and sets the group `payment_status = 'paid'` on capture.
  - Writes an event and an audit row.
- `paymentOfUserGroup(db, { userId, providerOrderId })` (actor-scoped, 404).
- `expireUnpaidOnlineOrders(db, { olderThanMinutes })`: sub-orders `placed → cancelled` (system, reason `payment_not_completed`), reservations released, group and open payments → `expired`.

Also `routing.ts`: the queue and `routeOrder` skip online groups not `paid`. Tests: `packages/db/test/payments.test.ts` (new) and `routing.test.ts`.

- [ ] Failing tests for Review Focus 3, 4 and 5, idempotent replay, and unknown order. Implement; PASS; commit `feat(db): Razorpay payment facts, monotonic and amount-checked; unpaid orders expire`.

### Task 3: API — gateway, place, verify, webhook, worker

**Files:**

- Create `apps/api/src/payments/razorpay.ts`:
  - `RazorpayGateway { createOrder; fetchPayment }`;
  - `httpRazorpay(keyId, keySecret)` (fetch, Basic auth, 8 s timeout);
  - `checkoutSignatureValid()` and `webhookSignatureValid()`.
- Create `apps/api/src/payments/service.ts`: `ensureRazorpayOrder()`.
- Create `apps/api/src/routes/payments.ts`:
  - `POST /v1/payments/razorpay/verify` (auth);
  - `POST /v1/webhooks/razorpay`.
- Modify:
  - `config.ts`: `RAZORPAY_*`; in production one key without the other is refused;
  - `types.ts`: `razorpay?: RazorpayGateway | null`;
  - `server.ts`;
  - `routes/checkout.ts`: online allowed when configured; the response carries `razorpay { keyId, orderId, amountPaise, currency }`; the quote carries `onlineTotalPaise`;
  - `worker.ts`: an expiry timer each minute.
- Tests: `apps/api/test/payments.test.ts` (fake gateway).

- [ ] Failing tests:
  - Review Focus 1 and 2;
  - verify happy path → `paid`;
  - bad signature → 400 `SIGNATURE_INVALID`;
  - signature good but payment not captured → stays unpaid;
  - webhook bad signature → 400;
  - same event twice → applied once;
  - webhook off without a secret → 404.
- [ ] Implement; PASS; commit `feat(api): Razorpay Standard Checkout — order, verify, webhook`.

### Task 4: Docs

- Spec 03 § Online payment (built).
- `docs/decisions.md`: Q2 and Q8 answered.
- `docs/questions-for-user.md`: the webhook secret and the public URL are still needed.
- `docs/runbooks/payments.md`: test keys, test cards and UPI, how to try it with curl until the web pay button exists.
- The skill's status line; the ledger.
- [ ] `pnpm check`, commit, push.
