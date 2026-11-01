/**
 * DEMO CATALOGUE (decision 2026-11-01 "Demo mode"). Two real products from the concept site plus representative
 * items so the storefront can be presented before the catalogue API exists (spec 02, Phase 1). Indicative prices,
 * integer paise, GST-inclusive. Replaced by `GET /v1/catalogue` — never extend this file with real business data.
 */
import { productSearchText } from './i18n/localize';

export const CATEGORY_KEYS = [
  'tyres',
  'lubricants',
  'batteries',
  'bearings',
  'filters',
  'spareParts',
  'accessories',
  'workshopTools',
  'evEssentials',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_SLUGS: Record<CategoryKey, string> = {
  tyres: 'tyres',
  lubricants: 'lubricants',
  batteries: 'batteries',
  bearings: 'bearings',
  filters: 'filters',
  spareParts: 'spare-parts',
  accessories: 'accessories',
  workshopTools: 'workshop-tools',
  evEssentials: 'ev-essentials',
};

export function categoryFromSlug(slug: string | undefined): CategoryKey | undefined {
  return CATEGORY_KEYS.find((k) => CATEGORY_SLUGS[k] === slug);
}

export type VehicleFit = '2W' | '4W' | '2W/4W' | 'EV';
export type Availability = 'in_stock' | 'low_stock' | 'on_request';

export interface DemoProduct {
  slug: string;
  sku: string;
  name: string;
  brand: string;
  category: CategoryKey;
  spec: string;
  compatibility: string;
  fits: VehicleFit;
  pricePaise: number;
  mrpPaise?: number;
  availability: Availability;
  leadDays: number;
  highlights: string[];
  popular?: boolean;
}

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    slug: 'castrol-activ-4t-20w40-900ml',
    sku: 'CAS-ACT4T-0900',
    name: 'Activ 4T 20W40 900 ml',
    brand: 'Castrol',
    category: 'lubricants',
    spec: 'Engine oil for 2W · 20W40 · 900 ml',
    compatibility: 'All two-wheelers with 4-stroke engines',
    fits: '2W',
    pricePaise: 44_000,
    mrpPaise: 47_500,
    availability: 'in_stock',
    leadDays: 1,
    highlights: ['Actibond molecules for engine protection', 'JASO MA2 · API SL', '900 ml pack'],
    popular: true,
  },
  {
    slug: 'exide-xltz4a-2w-battery',
    sku: 'EXI-XLTZ4A',
    name: 'XLTZ4A 24F+24P',
    brand: 'Exide',
    category: 'batteries',
    spec: '12 V · 3 Ah · VRLA · factory charged',
    compatibility: 'Most 100–125 cc motorcycles and scooters',
    fits: '2W',
    pricePaise: 100_000,
    mrpPaise: 112_000,
    availability: 'in_stock',
    leadDays: 1,
    highlights: ['Maintenance free', '24F + 24P warranty', 'Fitment check before dispatch'],
    popular: true,
  },
  {
    slug: 'scooter-tubeless-tyre-90-90-12',
    sku: 'TYR-SC-909012',
    name: 'Tubeless scooter tyre 90/90-12',
    brand: 'MRF',
    category: 'tyres',
    spec: '90/90-12 · 54J · tubeless',
    compatibility: 'Activa, Jupiter, Access front/rear (check size)',
    fits: '2W',
    pricePaise: 165_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Wet-grip tread', 'Fitting available at partner workshops'],
    popular: true,
  },
  {
    slug: 'car-tyre-185-65-r15',
    sku: 'TYR-PC-1856515',
    name: 'Passenger car tyre 185/65 R15',
    brand: 'CEAT',
    category: 'tyres',
    spec: '185/65 R15 · 88H · tubeless',
    compatibility: 'Dzire, Amaze, Xcent and similar (check size)',
    fits: '4W',
    pricePaise: 420_000,
    mrpPaise: 455_000,
    availability: 'low_stock',
    leadDays: 3,
    highlights: ['Low rolling noise', 'Alignment and balancing on request'],
  },
  {
    slug: 'car-starter-battery-45ah',
    sku: 'BAT-4W-45AH',
    name: 'Automotive starter battery 45 Ah',
    brand: 'Amaron',
    category: 'batteries',
    spec: '12 V · 45 Ah · maintenance free',
    compatibility: 'Hatchbacks and compact sedans (check terminal layout)',
    fits: '4W',
    pricePaise: 520_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Old battery exchange discount on request', 'Installation available'],
    popular: true,
  },
  {
    slug: 'heavy-duty-battery-90ah',
    sku: 'BAT-HD-90AH',
    name: 'Heavy-duty vehicle battery 90 Ah',
    brand: 'Exide',
    category: 'batteries',
    spec: '12 V · 90 Ah',
    compatibility: 'SUVs, pick-ups and light commercial vehicles',
    fits: '4W',
    pricePaise: 890_000,
    availability: 'on_request',
    leadDays: 4,
    highlights: ['Supplier confirmation required', 'Delivered and installed'],
  },
  {
    slug: 'synthetic-engine-oil-5w30-3-5l',
    sku: 'LUB-5W30-3500',
    name: 'Fully synthetic engine oil 5W-30 3.5 L',
    brand: 'Shell Helix',
    category: 'lubricants',
    spec: '5W-30 · API SP · 3.5 L',
    compatibility: 'Petrol cars; check the owner manual grade',
    fits: '4W',
    pricePaise: 289_000,
    mrpPaise: 315_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Fuel-economy grade', 'Pair with an oil filter'],
  },
  {
    slug: 'engine-oil-filter-petrol-car',
    sku: 'FLT-OIL-001',
    name: 'Engine oil filter',
    brand: 'Bosch',
    category: 'filters',
    spec: 'Spin-on · petrol cars',
    compatibility: 'Maruti Suzuki petrol models (check OEM number)',
    fits: '4W',
    pricePaise: 42_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['OEM-equivalent filtration', 'Replace with every oil change'],
  },
  {
    slug: 'diesel-fuel-filter',
    sku: 'FLT-FUEL-002',
    name: 'Diesel fuel filter',
    brand: 'Mann-Filter',
    category: 'filters',
    spec: 'Inline · diesel',
    compatibility: 'Common-rail diesel SUVs (check OEM number)',
    fits: '4W',
    pricePaise: 68_000,
    availability: 'low_stock',
    leadDays: 3,
    highlights: ['Water separation', 'Protects injectors'],
  },
  {
    slug: 'front-wheel-bearing-kit',
    sku: 'BRG-FWB-001',
    name: 'Front wheel bearing kit',
    brand: 'SKF',
    category: 'bearings',
    spec: 'Double-row angular contact · with seal',
    compatibility: 'Compact cars (check part reference)',
    fits: '4W',
    pricePaise: 145_000,
    availability: 'on_request',
    leadDays: 4,
    highlights: ['Supplier confirmation required', 'Fitment by workshop recommended'],
  },
  {
    slug: 'motorcycle-wheel-bearing-6301',
    sku: 'BRG-6301-2RS',
    name: 'Wheel bearing 6301-2RS',
    brand: 'NBC',
    category: 'bearings',
    spec: '12 × 37 × 12 mm · sealed',
    compatibility: 'Many 100–150 cc motorcycles',
    fits: '2W',
    pricePaise: 18_000,
    availability: 'in_stock',
    leadDays: 1,
    highlights: ['Pair of 2', 'Sealed both sides'],
  },
  {
    slug: 'brake-pad-set-front',
    sku: 'PRT-BRK-002',
    name: 'Front brake pad set',
    brand: 'Brembo',
    category: 'spareParts',
    spec: 'Ceramic · front axle',
    compatibility: 'Hyundai i20 / Venue (check part reference)',
    fits: '4W',
    pricePaise: 125_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Low dust', 'Fitting at partner workshops'],
    popular: true,
  },
  {
    slug: 'chain-sprocket-kit-150cc',
    sku: 'PRT-CSK-150',
    name: 'Chain sprocket kit',
    brand: 'Rolon',
    category: 'spareParts',
    spec: '428 chain · 14T / 42T',
    compatibility: '150 cc motorcycles (check teeth count)',
    fits: '2W',
    pricePaise: 135_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['O-ring chain', 'Includes front and rear sprockets'],
  },
  {
    slug: 'spark-plug-iridium',
    sku: 'PRT-SPK-IR',
    name: 'Iridium spark plug',
    brand: 'NGK',
    category: 'spareParts',
    spec: 'CPR8EAIX-9 · iridium',
    compatibility: 'Many 125–200 cc motorcycles',
    fits: '2W',
    pricePaise: 62_000,
    availability: 'in_stock',
    leadDays: 1,
    highlights: ['Faster starts', 'Longer life than copper plugs'],
  },
  {
    slug: 'all-weather-car-floor-mats',
    sku: 'ACC-MAT-001',
    name: 'All-weather car floor mat set',
    brand: 'Elegant',
    category: 'accessories',
    spec: '5 pieces · TPE · raised edges',
    compatibility: 'Universal fit for hatchbacks and sedans',
    fits: '4W',
    pricePaise: 120_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Washable', 'Anti-slip backing'],
  },
  {
    slug: 'two-wheeler-body-cover',
    sku: 'ACC-CVR-002',
    name: 'Two-wheeler protective cover',
    brand: 'AutoRight',
    category: 'accessories',
    spec: 'Water resistant · UV protected',
    compatibility: 'Scooters and motorcycles up to 150 cc',
    fits: '2W',
    pricePaise: 65_000,
    availability: 'in_stock',
    leadDays: 1,
    highlights: ['Elastic hem', 'Storage pouch'],
  },
  {
    slug: 'socket-tool-set-46pc',
    sku: 'TLS-SKT-046',
    name: 'Workshop socket tool set 46 pc',
    brand: 'Taparia',
    category: 'workshopTools',
    spec: '1/4" drive · 4–14 mm · ratchet',
    compatibility: 'Home and workshop use',
    fits: '2W/4W',
    pricePaise: 240_000,
    availability: 'in_stock',
    leadDays: 3,
    highlights: ['Chrome vanadium', 'Carry case'],
  },
  {
    slug: 'digital-tyre-pressure-gauge',
    sku: 'TLS-TPG-002',
    name: 'Digital tyre pressure gauge',
    brand: 'Michelin',
    category: 'workshopTools',
    spec: '0–100 psi · backlit display',
    compatibility: 'Cars and two-wheelers',
    fits: '2W/4W',
    pricePaise: 75_000,
    availability: 'in_stock',
    leadDays: 2,
    highlights: ['Accurate to ±1 psi', 'Auto off'],
  },
  {
    slug: 'ev-12v-auxiliary-battery',
    sku: 'EV-AUX-12V',
    name: 'EV auxiliary battery 12 V',
    brand: 'Exide',
    category: 'evEssentials',
    spec: '12 V · 35 Ah · AGM',
    compatibility: 'Electric cars (check model before ordering)',
    fits: 'EV',
    pricePaise: 480_000,
    availability: 'on_request',
    leadDays: 5,
    highlights: ['Electrical compatibility confirmed by our team', 'Installation recommended'],
  },
  {
    slug: 'ev-portable-charger-15a',
    sku: 'EV-CHG-15A',
    name: 'Portable EV charging cable 15 A',
    brand: 'Tata Power EZ',
    category: 'evEssentials',
    spec: 'Type 2 · 15 A · 5 m',
    compatibility: 'EV cars with Type 2 inlet',
    fits: 'EV',
    pricePaise: 1_250_000,
    availability: 'on_request',
    leadDays: 5,
    highlights: ['Earth-leakage protection', 'Check wall socket rating'],
  },
];

