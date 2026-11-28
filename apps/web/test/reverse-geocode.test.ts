/**
 * "Use my location" never guesses a PIN inside a served area (spec 06, Sarona 2026-11-28: real PIN 492099, nearest
 * centroid 492013, OpenStreetMap 493332). Outside served areas the provider answer is the fallback.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolvePincode, type NearestPins, type ReverseGeocoder } from '../src/lib/geo/reverse-geocode';

const SARONA = { lat: 21.216, lng: 81.597 };
const nearestSarona: NearestPins = {
  served: true,
  nearest: [
    { pincode: '492013', area: 'Sunder Nagar', distanceM: 1800 },
    { pincode: '492010', area: 'Tatibandh', distanceM: 3400 },
    { pincode: '492001', area: 'Raipur GPO', distanceM: 4800 },
    { pincode: '492099', area: 'Tatibandh Post Office', distanceM: 5300 },
    { pincode: '492017', area: 'Railway Station', distanceM: 5600 },
    { pincode: '492009', area: 'Shankar Nagar', distanceM: 6200 },
  ],
};
const osm = (pincode: string | null, authoritative = false): ReverseGeocoder => ({
  id: 'osm',
  authoritative,
  reverse: () => Promise.resolve({ pincode, area: 'Somewhere' }),
});

describe('resolvePincode', () => {
  it('inside a served area it fills nothing and offers the five nearest MechDost PINs (Sarona)', async () => {
    const reverse = vi.fn(() => Promise.resolve({ pincode: '493332', area: 'Somewhere' }));
    const geocoder: ReverseGeocoder = { id: 'osm', authoritative: false, reverse };
    const a = await resolvePincode(SARONA, { nearest: () => Promise.resolve(nearestSarona), geocoder });
    expect(a.pincode).toBeNull();
    expect(a.pincode).not.toBe('493332');
    expect(a.candidates.map((c) => c.pincode)).toEqual(['492013', '492010', '492001', '492099', '492017']);
    expect(a.candidates.map((c) => c.pincode)).toContain('492099');
    expect(reverse).not.toHaveBeenCalled(); // no upstream call, nothing to learn from OSM here
  });

  it('an authoritative provider naming an active MechDost PIN fills it (still editable)', async () => {
    const a = await resolvePincode(SARONA, {
      nearest: () => Promise.resolve(nearestSarona),
      geocoder: osm('492099', true),
    });
    expect(a).toEqual({ pincode: '492099', area: 'Tatibandh Post Office', candidates: [] });
  });

  it('an authoritative provider naming a PIN we do not serve falls back to the shortlist', async () => {
    const a = await resolvePincode(SARONA, {
      nearest: () => Promise.resolve(nearestSarona),
      geocoder: osm('493332', true),
    });
    expect(a.pincode).toBeNull();
    expect(a.candidates).toHaveLength(5);
  });

  it('outside every served area the provider answer is the fallback', async () => {
    const a = await resolvePincode(
      { lat: 19.076, lng: 72.877 },
      { nearest: () => Promise.resolve({ served: false, nearest: [] }), geocoder: osm('400001') },
    );
    expect(a).toEqual({ pincode: '400001', area: 'Somewhere', candidates: [] });
  });

  it('when the PIN list is unavailable the error is not hidden behind a guess', async () => {
    await expect(
      resolvePincode(SARONA, {
        nearest: () => Promise.reject(new Error('api down')),
        geocoder: osm('493332'),
      }),
    ).rejects.toThrow('api down');
  });
});
