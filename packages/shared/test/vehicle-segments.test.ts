import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '../src/analytics';
import { CataloguePageSchema } from '../src/catalogue';
import {
  cardSegment,
  DEFAULT_SEGMENT_SORT,
  DEFAULT_SEGMENT_TEXT,
  DEFAULT_SEGMENTS_OF_CATEGORY,
  defaultSegmentsFor,
  formatSegmentParam,
  isVehicleSegment,
  parseSegmentParam,
  VEHICLE_SEGMENTS,
} from '../src/vehicle-segments';
import { AdminSegmentPatchSchema, SegmentListParam } from '../src/vehicle-segments-api';
import { DEFAULT_SEARCH_VOCAB } from '../src/search/vocab';

describe('vehicle segments (design 2026-11-25)', () => {
  it('has the eight stable codes', () => {
    expect([...VEHICLE_SEGMENTS]).toEqual([
      'two_wheeler',
      'three_wheeler',
      'car_suv',
      'light_commercial',
      'truck_bus',
      'tractor_farm',
      'construction_otr',
      'not_vehicle',
    ]);
    expect(isVehicleSegment('truck_bus')).toBe(true);
    expect(isVehicleSegment('truck')).toBe(false);
    expect(isVehicleSegment(7)).toBe(false);
  });

  it('gives every segment an English and a Hindi name and description, and a unique sort', () => {
    for (const code of VEHICLE_SEGMENTS) {
      const t = DEFAULT_SEGMENT_TEXT[code];
      expect(t.nameEn.length).toBeGreaterThan(0);
      expect(t.nameEn.length).toBeLessThanOrEqual(60);
      expect(/\p{Script=Devanagari}/u.test(t.nameHi)).toBe(true);
      expect(/\p{Script=Devanagari}/u.test(t.descriptionHi)).toBe(true);
    }
    const sorts = VEHICLE_SEGMENTS.map((c) => DEFAULT_SEGMENT_SORT[c]);
    expect(new Set(sorts).size).toBe(8);
    expect([...sorts].sort((a, b) => a - b)).toEqual(sorts);
  });

  it('maps only to known segments', () => {
    for (const list of Object.values(DEFAULT_SEGMENTS_OF_CATEGORY))
      for (const c of list) expect(isVehicleSegment(c)).toBe(true);
  });

  describe('defaults', () => {
    it('the category wins over the vehicle types', () => {
      expect(defaultSegmentsFor({ categorySlug: 'truck-bus-tyres', vehicleTypes: ['4W'] })).toEqual([
        'truck_bus',
      ]);
      expect(defaultSegmentsFor({ categorySlug: 'e-rickshaw-batteries', vehicleTypes: [] })).toEqual([
        'three_wheeler',
      ]);
      expect(defaultSegmentsFor({ categorySlug: 'home-power', vehicleTypes: ['4W'] })).toEqual([
        'not_vehicle',
      ]);
    });
    it('a general category takes its vehicle types, else nothing', () => {
      expect(defaultSegmentsFor({ categorySlug: 'greases', vehicleTypes: ['3W', '2W'] })).toEqual([
        'three_wheeler',
        'two_wheeler',
      ]);
      expect(defaultSegmentsFor({ categorySlug: 'greases', vehicleTypes: [] })).toEqual([]);
    });
    it('a heavy-duty or diesel oil that says tractor is also Tractor & farm', () => {
      expect(
        defaultSegmentsFor({ categorySlug: 'heavy-duty-oils', vehicleTypes: [], text: 'Servo Tractor oil' }),
      ).toEqual(['truck_bus', 'light_commercial', 'tractor_farm']);
      expect(
        defaultSegmentsFor({ categorySlug: 'heavy-duty-oils', vehicleTypes: [], text: 'Servo Pride 15W-40' }),
      ).toEqual(['truck_bus', 'light_commercial']);
      expect(defaultSegmentsFor({ categorySlug: 'greases', vehicleTypes: [], text: 'tractor' })).toEqual([]);
    });
  });

  describe('the URL parameter', () => {
    it('keeps valid codes once, in the shared order', () => {
      expect(parseSegmentParam('tractor_farm,truck_bus,truck_bus')).toEqual(['truck_bus', 'tractor_farm']);
      expect(parseSegmentParam(['car_suv,nope', 'two_wheeler'])).toEqual(['two_wheeler', 'car_suv']);
      expect(parseSegmentParam(undefined)).toEqual([]);
      expect(parseSegmentParam('')).toEqual([]);
    });
    it('formats one selection as one URL value', () => {
      expect(formatSegmentParam(['tractor_farm', 'truck_bus'])).toBe('truck_bus,tractor_farm');
      expect(formatSegmentParam([])).toBe('');
    });
    it('the API parameter accepts the same list and refuses unknown codes', () => {
      expect(SegmentListParam.parse('truck_bus,two_wheeler')).toEqual(['truck_bus', 'two_wheeler']);
      expect(SegmentListParam.parse('')).toEqual([]);
      expect(() => SegmentListParam.parse('truck_bus,nope')).toThrow();
    });
  });

  it('a card tags the filtered segment first, else its first', () => {
    const own = [
      { code: 'light_commercial', name: 'Light commercial' },
      { code: 'truck_bus', name: 'Truck & bus' },
    ];
    expect(cardSegment(own, [])?.code).toBe('light_commercial');
    expect(cardSegment(own, ['truck_bus'])?.code).toBe('truck_bus');
    expect(cardSegment(own, ['two_wheeler'])?.code).toBe('light_commercial');
    expect(cardSegment([], ['truck_bus'])).toBeNull();
  });

  it('the listing DTO defaults to no segments and no facets (older responses still parse)', () => {
    const page = CataloguePageSchema.parse({
      place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
      items: [],
      nextCursor: null,
    });
    expect(page.facets).toEqual({ segments: [] });
  });

  it('the admin patch is strict and bounded', () => {
    expect(
      AdminSegmentPatchSchema.safeParse({ version: 1, nameEn: 'Heavy', sort: 5, active: false }).success,
    ).toBe(true);
    expect(AdminSegmentPatchSchema.safeParse({ version: 1, code: 'x' }).success).toBe(false);
    expect(AdminSegmentPatchSchema.safeParse({ version: 1, nameEn: '' }).success).toBe(false);
    expect(AdminSegmentPatchSchema.safeParse({ nameEn: 'x' }).success).toBe(false);
  });

  it('registers the two events with codes and counts only', () => {
    const filtered = CLIENT_EVENT_SCHEMAS.shop_segment_filtered;
    expect(filtered.safeParse({ segments: ['truck_bus'], count: 1 }).success).toBe(true);
    expect(filtered.safeParse({ segments: ['truck'], count: 1 }).success).toBe(false);
    expect(filtered.safeParse({ segments: [], count: 0, query: 'x' }).success).toBe(false);
    const tile = CLIENT_EVENT_SCHEMAS.home_segment_tile_clicked;
    expect(tile.safeParse({ segment: 'tractor_farm' }).success).toBe(true);
    expect(tile.safeParse({ segment: 'bike' }).success).toBe(false);
  });

  it('every segment has search words in English and Hindi', () => {
    const words = DEFAULT_SEARCH_VOCAB.filter((v) => v.kind === 'segment');
    for (const code of VEHICLE_SEGMENTS.filter(
      (c) => !['two_wheeler', 'three_wheeler', 'car_suv'].includes(c),
    )) {
      const mine = words.filter((w) => w.expandsTo[0] === code);
      expect(
        mine.some((w) => w.locale === 'en'),
        code,
      ).toBe(true);
      expect(
        mine.some((w) => w.locale === 'hi'),
        code,
      ).toBe(true);
    }
    for (const w of words) expect(w.term).toBe(w.term.toLowerCase());
  });
});
