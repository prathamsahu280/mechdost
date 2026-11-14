# 20 · MechDost Coins (loyalty bonus, not a wallet)

Status: decided 2026-11-01 (user) · earning answered 2026-11-13 (Q24) · **built on the real API 2026-11-14** (redeem at checkout, restore on cancel/reject, rewards with the unlock wait, expiry, customer and staff routes, real-mode screens; see "Built: API + real mode") · Decisions: "No wallet; MechDost Coins; no-returns policy", "2026-11-14 — MechDost Coins on the real API"

## Goal (user's words)

"Keeping a wallet type of thing would take some legal stuff that we might need to get approved … instead we'll keep a loyalty bonus type of stuff which will have coins … the coins would be used to get discounts." How coins are distributed and claimed: answered 2026-11-13 (Q24, below).

## Why coins and not a wallet

A wallet that holds money (refunds, top-ups, cash-out, transfers) is a prepaid payment instrument under RBI rules. Coins stay outside that only if they **never behave like money**:

- no cash value;
- cannot be bought, sold or transferred between accounts;
- never withdrawn or paid out;
- never given in place of a money refund;
- only usable as a discount on MechDost orders.

These rules are fixed in code and copy (account page, policy page, checkout note). Refunds always go to the original payment method (bank/UPI for COD orders). The old `refunds.mode = 'wallet'` was removed.

## Rules (built)

- **Value and cap (admin settings `coins.value_paise`, `coins.max_redeem_bp`, `coins.min_order_paise`):** 1 coin = `coinValuePaise` off (default ₹1). Coins pay at most `maxRedeemBp` of the order's **product subtotal** (default 10%), never delivery or COD fees, whole coins only, never more than the balance (`packages/shared/src/coins.ts` `coinRedemption`).
- **Minimum order and expiry:** minimum order `minOrderPaise` (default ₹0); expiry `coins.expiry_days` after the coins are added (default **180**, Q24); the earliest-expiring coins are used first; the worker expires what is left.
- **Earning (Q24, user 2026-11-13; every reward admin-set, 0 until configured):** `coins.earn_order_bp` of what a delivered order's products cost after discounts; `coins.first_order_bonus` on the first delivered order (once per customer); `coins.workshop_booking_bonus` per paid workshop booking. Earned coins become usable after `coins.unlock_days` (default **8**, after the 7-day claim window of Q25).
- **Referrals (Q31–Q34 answered; Q35–Q38, Q44, Q45, Q47 open):** not built — see "Gaps".
- **Cancelled or rejected order:** the coins it used are restored once, as coins — per sub-order (each part carries its share), with a fresh expiry.
- **Manual grants/deductions:** **super admin only** (`coins:adjust`; marketing lost it, user 2026-11-14), never to the staff member's own account (403 `COINS_SELF`), at most `coins.adjust_daily_cap` coins per customer per IST day (default 5,000, grants and deductions together, checked under a per-customer lock; 422 `COINS_DAILY_CAP`), each with a **reason code** (`goodwill`, `service_recovery`, `promotion`, `correction`, `fraud_reversal`, `other`) and an optional note the customer sees, audited. Four-eyes above `settings.approval_threshold` (spec 13) once real money-equivalent volumes exist (not built: no threshold setting yet).
- **Coin rules:** edited in Admin → Settings; saving needs `settings:write` **and** `coins:rules`. Site-wide only (no city overrides: coins belong to the account, not a city).
- **Viewing balances:** `coins:read` for ops, support, finance and marketing.
- **Order rewards stay off until a guard is chosen** (user 2026-11-14: "decide when enabling"): saving `coins.earn_order_bp` or `coins.first_order_bonus` above 0 is refused with 422 `COIN_GUARD_REQUIRED` (API and settings screen) — pending decision "Coin order-reward guard" in `docs/decisions.md`.
- **Not on bulk quote orders** (ruling 2026-11-14, merge with spec 19): a quote order's prices were negotiated with staff, so `coins` with a quote order is refused (422 `COINS_NOT_ON_QUOTES`); quote orders keep their own COD ceiling (`quotes.cod_cap_paise`, checked at acceptance), and the checkout COD cap is not applied to them.
- **One shop money model** (spec 19 I1 + this spec): a shop's order card shows its **payout** (its own price × qty, never the customer price; coins never change it), **"Collect ₹… on delivery"** on cash-on-delivery orders (the customer's total after coins = `collectPaise`; nothing on online orders), and the **coin line** "MechDost Coins −₹X (paid by MechDost)" when the part used coins. The API returns `totalPaise` (customer total), `payoutPaise`, `collectPaise` (null when online) and `coinDiscountPaise`. The customer's price stays hidden from the shop (I1); on COD the collect amount is the customer's total.
- **Shops see the coin discount and are owed it** (user 2026-11-14: "show line + payout ledger"): the shop's order cards show "MechDost Coins −₹X (paid by MechDost)" and the cash to collect; on delivery the part's `coin_discount_paise` is written to the append-only `shop_payout_entries` (`coin_discount`, once per order). Finance reads it at `GET /v1/admin/payouts/entries` (`payouts:read`). **Settlement rule for the weekly payout job (Q11, not built):** the shop is owed its payout (own price × qty) for each delivered part; against that, it already holds the cash it collected (COD). The `coin_discount` rows explain why the collected cash is lower than the customer price — the settlement must use either "payout − cash collected" **or** "payout − (customer total before coins) + coin entries", never both, or the coins are counted twice.

