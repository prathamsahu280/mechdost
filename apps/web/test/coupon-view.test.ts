import { describe, expect, it } from 'vitest';
import type { AdminCoupon } from '@mechdost/shared/coupon-api';
import { checkoutTotals } from '../src/lib/checkout-totals';
import {
  adminErrorKey,
  conditionLines,
  couponErrorKey,
  couponStatus,
  emptyForm,
  formFromCoupon,
  inputFromForm,
  type CouponForm,
} from '../src/lib/coupon-view';

const NOW = new Date('2026-11-15T10:00:00Z');
const base = (over: Partial<CouponForm> = {}): CouponForm => ({
  ...emptyForm('2026-11-15T10:00'),
  code: 'DIWALI10',
  title: 'Diwali 10%',
  titleHi: 'दिवाली 10%',
  value: '10',
  ...over,
});

describe('customer messages', () => {
  it('every refusal reason has its own message; call failures map to a few kinds', () => {
    expect(couponErrorKey('min_order')).toBe('err_min_order');
    expect(couponErrorKey('wrong_city')).toBe('err_wrong_city');
    expect(couponErrorKey('user_limit')).toBe('err_user_limit');
    expect(couponErrorKey('AUTH_REQUIRED')).toBe('err_sign_in');
    expect(couponErrorKey('HTTP_429')).toBe('err_rate');
    expect(couponErrorKey('NETWORK')).toBe('err_network');
    expect(couponErrorKey('SOMETHING_NEW')).toBe('err_generic');
  });

  it('lists the conditions in reading order, only the ones that exist', () => {
    expect(
      conditionLines({
        kind: 'percent',
        value: 10,
        minSubtotalPaise: 50_000,
        maxDiscountPaise: 20_000,
        endsAt: '2026-12-01T00:00:00Z',
        firstOrderOnly: true,
      }).map((l) => l.key),
    ).toEqual(['cond_percent', 'cond_cap', 'cond_min', 'cond_ends', 'cond_first']);
    expect(
      conditionLines({
        kind: 'free_shipping',
        value: 0,
        minSubtotalPaise: 0,
        maxDiscountPaise: null,
        endsAt: null,
        firstOrderOnly: false,
      }).map((l) => l.key),
    ).toEqual(['cond_free']);
  });
});

describe('offers flags in the admin form (2026-11-16)', () => {
  it('starts private and manual, and carries public / automatic / category into the API input', () => {
    const empty = emptyForm('2026-11-15T10:00');
    expect(empty).toMatchObject({ isPublic: false, autoApply: false, categorySlug: '' });
    expect(inputFromForm(base())).toMatchObject({
      ok: true,
      input: { isPublic: false, autoApply: false, categorySlug: null },
    });
    const cat = 'engine-oil';
    expect(inputFromForm(base({ isPublic: true, autoApply: true, categorySlug: cat }))).toMatchObject({
      ok: true,
      input: { isPublic: true, autoApply: true, categorySlug: cat },
    });
  });

  it('an automatic offer cannot be paid by a shop, and free delivery has no category', () => {
    expect(inputFromForm(base({ autoApply: true, funder: 'shop', shopId: 's1' }))).toMatchObject({
      ok: false,
      field: 'autoApply',
      error: 'f_err_auto_shop',
    });
    expect(
      inputFromForm(base({ kind: 'free_shipping', value: '', categorySlug: 'engine-oil' })),
    ).toMatchObject({ ok: true, input: { categorySlug: null } });
  });

  it('reads the flags back when editing, and maps a missing category to its message', () => {
    const coupon = {
      id: 'c1',
      code: 'AUTO1',
      title: 'Welcome',
      titleHi: 'स्वागत',
      terms: null,
      termsHi: null,
      kind: 'flat',
      value: 5_000,
      minSubtotalPaise: 0,
      maxDiscountPaise: null,
      startsAt: '2026-11-15T04:30:00.000Z',
      endsAt: null,
      startsAtIst: '2026-11-15T10:00',
      endsAtIst: null,
      usageLimitTotal: null,
      usageLimitPerUser: 1,
      usedCount: 0,
      firstOrderOnly: true,
      cityCode: null,
      funder: 'mechdost',
      shop: null,
      shopTerms: null,
      isPublic: true,
      autoApply: true,
      category: { slug: 'tyres', name: 'Tyres' },
      active: true,
      pausedReason: null,
      live: true,
      version: 1,
    } satisfies AdminCoupon;
    expect(formFromCoupon(coupon)).toMatchObject({ isPublic: true, autoApply: true, categorySlug: 'tyres' });
    expect(adminErrorKey('COUPON_CATEGORY')).toBe('a_err_category');
  });
});

