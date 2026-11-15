import type { VehicleType } from '@mechdost/shared/vehicles';
import {
  CataloguePageSchema,
  CATALOGUE_SLUG_RE,
  CatalogueProductSchema,
  type CatalogueCard,
  type CatalogueProduct,
} from '@mechdost/shared/catalogue';
import { readAttributes } from '@mechdost/shared/product-attributes';
import { categoryFromSlug } from '@/demo/catalogue';
import type { Locale } from '@/i18n/routing';
import type { CardView, ProductView } from './view';

/**
 * Catalogue from the MechDost API (data mode `api`, spec 02). Server-side only: imported from Server Components
 * and server functions, never from client components. Every response is parsed with the shared DTOs. Failures
 * throw (status, timeout, malformed body) so Next keeps serving the last good page (ISR) or shows the error
 * boundary — never an empty catalogue that looks real. Only a 404 product is `null`.
 */
const CITY = 'RPR'; // until the city selector (spec 15)
/** Cards per page (API max 48). `CATALOGUE_PAGE_SIZE` (server env) only for tests with a small catalogue. */
const PAGE_SIZE = Math.min(48, Math.max(1, Number(process.env.CATALOGUE_PAGE_SIZE) || 24));
const QUERY_MAX = 120;
const TIMEOUT_MS = 3000;

export type ApiSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc';

export interface CatalogueQuery {
  locale: Locale;
  q?: string;
  category?: string;
  sort?: ApiSort;
  vehicle?: VehicleType;
  cursor?: string;
  limit?: number;
  /** A shared link starts again at page 1 on a bad cursor; "Load more" must fail instead (review B6). */
  restartOnBadCursor?: boolean;
}

function base(): string {
  const url = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!url) throw new Error('NEXT_PUBLIC_API_URL is not set (data mode api)');
  return url;
}

async function get(url: URL, next: { revalidate: number; tags: string[] }): Promise<Response> {
  return fetch(url.toString(), { next, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

export async function fetchCataloguePage(
  query: CatalogueQuery,
): Promise<{ items: CardView[]; nextCursor: string | null }> {
  const url = new URL(`${base()}/v1/catalogue/products`);
  url.searchParams.set('locale', query.locale);
  url.searchParams.set('city', CITY);
  url.searchParams.set('limit', String(query.limit ?? PAGE_SIZE));
  const q = query.q?.trim().slice(0, QUERY_MAX);
  if (q) url.searchParams.set('q', q);
  if (query.category) url.searchParams.set('category', query.category);
  if (query.sort) url.searchParams.set('sort', query.sort);
  if (query.vehicle) url.searchParams.set('vehicle', query.vehicle);
  if (query.cursor) url.searchParams.set('cursor', query.cursor);

  let res = await get(url, { revalidate: 30, tags: ['catalogue'] });
  if (res.status === 422 && query.cursor && query.restartOnBadCursor !== false) {
    // A tampered or outdated cursor in a shared link: start again from the first page.
    url.searchParams.delete('cursor');
    res = await get(url, { revalidate: 30, tags: ['catalogue'] });
  }
  if (!res.ok) throw new Error(`catalogue API ${String(res.status)}`);
  const page = CataloguePageSchema.parse(await res.json());
  return { items: page.items.map(apiCard), nextCursor: page.nextCursor };
}

export async function fetchCatalogueProduct(slug: string, locale: Locale): Promise<ProductView | null> {
  // A slug the API would reject (400) cannot exist: a 404 page, no API call, no cache entry.
  if (!CATALOGUE_SLUG_RE.test(slug)) return null;
  const url = new URL(`${base()}/v1/catalogue/products/${encodeURIComponent(slug)}`);
  url.searchParams.set('locale', locale);
  url.searchParams.set('city', CITY);
  const res = await get(url, { revalidate: 60, tags: ['catalogue', `product:${slug}`] });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`catalogue API ${String(res.status)}`);
  return apiProduct(CatalogueProductSchema.parse(await res.json()), locale);
}

export function apiCard(c: CatalogueCard): CardView {
  return {
    slug: c.slug,
    sku: null,
    brand: c.brand.name,
    name: c.name,
    category: {
      key: categoryFromSlug(c.category.slug) ?? null,
      slug: c.category.slug,
      name: c.category.name,
    },
    spec: c.specSummary,
    compatibility: null,
    vehicleTypes: c.vehicleTypes,
    price: c.offer ? { pricePaise: c.offer.pricePaise, mrpPaise: c.offer.mrpPaise } : null,
    pack: c.offer?.netQuantity ?? null,
    availability: c.offer ? 'in_stock' : 'on_request',
    leadDays: c.offer?.leadDays ?? null,
    highlights: c.highlights,
    rating: c.rating,
    popular: false,
    photo: c.photo,
  };
}

export function apiProduct(p: CatalogueProduct, locale: Locale): ProductView {
  const sold = p.variants.find((v) => v.offer !== null);
  const offer = sold?.offer ?? null;
  return {
    ...apiCard({ ...p, offer, photo: p.photos[0] ?? null }),
    photos: p.photos,
    sku: sold?.sku ?? p.variants[0]?.sku ?? null,
    compatibility: p.compatibility,
    description: p.description,
    seller: offer?.seller ?? null,
    countryOfOrigin: countryName(p.countryOfOrigin, locale),
    partNumbers: p.partNumbers,
    shippingPaise: offer?.shippingPaise ?? null,
    attributeSet: p.attributeSet,
    // Re-read through the shared definitions: a value this build does not know is left out, never shown raw.
    attributes: p.attributeSet === null ? {} : readAttributes(p.attributeSet, p.attributes),
    warranty: p.warranty,
  };
}

let englishRegions: Map<string, string> | null = null;

/** The stored country (English text, e.g. "India") in the page's language; unknown names stay as stored. */
function countryName(stored: string, locale: Locale): string {
  if (locale === 'en') return stored;
  if (!englishRegions) {
    const en = new Intl.DisplayNames(['en'], { type: 'region' });
    englishRegions = new Map();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters)
      for (const b of letters) {
        const code = a + b;
        const name = en.of(code);
        if (name && name !== code) englishRegions.set(name.toLowerCase(), code);
      }
  }
  const code = englishRegions.get(stored.trim().toLowerCase());
  return code ? (new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? stored) : stored;
}
