import {
  CataloguePageSchema,
  CATALOGUE_SLUG_RE,
  CatalogueProductSchema,
  type CatalogueCard,
} from '@mechdost/shared/catalogue';

/**
 * Live catalogue from the browser (public, no sign-in) for the real-mode pickers: the seller application's product
 * tick-list, a shop asking to sell a product, staff adding a product to a shop. Only dynamically imported real-mode
 * modules load this (the storefront reads the catalogue on the server, `lib/catalogue/api-source.ts`). Answers are
 * validated with the shared DTOs (hard rule 4).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const PAGE = 24;
const QUERY_MAX = 120;

export type PublicResult<T> = { ok: true; data: T } | { ok: false; code: string };

async function getJson(url: string): Promise<{ ok: true; body: unknown } | { ok: false; code: string }> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  if (!res.ok) return { ok: false, code: `HTTP_${String(res.status)}` };
  return { ok: true, body: await res.json().catch(() => null) };
}

export interface CataloguePick {
  slug: string;
  name: string;
  brand: string;
  category: { slug: string; name: string };
  spec: string | null;
}

const pick = (c: CatalogueCard): CataloguePick => ({
  slug: c.slug,
  name: c.name,
  brand: c.brand.name,
  category: c.category,
  spec: c.specSummary,
});

/** One page of live products, optionally matching `q` (the API's search), in the page's language. */
export async function searchCatalogue(input: {
  q: string;
  locale: string;
  cursor?: string | null;
}): Promise<PublicResult<{ items: CataloguePick[]; next: string | null }>> {
  const url = new URL(`${API}/v1/catalogue/products`);
  url.searchParams.set('locale', input.locale === 'hi' ? 'hi' : 'en');
  url.searchParams.set('limit', String(PAGE));
  const q = input.q.trim().slice(0, QUERY_MAX);
  if (q) url.searchParams.set('q', q);
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  const res = await getJson(url.toString());
  if (!res.ok) return res;
  const page = CataloguePageSchema.safeParse(res.body);
  return page.success
    ? { ok: true, data: { items: page.data.items.map(pick), next: page.data.nextCursor } }
    : { ok: false, code: 'BAD_RESPONSE' };
}

export interface CatalogueVariantPick {
  sku: string;
  mrpPaise: number;
  /** Pack or option text for choosing between packs, e.g. "900 ml". */
  label: string;
}

/** The packs (SKUs) of one live product, with their MRP. */
export async function productVariants(
  slug: string,
  locale: string,
): Promise<PublicResult<{ name: string; variants: CatalogueVariantPick[] }>> {
  if (!CATALOGUE_SLUG_RE.test(slug)) return { ok: false, code: 'NOT_FOUND' };
  const url = new URL(`${API}/v1/catalogue/products/${encodeURIComponent(slug)}`);
  url.searchParams.set('locale', locale === 'hi' ? 'hi' : 'en');
  const res = await getJson(url.toString());
  if (!res.ok) return res;
  const p = CatalogueProductSchema.safeParse(res.body);
  if (!p.success) return { ok: false, code: 'BAD_RESPONSE' };
  return {
    ok: true,
    data: {
      name: `${p.data.brand.name} ${p.data.name}`,
      // Packs without an MRP are not sellable yet (design 2026-11-22): sellers cannot pick them.
      variants: p.data.variants
        .flatMap((v) => (v.mrpPaise === null ? [] : [{ ...v, mrpPaise: v.mrpPaise }]))
        .map((v) => ({
          sku: v.sku,
          mrpPaise: v.mrpPaise,
          label: v.netQuantity
            ? `${String(v.netQuantity.qty)} ${v.netQuantity.unit}`
            : Object.values(v.options)
                .filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
                .join(' · '),
        })),
    },
  };
}
