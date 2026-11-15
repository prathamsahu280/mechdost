/**
 * Coupon maths (spec 03 "Coupons", design 2026-11-15 catalogue/storefront next tier). Pure, integer paise, no Zod:
 * the db layer, API and browser import it (L101). The order of discounts is fixed: price → ONE coupon → MechDost
 * Coins on what is left (`research/promotions-referrals.md` § 1.4).
 *
 * Allocation rule (recorded 2026-11-15): the coupon's discount is spread over the eligible product lines in
 * proportion to their totals (largest-remainder method: floor shares, then one paise at a time to the biggest
 * fractional remainder, ties to the earlier line), so the line shares add up to the discount exactly and no line is
 * discounted below zero. A free-delivery coupon takes each group's whole delivery charge and nothing off products.
 */
export const COUPON_KINDS = ['percent', 'flat', 'free_shipping'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Who pays for the discount: MechDost (the shop is paid in full) or the named shop (its payout is lower). */
export const COUPON_FUNDERS = ['mechdost', 'shop'] as const;
export type CouponFunder = (typeof COUPON_FUNDERS)[number];

/** Why a code cannot be used. Codes (hard rule 16); the screen words them from the locale files. */
export const COUPON_REASONS = [
  'not_found',
  'paused',
  'not_started',
  'expired',
  'exhausted',
  'user_limit',
  'min_order',
  'wrong_city',
  'first_order_only',
  'not_for_cart',
  'shop_terms_pending',
  'quote_order',
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

/** The sizes the admin may set (the database CHECKs repeat them). */
export const COUPON_LIMITS = {
  percentMax: 90,
  valueMaxPaise: 10_000_000,
  totalUseMax: 1_000_000,
  perUserMax: 100,
} as const;

export interface CouponRule {
  kind: CouponKind;
  /** Percent (1..100) for `percent`, paise for `flat`, ignored for `free_shipping`. */
  value: number;
  minSubtotalPaise: number;
  maxDiscountPaise: number | null;
  funder: CouponFunder;
  shopId: string | null;
}

/** One sub-order of the cart: its shop, its product line totals (GST-inclusive paise) and delivery charge. */
export interface CouponGroup {
  shopId: string;
  lineTotals: readonly number[];
  shippingPaise: number;
}

export interface CouponGroupShare {
  /** Share on each product line, same order as `lineTotals`. */
  lines: number[];
  productPaise: number;
  shippingPaise: number;
  /** `productPaise + shippingPaise`. */
  discountPaise: number;
}

export interface CouponDiscount {
  discountPaise: number;
  productDiscountPaise: number;
  shippingDiscountPaise: number;
  perGroup: CouponGroupShare[];
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Spread `total` over `weights` so the parts add up to `total`. Needs `0 <= total <= sum(weights)`; no part is above
 * its weight. BigInt inside: paise × paise can pass 2^53.
 */
export function allocateLargestRemainder(total: number, weights: readonly number[]): number[] {
  const whole = sum(weights);
  if (!Number.isSafeInteger(total) || total < 0 || total > whole)
    throw new RangeError('allocateLargestRemainder: total must be between 0 and the sum of the weights');
  if (total === 0 || whole === 0) return weights.map(() => 0);
  const S = BigInt(whole);
  const T = BigInt(total);
  const parts = weights.map((w) => {
    const num = T * BigInt(w);
    return { floor: Number(num / S), rem: num % S };
  });
  const out = parts.map((p) => p.floor);
  let left = total - sum(out);
  const order = parts
    .map((p, i) => ({ i, rem: p.rem }))
    .filter((p) => p.rem > 0n)
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of order) {
    if (left === 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/**
 * The discount a coupon gives on a cart, or why it gives none. A shop-funded coupon looks only at its own shop's
 * lines; the minimum order is measured on the eligible products (so a shop's offer cannot be unlocked by another
 * shop's goods). Percent is rounded down, then capped; flat never goes above the eligible products.
 */
export function applyCoupon(
  rule: CouponRule,
  groups: readonly CouponGroup[],
): CouponDiscount | { reason: 'min_order' | 'not_for_cart' } {
  const eligible = groups.map((g) => rule.funder === 'mechdost' || g.shopId === rule.shopId);
  const productBase = sum(groups.flatMap((g, i) => (eligible[i] ? [...g.lineTotals] : [])));
  const shippingBase = sum(groups.map((g, i) => (eligible[i] ? g.shippingPaise : 0)));
  if (!eligible.some(Boolean) || (rule.kind === 'free_shipping' ? shippingBase : productBase) === 0)
    return { reason: 'not_for_cart' };
  if (productBase < rule.minSubtotalPaise) return { reason: 'min_order' };

  let productDiscount = 0;
  if (rule.kind === 'percent') {
    productDiscount = Number((BigInt(productBase) * BigInt(rule.value)) / 100n);
    if (rule.maxDiscountPaise !== null) productDiscount = Math.min(productDiscount, rule.maxDiscountPaise);
  } else if (rule.kind === 'flat') {
    productDiscount = Math.min(rule.value, productBase);
  }
  if (rule.kind !== 'free_shipping' && productDiscount <= 0) return { reason: 'not_for_cart' };

  const eligibleLines = groups.flatMap((g, i) => (eligible[i] ? [...g.lineTotals] : []));
  const shares = allocateLargestRemainder(productDiscount, eligibleLines);
  let cursor = 0;
  const perGroup = groups.map((g, i): CouponGroupShare => {
    const lines = g.lineTotals.map(() => 0);
    if (eligible[i])
      for (let j = 0; j < lines.length; j += 1) {
        lines[j] = shares[cursor] ?? 0;
        cursor += 1;
      }
    const productPaise = sum(lines);
    const shippingPaise = rule.kind === 'free_shipping' && eligible[i] ? g.shippingPaise : 0;
    return { lines, productPaise, shippingPaise, discountPaise: productPaise + shippingPaise };
  });
  const shippingDiscountPaise = sum(perGroup.map((p) => p.shippingPaise));
  return {
    discountPaise: productDiscount + shippingDiscountPaise,
    productDiscountPaise: productDiscount,
    shippingDiscountPaise,
    perGroup,
  };
}

/** The admin types a start and end in IST wall-clock time (`YYYY-MM-DDTHH:mm`); this is that instant. */
export function istLocalToDate(local: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new RangeError(`Invalid IST date-time: ${local}`);
  const ms = Date.parse(`${local}:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid IST date-time: ${local}`);
  return new Date(ms - 330 * 60 * 1000);
}

/** The reverse, for the edit form: an instant as `YYYY-MM-DDTHH:mm` in IST. */
export function dateToIstLocal(date: Date): string {
  return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 16);
}
