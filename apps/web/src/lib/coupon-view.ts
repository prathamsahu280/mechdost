import { COUPON_LIMITS, type CouponKind, type CouponReason } from '@mechdost/shared/coupon';
import type { AdminCoupon, CouponInput, CouponViewDto } from '@mechdost/shared/coupon-api';
import { parseRupees } from './money-input';

/**
 * View helpers for coupons (spec 03 / 07 / 08): every word comes from the `coupons` locale namespace (hard rule 10),
 * these functions only choose the key and the values. The customer's conditions are listed before a code is applied
 * (CCPA / dark-pattern rules, `research/promotions-referrals.md`); the admin form turns what staff type into the API's
 * `CouponInput` (rupees → integer paise, IST date-times as typed).
 */
export type CouponErrorKey =
  `err_${CouponReason}` | 'err_sign_in' | 'err_verify' | 'err_rate' | 'err_network' | 'err_generic';

/** The message for a refused check (the API's reason code) or a failed call (its error code). */
export function couponErrorKey(codeOrReason: string): CouponErrorKey {
  const reasons: readonly string[] = [
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
  ];
  if (reasons.includes(codeOrReason)) return `err_${codeOrReason}` as CouponErrorKey;
  switch (codeOrReason) {
    case 'AUTH_REQUIRED':
    case 'HTTP_401':
      return 'err_sign_in';
    case 'VERIFICATION_REQUIRED':
      return 'err_verify';
    case 'RATE_LIMITED':
    case 'HTTP_429':
      return 'err_rate';
    case 'NETWORK':
    case 'UNAVAILABLE':
      return 'err_network';
    default:
      return 'err_generic';
  }
}

export interface ConditionLine {
  key: 'cond_percent' | 'cond_flat' | 'cond_free' | 'cond_cap' | 'cond_min' | 'cond_ends' | 'cond_first';
  /** Plain numbers / paise; the screen formats them. */
  value?: number;
  at?: string;
}

/** What the offer does and when it applies, in reading order. */
export function conditionLines(
  c: Pick<
    CouponViewDto,
    'kind' | 'value' | 'minSubtotalPaise' | 'maxDiscountPaise' | 'endsAt' | 'firstOrderOnly'
  >,
): ConditionLine[] {
  const lines: ConditionLine[] = [];
  if (c.kind === 'percent') lines.push({ key: 'cond_percent', value: c.value });
  else if (c.kind === 'flat') lines.push({ key: 'cond_flat', value: c.value });
  else lines.push({ key: 'cond_free' });
  if (c.kind === 'percent' && c.maxDiscountPaise !== null)
    lines.push({ key: 'cond_cap', value: c.maxDiscountPaise });
  if (c.minSubtotalPaise > 0) lines.push({ key: 'cond_min', value: c.minSubtotalPaise });
  if (c.endsAt) lines.push({ key: 'cond_ends', at: c.endsAt });
  if (c.firstOrderOnly) lines.push({ key: 'cond_first' });
  return lines;
}

// ── Admin form ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface CouponForm {
  code: string;
  title: string;
  titleHi: string;
  terms: string;
  termsHi: string;
  kind: CouponKind;
  /** Percent number, or rupees for flat. */
  value: string;
  minRupees: string;
  capRupees: string;
  startsAtIst: string;
  endsAtIst: string;
  usageLimitTotal: string;
  usageLimitPerUser: string;
  firstOrderOnly: boolean;
  city: string;
  funder: 'mechdost' | 'shop';
  shopId: string;
  /** Listed on the public offers page; private by default. */
  isPublic: boolean;
  /** Applied at checkout with no code (MechDost-funded only). */
  autoApply: boolean;
  /** Category slug, or '' for every product. */
  categorySlug: string;
}

export const emptyForm = (nowIst: string): CouponForm => ({
  code: '',
  title: '',
  titleHi: '',
  terms: '',
  termsHi: '',
  kind: 'percent',
  value: '',
  minRupees: '',
  capRupees: '',
  startsAtIst: nowIst,
  endsAtIst: '',
  usageLimitTotal: '',
  usageLimitPerUser: '1',
  firstOrderOnly: false,
  city: '',
  funder: 'mechdost',
  shopId: '',
  isPublic: false,
  autoApply: false,
  categorySlug: '',
});

