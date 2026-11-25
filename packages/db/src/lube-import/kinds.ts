import type { VehicleType } from '@mechdost/shared/vehicles';
import type { PlannedCategory } from '../battery-import/types';
import { SUB_CATEGORIES } from '../catalogue-v2/glossary';

/**
 * The sub-categories of `lubricants` the HP and BPCL MAK imports use (user 2026-11-25: map into the existing children, add a
 * new child only if clearly needed), with the HSN of each and the words the texts use. HSN as for Castrol in the
 * catalogue-v2 import: oils 2710, greases 3403, coolants 3820, brake fluid 3819 (fork oil 2710); GST 18 %.
 */
export type LubeCategory =
  | 'car-engine-oil'
  | 'motorcycle-oil'
  | 'diesel-engine-oil'
  | 'heavy-duty-oils'
  | 'gear-oils'
  | 'greases'
  | 'coolants'
  | 'brake-fluid-fork-oil'
  | 'tractor-agri-oils'
  | 'speciality-oils';

export interface LubeCategoryInfo {
  category: PlannedCategory;
  /** What the product is, for the first line of the description. */
  typeEn: string;
  typeHi: string;
  hsn: string;
  /** Used when the item says nothing more specific. */
  vehicleTypes: VehicleType[];
}

const existing = (slug: LubeCategory): PlannedCategory => {
  const sub = Object.values(SUB_CATEGORIES).find((s) => s.slug === slug);
  if (!sub) throw new Error(`No sub-category ${slug}`);
  return { slug: sub.slug, parent: sub.parent, name: sub.name, nameHi: sub.nameHi };
};

const info = (
  slug: LubeCategory,
  typeEn: string,
  typeHi: string,
  hsn: string,
  vehicleTypes: VehicleType[],
): LubeCategoryInfo => ({ category: existing(slug), typeEn, typeHi, hsn, vehicleTypes });

export const LUBE_CATEGORIES: Readonly<Record<LubeCategory, LubeCategoryInfo>> = {
  'car-engine-oil': info('car-engine-oil', 'car engine oil', 'कार इंजन ऑयल', '2710', ['4W']),
  'motorcycle-oil': info(
    'motorcycle-oil',
    'motorcycle and scooter engine oil',
    'मोटरसाइकिल और स्कूटर इंजन ऑयल',
    '2710',
    ['2W'],
  ),
  'diesel-engine-oil': info('diesel-engine-oil', 'diesel engine oil', 'डीज़ल इंजन ऑयल', '2710', []),
  'heavy-duty-oils': info('heavy-duty-oils', 'heavy-duty engine oil', 'हेवी ड्यूटी इंजन ऑयल', '2710', []),
  'gear-oils': info('gear-oils', 'gear and transmission oil', 'गियर और ट्रांसमिशन ऑयल', '2710', []),
  greases: info('greases', 'grease', 'ग्रीज़', '3403', []),
  coolants: info('coolants', 'radiator coolant', 'रेडिएटर कूलेंट', '3820', []),
  'brake-fluid-fork-oil': info(
    'brake-fluid-fork-oil',
    'brake fluid or fork oil',
    'ब्रेक फ्लूइड या फ़ोर्क ऑयल',
    '3819',
    [],
  ),
  'tractor-agri-oils': info(
    'tractor-agri-oils',
    'tractor and farm oil',
    'ट्रैक्टर और खेती का ऑयल',
    '2710',
    [],
  ),
  'speciality-oils': info(
    'speciality-oils',
    'speciality vehicle product',
    'गाड़ी का स्पेशलिटी उत्पाद',
    '3403',
    [],
  ),
};

/** GST on lubricating oils, greases, coolants and brake fluid is 18 % (as for Castrol in the catalogue-v2 import). */
export const LUBE_GST_RATE_BP = 1800;
