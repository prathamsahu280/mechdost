import { attributeDefs, readAttributes } from '@mechdost/shared/product-attributes';
import { CATEGORY_SLUGS, VEHICLE_TYPES_OF_FIT, type DemoProduct } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { DEMO_PRODUCT_SPECS } from '@/demo/product-specs';
import { productRating } from '@/demo/reviews';
import type { CardView, ProductView } from './view';

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
    vehicleTypes: VEHICLE_TYPES_OF_FIT[p.fits],
    price: { pricePaise: p.pricePaise, mrpPaise: p.mrpPaise ?? null },
    mrpFrom: null,
    pack: DEMO_PRODUCT_SPECS[raw.slug]?.netQuantity ?? null,
    availability: p.availability,
    leadDays: p.leadDays,
    highlights: p.highlights,
    rating: { avg: rating.rating, count: rating.count },
    popular: p.popular ?? false,
    photo: null,
  };
}

export function demoProduct(raw: DemoProduct, locale: string): ProductView {
  const slug = CATEGORY_SLUGS[raw.category];
  const attributeSet = attributeDefs(slug).length > 0 ? slug : null;
  return {
    ...demoCard(raw, locale),
    description: null,
    seller: null,
    countryOfOrigin: null,
    partNumbers: [],
    partReference: raw.sku,
    shippingPaise: null,
    attributeSet,
    attributes:
      attributeSet === null
        ? {}
        : readAttributes(attributeSet, DEMO_PRODUCT_SPECS[raw.slug]?.attributes ?? {}),
    warranty: null,
  };
}