const rupees = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export function formFromCoupon(c: AdminCoupon): CouponForm {
  return {
    code: c.code,
    title: c.title,
    titleHi: c.titleHi ?? '',
    terms: c.terms ?? '',
    termsHi: c.termsHi ?? '',
    kind: c.kind,
    value: c.kind === 'percent' ? String(c.value) : c.kind === 'flat' ? rupees(c.value) : '',
    minRupees: c.minSubtotalPaise > 0 ? rupees(c.minSubtotalPaise) : '',
    capRupees: c.maxDiscountPaise === null ? '' : rupees(c.maxDiscountPaise),
    startsAtIst: c.startsAtIst,
    endsAtIst: c.endsAtIst ?? '',
    usageLimitTotal: c.usageLimitTotal === null ? '' : String(c.usageLimitTotal),
    usageLimitPerUser: String(c.usageLimitPerUser),
    firstOrderOnly: c.firstOrderOnly,
    city: c.cityCode ?? '',
    funder: c.funder,
    shopId: c.shop?.id ?? '',
    isPublic: c.isPublic,
    autoApply: c.autoApply,
    categorySlug: c.category?.slug ?? '',
  };
}

export type FormField =
  | 'code'
  | 'title'
  | 'titleHi'
  | 'terms'
  | 'value'
  | 'minRupees'
  | 'capRupees'
  | 'startsAtIst'
  | 'endsAtIst'
  | 'usageLimitTotal'
  | 'usageLimitPerUser'
  | 'shopId'
  | 'autoApply';
export type FormErrorKey =
  | 'f_err_code'
  | 'f_err_title'
  | 'f_err_title_hi'
  | 'f_err_terms'
  | 'f_err_value'
  | 'f_err_percent'
  | 'f_err_money'
  | 'f_err_dates'
  | 'f_err_start'
  | 'f_err_limit'
  | 'f_err_per_user'
  | 'f_err_shop'
  | 'f_err_auto_shop';

