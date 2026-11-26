/**
 * Founder ruling 2026-11-26 ("yes we can replace the old vehicle type drop down", Q-segments): the shop's 2W/3W/4W
 * "Vehicle type" select is gone; the "Kind of vehicle" chips are the only vehicle filter. Old links with
 * `?vehicle=2W|3W|4W` keep working: the server sends them on to the matching segment (2W -> two_wheeler,
 * 3W -> three_wheeler, 4W -> car_suv), keeping every other filter.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyVehicleRedirect, shopUrl, type ShopState } from '../src/lib/catalogue/shop-state';

const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');

describe('old ?vehicle= links', () => {
  it('2W, 3W and 4W go to the matching segment', () => {
    expect(legacyVehicleRedirect('/shop', { vehicle: '2W' })).toBe('/shop?segment=two_wheeler');
    expect(legacyVehicleRedirect('/shop', { vehicle: '3W' })).toBe('/shop?segment=three_wheeler');
    expect(legacyVehicleRedirect('/hi/shop', { vehicle: '4W' })).toBe('/hi/shop?segment=car_suv');
  });
  it('keeps the search, category, sort, pages and chosen segments (merged, shared order)', () => {
    const url = legacyVehicleRedirect('/shop', {
      q: 'tyre',
      category: 'tyres',
      sort: 'price_asc',
      pages: '2',
      segment: 'truck_bus',
      vehicle: '2W',
    });
    const p = new URL(url ?? '', 'https://x.test').searchParams;
    expect(p.get('q')).toBe('tyre');
    expect(p.get('category')).toBe('tyres');
    expect(p.get('sort')).toBe('price_asc');
    expect(p.get('pages')).toBe('2');
    expect(p.get('segment')).toBe('two_wheeler,truck_bus');
    expect(p.has('vehicle')).toBe(false);
  });
  it('an unknown vehicle value is dropped; no vehicle parameter means no redirect', () => {
    expect(legacyVehicleRedirect('/shop', { vehicle: 'CV', q: 'oil' })).toBe('/shop?q=oil');
    expect(legacyVehicleRedirect('/shop', { q: 'oil' })).toBeNull();
    expect(legacyVehicleRedirect('/shop', {})).toBeNull();
  });
});

describe('the shop has no vehicle-type select any more', () => {
  it('the shop URL never writes ?vehicle=', () => {
    const s: ShopState = { query: '', category: undefined, sub: undefined, sort: 'popular', segments: [] };
    expect(shopUrl('/shop', s)).toBe('/shop');
    expect(Object.keys(s)).not.toContain('vehicle');
  });
  it('the shop browser renders no vehicle select', () => {
    expect(src('components/catalogue/shop-browser.tsx')).not.toMatch(/shop-vehicle|VEHICLE_TYPES/);
  });
});