describe('admin form → API input', () => {
  it('turns rupees into integer paise and keeps IST times as typed', () => {
    const r = inputFromForm(base({ kind: 'flat', value: '99.50', minRupees: '1,000', capRupees: '' }));
    expect(r).toMatchObject({
      ok: true,
      input: { kind: 'flat', value: 9_950, minSubtotalPaise: 100_000, maxDiscountPaise: null },
    });
    const p = inputFromForm(base({ capRupees: '200' }));
    expect(p).toMatchObject({
      ok: true,
      input: {
        kind: 'percent',
        value: 10,
        maxDiscountPaise: 20_000,
        startsAtIst: '2026-11-15T10:00',
        endsAtIst: null,
        city: null,
      },
    });
  });

  it('names the first wrong field', () => {
    expect(inputFromForm(base({ code: 'ab' }))).toMatchObject({ ok: false, field: 'code' });
    expect(inputFromForm(base({ titleHi: '' }))).toMatchObject({ ok: false, field: 'titleHi' });
    expect(inputFromForm(base({ value: '95' }))).toMatchObject({
      ok: false,
      field: 'value',
      error: 'f_err_percent',
    });
    expect(inputFromForm(base({ terms: 'Only English' }))).toMatchObject({ ok: false, field: 'terms' });
    expect(inputFromForm(base({ endsAtIst: '2026-11-14T10:00' }))).toMatchObject({
      ok: false,
      field: 'endsAtIst',
    });
    expect(inputFromForm(base({ usageLimitPerUser: '2', firstOrderOnly: true }))).toMatchObject({
      ok: false,
      field: 'usageLimitPerUser',
    });
    expect(inputFromForm(base({ funder: 'shop', shopId: '' }))).toMatchObject({ ok: false, field: 'shopId' });
  });

  it('a shop-funded form carries the shop; a MechDost one never does', () => {
    expect(
      inputFromForm(base({ funder: 'shop', shopId: '0198f3a0-0000-7000-8000-000000000001' })),
    ).toMatchObject({
      ok: true,
      input: { funder: 'shop', shopId: '0198f3a0-0000-7000-8000-000000000001' },
    });
    expect(inputFromForm(base({ funder: 'mechdost', shopId: 'left-over' }))).toMatchObject({
      ok: true,
      input: { shopId: null },
    });
  });

  it('round-trips a stored coupon', () => {
    const c: AdminCoupon = {
      id: 'x',
      code: 'SAVE50',
      title: 'Save',
      titleHi: 'बचत',
      terms: null,
      termsHi: null,
      kind: 'flat',
      value: 5_000,
      minSubtotalPaise: 0,
      maxDiscountPaise: null,
      startsAt: '2026-11-15T04:30:00.000Z',
      endsAt: null,
      startsAtIst: '2026-11-15T10:00',
      endsAtIst: null,
      usageLimitTotal: 100,
      usageLimitPerUser: 1,
      usedCount: 0,
      firstOrderOnly: false,
      cityCode: 'RPR',
      funder: 'mechdost',
      shop: null,
      shopTerms: null,
      isPublic: false,
      autoApply: false,
      category: null,
      active: true,
      pausedReason: null,
      live: true,
      version: 1,
    };
    const again = inputFromForm(formFromCoupon(c));
    expect(again).toMatchObject({
      ok: true,
      input: { code: 'SAVE50', kind: 'flat', value: 5_000, usageLimitTotal: 100, city: 'RPR' },
    });
  });
});

describe('status and errors', () => {
  const c = (over: Partial<AdminCoupon>): AdminCoupon => ({
    id: 'x',
    code: 'ABCD',
    title: 't',
    titleHi: 't',
    terms: null,
    termsHi: null,
    kind: 'flat',
    value: 100,
    minSubtotalPaise: 0,
    maxDiscountPaise: null,
    startsAt: '2026-11-01T00:00:00Z',
    endsAt: null,
    startsAtIst: '',
    endsAtIst: null,
    usageLimitTotal: null,
    usageLimitPerUser: 1,
    usedCount: 0,
    firstOrderOnly: false,
    cityCode: null,
    funder: 'mechdost',
    shop: null,
    shopTerms: null,
    isPublic: false,
    autoApply: false,
    category: null,
    active: true,
    pausedReason: null,
    live: true,
    version: 1,
    ...over,
  });
  it('shows the one thing staff must act on first', () => {
    expect(couponStatus(c({}), NOW)).toBe('live');
    expect(couponStatus(c({ active: false }), NOW)).toBe('paused');
    expect(couponStatus(c({ funder: 'shop', shopTerms: 'pending' }), NOW)).toBe('waiting_shop');
    expect(couponStatus(c({ funder: 'shop', shopTerms: 'declined' }), NOW)).toBe('declined');
    expect(couponStatus(c({ startsAt: '2026-12-01T00:00:00Z' }), NOW)).toBe('scheduled');
    expect(couponStatus(c({ endsAt: '2026-11-10T00:00:00Z' }), NOW)).toBe('ended');
    expect(couponStatus(c({ usageLimitTotal: 5, usedCount: 5 }), NOW)).toBe('used_up');
  });
  it('maps the API codes', () => {
    expect(adminErrorKey('STALE_COUPON')).toBe('a_err_stale');
    expect(adminErrorKey('COUPON_CODE_TAKEN')).toBe('a_err_taken');
    expect(adminErrorKey('whatever')).toBe('a_err_generic');
  });
});

describe('the checkout summary adds up with a coupon', () => {
  it('coupon first, then coins, then the COD fee only for cash on delivery', () => {
    const input = {
      totalPaise: 105_000,
      codFeePaise: 5_000,
      onlineTotalPaise: 100_000,
      coinDiscountPaise: 3_000,
    };
    expect(checkoutTotals({ ...input, method: 'cod', couponDiscountPaise: 10_000 })).toEqual({
      feePaise: 5_000,
      payablePaise: 92_000,
    });
    expect(checkoutTotals({ ...input, method: 'online', couponDiscountPaise: 10_000 })).toEqual({
      feePaise: 0,
      payablePaise: 87_000,
    });
    expect(checkoutTotals({ ...input, method: 'online' }).payablePaise).toBe(97_000);
  });
});
