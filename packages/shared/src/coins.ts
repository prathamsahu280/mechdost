/**
 * MechDost Coins (decision 2026-11-01, spec 20): a loyalty bonus, not a wallet. Coins have no cash value, cannot
 * be bought, sold, transferred or cashed out, and are only used for a discount on an order. Earning (Q24, user
 * 2026-11-13): admin-set rewards on delivered orders, the first order and workshop bookings, usable after a wait,
 * expiring later. The maths below is shared by API, web and app, and has no Zod (the db layer imports it, L101).
 * Integer paise and basis points only (CLAUDE.md conventions).
 */
export interface CoinRules {
  /** Discount value of one coin, in paise (default ₹1). */
  coinValuePaise: number;
  /** Most of an order's product subtotal that coins may pay, in basis points (default 10%). */
  maxRedeemBp: number;
  /** Smallest product subtotal on which coins can be used, in paise (default ₹0). */
  minOrderPaise: number;
  /** Days before earned coins expire (default 180, Q24). */
  expiryDays: number;
}

export const DEFAULT_COIN_RULES: CoinRules = {
  coinValuePaise: 100,
  maxRedeemBp: 1_000,
  minOrderPaise: 0,
  expiryDays: 180,
};

/** Admin-editable ranges (spec 08 settings). */
export const COIN_RULE_LIMITS: Record<keyof CoinRules, readonly [number, number]> = {
  // Same floor as the admin setting `coins.value_paise` (₹1; the screen takes whole rupees).
  coinValuePaise: [100, 1_000],
  maxRedeemBp: [0, 5_000],
  minOrderPaise: [0, 10_000_000],
  expiryDays: [30, 1_095],
};

export interface CoinRedemption {
  coins: number;
  discountPaise: number;
}

const NONE: CoinRedemption = { coins: 0, discountPaise: 0 };

/**
 * How many coins an order can use and the discount they give: whole coins only, never more than the balance,
 * never more than `maxRedeemBp` of the product subtotal, nothing below `minOrderPaise`. Delivery and COD fees are
 * never paid with coins.
 */
export function coinRedemption(
  balance: number,
  subtotalPaise: number,
  rules: CoinRules = DEFAULT_COIN_RULES,
  requested = Number.POSITIVE_INFINITY,
): CoinRedemption {
  if (!Number.isInteger(balance) || balance <= 0) return NONE;
  if (!Number.isInteger(subtotalPaise) || subtotalPaise <= 0 || subtotalPaise < rules.minOrderPaise)
    return NONE;
  if (rules.coinValuePaise <= 0 || rules.maxRedeemBp <= 0) return NONE;
  const capPaise = Math.floor((subtotalPaise * rules.maxRedeemBp) / 10_000);
  const coins = Math.max(
    0,
    Math.min(balance, Math.floor(capPaise / rules.coinValuePaise), Math.floor(requested)),
  );
  return coins === 0 ? NONE : { coins, discountPaise: coins * rules.coinValuePaise };
}

/** Expiry timestamp for coins earned at `earnedAt`. */
export function coinExpiry(earnedAt: Date, rules: CoinRules = DEFAULT_COIN_RULES): Date {
  return new Date(earnedAt.getTime() + rules.expiryDays * 86_400_000);
}

/** Ledger entry kinds (`coin_ledger.kind`). */
export const COIN_LEDGER_KINDS = ['earn', 'redeem', 'restore', 'expire', 'adjust'] as const;
export type CoinLedgerKind = (typeof COIN_LEDGER_KINDS)[number];

/** Why coins were earned (`coin_rewards.source`, `coin_ledger.reason_code` of earn rows). Referrals wait for Q47. */
export const COIN_REWARD_SOURCES = ['order', 'first_order', 'workshop_booking'] as const;
export type CoinRewardSource = (typeof COIN_REWARD_SOURCES)[number];

/** A pending reward: waits `unlockDays`, then becomes coins (credited) or is cancelled (order cancelled/refunded). */
export const COIN_REWARD_STATES = ['pending', 'credited', 'cancelled'] as const;
export type CoinRewardState = (typeof COIN_REWARD_STATES)[number];

/** Why a pending reward was cancelled before it unlocked. */
export const COIN_REWARD_CANCEL_REASONS = ['order_cancelled', 'order_refunded', 'request_cancelled'] as const;
export type CoinRewardCancelReason = (typeof COIN_REWARD_CANCEL_REASONS)[number];

/** Kinds of `shop_payout_entries` rows (what MechDost owes a shop). */
export const SHOP_PAYOUT_ENTRY_KINDS = ['coin_discount', 'coupon_discount'] as const;
export type ShopPayoutEntryKind = (typeof SHOP_PAYOUT_ENTRY_KINDS)[number];

