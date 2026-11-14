import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { MOVE_REASONS, MOVE_TRANSPORTS, VISIT_FEE_WAIVE_REASONS } from '@mechdost/shared/state';
import { describe, expect, it } from 'vitest';
import {
  HOME_ERROR_CODES,
  homeErrorKey,
  homeJobNextAction,
  mayOfferMove,
  mayWaiveFee,
  parseHomeSettingsInput,
  pendingMove,
  pinnedAddresses,
  spacedCode,
  validMechanicName,
  visitFeeDue,
  visitFeeGstPaise,
} from '../src/lib/home-service-views';

const home = (over: Partial<NonNullable<Parameters<typeof visitFeeDue>[0]['home']>> = {}) => ({
  visitFeePaise: 9_900,
  gstRegistered: true,
  feeWaivedReason: null,
  mechanicName: 'Sunil',
  address: null,
  arrivalCode: null,
  arrivalLocked: false,
  arrivedVia: null,
  move: null,
  ...over,
});

describe('home servicing view helpers', () => {
  it('maps each home error code to its own message key and leaves other codes to the request messages', () => {
    expect(homeErrorKey('FEE_CHANGED')).toBe('err_FEE_CHANGED');
    expect(homeErrorKey('STALE_REQUEST')).toBeNull();
    expect(homeErrorKey('')).toBeNull();
  });

  it('has an English and a Hindi message for every home code, move reason, transport and waive reason', () => {
    for (const lang of [en, hi]) {
      const h = lang.homeService as Record<string, string>;
      for (const code of HOME_ERROR_CODES) expect(h[`err_${code}`], code).toBeTruthy();
      for (const r of MOVE_REASONS) expect(h[`moveReason_${r}`], r).toBeTruthy();
      for (const r of MOVE_TRANSPORTS) expect(h[`moveTransport_${r}`], r).toBeTruthy();
      for (const r of VISIT_FEE_WAIVE_REASONS) expect(h[`feeWaivedReason_${r}`], r).toBeTruthy();
    }
    expect(Object.keys(en.homeService).sort()).toEqual(Object.keys(hi.homeService).sort());
  });

  it('shows GST next to the fee only for a registered workshop', () => {
    expect(visitFeeGstPaise(9_900, true)).toBe(1_782);
    expect(visitFeeGstPaise(9_900, false)).toBe(0);
    expect(visitFeeGstPaise(0, true)).toBe(0);
  });

  it('offers only addresses that have a map pin', () => {
    const a = (lat: number | null, lng: number | null) => ({ id: String(lat), lat, lng }) as never;
    expect(pinnedAddresses([a(21.2, 81.6), a(null, null), a(21.3, null)])).toHaveLength(1);
  });

  it('reads the arrival code aloud with spaces', () => {
    expect(spacedCode('4821')).toBe('4 8 2 1');
  });

  it('knows when the visit fee is still due, and the next step after a declined move', () => {
    expect(visitFeeDue({ home: home() })).toBe(true);
    expect(visitFeeDue({ home: home({ feeWaivedReason: 'goodwill' }) })).toBe(false);
    expect(visitFeeDue({ home: home({ visitFeePaise: 0 }) })).toBe(false);
    expect(visitFeeDue({ home: null })).toBe(false);
    expect(homeJobNextAction({ status: 'no_work_approved', home: home() })).toBe('bill');
    expect(homeJobNextAction({ status: 'no_work_approved', home: home({ feeWaivedReason: 'other' }) })).toBe(
      'return',
    );
    expect(homeJobNextAction({ status: 'confirmed', home: home() })).toBe('receive');
  });

  it('allows an offer to move only at home, after arrival, with none waiting; waiving only before the bill', () => {
    const proposed = {
      id: 'm',
      reasonCode: 'needs_lift',
      transport: 'customer_drops',
      status: 'proposed',
    } as const;
    expect(mayOfferMove({ status: 'vehicle_received', serviceMode: 'home', home: home() })).toBe(true);
    expect(mayOfferMove({ status: 'vehicle_received', serviceMode: 'workshop', home: home() })).toBe(false);
    expect(mayOfferMove({ status: 'confirmed', serviceMode: 'home', home: home() })).toBe(false);
    expect(
      mayOfferMove({ status: 'vehicle_received', serviceMode: 'home', home: home({ move: proposed }) }),
    ).toBe(false);
    expect(pendingMove(home({ move: proposed }))).toEqual(proposed);
    expect(pendingMove(home({ move: { ...proposed, status: 'accepted' } }))).toBeNull();
    expect(mayWaiveFee({ status: 'ready', home: home() })).toBe(true);
    expect(mayWaiveFee({ status: 'billed', home: home() })).toBe(false);
    expect(mayWaiveFee({ status: 'ready', home: home({ feeWaivedReason: 'other' }) })).toBe(false);
  });

  it('accepts a mechanic first name of 2 to 30 letters, including Devanagari, and nothing odd', () => {
    expect(validMechanicName('Sunil')).toBe(true);
    expect(validMechanicName('सुनील')).toBe(true);
    expect(validMechanicName("D'Souza")).toBe(true);
    expect(validMechanicName('S')).toBe(false);
    expect(validMechanicName('x'.repeat(31))).toBe(false);
    expect(validMechanicName('Sunil 9')).toBe(false);
    expect(validMechanicName('<b>')).toBe(false);
  });

  it('checks the radius (1 to 25 km) and the fee (rupees, up to the city maximum)', () => {
    expect(parseHomeSettingsInput({ radiusKm: '5', feeRupees: '99' }, 50_000)).toEqual({
      ok: true,
      radiusKm: 5,
      feePaise: 9_900,
    });
    expect(parseHomeSettingsInput({ radiusKm: '12', feeRupees: '149.50' }, 50_000)).toMatchObject({
      feePaise: 14_950,
    });
    expect(parseHomeSettingsInput({ radiusKm: '0', feeRupees: '99' }, 50_000)).toEqual({
      ok: false,
      field: 'radius',
    });
    expect(parseHomeSettingsInput({ radiusKm: '26', feeRupees: '99' }, 50_000)).toEqual({
      ok: false,
      field: 'radius',
    });
    expect(parseHomeSettingsInput({ radiusKm: '5', feeRupees: '501' }, 50_000)).toEqual({
      ok: false,
      field: 'fee',
    });
    expect(parseHomeSettingsInput({ radiusKm: '5', feeRupees: '99' }, 5_000)).toEqual({
      ok: false,
      field: 'fee',
    });
    expect(parseHomeSettingsInput({ radiusKm: '5', feeRupees: 'free' }, 50_000)).toEqual({
      ok: false,
      field: 'fee',
    });
    expect(parseHomeSettingsInput({ radiusKm: '5', feeRupees: '0' }, 50_000)).toMatchObject({
      ok: true,
      feePaise: 0,
    });
  });
});
