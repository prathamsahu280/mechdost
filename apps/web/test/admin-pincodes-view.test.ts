import { describe, expect, it } from 'vitest';
import {
  filterPincodes,
  parseCoordinate,
  parseFreeDelivery,
  pincodeEditBody,
  pincodeAddBody,
  type PincodeForm,
} from '../src/lib/admin-pincodes-view';

const row = {
  pincode: '492001',
  areaEn: 'Raipur GPO',
  areaHi: 'रायपुर जीपीओ',
  lat: 21.2292,
  lng: 81.6338,
  active: true,
  inactiveReason: null,
  inactiveNote: null,
  source: 'seed' as const,
  freeDeliveryMinPaise: null,
  shopsCovering: 2,
  version: 3,
  updatedAt: '2026-11-14T10:00:00.000Z',
};
const form = (over: Partial<PincodeForm> = {}): PincodeForm => ({
  pincode: '492001',
  lat: '21.2292',
  lng: '81.6338',
  areaEn: 'Raipur GPO',
  areaHi: 'रायपुर जीपीओ',
  freeDelivery: '',
  ...over,
});

describe('PIN code form helpers (Admin → Settings → Service area)', () => {
  it('reads the free-delivery amount: blank = no override, ₹0 = always free, rupees → paise', () => {
    expect(parseFreeDelivery('')).toEqual({ ok: true, paise: null });
    expect(parseFreeDelivery('0')).toEqual({ ok: true, paise: 0 });
    expect(parseFreeDelivery('₹1,499.50')).toEqual({ ok: true, paise: 149950 });
    expect(parseFreeDelivery('abc')).toEqual({ ok: false });
    expect(parseFreeDelivery('200000')).toEqual({ ok: false }); // above ₹1,00,000
  });

  it('reads coordinates (Devanagari digits too) and refuses ones outside India', () => {
    expect(parseCoordinate('21.2292', 'lat')).toBe(21.2292);
    expect(parseCoordinate('२१.२५', 'lat')).toBe(21.25);
    expect(parseCoordinate('81.6', 'lat')).toBeNull();
    expect(parseCoordinate('', 'lng')).toBeNull();
    expect(parseCoordinate('1e2', 'lng')).toBeNull();
  });

  it('builds the add body, or names the first bad field', () => {
    expect(pincodeAddBody('RPR', form({ pincode: '492004', freeDelivery: '500' }))).toEqual({
      ok: true,
      body: {
        city: 'RPR',
        pincode: '492004',
        lat: 21.2292,
        lng: 81.6338,
        areaEn: 'Raipur GPO',
        areaHi: 'रायपुर जीपीओ',
        freeDeliveryMinPaise: 50000,
      },
    });
    expect(pincodeAddBody('RPR', form({ pincode: '49200' }))).toEqual({ ok: false, field: 'pincode' });
    expect(pincodeAddBody('RPR', form({ lng: '200' }))).toEqual({ ok: false, field: 'lng' });
    expect(pincodeAddBody('RPR', form({ areaHi: 'Raipur' }))).toEqual({ ok: false, field: 'areaHi' });
    expect(pincodeAddBody('RPR', form({ areaEn: ' ' }))).toEqual({ ok: false, field: 'areaEn' });
  });

  it('the edit body carries only what changed (L103), and nothing when nothing changed', () => {
    expect(pincodeEditBody('RPR', row, form())).toEqual({ ok: true, body: null });
    expect(pincodeEditBody('RPR', row, form({ freeDelivery: '0' }))).toEqual({
      ok: true,
      body: { city: 'RPR', version: 3, freeDeliveryMinPaise: 0 },
    });
    expect(pincodeEditBody('RPR', row, form({ areaHi: 'रायपुर मुख्य डाकघर', lat: '21.23' }))).toEqual({
      ok: true,
      body: {
        city: 'RPR',
        version: 3,
        centroid: { lat: 21.23, lng: 81.6338 },
        area: { en: 'Raipur GPO', hi: 'रायपुर मुख्य डाकघर' },
      },
    });
    expect(
      pincodeEditBody('RPR', { ...row, freeDeliveryMinPaise: 30000 }, form({ freeDelivery: '' })),
    ).toEqual({ ok: true, body: { city: 'RPR', version: 3, freeDeliveryMinPaise: null } });
  });

  it('filters by PIN or area name in either language', () => {
    const rows = [row, { ...row, pincode: '492004', areaEn: 'Pandri', areaHi: 'पंडरी' }];
    expect(filterPincodes(rows, '').length).toBe(2);
    expect(filterPincodes(rows, '4920').length).toBe(2);
    expect(filterPincodes(rows, 'pand').map((r) => r.pincode)).toEqual(['492004']);
    expect(filterPincodes(rows, 'पंडरी').map((r) => r.pincode)).toEqual(['492004']);
  });
});