/** Reason codes for a staff grant or deduction (hard rule 16: codes, the note is extra). */
export const COIN_ADJUST_REASONS = [
  'goodwill',
  'service_recovery',
  'promotion',
  'correction',
  'fraud_reversal',
  'other',
] as const;
export type CoinAdjustReason = (typeof COIN_ADJUST_REASONS)[number];

/** Every `coin_ledger.reason_code`: system codes for system rows, the staff code for adjustments. */
export const COIN_REASON_CODES = [
  ...COIN_REWARD_SOURCES,
  ...COIN_ADJUST_REASONS,
  'order_redeem',
  'order_cancelled',
  'expired',
] as const;
export type CoinReasonCode = (typeof COIN_REASON_CODES)[number];

/**
 * Split a checkout's coins across its per-shop sub-orders in proportion to their product subtotals (largest
 * remainder), whole coins only, never more than a sub-order's own subtotal. Returns coins per sub-order; the
 * discount of each is `coins × coinValuePaise`, so the parts always add up to the whole (integer paise).
 */
export function splitCoins(coins: number, coinValuePaise: number, subtotals: readonly number[]): number[] {
  const total = subtotals.reduce((a, b) => a + b, 0);
  if (coins <= 0 || total <= 0 || coinValuePaise <= 0) return subtotals.map(() => 0);
  const room = subtotals.map((s) => Math.floor(s / coinValuePaise));
  const exact = subtotals.map((s) => (coins * s) / total);
  const out = exact.map((x, i) => Math.min(Math.floor(x), room[i] ?? 0));
  let left = coins - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  // Hand out the remainder one coin at a time, biggest remainder first, only where the sub-order has room.
  while (left > 0) {
    let gave = false;
    for (const { i } of order) {
      if (left === 0) break;
      if ((out[i] ?? 0) < (room[i] ?? 0)) {
        out[i] = (out[i] ?? 0) + 1;
        left -= 1;
        gave = true;
      }
    }
    if (!gave) throw new Error('splitCoins: more coins than the sub-orders can take');
  }
  return out;
}

/** One ledger row as the expiry maths needs it. */
export interface CoinLotEntry {
  id: string;
  delta: number;
  kind: CoinLedgerKind;
  expiresAt: Date | null;
}

export interface CoinLot {
  id: string;
  coins: number;
  remaining: number;
  expiresAt: Date | null;
}

/**
 * Coin lots with what is left of each (first-expiring used first). Lots are the positive rows (earned, granted,
 * returned); spending, deductions and expiries use the earliest-expiring lots first, so a customer always keeps the
 * coins that last longest. Lots without an expiry go last.
 */
export function coinLots(entries: readonly CoinLotEntry[]): CoinLot[] {
  const lots = entries
    .filter((e) => e.delta > 0)
    .map((e) => ({ id: e.id, coins: e.delta, remaining: e.delta, expiresAt: e.expiresAt }))
    .sort(
      (a, b) =>
        (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id),
    );
  let used = entries.filter((e) => e.delta < 0).reduce((a, e) => a - e.delta, 0);
  for (const lot of lots) {
    const take = Math.min(lot.remaining, used);
    lot.remaining -= take;
    used -= take;
    if (used === 0) break;
  }
  return lots;
}

/**
 * Coins that have expired by `now` and are still unused, and the last such lot (its id makes the expiry's
 * idempotency key: one expiry per lot boundary, never twice).
 */
export function expiredCoins(
  entries: readonly CoinLotEntry[],
  now: Date,
): { coins: number; lastLotId: string | null } {
  let coins = 0;
  let lastLotId: string | null = null;
  for (const lot of coinLots(entries)) {
    if (!lot.expiresAt || lot.expiresAt.getTime() > now.getTime()) break;
    coins += lot.remaining;
    lastLotId = lot.id;
  }
  return { coins, lastLotId };
}

/** The next coins to expire after `now`: how many and when (null when nothing expires). */
export function nextExpiry(entries: readonly CoinLotEntry[], now: Date): { coins: number; at: Date } | null {
  const lot = coinLots(entries).find(
    (l) => l.remaining > 0 && l.expiresAt && l.expiresAt.getTime() > now.getTime(),
  );
  return lot?.expiresAt ? { coins: lot.remaining, at: lot.expiresAt } : null;
}

/** Coins earned for a delivered order: `earnBp` of what the products cost after discounts, in whole coins. */
export function orderRewardCoins(paidProductsPaise: number, earnBp: number, coinValuePaise: number): number {
  if (paidProductsPaise <= 0 || earnBp <= 0 || coinValuePaise <= 0) return 0;
  return Math.floor((paidProductsPaise * earnBp) / 10_000 / coinValuePaise);
}
