/**
 * Vehicle segments (design 2026-11-25 "Shopping personalisation", phase 1): which kind of vehicle (or none) a product
 * is for. Wider than `VEHICLE_TYPES` (2W/3W/4W), which keeps serving "My vehicles", roadside and service requests.
 *
 * The codes are stable enums (hard rule 16); the names, Hindi names, descriptions, order and on/off state live in the
 * `vehicle_segments` table and are edited by staff (hard rule 8). The built-in names here are the seed of that table
 * (migration 0087) and the fallback of the demo catalogue and tests. No Zod here on purpose: browser islands import
 * this file and must stay inside the JS budget (spec 16); the DTOs are in `vehicle-segments-api.ts`.
 */
export const VEHICLE_SEGMENTS = [
  'two_wheeler',
  'three_wheeler',
  'car_suv',
  'light_commercial',
  'truck_bus',
  'tractor_farm',
  'construction_otr',
  'not_vehicle',
] as const;

export type VehicleSegment = (typeof VEHICLE_SEGMENTS)[number];

export function isVehicleSegment(value: unknown): value is VehicleSegment {
  return typeof value === 'string' && (VEHICLE_SEGMENTS as readonly string[]).includes(value);
}

/** Segments per request at most (the URL, the API and the chips agree). */
export const SEGMENT_FILTER_MAX = VEHICLE_SEGMENTS.length;

export interface SegmentText {
  nameEn: string;
  nameHi: string;
  descriptionEn: string;
  descriptionHi: string;
}

/** Seed names and descriptions (English + Hindi); staff edit them in the console. */
export const DEFAULT_SEGMENT_TEXT: Record<VehicleSegment, SegmentText> = {
  two_wheeler: {
    nameEn: 'Two-wheeler',
    nameHi: 'दोपहिया',
    descriptionEn: 'Bikes and scooters',
    descriptionHi: 'बाइक और स्कूटर',
  },
  three_wheeler: {
    nameEn: 'Three-wheeler',
    nameHi: 'तिपहिया',
    descriptionEn: 'Autos, e-rickshaws and loaders',
    descriptionHi: 'ऑटो, ई-रिक्शा और लोडर',
  },
  car_suv: {
    nameEn: 'Car & SUV',
    nameHi: 'कार और एसयूवी',
    descriptionEn: 'Hatchbacks, sedans and SUVs',
    descriptionHi: 'हैचबैक, सेडान और एसयूवी',
  },
  light_commercial: {
    nameEn: 'Light commercial',
    nameHi: 'हल्के व्यावसायिक वाहन',
    descriptionEn: 'Pickups, tempos and mini trucks',
    descriptionHi: 'पिकअप, टेम्पो और मिनी ट्रक',
  },
  truck_bus: {
    nameEn: 'Truck & bus',
    nameHi: 'ट्रक और बस',
    descriptionEn: 'Heavy trucks, tippers and buses',
    descriptionHi: 'भारी ट्रक, टिप्पर और बसें',
  },
  tractor_farm: {
    nameEn: 'Tractor & farm',
    nameHi: 'ट्रैक्टर और खेती',
    descriptionEn: 'Tractors and farm machines',
    descriptionHi: 'ट्रैक्टर और खेती की मशीनें',
  },
  construction_otr: {
    nameEn: 'Construction & OTR',
    nameHi: 'निर्माण और ओटीआर',
    descriptionEn: 'Earth movers, loaders and off-the-road machines',
    descriptionHi: 'अर्थमूवर, लोडर और ऑफ-रोड मशीनें',
  },
  not_vehicle: {
    nameEn: 'Not a vehicle',
    nameHi: 'वाहन के लिए नहीं',
    descriptionEn: 'Inverters, home power, gensets and tools',
    descriptionHi: 'इन्वर्टर, घरेलू बिजली, जेनसेट और औज़ार',
  },
};

/** Where a segment sits when staff have not reordered (the table's `sort` column starts from it). */
export const DEFAULT_SEGMENT_SORT: Record<VehicleSegment, number> = {
  two_wheeler: 10,
  three_wheeler: 20,
  car_suv: 30,
  light_commercial: 40,
  truck_bus: 50,
  tractor_farm: 60,
  construction_otr: 70,
  not_vehicle: 80,
};

/** The segment a 2W/3W/4W vehicle type belongs to (the backfill and the default for products tagged by type). */
export const SEGMENT_OF_VEHICLE_TYPE = {
  '2W': 'two_wheeler',
  '3W': 'three_wheeler',
  '4W': 'car_suv',
} as const satisfies Record<string, VehicleSegment>;

