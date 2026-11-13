import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueCard, CatalogueProduct } from '@mechdost/shared/catalogue';
import {
  apiCard,
  apiProduct,
  fetchCataloguePage,
  fetchCatalogueProduct,
} from '../src/lib/catalogue/api-source';

const card: CatalogueCard = {
  slug: 'castrol-activ-4t-20w40-900ml',
  name: 'Activ 4T 20W40 900 ml',
  brand: { slug: 'castrol', name: 'Castrol' },
  category: { slug: 'lubricants', name: 'Lubricants' },
  specSummary: 'Engine oil for 2W · 20W40 · 900 ml',
  highlights: ['API SL'],
  vehicleTypes: [],
  rating: null,
  offer: { pricePaise: 44_000, mrpPaise: 47_500, netQuantity: null, shippingPaise: null, leadDays: null },
  photo: null,
};
const product: CatalogueProduct = {
  ...card,
  description: 'Mineral oil',
  compatibility: 'All 4-stroke two-wheelers',
  spec: {},
  attributeSet: 'lubricants',
  attributes: {},
  countryOfOrigin: 'India',
  warranty: null,
  gstRateBp: 1800,
  partNumbers: [],
  photos: [],
  variants: [
    { sku: 'CAS-0900-A', options: {}, mrpPaise: 47_500, netQuantity: null, offer: null },
    {
      sku: 'CAS-0900-B',
      options: {},
      mrpPaise: 47_500,
      netQuantity: { qty: 900, unit: 'ml' },
      offer: {
        pricePaise: 44_000,
        mrpPaise: 47_500,
        netQuantity: { qty: 900, unit: 'ml' },
        shippingPaise: 0,
        leadDays: 2,
        seller: 'Sharma Auto Parts',
      },
    },
  ],
  place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (items: CatalogueCard[], nextCursor: string | null = null) => ({
  place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
  items,
  nextCursor,
});
const calledUrl = (i = 0) => {
  const input = fetchMock.mock.calls[i]?.[0];
  return new URL(typeof input === 'string' ? input : 'http://missing.test/');
};

describe('catalogue API source (plan 2026-11-10 task 3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends locale, city RPR, q trimmed to 120 and limit 24', async () => {
    fetchMock.mockResolvedValue(json(page([card], 'next-1')));
    const result = await fetchCataloguePage({
      locale: 'hi',
      q: `  ${'x'.repeat(130)}  `,
      category: 'lubricants',
    });
    const url = calledUrl();
    expect(url.origin + url.pathname).toBe('http://api.test/v1/catalogue/products');
    expect(url.searchParams.get('locale')).toBe('hi');
    expect(url.searchParams.get('city')).toBe('RPR');
    expect(url.searchParams.get('q')).toBe('x'.repeat(120));
    expect(url.searchParams.get('category')).toBe('lubricants');
    expect(url.searchParams.get('limit')).toBe('24');
    expect(result.nextCursor).toBe('next-1');
    expect(result.items[0]?.slug).toBe(card.slug);
  });

  it('passes revalidate and the catalogue tag', async () => {
    fetchMock.mockResolvedValue(json(page([])));
    await fetchCataloguePage({ locale: 'en' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & {
      next?: { revalidate: number; tags: string[] };
    };
    expect(init.next).toEqual({ revalidate: 30, tags: ['catalogue'] });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockResolvedValue(json(product));
    await fetchCatalogueProduct(card.slug, 'en');
    const productInit = fetchMock.mock.calls[1]?.[1] as RequestInit & {
      next?: { revalidate: number; tags: string[] };
    };
    expect(productInit.next).toEqual({ revalidate: 60, tags: ['catalogue', `product:${card.slug}`] });
  });

  it('404 → null', async () => {
    fetchMock.mockResolvedValue(json({ code: 'NOT_FOUND' }, 404));
    expect(await fetchCatalogueProduct('gone', 'en')).toBeNull();
  });

  it('a slug the API would reject (capitals, underscores, too long) is a 404 without calling the API', async () => {
    for (const slug of ['Castrol-Activ', 'a_b', 'café', 'x'.repeat(121)])
      expect(await fetchCatalogueProduct(slug, 'en')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('500 → throws (ISR keeps the last good page)', async () => {
    fetchMock.mockResolvedValue(json({ code: 'INTERNAL' }, 500));
    await expect(fetchCataloguePage({ locale: 'en' })).rejects.toThrow(/500/);
  });

  it('timeout → throws', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(fetchCatalogueProduct('slow', 'en')).rejects.toThrow();
  });

  it('a malformed body → throws, never a half-rendered page', async () => {
    fetchMock.mockResolvedValue(json({ items: 'nope' }));
    await expect(fetchCataloguePage({ locale: 'en' })).rejects.toThrow();
  });

  it('422 INVALID_CURSOR → retries once without the cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ code: 'INVALID_CURSOR' }, 422))
      .mockResolvedValueOnce(json(page([card])));
    const result = await fetchCataloguePage({ locale: 'en', cursor: 'tampered' });
    expect(calledUrl(0).searchParams.get('cursor')).toBe('tampered');
    expect(calledUrl(1).searchParams.has('cursor')).toBe(false);
    expect(result.items).toHaveLength(1);
  });

  it('Load more (restartOnBadCursor: false) fails on 422 instead of appending page 1 again', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'INVALID_CURSOR' }, 422));
    await expect(
      fetchCataloguePage({ locale: 'en', cursor: 'stale', restartOnBadCursor: false }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('apiCard: offer null → price null, availability on_request; vehicle types from the API', () => {
    const view = apiCard({ ...card, offer: null });
    expect(view.price).toBeNull();
    expect(view.availability).toBe('on_request');
    expect(view.vehicleTypes).toEqual([]); // the card says "Fitment not listed"
    expect(apiCard({ ...card, vehicleTypes: ['2W', '3W'] }).vehicleTypes).toEqual(['2W', '3W']);
    expect(view.category).toEqual({ key: 'lubricants', slug: 'lubricants', name: 'Lubricants' });
    expect(apiCard(card).price).toEqual({ pricePaise: 44_000, mrpPaise: 47_500 });
    expect(apiCard(card).availability).toBe('in_stock');
  });

  it('apiProduct: seller and country of origin from the first variant with an offer; origin in Hindi', () => {
    const en = apiProduct(product, 'en');
    expect(en.seller).toBe('Sharma Auto Parts');
    expect(en.sku).toBe('CAS-0900-B');
    expect(en.leadDays).toBe(2);
    expect(en.shippingPaise).toBe(0);
    expect(en.countryOfOrigin).toBe('India');
    expect(apiProduct(product, 'hi').countryOfOrigin).toBe('भारत');
    expect(apiProduct({ ...product, countryOfOrigin: 'Atlantis' }, 'hi').countryOfOrigin).toBe('Atlantis');
  });
});
