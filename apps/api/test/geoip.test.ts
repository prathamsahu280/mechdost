import { describe, expect, it } from 'vitest';
import type { CityResponse } from 'maxmind';
import { geoIpFromReader, openGeoIp, placeOf } from '../src/auth/geoip';
import { setLogSink } from '../src/logger';

const record = (over: Partial<CityResponse>): CityResponse => over as CityResponse;

describe('placeOf (DB-IP City Lite record → stored place)', () => {
  it('reads country, state and city in English', () => {
    expect(
      placeOf(
        record({
          country: { iso_code: 'IN' },
          subdivisions: [{ names: { en: 'Chhattisgarh' } }],
          city: { names: { en: 'Raipur' } },
        } as never),
      ),
    ).toEqual({ countryCode: 'IN', region: 'Chhattisgarh', city: 'Raipur' });
  });
  it('keeps a state without a city, and returns null for nothing usable', () => {
    expect(placeOf(record({ subdivisions: [{ names: { en: 'Odisha' } }] } as never))).toEqual({
      countryCode: null,
      region: 'Odisha',
      city: null,
    });
    expect(placeOf(null)).toBeNull();
    expect(placeOf(record({}))).toBeNull();
  });
  it('drops a malformed country code and control characters', () => {
    expect(
      placeOf(record({ country: { iso_code: 'india' }, city: { names: { en: 'Ra\u0000ipur ' } } } as never)),
    ).toEqual({ countryCode: null, region: null, city: 'Raipur' });
  });
});

describe('geoIpFromReader', () => {
  const reader = {
    get: (ip: string) => {
      if (ip === '1.2.3.4') return record({ city: { names: { en: 'Pune' } } } as never);
      throw new Error('bad');
    },
  };
  it('looks up IP addresses only, and never throws', () => {
    const g = geoIpFromReader(reader);
    expect(g.lookup('1.2.3.4')).toMatchObject({ city: 'Pune' });
    expect(g.lookup('unknown')).toBeNull();
    expect(g.lookup('5.6.7.8')).toBeNull(); // reader threw
  });
});

describe('openGeoIp', () => {
  it('is null without a path, and null (not a crash) for a missing or invalid file', async () => {
    setLogSink(() => undefined);
    expect(await openGeoIp(null)).toBeNull();
    expect(await openGeoIp('Z:/no/such/file.mmdb')).toBeNull();
  });
});
