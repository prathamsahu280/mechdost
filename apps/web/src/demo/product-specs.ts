import type { AttrValue, NetQuantity } from '@mechdost/shared/product-attributes';

/**
 * Comparison data for the demo products (decision 2026-11-13): typed attributes and pack sizes, only what the
 * pack or spec line states. Kept apart from `catalogue.ts` because client components import that file: this
 * data is read on the server only (catalogue views, the seed fixture), so it never ships to the browser (JS
 * budget, spec 16).
 */
export interface DemoProductSpecs {
  attributes?: Readonly<Record<string, AttrValue>>;
  netQuantity?: NetQuantity;
}

export const DEMO_PRODUCT_SPECS: Readonly<Record<string, DemoProductSpecs>> = {
  'castrol-activ-4t-20w40-900ml': {
    attributes: { saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2' },
    netQuantity: { qty: 900, unit: 'ml' },
  },
  'motul-3100-4t-10w30-1l': {
    attributes: { saeGrade: '10W30', apiClass: 'SM', jasoClass: 'MA2', baseType: 'semi_synthetic' },
    netQuantity: { qty: 1000, unit: 'ml' },
  },
  'shell-advance-ax7-10w30-1l': {
    attributes: { saeGrade: '10W30', apiClass: 'SM', jasoClass: 'MA2', baseType: 'semi_synthetic' },
    netQuantity: { qty: 1000, unit: 'ml' },
  },
  'hp-racer4-20w40-900ml': {
    attributes: { saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2', baseType: 'mineral' },
    netQuantity: { qty: 900, unit: 'ml' },
  },
  'exide-xltz4a-2w-battery': {
    attributes: {
      voltage: 12,
      capacityAh: 3,
      batteryType: 'vrla',
      freeReplacementMonths: 24,
      proRataMonths: 24,
    },
  },
  'scooter-tubeless-tyre-90-90-12': {
    attributes: { size: '90/90-12', loadIndex: 54, speedSymbol: 'J', tubeless: true },
  },
  'car-tyre-185-65-r15': {
    attributes: { size: '185/65 R15', loadIndex: 88, speedSymbol: 'H', tubeless: true },
  },
  'car-starter-battery-45ah': { attributes: { voltage: 12, capacityAh: 45 } },
  'heavy-duty-battery-90ah': { attributes: { voltage: 12, capacityAh: 90 } },
  'synthetic-engine-oil-5w30-3-5l': {
    attributes: { saeGrade: '5W30', apiClass: 'SP', baseType: 'synthetic' },
    netQuantity: { qty: 3500, unit: 'ml' },
  },
  'all-weather-car-floor-mats': { netQuantity: { qty: 5, unit: 'piece' } },
};
