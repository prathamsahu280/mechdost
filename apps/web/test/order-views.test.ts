import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import {
  addressLines,
  adminActions,
  advanceBody,
  apiErrorKey,
  closedGroup,
  historyReasonKey,
  itemTitle,
  minutesLeft,
  nextShopAction,
  priceRows,
  routeSuggestions,
  shopIdsOf,
  shopStageKey,
} from '../src/lib/order-views';

/** Real-API shop portal and admin routing (Stream C2, 2026-11-14): what each card shows and which call it makes. */
describe('shop portal on the API', () => {
  const now = Date.parse('2026-11-16T10:00:00Z');

  it('counts offer minutes up, never below zero, and survives a missing or broken timestamp', () => {
    expect(minutesLeft('2026-11-16T10:04:01Z', now)).toBe(5);
    expect(minutesLeft('2026-11-16T10:05:00Z', now)).toBe(5);
    expect(minutesLeft('2026-11-16T09:59:00Z', now)).toBe(0);
    expect(minutesLeft(null, now)).toBe(0);
    expect(minutesLeft('not a date', now)).toBe(0);
  });

  it('shows the Hindi item title on /hi only when the snapshot has one', () => {
    const item = { title: 'Castrol Activ 4T 900 ml', titleHi: 'कैस्ट्रॉल एक्टिव 4T 900 ml' };
    expect(itemTitle(item, 'hi')).toBe(item.titleHi);
    expect(itemTitle(item, 'en')).toBe(item.title);
    expect(itemTitle({ title: 'Bosch wiper', titleHi: null }, 'hi')).toBe('Bosch wiper');
  });

  it('offers one next step per stage; "out for delivery" from packed is hand-over + out for delivery', () => {
    expect(nextShopAction('confirmed')).toEqual({ kind: 'advance', label: 'markPacked', steps: ['packed'] });
    expect(nextShopAction('packed')).toEqual({
      kind: 'advance',
      label: 'markShipped',
      steps: ['out_for_delivery'],
      handOver: true,
    });
    // Handed over but the code was never sent (second call failed): only the missing step.
    expect(nextShopAction('shipped')).toEqual({
      kind: 'advance',
      label: 'markShipped',
      steps: ['out_for_delivery'],
    });
    expect(nextShopAction('out_for_delivery')).toEqual({ kind: 'code' });
    expect(nextShopAction('delivered')).toBeNull();
    expect(nextShopAction('cancelled')).toBeNull();
  });

  it('sends the version with each step and own delivery for the hand-over', () => {
    expect(advanceBody('packed', 3)).toEqual({ to: 'packed', version: 3 });
    expect(advanceBody('shipped', 4)).toEqual({ to: 'shipped', version: 4, mode: 'own' });
    expect(advanceBody('out_for_delivery', 5)).toEqual({ to: 'out_for_delivery', version: 5 });
    // From "packed" one call hands over and goes out for delivery (QA pass 4, bug 3).
    expect(advanceBody('out_for_delivery', 5, true)).toEqual({
      to: 'out_for_delivery',
      version: 5,
      handOverOwn: true,
    });
  });

  it('labels statuses with the existing order stage texts', () => {
    expect(shopStageKey('confirmed')).toBe('stage_confirmed');
    expect(shopStageKey('packed')).toBe('stage_packed');
    expect(shopStageKey('shipped')).toBe('stage_shipped');
    expect(shopStageKey('out_for_delivery')).toBe('stage_shipped');
    expect(shopStageKey('delivered')).toBe('stage_delivered');
  });

  it('reads the loose address snapshot defensively', () => {
    expect(addressLines(null)).toBeNull();
    expect(addressLines({})).toBeNull();
    expect(
      addressLines({
        contactName: ' Ravi ',
        contactPhone: '+919812300000',
        line1: 'House 12, Shankar Nagar',
        line2: null,
        landmark: 'Near temple',
        pincode: '492007',
        extra: 5,
      }),
    ).toEqual({
      name: 'Ravi',
      phone: '+919812300000',
      lines: ['House 12, Shankar Nagar', 'Near temple', '492007'],
    });
    expect(addressLines({ line1: 42, pincode: '492001' })).toEqual({
      name: null,
      phone: null,
      lines: ['492001'],
    });
  });

  it('takes the shop ids from /v1/me roles, once each', () => {
    expect(
      shopIdsOf([
        { role: 'customer', shopId: null },
        { role: 'seller_owner', shopId: 's1' },
        { role: 'seller_staff', shopId: 's1' },
      ]),
    ).toEqual(['s1']);
    expect(shopIdsOf([{ role: 'customer', shopId: null }])).toEqual([]);
  });
});