## Data (migrations 0006–0007, 0050)

- `coin_accounts`: `user_id` PK, `balance` CHECK ≥ 0, `lifetime_earned`, `version`.
- `coin_ledger`: append-only (trigger), `delta` ≠ 0 with sign matching `kind` (earn/restore > 0, redeem/expire < 0, adjust either), unique `idem_key`, `order_group_id` required for redeem/restore, `created_by` required for adjust, `expires_at` on every row that adds coins, `reason_code` (CHECK in `COIN_REASON_CODES`, 0050).
- `coin_rewards` (0050): pending → credited | cancelled; `available_at`; one row per source event (unique `(source, order_id)`, unique `service_request_id`), one live first-order bonus per customer (partial unique index excluding cancelled rows); credited ⇔ `ledger_id`; cancelled ⇔ `cancel_reason_code`. RLS on, version/updated_at triggers.
- `shop_payout_entries` (0050): append-only (trigger) amounts MechDost owes a shop; kind `coin_discount` (one per delivered order with coins, unique idempotency key), integer paise > 0.
- `order_groups.coins_redeemed` + `coin_discount_paise`, and per sub-order `orders.coins_redeemed` + `coin_discount_paise` (0050), consistent with each other and ≤ `discount_paise`.
- RLS on, no end-user grants.

## Repository (`packages/db/src/repo/coins.ts`)

`coinSettings`, `checkoutCoins` (inside `placeOrder`), `redeemCoins` (compare-and-set `balance >= n`), `restoreCoinsForSubOrder` / `restoreCoinsForOrder` (exactly what is outstanding, once), `createOrderRewards`, `createServiceReward`, `cancelPendingOrderRewards`, `releaseDueCoinRewards` and `expireDueCoins` (worker), `adjustCoins` (+ audit, version check), `myCoins`, `myCoinLedger`, `adminCoinAccount`, `coinActivity`, `coinBalance`. Every ledger write is idempotent by key.

## Built: API + real mode (2026-11-14)