export function findProduct(slug: string): DemoProduct | undefined {
  return DEMO_PRODUCTS.find((p) => p.slug === slug);
}

export type SortKey = 'popular' | 'price_asc' | 'price_desc';

/**
 * Search name, brand, SKU, spec and compatibility in English and Hindi (case-insensitive), optionally within a
 * category. `categoryLabel` adds the shown category name (e.g. "लुब्रिकेंट") so it matches as typed.
 */
export function searchProducts(opts: {
  query?: string;
  category?: CategoryKey;
  sort?: SortKey;
  categoryLabel?: (key: CategoryKey) => string;
}): DemoProduct[] {
  const q = opts.query?.trim().toLowerCase() ?? '';
  const words = q.split(/\s+/).filter(Boolean);
  const list = DEMO_PRODUCTS.filter((p) => {
    if (opts.category && p.category !== opts.category) return false;
    if (words.length === 0) return true;
    const hay = `${productSearchText(p)} ${opts.categoryLabel?.(p.category) ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w) || hay.includes(w.replace(/s$/, '')));
  });
  const sorted = [...list];
  if (opts.sort === 'price_asc') sorted.sort((a, b) => a.pricePaise - b.pricePaise);
  else if (opts.sort === 'price_desc') sorted.sort((a, b) => b.pricePaise - a.pricePaise);
  else sorted.sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)));
  return sorted;
}

/** Delivery rule: free from the threshold, else the flat fee. Admin-set (demo: /admin/settings; spec 03 per city). */
export function deliveryFeePaise(
  subtotalPaise: number,
  rule: { deliveryFeePaise: number; freeDeliveryFromPaise: number } = {
    deliveryFeePaise: 4_900,
    freeDeliveryFromPaise: 99_900,
  },
): number {
  return subtotalPaise === 0 || subtotalPaise >= rule.freeDeliveryFromPaise ? 0 : rule.deliveryFeePaise;
}
