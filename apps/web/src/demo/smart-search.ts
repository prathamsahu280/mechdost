import {
  DEFAULT_SEARCH_VOCAB,
  didYouMean,
  parseSearchQuery,
  scoreProductText,
  type PackSize,
  type SearchableProductText,
} from '@mechdost/shared/search';
import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  CATEGORY_KEYS,
  CATEGORY_SLUGS,
  DEMO_PRODUCTS,
  VEHICLE_TYPES_OF_FIT,
  type CategoryKey,
  type DemoProduct,
  type SortKey,
} from './catalogue';
import type { ProductHi } from './i18n/hi-products';
import { productSearchText } from './i18n/product-search';
import { productFullName } from '@/lib/product-name';

/**
 * The demo catalogue's smart search (spec 02 "Smart search", design 2026-11-22): the same query understanding and
 * ranking rules as the API (`packages/shared/src/search`), run over the demo products. Its own module on purpose:
 * the shop loads it lazily (with the Hindi product text), never in the first load (JS budget, spec 16).
 */

const packsCache = new WeakMap<DemoProduct, PackSize[]>();

/** The pack size a demo product names ("… 900 ml", "… 3.5 L"). */
function packsOf(p: DemoProduct): PackSize[] {
  const hit = packsCache.get(p);
  if (hit) return hit;
  const found = parseSearchQuery(`${p.name} ${p.spec}`, []).netQty;
  const packs = found ? [found] : [];
  packsCache.set(p, packs);
  return packs;
}

function searchable(
  p: DemoProduct,
  hi: Readonly<Record<string, ProductHi>> | undefined,
  categoryLabel: ((key: CategoryKey) => string) | undefined,
): SearchableProductText {
  return {
    name: `${productFullName(p.brand, p.name)} ${hi?.[p.slug]?.name ?? ''}`,
    brand: p.brand,
    text: `${productSearchText(p, hi)} ${categoryLabel?.(p.category) ?? ''}`,
    categorySlug: CATEGORY_SLUGS[p.category],
    vehicleTypes: VEHICLE_TYPES_OF_FIT[p.fits],
    packs: packsOf(p),
    inStock: p.availability !== 'on_request',
  };
}

export interface SmartSearchOptions {
  query?: string;
  category?: CategoryKey;
  sort?: SortKey;
  vehicle?: VehicleType;
  categoryLabel?: (key: CategoryKey) => string;
  hi?: Readonly<Record<string, ProductHi>>;
}

/** Products matching the query, best first (popular first when there is no query); price sorts keep the matches. */
export function smartSearchProducts(opts: SmartSearchOptions): DemoProduct[] {
  const parsed = parseSearchQuery(opts.query ?? '', DEFAULT_SEARCH_VOCAB);
  const scored: { p: DemoProduct; score: number }[] = [];
  for (const p of DEMO_PRODUCTS) {
    if (opts.category && p.category !== opts.category) continue;
    if (opts.vehicle && !VEHICLE_TYPES_OF_FIT[p.fits].includes(opts.vehicle)) continue;
    const score = scoreProductText(parsed, searchable(p, opts.hi, opts.categoryLabel));
    if (score > 0) scored.push({ p, score });
  }
  const searching = parsed.raw.trim() !== '';
  if (opts.sort === 'price_asc') scored.sort((a, b) => a.p.pricePaise - b.p.pricePaise);
  else if (opts.sort === 'price_desc') scored.sort((a, b) => b.p.pricePaise - a.p.pricePaise);
  else
    scored.sort(
      (a, b) =>
        (searching ? b.score - a.score : 0) || Number(Boolean(b.p.popular)) - Number(Boolean(a.p.popular)),
    );
  return scored.map((s) => s.p);
}

/** The closest brand, category or product name for a search that found nothing. */
export function demoDidYouMean(query: string, categoryLabel: (key: CategoryKey) => string): string | null {
  const names = [
    ...new Set([
      ...DEMO_PRODUCTS.map((p) => p.brand),
      ...CATEGORY_KEYS.map((k) => categoryLabel(k)),
      ...DEMO_PRODUCTS.flatMap((p) => p.name.split(' ').filter((w) => w.length >= 4)),
    ]),
  ];
  return didYouMean(query, names);
}

export interface DemoSuggestion {
  kind: 'brand' | 'category' | 'product';
  label: string;
  slug: string;
  subtitle: string | null;
}

/** Up to 8 suggestions for the words typed: brands (≤ 2), categories (≤ 2), then the best products. */
export function demoSuggestions(
  query: string,
  categoryLabel: (key: CategoryKey) => string,
  hi: Readonly<Record<string, ProductHi>> | undefined,
  locale: string,
): DemoSuggestion[] {
  const q = query.trim().toLowerCase();
  if (Array.from(q).length < 2) return [];
  const out: DemoSuggestion[] = [];
  const brands = [...new Set(DEMO_PRODUCTS.map((p) => p.brand))]
    .filter((b) => b.toLowerCase().startsWith(q))
    .slice(0, 2);
  for (const b of brands)
    out.push({ kind: 'brand', label: b, slug: b.toLowerCase().replace(/[^a-z0-9]+/g, '-'), subtitle: null });
  const parsed = parseSearchQuery(query, DEFAULT_SEARCH_VOCAB);
  for (const k of CATEGORY_KEYS) {
    const label = categoryLabel(k);
    const named = label.toLowerCase().includes(q) || k.toLowerCase().includes(q);
    if (
      (named || parsed.categorySlug === CATEGORY_SLUGS[k]) &&
      out.filter((o) => o.kind === 'category').length < 2
    )
      out.push({ kind: 'category', label, slug: CATEGORY_SLUGS[k], subtitle: null });
  }
  const room = 8 - out.length;
  for (const p of smartSearchProducts({ query, categoryLabel, hi }).slice(0, room))
    out.push({
      kind: 'product',
      label: `${p.brand} ${(locale === 'hi' ? hi?.[p.slug]?.name : undefined) ?? p.name}`,
      slug: p.slug,
      subtitle: null,
    });
  return out.slice(0, 8);
}