const IST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const whole = (v: string, min: number, max: number): number | null => {
  const n = /^\d{1,9}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** The API's input from what staff typed, or the first field that is wrong (the server checks everything again). */
export function inputFromForm(
  f: CouponForm,
): { ok: true; input: CouponInput } | { ok: false; field: FormField; error: FormErrorKey } {
  const bad = (field: FormField, error: FormErrorKey) => ({ ok: false as const, field, error });
  const code = f.code.trim();
  if (!/^[A-Za-z0-9]{4,20}$/.test(code)) return bad('code', 'f_err_code');
  if (f.title.trim().length < 2) return bad('title', 'f_err_title');
  if (f.titleHi.trim().length < 2) return bad('titleHi', 'f_err_title_hi');
  const hasTerms = f.terms.trim() !== '' || f.termsHi.trim() !== '';
  if (hasTerms && (f.terms.trim() === '' || f.termsHi.trim() === '')) return bad('terms', 'f_err_terms');

  let value = 0;
  if (f.kind === 'percent') {
    const p = whole(f.value, 1, COUPON_LIMITS.percentMax);
    if (p === null) return bad('value', 'f_err_percent');
    value = p;
  } else if (f.kind === 'flat') {
    const r = parseRupees(f.value);
    if (!r.ok || r.paise > COUPON_LIMITS.valueMaxPaise) return bad('value', 'f_err_money');
    value = r.paise;
  }
  let min = 0;
  if (f.minRupees.trim() !== '') {
    const r = parseRupees(f.minRupees, { allowZero: true });
    if (!r.ok) return bad('minRupees', 'f_err_money');
    min = r.paise;
  }
  let cap: number | null = null;
  if (f.kind === 'percent' && f.capRupees.trim() !== '') {
    const r = parseRupees(f.capRupees);
    if (!r.ok) return bad('capRupees', 'f_err_money');
    cap = r.paise;
  }
  if (!IST.test(f.startsAtIst)) return bad('startsAtIst', 'f_err_start');
  const ends = f.endsAtIst.trim() === '' ? null : f.endsAtIst;
  if (ends !== null && (!IST.test(ends) || ends <= f.startsAtIst)) return bad('endsAtIst', 'f_err_dates');
  const total =
    f.usageLimitTotal.trim() === '' ? null : whole(f.usageLimitTotal, 1, COUPON_LIMITS.totalUseMax);
  if (f.usageLimitTotal.trim() !== '' && total === null) return bad('usageLimitTotal', 'f_err_limit');
  const perUser = whole(f.usageLimitPerUser, 1, COUPON_LIMITS.perUserMax);
  if (perUser === null || (f.firstOrderOnly && perUser !== 1))
    return bad('usageLimitPerUser', 'f_err_per_user');
  if (f.funder === 'shop' && f.shopId === '') return bad('shopId', 'f_err_shop');
  if (f.autoApply && f.funder === 'shop') return bad('autoApply', 'f_err_auto_shop');

  return {
    ok: true,
    input: {
      code,
      title: f.title.trim(),
      titleHi: f.titleHi.trim(),
      terms: hasTerms ? f.terms.trim() : null,
      termsHi: hasTerms ? f.termsHi.trim() : null,
      kind: f.kind,
      value,
      minSubtotalPaise: min,
      maxDiscountPaise: cap,
      startsAtIst: f.startsAtIst,
      endsAtIst: ends,
      usageLimitTotal: total,
      usageLimitPerUser: perUser,
      firstOrderOnly: f.firstOrderOnly,
      city: f.city.trim() === '' ? null : f.city.trim().toUpperCase(),
      funder: f.funder,
      shopId: f.funder === 'shop' ? f.shopId : null,
      isPublic: f.isPublic,
      autoApply: f.autoApply,
      // Free delivery depends on no category (the server refuses the combination).
      categorySlug: f.kind === 'free_shipping' || f.categorySlug === '' ? null : f.categorySlug,
    },
  };
}

export type CouponStatusKey =
  'live' | 'paused' | 'waiting_shop' | 'declined' | 'scheduled' | 'ended' | 'used_up';

/** The one status word for a row (what staff need to act on first). */
export function couponStatus(c: AdminCoupon, now: Date): CouponStatusKey {
  if (!c.active) return 'paused';
  if (c.funder === 'shop' && c.shopTerms === 'declined') return 'declined';
  if (c.funder === 'shop' && c.shopTerms !== 'accepted') return 'waiting_shop';
  if (new Date(c.startsAt) > now) return 'scheduled';
  if (c.endsAt !== null && new Date(c.endsAt) <= now) return 'ended';
  if (c.usageLimitTotal !== null && c.usedCount >= c.usageLimitTotal) return 'used_up';
  return 'live';
}

/** A failed save/pause → a message key in the `coupons` namespace. */
export type AdminErrorKey =
  | 'a_err_stale'
  | 'a_err_taken'
  | 'a_err_locked'
  | 'a_err_rule'
  | 'a_err_shop'
  | 'a_err_category'
  | 'a_err_forbidden'
  | 'a_err_network'
  | 'a_err_generic';
export function adminErrorKey(code: string): AdminErrorKey {
  switch (code) {
    case 'STALE_COUPON':
      return 'a_err_stale';
    case 'COUPON_CODE_TAKEN':
      return 'a_err_taken';
    case 'COUPON_LOCKED':
      return 'a_err_locked';
    case 'COUPON_RULE':
    case 'VALIDATION':
    case 'HTTP_422':
    case 'HTTP_400':
      return 'a_err_rule';
    case 'COUPON_SHOP':
      return 'a_err_shop';
    case 'COUPON_CATEGORY':
      return 'a_err_category';
    case 'FORBIDDEN':
    case 'HTTP_403':
    case 'NOT_FOUND':
    case 'HTTP_404':
      return 'a_err_forbidden';
    case 'NETWORK':
    case 'UNAVAILABLE':
      return 'a_err_network';
    default:
      return 'a_err_generic';
  }
}
