# 20 · MechDost Coins (loyalty bonus, not a wallet)

Status: decided 2026-11-01 (user) · ledger built (repository + tests); redemption at checkout, restore on cancel/refund, expiry and the staff adjust route are **not wired yet** (review 2026-11-11, C4); **earning rules pending Q24** · Decisions: "No wallet; MechDost Coins; no-returns policy"

## Goal (user's words)

"Keeping a wallet type of thing would take some legal stuff that we might need to get approved … instead we'll keep a loyalty bonus type of stuff which will have coins … the coins would be used to get discounts." How coins are distributed and claimed: the user decides later (Q24).

## Why coins and not a wallet

A wallet that holds money (refunds, top-ups, cash-out, transfers) is a prepaid payment instrument under RBI rules. Coins stay outside that only if they **never behave like money**:

- no cash value;
- cannot be bought, sold or transferred between accounts;
- never withdrawn or paid out;
- never given in place of a money refund;
- only usable as a discount on MechDost orders.

These rules are fixed in code and copy (account page, policy page, checkout note). Refunds always go to the original payment method (bank/UPI for COD orders). The old `refunds.mode = 'wallet'` was removed.

## Rules (built)

- **Value and cap (admin settings):** 1 coin = `coinValuePaise` off (default ₹1). Coins pay at most `maxRedeemBp` of the order's **product subtotal** (default 10%), never delivery or COD fees, whole coins only, never more than the balance (`packages/shared/src/coins.ts` `coinRedemption`).
- **Minimum order and expiry:** minimum order `minOrderPaise` (default ₹0); expiry `expiryDays` after earning (default 365, expiry job P1).
- **Cancelled or rejected order:** the coins it used are restored once, as coins.
- **Manual grants/deductions:** staff with `coins:adjust` (marketing; super admin) only, each with a customer-visible reason, audited. Four-eyes above `settings.approval_threshold` (spec 13) once real money-equivalent volumes exist.
- **Viewing balances:** `coins:read` for ops, support and finance.

## Data (migrations 0006–0007)

- `coin_accounts`: `user_id` PK, `balance` CHECK ≥ 0, `lifetime_earned`, `version`.
- `coin_ledger`: append-only (trigger), `delta` ≠ 0 with sign matching `kind` (earn/restore > 0, redeem/expire < 0, adjust either), unique `idem_key`, `order_group_id` required for redeem/restore, `created_by` required for adjust, `expires_at`.
- `order_groups.coins_redeemed` + `coin_discount_paise`, consistent with each other and ≤ `discount_paise`.
- RLS on, no end-user grants.

## Repository (`packages/db/src/repo/coins.ts`)

`earnCoins`, `redeemCoins` (compare-and-set `balance >= n` inside the order-placement transaction), `restoreCoinsForOrder` (restores exactly what is outstanding, once), `adjustCoins` (+ audit), `coinBalance`. Every call is idempotent by key.

## UI (demo, `apps/web/src/demo/coins.ts`)

- `/account/coins`: balance, how coins work (incl. "no cash value"), "ways to earn coming soon", history.
- Checkout: "Use N MechDost Coins and save ₹X" (signed-in customers), shown in the summary and on the order page.
- `/admin/coins`: grant/remove with reason, recent activity.
- `/admin/settings`: coin value and maximum share.

The seeded demo customer has 250 labelled demo coins.

## Analytics

`click` ids `admin_coins_granted|removed`, `account_coins_shop`; order `purchase` carries the discounted total. Phase 1: `coins_earned`, `coins_redeemed`, `coins_restored`, `coins_adjusted` (counts only).

## Acceptance tests

`packages/shared/test/coins.test.ts` (cap, rounding, balance, min order, expiry), `packages/db/test/integrity.test.ts` "MechDost Coins ledger" (earn/spend, idempotency, two checkouts racing → one wins, single restore, overdraw refused, audit, append-only, non-negative balance, order coin columns consistent), `apps/web/e2e/coins-policy.spec.ts` (checkout redemption → order → admin reject → coins restored; admin grant/remove with errors; settings drive the cap).

## Pending (Q24)

How coins are earned (per order %, first order, reviews, referrals, service bookings, campaigns) and claimed (automatic after delivery vs a "claim" button, waiting period after delivery so returns/fraud can't farm coins), expiry period, whether coins also apply to workshop services. Until answered, earning is off (admin grants only).
