import { CouponPreviewDto, type CouponPreview } from '@mechdost/shared/coupon-api';
import { authed, type ApiResult } from './orders-api';

/**
 * The checkout's coupon check on the API (spec 03; real data mode). Signed in; nothing is counted here, the order
 * placement checks the code again. Loaded only by the lazy coupon field, never by always-loaded modules (JS budget).
 */
export function checkCoupon(
  locale: string,
  input: { code: string; pincode: string; lines: readonly { sku: string; qty: number }[] },
): Promise<ApiResult<CouponPreview>> {
  return authed(locale, '/checkout/coupon', CouponPreviewDto, {
    method: 'POST',
    body: { ...input, locale: locale === 'hi' ? 'hi' : 'en' },
  });
}

export type AppliedCoupon = Extract<CouponPreview, { ok: true }>;
