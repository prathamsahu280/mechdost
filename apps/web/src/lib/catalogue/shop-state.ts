import type { VehicleType } from '@mechdost/shared/vehicles';
import { CATEGORY_SLUGS, categoryFromSlug, type CategoryKey } from '@/demo/categories';
import type { SortKey } from '@/demo/catalogue';

/** A sub-category chosen in the shop (API mode, from a breadcrumb or a shared link): its slug and display name. */
export interface SubCategory {
  slug: string;
  name: string;
}

/** The shop's filters as the URL carries them. */
export interface ShopState {
  query: string;
  /** The top-level category (for a sub-category, its parent: the select and chips show it). */
  category: CategoryKey | undefined;
  /** Narrows `category` to one sub-category; the URL's `category` parameter then holds this slug. */
  sub: SubCategory | undefined;
  sort: SortKey;
  /** Only products tagged for this vehicle type (decision 2026-11-12). */
  vehicle: VehicleType | undefined;
}

export function shopUrl(base: string, s: ShopState): string {
  const params = new URLSearchParams();
  if (s.query) params.set('q', s.query);
  if (s.sub) params.set('category', s.sub.slug);
  else if (s.category) params.set('category', CATEGORY_SLUGS[s.category]);
  if (s.sort !== 'popular') params.set('sort', s.sort);
  if (s.vehicle) params.set('vehicle', s.vehicle);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

interface CategoryRow {
  slug: string;
  parentSlug: string | null;
  name: string;
}

/**
 * The `category` URL parameter is a top-level slug or a sub-category slug (breadcrumbs, JSON-LD and the compare
 * page link to the product's own sub-category). A sub-category resolves to its top-level parent plus a removable
 * sub filter; an unknown slug filters nothing.
 */
export function resolveCategoryParam(
  slug: string | undefined,
  categories: readonly CategoryRow[],
): { category: CategoryKey | undefined; sub: SubCategory | undefined } {
  const top = categoryFromSlug(slug);
  if (top) return { category: top, sub: undefined };
  const row = slug === undefined ? undefined : categories.find((c) => c.slug === slug);
  const parent = categoryFromSlug(row?.parentSlug ?? undefined);
  if (!row || !parent) return { category: undefined, sub: undefined };
  return { category: parent, sub: { slug: row.slug, name: row.name } };
}