describe('admin routing on the API', () => {
  it('allows each staff action exactly where the order state machine does', () => {
    expect(adminActions('placed')).toEqual({ route: true, reject: true, cancel: true, override: false });
    expect(adminActions('needs_rerouting')).toEqual({
      route: true,
      reject: true,
      cancel: true,
      override: false,
    });
    expect(adminActions('awaiting_shop')).toEqual({
      route: false,
      reject: false,
      cancel: true,
      override: false,
    });
    expect(adminActions('packed')).toEqual({ route: false, reject: false, cancel: true, override: false });
    expect(adminActions('shipped')).toEqual({ route: false, reject: false, cancel: false, override: false });
    expect(adminActions('out_for_delivery')).toEqual({
      route: false,
      reject: false,
      cancel: false,
      override: true,
    });
    expect(adminActions('delivered')).toEqual({
      route: false,
      reject: false,
      cancel: false,
      override: false,
    });
    expect(adminActions('nonsense')).toEqual({ route: false, reject: false, cancel: false, override: false });
  });

  it('offers only eligible, untried shops in the API ranking order, at most three', () => {
    const s = (shopId: string, eligible = true, triedBefore = false) => ({ shopId, eligible, triedBefore });
    const ranked = [s('a', true, true), s('b'), s('c', false), s('d'), s('e'), s('f')];
    expect(routeSuggestions(ranked).map((x) => x.shopId)).toEqual(['b', 'd', 'e']);
    expect(routeSuggestions([s('x', false), s('y', true, true)])).toEqual([]);
  });

  it('splits the closed view into delivered, rejected and cancelled', () => {
    expect(closedGroup('delivered')).toBe('delivered');
    expect(closedGroup('rejected')).toBe('rejected');
    expect(closedGroup('cancelled')).toBe('cancelled');
    expect(closedGroup('packed')).toBeNull();
  });

  it('explains past offers: expired → no answer in time, known decline codes, else declined', () => {
    expect(historyReasonKey({ status: 'expired', declineReason: null })).toBe('reason_timeout');
    expect(historyReasonKey({ status: 'declined', declineReason: 'out_of_stock' })).toBe(
      'reason_out_of_stock',
    );
    expect(historyReasonKey({ status: 'declined', declineReason: 'made_up' })).toBe('reason_declined');
  });
});

describe('API errors and shop prices', () => {
  it('maps API error codes to portal texts that exist in English and Hindi', () => {
    const codes = [
      'NETWORK',
      'STALE_ORDER',
      'CONFLICT',
      'RETRY',
      'ILLEGAL_TRANSITION',
      'ASSIGNMENT_UNAVAILABLE',
      'SHOP_NOT_ELIGIBLE',
      'ALREADY_DELIVERED',
      'MRP_EXCEEDED',
      'HTTP_500',
      'SOMETHING_NEW',
    ];
    for (const code of codes) {
      const key = apiErrorKey(code);
      expect(key.startsWith('api_err_')).toBe(true);
      expect(en.portal).toHaveProperty(key);
      expect(hi.portal).toHaveProperty(key);
    }
    expect(apiErrorKey('CONFLICT')).toBe('api_err_STALE_ORDER');
    expect(apiErrorKey('HTTP_500')).toBe('api_err_generic');
  });

  it('every new portal.api_* string has a Hindi version', () => {
    const keys = Object.keys(en.portal).filter((k) => k.startsWith('api_'));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(hi.portal).toHaveProperty(k);
  });

  it('merges offers with the newest price request per product', () => {
    const offer = { sku: 'A-1', product: 'Oil', mrpPaise: 50_000, sellingPaise: 44_000, onHand: 7 };
    const req = (sku: string, status: string, requestedPaise: number, reasonCode: string | null = null) => ({
      sku,
      product: sku === 'A-1' ? 'Oil' : 'Filter',
      mrpPaise: 30_000,
      status,
      requestedPaise,
      reasonCode,
    });
    const rows = priceRows(
      [offer],
      // Newest first: the pending request wins over the older rejected one.
      [
        req('A-1', 'pending', 42_000),
        req('A-1', 'rejected', 39_000, 'above_market'),
        req('B-2', 'rejected', 25_000, null),
      ],
    );
    expect(rows).toEqual([
      {
        sku: 'A-1',
        product: 'Oil',
        mrpPaise: 50_000,
        livePaise: 44_000,
        onHand: 7,
        pendingPaise: 42_000,
        rejectedReason: null,
      },
      {
        sku: 'B-2',
        product: 'Filter',
        mrpPaise: 30_000,
        livePaise: null,
        onHand: 0,
        pendingPaise: null,
        rejectedReason: 'other',
      },
    ]);
    // Approved/withdrawn requests for unlisted products add no row.
    expect(priceRows([], [req('C-3', 'withdrawn', 1)])).toEqual([]);
  });
});
