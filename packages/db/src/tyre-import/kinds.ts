import type { VehicleType } from '@mechdost/shared/vehicles';
import type { PlannedCategory } from '../battery-import/types';

/**
 * The kinds of tyre product the CEAT and MRF importers know, with their sub-category under `tyres`, vehicle types, HSN
 * and the words the texts use (user 2026-11-24: categories "for the admin"). HSN: tyres 4011, flaps 4012, tubes 4013.
 * GST is 18 % on all three since GST 2.0 of 2025-09-22 (ruling Q210; the admin can change it per product).
 */
export type TyreKind =
  | 'car_suv'
  | 'two_wheeler'
  | 'three_wheeler'
  | 'light_commercial'
  | 'truck_bus'
  | 'farm'
  | 'otr'
  | 'industrial'
  | 'tube'
  | 'flap';

const sub = (
  slug: string,
  name: string,
  nameHi: string,
  description: string,
  descriptionHi: string,
): PlannedCategory => ({
  slug,
  parent: 'tyres',
  name,
  nameHi,
  description,
  descriptionHi,
});

export const TYRE_CATEGORIES: Readonly<Record<TyreKind, PlannedCategory>> = {
  car_suv: sub(
    'car-suv-tyres',
    'Car and SUV tyres',
    'कार और SUV टायर',
    'Tyres for cars, SUVs and MUVs, with the vehicles each size is listed for.',
    'कार, SUV और MUV के टायर, साथ में हर साइज़ के लिए बताई गई गाड़ियाँ।',
  ),
  two_wheeler: sub(
    'two-wheeler-tyres',
    'Two-wheeler tyres',
    'दोपहिया टायर',
    'Motorcycle and scooter tyres, front and rear, with the bikes each size is listed for.',
    'मोटरसाइकिल और स्कूटर के आगे और पीछे के टायर, साथ में हर साइज़ के लिए बताई गई गाड़ियाँ।',
  ),
  three_wheeler: sub(
    'three-wheeler-tyres',
    'Three-wheeler tyres',
    'तिपहिया टायर',
    'Tyres for autos, load carriers and e-rickshaws.',
    'ऑटो, लोडर और ई-रिक्शा के टायर।',
  ),
  light_commercial: sub(
    'light-commercial-tyres',
    'Light commercial tyres',
    'लाइट कमर्शियल टायर',
    'Tyres for pick-ups and small, light and intermediate commercial vehicles.',
    'पिकअप और छोटे, हल्के व्यावसायिक वाहनों के टायर।',
  ),
  truck_bus: sub(
    'truck-bus-tyres',
    'Truck and bus tyres',
    'ट्रक और बस टायर',
    'Tyres for medium and heavy trucks and buses.',
    'मध्यम और भारी ट्रक व बसों के टायर।',
  ),
  farm: sub(
    'farm-tyres',
    'Farm tyres',
    'खेती के टायर',
    'Tractor, trailer and implement tyres.',
    'ट्रैक्टर, ट्रेलर और खेती के औज़ारों के टायर।',
  ),
  otr: sub(
    'otr-tyres',
    'Off-the-road (OTR) tyres',
    'ऑफ़-द-रोड (ओटीआर) टायर',
    'Tyres for earth movers, loaders, graders, fork-lifts and industrial vehicles.',
    'अर्थमूवर, लोडर, ग्रेडर, फ़ोर्क-लिफ़्ट और औद्योगिक वाहनों के टायर।',
  ),
  industrial: sub(
    'industrial-tyres',
    'Industrial tyres',
    'इंडस्ट्रियल टायर',
    'Tyres for forklifts, trailers, port and factory vehicles and other industrial equipment.',
    'फ़ोर्कलिफ़्ट, ट्रेलर, बंदरगाह और फ़ैक्टरी के वाहनों और दूसरे औद्योगिक उपकरणों के टायर।',
  ),
  tube: sub(
    'tubes-flaps',
    'Tubes and flaps',
    'ट्यूब और फ़्लैप',
    'Inner tubes and flaps for car, two-wheeler, commercial and farm tyres.',
    'कार, दोपहिया, व्यावसायिक और खेती के टायरों की ट्यूब और फ़्लैप।',
  ),
  flap: sub(
    'tubes-flaps',
    'Tubes and flaps',
    'ट्यूब और फ़्लैप',
    'Inner tubes and flaps for car, two-wheeler, commercial and farm tyres.',
    'कार, दोपहिया, व्यावसायिक और खेती के टायरों की ट्यूब और फ़्लैप।',
  ),
};

/** The distinct sub-categories (tubes and flaps share one). */
export const TYRE_CATEGORY_LIST: readonly PlannedCategory[] = [
  ...new Map(Object.values(TYRE_CATEGORIES).map((c) => [c.slug, c])).values(),
];

export interface KindInfo {
  /** `spec.productType` code. */
  code: string;
  vehicleTypes: VehicleType[];
  hsn: string;
  en: string;
  hi: string;
}

export const KINDS: Readonly<Record<TyreKind, KindInfo>> = {
  car_suv: {
    code: 'car_suv_tyre',
    vehicleTypes: ['4W'],
    hsn: '4011',
    en: 'car and SUV tyre',
    hi: 'कार और SUV टायर',
  },
  two_wheeler: {
    code: 'two_wheeler_tyre',
    vehicleTypes: ['2W'],
    hsn: '4011',
    en: 'two-wheeler tyre',
    hi: 'दोपहिया टायर',
  },
  three_wheeler: {
    code: 'three_wheeler_tyre',
    vehicleTypes: ['3W'],
    hsn: '4011',
    en: 'three-wheeler tyre',
    hi: 'तिपहिया टायर',
  },
  light_commercial: {
    code: 'light_commercial_tyre',
    vehicleTypes: [],
    hsn: '4011',
    en: 'light commercial vehicle tyre',
    hi: 'लाइट कमर्शियल वाहन का टायर',
  },
  truck_bus: {
    code: 'truck_bus_tyre',
    vehicleTypes: [],
    hsn: '4011',
    en: 'truck and bus tyre',
    hi: 'ट्रक और बस का टायर',
  },
  farm: { code: 'farm_tyre', vehicleTypes: [], hsn: '4011', en: 'farm tyre', hi: 'खेती का टायर' },
  otr: {
    code: 'otr_tyre',
    vehicleTypes: [],
    hsn: '4011',
    en: 'off-the-road (OTR) tyre',
    hi: 'ऑफ़-द-रोड (ओटीआर) टायर',
  },
  industrial: {
    code: 'industrial_tyre',
    vehicleTypes: [],
    hsn: '4011',
    en: 'industrial tyre',
    hi: 'इंडस्ट्रियल टायर',
  },
  tube: { code: 'tube', vehicleTypes: [], hsn: '4013', en: 'inner tube', hi: 'इनर ट्यूब' },
  flap: { code: 'flap', vehicleTypes: [], hsn: '4012', en: 'tyre flap', hi: 'टायर फ़्लैप' },
};
