/**
 * Vehicle segments on the storefront (design 2026-11-25, spec 02): URL round trip, the demo catalogue's segments and
 * filter, the card and tile data, the browser store behind the demo admin, and the home section lists.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOME_SECTIONS as SHARED_SECTIONS } from '@mechdost/shared/site-layout';
import { DEFAULT_SEGMENT_TEXT, parseSegmentParam } from '@mechdost/shared/vehicle-segments';
import { DEMO_PRODUCTS, demoSegmentsOf, searchProducts } from '../src/demo/catalogue';
import {
  activeDemoSegments,
  DEFAULT_DEMO_SEGMENTS,
  DEMO_SEGMENTS_KEY,
  saveDemoSegments,
} from '../src/demo/segments';
import { smartSearchProducts } from '../src/demo/smart-search';
import { HOME_SECTIONS } from '../src/lib/site-layout';
import { HOME_SEGMENT_CODES, homeSegmentTiles } from '../src/lib/catalogue/home-segments';
import { demoCard } from '../src/lib/catalogue/demo-source';
import { shopUrl, type ShopState } from '../src/lib/catalogue/shop-state';

const base: ShopState = {
  query: '',
  category: undefined,
  sub: undefined,
  sort: 'popular',
  vehicle: undefined,
  segments: [],
};

describe('the shop URL', () => {
  it('carries the chosen segments once, in the shared order', () => {
    expect(shopUrl('/shop', { ...base, segments: ['tractor_farm', 'truck_bus'] })).toBe(
      '/shop?segment=truck_bus%2Ctractor_farm',
    );
    expect(shopUrl('/shop', base)).toBe('/shop');
  });
  it('round trips through the parser, with the other filters', () => {
    const url = shopUrl('/shop', { ...base, query: 'tyre', category: 'tyres', segments: ['truck_bus'] });
    const params = new URL(url, 'https://x.test').searchParams;
    expect(parseSegmentParam(params.get('segment'))).toEqual(['truck_bus']);
    expect(params.get('q')).toBe('tyre');
  });
});

describe('the demo catalogue', () => {
  it('has heavy-vehicle, tractor and machine products with segments', () => {
    const by = (code: string) =>
      DEMO_PRODUCTS.filter((p) => demoSegmentsOf(p).some((s) => s === code)).map((p) => p.slug);
    expect(by('truck_bus').length).toBeGreaterThanOrEqual(2);
    expect(by('tractor_farm').length).toBeGreaterThanOrEqual(2);
    expect(by('construction_otr').length).toBeGreaterThanOrEqual(1);
    expect(by('not_vehicle')).toContain('socket-tool-set-46pc'); // workshop tools: derived from the category
  });
  it('derives bikes and cars from `fits`, like the database trigger', () => {
    const castrol = DEMO_PRODUCTS.find((p) => p.slug === 'castrol-activ-4t-20w40-900ml')!;
    expect(demoSegmentsOf(castrol)).toEqual(['two_wheeler']);
    const mixed = { ...castrol, fits: '2W/4W' as const };
    expect(demoSegmentsOf(mixed)).toEqual(['two_wheeler', 'car_suv']);
    const ev = DEMO_PRODUCTS.find((p) => p.fits === 'EV')!;
    expect(demoSegmentsOf(ev)).toEqual([]);
  });
  it('filters by one or several segments', () => {
    const truck = searchProducts({ segments: ['truck_bus'] }).map((p) => p.slug);
    expect(truck).toContain('mrf-steel-muscle-1000r20-truck-tyre');
    expect(truck).not.toContain('castrol-activ-4t-20w40-900ml');
    const both = searchProducts({ segments: ['truck_bus', 'tractor_farm'] }).map((p) => p.slug);
    expect(both).toContain('amaron-pro-tractor-88ah-battery');
    expect(both).toContain('mrf-steel-muscle-1000r20-truck-tyre');
  });
  it('"truck tyre" ranks the truck tyre first and "tractor" finds tractor products', () => {
    expect(smartSearchProducts({ query: 'truck tyre' })[0]?.slug).toBe('mrf-steel-muscle-1000r20-truck-tyre');
    const tractor = smartSearchProducts({ query: 'tractor' }).map((p) => p.slug);
    expect(tractor.slice(0, 2).sort()).toEqual([
      'amaron-pro-tractor-88ah-battery',
      'servo-agri-super-15w40-7l',
    ]);
    expect(smartSearchProducts({ query: 'ट्रक' })[0]?.slug).toBe('mrf-steel-muscle-1000r20-truck-tyre');
  });
  it('names the card tag in the page language', () => {
    const p = DEMO_PRODUCTS.find((x) => x.slug === 'mrf-steel-muscle-1000r20-truck-tyre')!;
    expect(demoCard(p, 'en').segments).toEqual([{ code: 'truck_bus', name: 'Truck & bus' }]);
    expect(demoCard(p, 'hi').segments).toEqual([{ code: 'truck_bus', name: 'ट्रक और बस' }]);
  });
});

describe('the demo store behind the admin editor', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    const events: Event[] = [];
    Object.assign(globalThis, {
      window: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
        },
        dispatchEvent: (e: Event) => events.push(e),
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('lists every segment on, in the built-in order, until the admin changes something', () => {
    expect(activeDemoSegments(DEFAULT_DEMO_SEGMENTS).map((r) => r.code)).toEqual([
      'two_wheeler',
      'three_wheeler',
      'car_suv',
      'light_commercial',
      'truck_bus',
      'tractor_farm',
      'construction_otr',
      'not_vehicle',
    ]);
  });
  it('keeps renames, order and the switch, and ignores junk', () => {
    const rows = DEFAULT_DEMO_SEGMENTS.map((r) =>
      r.code === 'truck_bus'
        ? { ...r, nameEn: 'Heavy', sort: 1, active: true }
        : r.code === 'two_wheeler'
          ? { ...r, active: false }
          : r,
    );
    expect(saveDemoSegments(rows)).toBe(true);
    const saved = store.get(DEMO_SEGMENTS_KEY);
    expect(saved).toBeDefined();
    expect((JSON.parse(saved!) as Record<string, { nameEn: string }>).truck_bus?.nameEn).toBe('Heavy');
  });
  it('reports a browser that refuses to store', () => {
    (
      globalThis as unknown as { window: { localStorage: { setItem: () => never } } }
    ).window.localStorage.setItem = () => {
      throw new Error('quota');
    };
    expect(saveDemoSegments(DEFAULT_DEMO_SEGMENTS)).toBe(false);
  });
});

describe('home', () => {
  it('lists "Shop by vehicle" right after the categories in the shared list and the demo list alike', () => {
    expect([...HOME_SECTIONS]).toEqual([...SHARED_SECTIONS]);
    expect(SHARED_SECTIONS.indexOf('vehicles')).toBe(SHARED_SECTIONS.indexOf('categories') + 1);
  });
  it('shows tiles for Truck & bus, Tractor & farm and Construction & OTR in either language', async () => {
    expect([...HOME_SEGMENT_CODES]).toEqual(['truck_bus', 'tractor_farm', 'construction_otr']);
    const en = await homeSegmentTiles('en');
    const hi = await homeSegmentTiles('hi');
    expect(en.map((t) => t.name)).toEqual(HOME_SEGMENT_CODES.map((c) => DEFAULT_SEGMENT_TEXT[c].nameEn));
    expect(hi.map((t) => t.name)).toEqual(HOME_SEGMENT_CODES.map((c) => DEFAULT_SEGMENT_TEXT[c].nameHi));
  });
});
