import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import {
  formatSegmentParam,
  parseSegmentParam,
  SEGMENT_OF_VEHICLE_TYPE,
  type VehicleSegment,
} from '@mechdost/shared/vehicle-segments';
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
  /** Vehicle segments chosen with the chips (any of; design 2026-11-25); empty = all vehicles. */
  segments: readonly VehicleSegment[];
}

export function shopUrl(base: string, s: ShopState): string {
  const params = new URLSearchParams();
  if (s.query) params.set('q', s.query);
  if (s.sub) params.set('category', s.sub.slug);
  else if (s.category) params.set('category', CATEGORY_SLUGS[s.category]);
  if (s.sort !== 'popular') params.set('sort', s.sort);
  const segment = formatSegmentParam(s.segments);
  if (segment) params.set('segment', segment);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Old shop links with the retired 2W/3W/4W "Vehicle type" select (`?vehicle=2W`; founder ruling 2026-11-26) go to the
 * matching segment chip (2W -> two_wheeler, 3W -> three_wheeler, 4W -> car_suv), merged with any chosen segments and
 * keeping every other parameter. An unknown value is dropped. Null when the URL has no `vehicle` parameter.
 */
export function legacyVehicleRedirect(
  base: string,
  search: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  const raw = search.vehicle;
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const type = VEHICLE_TYPES.find((v) => v === value);
  const params = new URLSearchParams();
  for (const [key, v] of Object.entries(search)) {
    if (key === 'vehicle' || key === 'segment' || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(key, one);
  }
  const segments = parseSegmentParam(search.segment);
  const segment = formatSegmentParam(type ? [...segments, SEGMENT_OF_VEHICLE_TYPE[type]] : segments);
  if (segment) params.set('segment', segment);
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
