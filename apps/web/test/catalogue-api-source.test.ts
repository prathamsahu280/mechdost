import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogueCard, CatalogueProduct } from '@mechdost/shared/catalogue';
import { mrpOnly } from '../src/lib/catalogue/mrp-only';
import { productLd } from '../src/lib/structured-data';
import {
  apiCard,
  apiProduct,
  fetchCatalogueCategories,
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
  segments: [],
  rating: null,
  mrpFromPaise: 47_500,
  mrpVaries: false,
  sizeCount: 1,
  matchedSizes: [],
  offer: {
    sku: 'CAS-0900-B',
    pricePaise: 44_000,
    mrpPaise: 47_500,
    netQuantity: null,
    shippingPaise: null,
    leadDays: null,
  },
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
    { sku: 'CAS-0900-A', label: '900 ml', options: {}, mrpPaise: 47_500, netQuantity: null, offer: null },
    {
      sku: 'CAS-0900-B',
      label: '900 ml',
      options: {},
      mrpPaise: 47_500,
      netQuantity: { qty: 900, unit: 'ml' },
      offer: {
        sku: 'CAS-0900-B',
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

  it('apiCard: the offered variant sku reaches the card so Add to cart works (real-API bug 2026-11-16)', () => {
    expect(apiCard(card).sku).toBe('CAS-0900-B');
    // No offer = on request: no sku, so the card cannot add to the cart.
    expect(apiCard({ ...card, offer: null }).sku).toBeNull();
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

  it('maps the offered pack and re-reads attributes defensively (design 2026-11-13)', () => {
    const c = apiCard({ ...card, offer: { ...card.offer!, netQuantity: { qty: 900, unit: 'ml' } } });
    expect(c.pack).toEqual({ qty: 900, unit: 'ml' });
    expect(apiCard({ ...card, offer: null }).pack).toBeNull();
    const p = apiProduct({ ...product, attributes: { saeGrade: '20W40', apiClass: 'XX' } }, 'en');
    expect(p.attributeSet).toBe('lubricants');
    expect(p.attributes).toEqual({ saeGrade: '20W40' });
    // The pack of the variant that is sold.
    expect(p.pack).toEqual({ qty: 900, unit: 'ml' });
  });
});

describe('Part reference (live audit 2026-11-22 item 11)', () => {
  const one = { sku: 'X-1-L', label: '1 L', options: {}, mrpPaise: 100, netQuantity: null, offer: null };
  const two = { ...one, sku: 'X-6-L' };

  it('is the SKU of a single-pack product', () => {
    expect(apiProduct({ ...product, variants: [one] }, 'en').partReference).toBe('X-1-L');
  });

  it('never names one pack size of a multi-pack product: a real part number, else nothing', () => {
    const multi = { ...product, variants: [one, two], partNumbers: [] };
    expect(apiProduct(multi, 'en').partReference).toBeNull();
    const numbered = { ...multi, partNumbers: [{ kind: 'mfr', value: '15B2F6' }] };
    expect(apiProduct(numbered, 'en').partReference).toBe('15B2F6');
    // The cart still gets the pack that is sold.
    expect(apiProduct(numbered, 'en').sku).toBe('X-1-L');
  });
});

describe('Categories for the shop filter', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test/');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads slug, parent and localised name from the categories endpoint', async () => {
    fetchMock.mockResolvedValue(
      json({
        categories: [
          {
            slug: 'car-engine-oil',
            parentSlug: 'lubricants',
            name: 'कार इंजन ऑयल',
            description: null,
            icon: null,
            liveProducts: 3,
          },
        ],
      }),
    );
    const rows = await fetchCatalogueCategories('hi');
    expect(calledUrl().pathname).toBe('/v1/catalogue/categories');
    expect(calledUrl().searchParams.get('locale')).toBe('hi');
    expect(rows[0]).toMatchObject({ slug: 'car-engine-oil', parentSlug: 'lubricants' });
  });

  it('throws on an API error (the shop then ignores the filter, never shows a wrong list)', async () => {
    fetchMock.mockResolvedValue(json({ code: 'INTERNAL' }, 500));
    await expect(fetchCatalogueCategories('en')).rejects.toThrow(/500/);
  });
});

describe('MRP without a shop offer (spec 02)', () => {
  const unsold: CatalogueCard = { ...card, offer: null };

  it('maps to an MRP-only view: no price, still on request, no sku', () => {
    const v = apiCard(unsold);
    expect(v).toMatchObject({ price: null, availability: 'on_request', sku: null });
    expect(v.mrpFrom).toEqual({ paise: 47_500, varies: false });
    expect(mrpOnly(v)).toEqual({ key: 'mrp', paise: 47_500 });
  });

  it('says "from" when packs differ, and nothing when there is no MRP or a price', () => {
    expect(mrpOnly(apiCard({ ...unsold, mrpVaries: true }))).toEqual({ key: 'mrpFrom', paise: 47_500 });
    expect(mrpOnly(apiCard({ ...unsold, mrpFromPaise: null }))).toBeNull();
    expect(mrpOnly(apiCard({ ...unsold, mrpFromPaise: 0 }))).toBeNull();
    expect(mrpOnly(apiCard(card))).toBeNull();
  });

  it('JSON-LD marks up the product but no offer for an MRP-only product', () => {
    const view = apiProduct({ ...product, variants: [] }, 'en');
    const ld = productLd(view, '/shop/x', null);
    expect(ld).toMatchObject({ '@type': 'Product', name: 'Castrol Activ 4T 20W40 900 ml' });
    expect(ld).not.toHaveProperty('offers');
  });
});

describe('Sizes as variants (user 2026-11-24)', () => {
  const size = (sku: string, label: string, mrpPaise: number | null, price: number | null) => ({
    sku,
    label,
    options: {},
    mrpPaise,
    netQuantity: null,
    offer:
      price === null
        ? null
        : {
            sku,
            pricePaise: price,
            mrpPaise: mrpPaise ?? price,
            netQuantity: null,
            shippingPaise: 0,
            leadDays: 2,
            seller: 'Sharma Auto Parts',
          },
  });
  const tyre = {
    ...product,
    sizeCount: 3,
    variants: [
      size('T-A', '145/70 R12 69T TL', 300_000, 280_000),
      size('T-B', '155/65 R13 73T TL', 350_000, 330_000),
      size('T-C', '165/80 R14 85T TL', null, null),
    ],
  };

  it('carries every size with its own price, stock and price-on-request state', () => {
    const v = apiProduct(tyre, 'en').variants;
    expect(v.map((x) => x.sku)).toEqual(['T-A', 'T-B', 'T-C']);
    expect(v[0]).toMatchObject({ label: '145/70 R12 69T TL', pricePaise: 280_000, inStock: true });
    expect(v[2]).toMatchObject({ pricePaise: null, mrpPaise: null, priceOnRequest: true, inStock: false });
  });

  it('opens on the lowest offered price and states it as the product price', () => {
    const rev = { ...tyre, variants: [tyre.variants[1], tyre.variants[0], tyre.variants[2]] } as typeof tyre;
    const view = apiProduct(rev, 'en');
    expect(view.defaultSku).toBe('T-A');
    expect(view.sku).toBe('T-A');
    expect(view.price?.pricePaise).toBe(280_000);
  });

  it('a size without an offer but with an MRP is unavailable, not price on request', () => {
    const v = apiProduct({ ...tyre, variants: [size('U-1', '1 L', 10_000, null)] }, 'en').variants[0];
    expect(v).toMatchObject({ inStock: false, priceOnRequest: false, mrpPaise: 10_000 });
  });

  it('cards say "from" with the size count only when there are several sizes', () => {
    const c = apiCard({ ...card, sizeCount: 3 });
    expect(c.sizes).toEqual({ count: 3, fromPaise: 44_000 });
    expect(apiCard(card).sizes).toBeNull();
    expect(apiCard({ ...card, sizeCount: 3, offer: null }).sizes).toEqual({ count: 3, fromPaise: null });
  });
});
