import { CATEGORY_SLUGS, type DemoProduct } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { productRating } from '@/demo/reviews';
import type { CardView, ProductView } from './view';

const FIT_LABEL: Record<DemoProduct['fits'], string> = {
  '2W': '2W',
  '4W': '4W',
  '2W/4W': '2W · 4W',
  EV: 'EV',
};

/** A demo product as a card (data mode `demo`), localised like the rest of the demo screens. */
export function demoCard(raw: DemoProduct, locale: string): CardView {
  const p = localizeProduct(raw, locale);
  const rating = productRating(raw);
  return {
    slug: p.slug,
    sku: p.sku,
    brand: p.brand,
    name: p.name,
    category: { key: p.category, slug: CATEGORY_SLUGS[p.category], name: null },
    spec: p.spec,
    compatibility: p.compatibility,
    fit: FIT_LABEL[p.fits],
    price: { pricePaise: p.pricePaise, mrpPaise: p.mrpPaise ?? null },
    availability: p.availability,
    leadDays: p.leadDays,
    highlights: p.highlights,
    rating: { avg: rating.rating, count: rating.count },
    popular: p.popular ?? false,
    photo: null,
  };
}

export function demoProduct(raw: DemoProduct, locale: string): ProductView {
  return {
    ...demoCard(raw, locale),
    description: null,
    seller: null,
    countryOfOrigin: null,
    partNumbers: [],
    shippingPaise: null,
  };
}
