import { describe, expect, it } from 'vitest';
import { DEVANAGARI_RE, inIndia, isPincode } from '../src/geo';
import { AdminPincodeList, PublicPincodeList } from '../src/geo-api';

describe('PIN code rules (spec 15 "PIN codes")', () => {
  it('accepts six digits not starting with 0', () => {
    expect(isPincode('492001')).toBe(true);
    expect(isPincode('092001')).toBe(false);
    expect(isPincode('49200')).toBe(false);
    expect(isPincode('4920011')).toBe(false);
  });

  it('knows India from swapped or foreign coordinates', () => {
    expect(inIndia(21.25, 81.63)).toBe(true);
    expect(inIndia(81.63, 21.25)).toBe(false);
    expect(inIndia(51.5, -0.12)).toBe(false);
    expect(inIndia(Number.NaN, 81)).toBe(false);
  });

  it('a Hindi area name must contain Devanagari', () => {
    expect(DEVANAGARI_RE.test('पंडरी')).toBe(true);
    expect(DEVANAGARI_RE.test('Pandri')).toBe(false);
  });
});

describe('PIN code response schemas', () => {
  const row = {
    pincode: '492001',
    areaEn: 'Raipur GPO',
    areaHi: 'रायपुर जीपीओ',
    lat: 21.23,
    lng: 81.63,
    active: false,
    inactiveReason: 'a_new_reason',
    inactiveNote: null,
    source: 'seed',
    freeDeliveryMinPaise: null,
    shopsCovering: 0,
    version: 2,
    updatedAt: '2026-11-14T10:00:00.000Z',
  };

  it('reads an unknown reason as "other" and refuses a missing field', () => {
    const parsed = AdminPincodeList.parse({
      city: { code: 'RPR', name: 'Raipur', nameHi: null },
      pincodes: [row],
    });
    expect(parsed.pincodes[0]?.inactiveReason).toBe('other');
    const { version: _v, ...noVersion } = row;
    expect(
      AdminPincodeList.safeParse({
        city: { code: 'RPR', name: 'Raipur', nameHi: null },
        pincodes: [noVersion],
      }).success,
    ).toBe(false);
  });

  it('the public list carries the area in one language', () => {
    expect(
      PublicPincodeList.parse({
        city: 'RPR',
        pincodes: [{ pincode: '492001', area: 'पंडरी', lat: 21.2, lng: 81.6 }],
      }),
    ).toBeTruthy();
  });
});
