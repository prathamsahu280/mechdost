import type { CouponReason } from '@mechdost/shared/coupon';
import { chooseOffer, quoteInternal, type CartLine } from './checkout';
import type { CouponView } from './coupons';
import type { CatalogueLocale } from './catalogue';
import type { Tx } from './orders';

/**
 * The checkout's "check this code" step (spec 03): the cart priced for the PIN, the coupon checked for this customer,
 * and the totals the customer would pay with it, so the screen shows the conditions and the saving before the code is
 * applied. No side effects, nothing counted: `placeOrder` checks again and counts. The coupon comes first in the
 * order of discounts; coins are worked out on the net products (the screen asks `GET /me/coins` rules for that).
 */
export type CouponPreview =
  | {
      ok: true;
      coupon: CouponView;
      /** A typed code or an automatic offer (2026-11-16: never both; the larger discount won). */
      source: 'code' | 'automatic';
      /** The offer that lost, so the customer sees what they did not get. */
      beaten: { source: 'code' | 'automatic'; title: string; discountPaise: number } | null;
      discountPaise: number;
      productDiscountPaise: number;
      shippingDiscountPaise: number;
      /** Per sub-order, same order as the quote's groups. */
      groups: { productDiscountPaise: number; shippingDiscountPaise: number }[];
      /** Products after the coupon: what coins are capped against. */
      netSubtotalPaise: number;
      totalPaise: number;
      onlineTotalPaise: number;
      cod: { allowed: boolean; reason: 'over_cap' | 'pincode' | null; capPaise: number };
    }
  | { ok: false; reason: CouponReason; coupon: CouponView | null };

export async function previewCoupon(
  db: Tx,
  input: {
    userId: string;
    /** The typed code, or null to ask only for the automatic offer the cart gets. */
    code: string | null;
    pincode: string;
    lines: readonly CartLine[];
    locale: CatalogueLocale;
  },
): Promise<CouponPreview> {
  const internal = await quoteInternal(db, {
    pincode: input.pincode,
    lines: input.lines,
    locale: input.locale,
  });
  const checked = await chooseOffer(db, internal, {
    code: input.code?.trim() ? input.code.trim() : null,
    userId: input.userId,
    locale: input.locale,
    allowAutomatic: true,
  });
  if (!checked.ok) return { ok: false, reason: checked.reason, coupon: checked.view };
  const { quote } = internal;
  const d = checked.discount;
  const totalPaise = quote.totalPaise - d.discountPaise;
  const reason =
    quote.cod.reason === 'pincode' ? 'pincode' : totalPaise > quote.cod.capPaise ? 'over_cap' : null;
  return {
    ok: true,
    coupon: checked.coupon.view,
    source: checked.source,
    beaten: checked.beaten,
    discountPaise: d.discountPaise,
    productDiscountPaise: d.productDiscountPaise,
    shippingDiscountPaise: d.shippingDiscountPaise,
    groups: d.perGroup.map((g) => ({
      productDiscountPaise: g.productPaise,
      shippingDiscountPaise: g.shippingPaise,
    })),
    netSubtotalPaise: quote.subtotalPaise - d.productDiscountPaise,
    totalPaise,
    onlineTotalPaise: quote.onlineTotalPaise - d.discountPaise,
    cod: { allowed: reason === null, reason, capPaise: quote.cod.capPaise },
  };
}
