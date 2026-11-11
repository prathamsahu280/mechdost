/**
 * The nine demo categories and their URL slugs (spec 02). Kept apart from `catalogue.ts` (product data) so the
 * site settings loaded on every page do not pull the whole demo catalogue into the bundle (JS budget, spec 16).
 */
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
