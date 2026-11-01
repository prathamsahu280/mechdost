/**
 * MechDost Coins (decision 2026-11-01, spec 20): a loyalty bonus, not a wallet. Coins have no cash value, cannot
 * be bought, sold, transferred or cashed out, and are only used for a discount on an order. How coins are earned
 * is decided by the user later (inbox Q24); the redemption maths below is fixed and shared by API, web and app.
 * Integer paise and basis points only (CLAUDE.md conventions).
 */
export interface CoinRules {
  /** Discount value of one coin, in paise (default ₹1). */
  coinValuePaise: number;
  /** Most of an order's product subtotal that coins may pay, in basis points (default 10%). */
  maxRedeemBp: number;
  /** Smallest product subtotal on which coins can be used, in paise (default ₹0). */
  minOrderPaise: number;
  /** Days before earned coins expire (default 365). */
  expiryDays: number;
}

export const DEFAULT_COIN_RULES: CoinRules = {
  coinValuePaise: 100,
  maxRedeemBp: 1_000,
  minOrderPaise: 0,
  expiryDays: 365,
};

/** Admin-editable ranges (spec 08 settings). */
export const COIN_RULE_LIMITS: Record<keyof CoinRules, readonly [number, number]> = {
  coinValuePaise: [1, 1_000],
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
