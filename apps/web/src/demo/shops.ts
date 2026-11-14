/**
 * DEMO SHOPS (decision 2026-11-01 "Demo mode"): partner sellers in Raipur that admin routes product orders to
 * (spec 04). Real shops come from approved seller applications (`shops`, `shop_inventory`, `shop_pincodes`).
 */
import type { CategoryKey } from './catalogue';
import { takesNewWork } from './partner-status';
import { APPLICATION_STAGES, applicationsNow, type DemoApplication } from './store';

export interface DemoShop {
  slug: string;
  name: string;
  area: string;
  pincode: string;
  lat: number;
  lng: number;
  categories: readonly CategoryKey[];
  /** Share of offered orders accepted in the last 30 days, 0–100. */
  acceptance: number;
  /** Median minutes to accept an offered order. */
  acceptMinutes: number;
  rating: number;
}

export const DEMO_SHOPS: readonly DemoShop[] = [
  {
    slug: 'sharma-auto-parts',
    name: 'Sharma Auto Parts',
    area: 'Pandri',
    pincode: '492004',
    lat: 21.2561,
    lng: 81.6418,
    categories: ['spareParts', 'filters', 'bearings', 'lubricants', 'accessories'],
    acceptance: 94,
    acceptMinutes: 6,
    rating: 4.6,
  },
  {
    slug: 'chhattisgarh-tyre-house',
    name: 'Chhattisgarh Tyre House',
    area: 'Telibandha',
    pincode: '492006',
    lat: 21.2459,
    lng: 81.6602,
    categories: ['tyres', 'accessories'],
    acceptance: 89,
    acceptMinutes: 9,
    rating: 4.5,
  },
  {
    slug: 'raipur-battery-point',
    name: 'Raipur Battery Point',
    area: 'Shankar Nagar',
    pincode: '492007',
    lat: 21.2542,
    lng: 81.6589,
    categories: ['batteries', 'evEssentials', 'workshopTools'],
    acceptance: 97,
    acceptMinutes: 4,
    rating: 4.8,
  },
  {
    slug: 'gupta-lubes-spares',
    name: 'Gupta Lubes & Spares',
    area: 'Tatibandh',
    pincode: '492099',
    lat: 21.2601,
    lng: 81.5873,
    categories: ['lubricants', 'filters', 'spareParts', 'bearings', 'batteries'],
    acceptance: 82,
    acceptMinutes: 14,
    rating: 4.3,
  },
];

/** The shop an onboarded seller application became (stable: from the application code). */
export const shopSlugForApplication = (code: string) => `shop-${code.toLowerCase()}`;

const ONBOARDED = APPLICATION_STAGES.indexOf('onboarded');

/** Approved (or invited) seller applications, as the API's `shops` row made at approval (Q89). */
export function onboardedSellerApplications(): DemoApplication[] {
  return applicationsNow().filter((a) => a.kind === 'seller' && !a.rejected && a.stage >= ONBOARDED);
}

function shopFromApplication(a: DemoApplication): DemoShop {
  return {
    slug: shopSlugForApplication(a.code),
    name: a.shopName ?? a.business,
    area: a.addressLine ?? a.pincode,
    pincode: a.pincode,
    lat: a.location?.lat ?? 21.2514,
    lng: a.location?.lng ?? 81.6296,
    categories: a.categories ?? [],
    // No history yet: ranked after established shops with the same categories.
    acceptance: 0,
    acceptMinutes: 0,
    rating: 0,
  };
}

/** Every shop: the fixed demo shops, then shops onboarded on this device (approved applications). */
export function allShops(): readonly DemoShop[] {
  const onboarded = onboardedSellerApplications().map(shopFromApplication);
  return onboarded.length === 0 ? DEMO_SHOPS : [...DEMO_SHOPS, ...onboarded];
}

export function findShop(slug: string | null | undefined): DemoShop | undefined {
  return allShops().find((s) => s.slug === slug);
}

/**
 * Ranked suggestions for routing an order (spec 04): shops covering every category in the order first, then
 * acceptance rate, then speed. The API ranker also uses stock, distance and price.
 */
export function rankShops(categories: readonly CategoryKey[], exclude: readonly string[] = []): DemoShop[] {
  const coverage = (s: DemoShop) => categories.filter((c) => s.categories.includes(c)).length;
  // Paused or suspended shops are never suggested (admin control, decision 2026-11-01). Shops stocking none of the
  // order's categories stay last, and the card warns (QA 2026-11-14, U13: a warning, not removal — the shop's
  // category list can be incomplete, and removing them left orders with no shop at all).
  return allShops()
    .filter((s) => !exclude.includes(s.slug) && takesNewWork('shop', s.slug))
    .toSorted(
      (a, b) => coverage(b) - coverage(a) || b.acceptance - a.acceptance || a.acceptMinutes - b.acceptMinutes,
    );
}
