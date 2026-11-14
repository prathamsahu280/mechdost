import type { AdminShopDetailDto } from '@mechdost/shared/shop-api';
import { describe, expect, it } from 'vitest';
import {
  coverageBody,
  deadlineView,
  formFromShop,
  istDayTime,
  rowsFromCoverage,
  shopErrorKey,
  shopPatch,
  standingTargets,
} from '../src/lib/admin-shop-form';

const shop: AdminShopDetailDto = {
  id: '0190a8d2-0000-7000-8000-000000000001',
  cityId: 'c1',
  name: 'Sharma Auto Parts',
  nameHi: null,
  addressLine: 'Pandri, Raipur',
  addressLineHi: 'पंडरी, रायपुर',
  pincode: '492004',
  status: 'approved',
  gstStatus: 'registered',
  busy: false,
  busyUntil: null,
  coveragePincodes: 2,
  offersOnSale: 3,
  freeDeliveryMinPaise: null,
  hours: { open: '09:00', close: '21:00', days: [1, 2, 3, 4, 5, 6] },
  openNow: true,
  version: 4,
  missingHindi: ['name'],
  legalName: null,
  gstin: null,
  phone: '+919000000001',
  email: null,
  acceptanceTimeoutMin: null,
  statusReason: null,
  statusReasonCode: null,
  statusChangedAt: null,
  pausedUntil: null,
  coverage: [
    { pincode: '492001', shippingPaise: 4000, leadDays: 2, active: true },
    { pincode: '492004', shippingPaise: 0, leadDays: 1, active: true },
  ],
  history: [],
  members: [],
};

describe('shop profile form', () => {
  it('sends only what changed, with the version (L103); nothing changed → no request', () => {
    const f = formFromShop(shop);
    expect(f).toMatchObject({ phone: '9000000001', freeDelivery: '', timeout: '', open: '09:00' });
    expect(shopPatch(shop, f)).toEqual({ ok: true, body: null });
    const r = shopPatch(shop, { ...f, nameHi: 'शर्मा ऑटो पार्ट्स', freeDelivery: '499.50', timeout: '20' });
    expect(r).toEqual({
      ok: true,
      body: {
        version: 4,
        nameHi: 'शर्मा ऑटो पार्ट्स',
        freeDeliveryMinPaise: 49950,
        acceptanceTimeoutMin: 20,
      },
    });
  });

  it('0 means always free; emptying a set value goes back to the city setting (null)', () => {
    const withFree = { ...shop, freeDeliveryMinPaise: 50000, acceptanceTimeoutMin: 30 };
    const f = formFromShop(withFree);
    expect(f.freeDelivery).toBe('500');
    expect(shopPatch(withFree, { ...f, freeDelivery: '0' })).toEqual({
      ok: true,
      body: { version: 4, freeDeliveryMinPaise: 0 },
    });
    expect(shopPatch(withFree, { ...f, freeDelivery: '', timeout: '' })).toEqual({
      ok: true,
      body: { version: 4, freeDeliveryMinPaise: null, acceptanceTimeoutMin: null },
    });
  });

  it('flags every bad field at once', () => {
    const f = formFromShop(shop);
    const r = shopPatch(shop, {
      ...f,
      name: 'x',
      phone: '12345',
      gstin: '22AAAAA0000A1Z9',
      timeout: '500',
      freeDelivery: 'abc',
      close: '08:00',
      days: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual(
        ['close', 'days', 'freeDelivery', 'gstin', 'name', 'phone', 'timeout'].sort(),
      );
  });

  it('hours: a changed window or weekday is sent as one hours object; 24:00 allowed', () => {
    const f = formFromShop(shop);
    expect(shopPatch(shop, { ...f, close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] })).toEqual({
      ok: true,
      body: { version: 4, hours: { open: '09:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] } },
    });
  });
});

describe('coverage editor', () => {
  it('sends changed and new PIN codes as upserts and removed ones as removals', () => {
    const rows = rowsFromCoverage(shop.coverage);
    expect(rows[0]).toMatchObject({
      pincode: '492001',
      charge: '40',
      days: '2',
      active: true,
      remove: false,
    });
    const edited = [
      { ...rows[0]!, charge: '25' },
      { ...rows[1]!, remove: true },
      { pincode: '492099', charge: '0', days: '3', active: true, remove: false, isNew: true },
    ];
    expect(coverageBody(shop, edited)).toEqual({
      ok: true,
      body: {
        version: 4,
        upsert: [
          { pincode: '492001', shippingPaise: 2500, leadDays: 2, active: true },
          { pincode: '492099', shippingPaise: 0, leadDays: 3, active: true },
        ],
        remove: ['492004'],
      },
    });
    expect(coverageBody(shop, rows)).toEqual({ ok: true, body: null });
  });

  it('refuses a bad PIN, charge or days, and a PIN listed twice', () => {
    const rows = rowsFromCoverage(shop.coverage);
    const r = coverageBody(shop, [
      ...rows,
      { pincode: '49200', charge: '10', days: '1', active: true, remove: false, isNew: true },
      { pincode: '492001', charge: '10', days: '1', active: true, remove: false, isNew: true },
      { pincode: '492007', charge: '-1', days: '99', active: true, remove: false, isNew: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ 2: 'pincode', 3: 'duplicate', 4: 'charge' });
  });
});

describe('standing, deadlines and errors', () => {
  it('offers only the moves the API allows; a pending shop can only be kept dark', () => {
    expect(standingTargets('approved')).toEqual(['paused', 'suspended']);
    expect(standingTargets('paused')).toEqual(['approved', 'suspended']);
    expect(standingTargets('suspended')).toEqual(['approved']);
    // A pending shop can only be kept dark (code review 2026-11-14); it goes live by itself otherwise.
    expect(standingTargets('pending')).toEqual(['suspended']);
  });

  it('a deadline within two hours counts down; a closed shop shows the time it waits until', () => {
    const now = Date.parse('2026-11-16T10:00:00+05:30');
    expect(deadlineView('2026-11-16T10:15:00+05:30', now)).toEqual({ kind: 'minutes', minutes: 15 });
    expect(deadlineView('2026-11-17T10:00:00+05:30', now)).toEqual({
      kind: 'until',
      at: '2026-11-17T10:00:00+05:30',
    });
    expect(deadlineView(null, now)).toEqual({ kind: 'minutes', minutes: 0 });
  });

  it('Hindi times use the 24-hour clock (no Latin am/pm on /hi)', () => {
    const hi = istDayTime('2026-11-17T21:30:00+05:30', 'hi');
    expect(hi).toContain('21:30');
    expect(hi).not.toMatch(/[ap]m/i);
  });

  it('maps API codes to messages, falling back to the common ones', () => {
    expect(shopErrorKey('GSTIN_TAKEN')).toBe('shops_api_err_GSTIN_TAKEN');
    expect(shopErrorKey('ALREADY_OWNER')).toBe('shops_api_err_ALREADY_OWNER');
    expect(shopErrorKey('PINCODE_OTHER_CITY')).toBe('shops_api_err_PINCODE_OTHER_CITY');
    expect(shopErrorKey('STALE_SHOP')).toBe('shops_api_err_STALE_SHOP');
    expect(shopErrorKey('HTTP_429')).toBe('api_common_err_rate');
    expect(shopErrorKey('SOMETHING_NEW')).toBe('api_common_err_generic');
  });
});