- **Checkout** (`placeOrder`, `packages/db/src/repo/checkout.ts`): body `coins` (whole coins). Inside the order transaction the server re-checks them with `coinRedemption` against the balance and the rules (else **409 COINS_CHANGED**), splits them across sub-orders by product subtotal (`splitCoins`, never above a part's subtotal), takes them off each part's total (what the shop collects for COD; what Razorpay is asked for online), checks the COD cap on the discounted total, and spends them by compare-and-set (`redeem:<group id>`; a parallel spend fails with INSUFFICIENT_COINS and the whole order rolls back). `expectedTotalPaise` already has the discount taken off; the coins are part of the request fingerprint (same key + other coins = IDEMPOTENCY_MISMATCH). The public `POST /v1/checkout/quote` is unchanged (anonymous); the screen gets the balance and rules from `GET /v1/me/coins` and computes the same number with the shared `coinRedemption`.
- **Restore / earn hooks:** `transitionOrder` restores a part's coins on cancelled/rejected (`restore:<order id>`, never more than the group still has outstanding) and creates rewards on delivered; `transitionRequest` creates the workshop reward on paid. All in the same transaction as the status change.
- **Worker** (`apps/api/src/worker.ts`, every 10 min): `releaseDueCoinRewards` (row lock with skip locked, `reward:<id>` ledger key) and `expireDueCoins` (account row locked; key `expire:<last lot>:<coins used>`; looks back 30 days for lapsed lots).
- **Routes** (`apps/api/src/routes/coins.ts`): `GET /v1/me/coins` (balance, coins on the way, next expiry, rules), `GET /v1/me/coins/ledger` (cursor), `GET /v1/admin/coins/accounts/{userId}` and `GET /v1/admin/coins/activity` (`coins:read`), `POST /v1/admin/coins/accounts/{userId}/adjust` (`coins:adjust`, `Idempotency-Key`, `version`; 409 STALE_COINS / INSUFFICIENT_COINS; 30 per 10 min per staff member). `GET /v1/orders/{code}` returns `coins`. Response schemas: `@mechdost/shared/coins-api`.
- **Web (real mode):** Account → Coins (`coins-section-api.tsx`, `React.lazy`, `DATA_MODE === 'api'`), checkout redemption for COD and online (`checkout-form.tsx`; coin API code loaded lazily), the order page's coin line, Admin → Coins (`admin-coins-api.tsx`, `next/dynamic`, `AUTH_MODE === 'firebase'`: open by account id or from activity, grant/remove with a reason code), coin rules in Admin → Settings (units: rupees, basis points, coins, days). Strings `account.coins_api_*`, `portal.coins_api_*`, `checkout.coins_api_changed`, `checkout.online_coins_changed` (en + hi). Coins are no longer in `BROWSER_ONLY_SECTIONS`.

### Anti-abuse: workshop booking rewards (security review 2026-11-14)

"Paid at the workshop" (cash, UPI or card, `mark-paid`) is the workshop's own word, so a colluding workshop and customer could farm coins with fake bookings. Guards, all in the paid transaction (`createServiceReward`):

- **Minimum bill:** no booking reward below `coins.workshop_reward_min_bill_paise` (default ₹500).
- **Cooldown:** at most one booking reward per customer per workshop in `coins.workshop_reward_cooldown_days` (default 30; 0 = no limit). Pending and credited rewards count; checked under a per customer + workshop advisory lock, so two bookings paid at once cannot both earn.
- **Held, then cancellable:** the reward stays pending for the unlock days (default 8); `cancelPendingServiceRewards` cancels it, and `transitionRequest` calls it on any move out of paid/completed that undoes the payment (none exists in the state machine today, so the hook is ready for reopen/dispute states).
- **Not yet possible:** support requests cannot name a service request (only orders), so "a ticket about it cancels the reward" waits for that link; when it is added, opening an `order_issue`/`refund` ticket about a booking in the unlock window must call `cancelPendingServiceRewards`.
- The customer's rule text shows the minimum bill and the cooldown; both are admin settings (`coins:rules`).

Tests: `packages/db/test/service-requests.test.ts` "workshop booking coins: anti-abuse" (below the minimum → none; same workshop within the cooldown → none; after it → reward; cancelled reward never credited).

### Code review fixes (2026-11-14, user rulings)

- **Lock order** (spec 14): checkout spends the coins right after the group row, before any stock is reserved; a cancel restores coins (in `transitionOrder`) before releasing stock — coin account first, then stock, everywhere. Test: a trigger trace in `packages/db/test/coins.test.ts`.
- **Expiry job** pages through every candidate by user id in one run, so customers with nothing left to expire cannot starve others.
- The whole-group `restoreCoinsForOrder` is removed: only per-part restores exist.
- The **order page** counts only the coins of parts still on their way.
- **Self-booking:** a customer who holds a role at the workshop (`user_roles.workshop_id`) earns no booking reward there.
- `COIN_RULE_LIMITS.coinValuePaise` starts at 100, like the admin setting.
- The web checkout judges cash on delivery after the coin discount, like the server.

### Gaps

- **Referrals** (Q31–Q34 answered) are not built: the programme as a whole (codes, attribution at sign-up, abuse rules Q35–Q38, Q44, Q45) is still open under Q47 ("do not build until discussed"). The reward table has room for a `referral` source.
- **Refund after delivery:** no refund flow exists yet; when it is built it must call `cancelPendingOrderRewards` so a refunded order's reward never unlocks. Credited rewards are not clawed back (the 8-day wait outlasts the 7-day claim window).
- **Four-eyes** for large adjustments waits for `settings.approval_threshold` (meanwhile: super admin only + the daily cap).
- **Line-level allocation** of the coin discount (for a partial refund of one line) is per sub-order only; the refund flow must allocate per line from the stored sub-order share.
- **GST:** invoices stay at full price with the coin discount paid by MechDost (Q41 default; ask the CA).
- **Customer search** in Admin → Coins: staff open a customer by account id or from recent activity (no search API yet, same as Admin → Customers).
- **Not run here:** Playwright (`coins-policy.spec.ts` targets the demo), `next build` / JS budget measurement (low-memory machine) — run at merge.

## UI (demo, `apps/web/src/demo/coins.ts`)

- `/account/coins`: balance, how coins work (incl. "no cash value"), "ways to earn coming soon", history.
- Checkout: "Use N MechDost Coins and save ₹X" (signed-in customers), shown in the summary and on the order page.
- `/admin/coins`: grant/remove with reason, recent activity.
- `/admin/settings`: coin value and maximum share.

The seeded demo customer has 250 labelled demo coins.

## Analytics

`click` ids `admin_coins_granted|removed`, `account_coins_shop`, `checkout_coins_on|off`; order `purchase` carries the discounted total and `coinsRedeemed`. Server events (2026-11-14): `coins_redeemed`, `coins_restored`, `coins_reward_created`, `coins_earned`, `coins_expired`, `coins_adjusted` (codes and counts only).

## Acceptance tests

`packages/db/test/coins.test.ts` (checkout redemption split across parts, cap/balance refused with COINS_CHANGED, online total, a replay spends once, two checkouts racing → one wins and no negative balance, cancel/reject restores each part once, rewards 0 until configured, order + first-order rewards credited only after the unlock days and once, expiry of what is left once, staff adjust with reason code/version/replay/overdraw/audit, unknown customer 404, own history only with cursor), `packages/db/test/service-requests.test.ts` (paid booking → workshop reward), `apps/api/test/coins.test.ts` (sign-in, own data, 409 COINS_CHANGED, 400 bad body, `coins:read`/`coins:adjust` 403s, 404, STALE_COINS, idempotent adjust, coin rules site-wide), `apps/web/test/coins-view.test.ts` (labels by code, error keys, adjust form, setting units), `packages/shared/test/coins.test.ts` (cap, rounding, balance, min order, expiry 180 days, split, lots, first-expiring used first, order rewards), `packages/db/test/integrity.test.ts` "MechDost Coins ledger" (earn/spend, idempotency, two spends racing → one wins, single restore, overdraw refused, audit, append-only, non-negative balance, order coin columns consistent), `apps/web/e2e/coins-policy.spec.ts` (demo: checkout redemption → order → admin reject → coins restored; admin grant/remove with errors; settings drive the cap).

## Answered (Q24, 2026-11-13)

Earned on delivered orders (%), the first order, workshop bookings and referrals, at admin-set rates; credited automatically after 8 days; expiry 180 days; both admin-configurable. Built except referrals (see Gaps). Coins are spent on product orders only (not on workshop bills).