/**
 * Category slug -> segments (reviewed 2026-11-25 against the live catalogue; migration 0087 holds the same table in
 * `category_default_segments`). Categories not listed (greases, gear oils, coolants, filters, bearings, ...) are
 * general: their products take a segment from their vehicle types or stay without one until staff set it.
 */
export const DEFAULT_SEGMENTS_OF_CATEGORY: Readonly<Record<string, readonly VehicleSegment[]>> = {
  'two-wheeler-tyres': ['two_wheeler'],
  'two-wheeler-batteries': ['two_wheeler'],
  'motorcycle-oil': ['two_wheeler'],
  'three-wheeler-tyres': ['three_wheeler'],
  'three-wheeler-batteries': ['three_wheeler'],
  'e-rickshaw-batteries': ['three_wheeler'],
  'car-suv-tyres': ['car_suv'],
  'car-suv-batteries': ['car_suv'],
  'car-engine-oil': ['car_suv'],
  'car-care-products': ['car_suv'],
  'light-commercial-tyres': ['light_commercial'],
  'truck-bus-tyres': ['truck_bus'],
  'cv-batteries': ['truck_bus', 'light_commercial'],
  'diesel-engine-oil': ['truck_bus', 'light_commercial'],
  'heavy-duty-oils': ['truck_bus', 'light_commercial'],
  'farm-tyres': ['tractor_farm'],
  'tractor-batteries': ['tractor_farm'],
  'tractor-agri-oils': ['tractor_farm'],
  'otr-tyres': ['construction_otr'],
  'industrial-tyres': ['construction_otr'],
  'earth-moving-batteries': ['construction_otr'],
  'home-power': ['not_vehicle'],
  'genset-batteries': ['not_vehicle'],
  'industrial-batteries': ['not_vehicle'],
  'workshop-tools': ['not_vehicle'],
};

/** The segment words of a heavy-duty oil's text that add the tractor segment (backfill and new products alike). */
export const TRACTOR_TEXT_RE = /tractor|ट्रैक्टर/i;

/** Locale key of a segment's built-in name (demo mode and the Hindi fallback): `segments.<code>`. */
export function segmentLabelKey(code: VehicleSegment): `segments.${VehicleSegment}` {
  return `segments.${code}`;
}

/**
 * The segments of a product given only what is known without the database (demo catalogue, tests): its category
 * slug first, then its vehicle types. Mirrors `public.product_default_segments` in migration 0087.
 */
export function defaultSegmentsFor(input: {
  categorySlug: string;
  vehicleTypes: readonly string[];
  text?: string;
}): VehicleSegment[] {
  const own = DEFAULT_SEGMENTS_OF_CATEGORY[input.categorySlug];
  if (own) {
    const out = [...own];
    if (
      (input.categorySlug === 'diesel-engine-oil' || input.categorySlug === 'heavy-duty-oils') &&
      TRACTOR_TEXT_RE.test(input.text ?? '')
    )
      out.push('tractor_farm');
    return out;
  }
  const byType: VehicleSegment[] = [];
  for (const t of input.vehicleTypes) {
    const seg = (SEGMENT_OF_VEHICLE_TYPE as Record<string, VehicleSegment | undefined>)[t];
    if (seg && !byType.includes(seg)) byType.push(seg);
  }
  return byType;
}

/**
 * The one segment a product card tags (design 2026-11-25): the first of the filtered segments the product is in,
 * else the first of its own segments in the staff's order. `own` arrives in that order.
 */
export function cardSegment<T extends { code: string }>(
  own: readonly T[],
  filtered: readonly string[],
): T | null {
  return own.find((s) => filtered.includes(s.code)) ?? own[0] ?? null;
}

/**
 * The `segment` URL parameter ("truck_bus,tractor_farm"): valid codes only, each once, in the shared order. Anything
 * else is dropped, so a hand-edited link filters nothing it should not.
 */
export function parseSegmentParam(value: string | readonly string[] | undefined | null): VehicleSegment[] {
  const raw = (Array.isArray(value) ? value.join(',') : (value ?? '')) as string;
  const wanted = new Set(raw.split(',').map((x) => x.trim()));
  return VEHICLE_SEGMENTS.filter((code) => wanted.has(code));
}

/** The URL form of a selection (empty string = no filter), in the shared order so one selection has one URL. */
export function formatSegmentParam(segments: readonly string[]): string {
  return VEHICLE_SEGMENTS.filter((code) => segments.includes(code)).join(',');
}
