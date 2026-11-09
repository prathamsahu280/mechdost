import { describe, expect, it } from 'vitest';
import { CatalogueCardSchema, CataloguePageSchema, CatalogueProductSchema } from '../src/catalogue';

const card = {
  slug: 'castrol-activ-4t-20w40-900ml',
  name: 'Activ 4T 20W40 900 ml',
  brand: { slug: 'castrol', name: 'Castrol' },
  category: { slug: 'lubricants', name: 'Lubricants' },
  specSummary: 'Engine oil for 2W · 20W40 · 900 ml',
  highlights: ['API SL'],
  rating: null,
  offer: { pricePaise: 44_000, mrpPaise: 47_500, shippingPaise: null, leadDays: null },
  photo: null,
};

describe('catalogue DTOs (spec 02, shared by API and web)', () => {
  it('parse a real API page and reject a card without slug', () => {
    const page = CataloguePageSchema.parse({
      place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
      items: [card, { ...card, slug: 'exide-xltz4a', offer: null }],
      nextCursor: null,
    });
    expect(page.items.map((i) => i.offer?.pricePaise ?? null)).toEqual([44_000, null]);
    expect(() => CatalogueCardSchema.parse({ ...card, slug: undefined })).toThrow();
  });

  it('parse a product with a seller on its variant offer', () => {
    const product = CatalogueProductSchema.parse({
      ...card,
      description: null,
      compatibility: null,
      spec: { viscosity: '20W40' },
      countryOfOrigin: 'IN',
      warranty: null,
      gstRateBp: 1800,
      partNumbers: [],
      photos: [],
      variants: [
        {
          sku: 'CAS-ACT4T-0900',
          options: {},
          mrpPaise: 47_500,
          offer: {
            pricePaise: 44_000,
            mrpPaise: 47_500,
            shippingPaise: 0,
            leadDays: 1,
            seller: 'Sharma Auto Parts',
          },
        },
      ],
      place: { cityCode: 'RPR', pincode: '492001', pincodeKnown: true },
    });
    expect(product.variants[0]?.offer?.seller).toBe('Sharma Auto Parts');
  });
});
