import { attributeDefs, readAttributes } from '@mechdost/shared/product-attributes';
import { DEFAULT_SEGMENT_TEXT } from '@mechdost/shared/vehicle-segments';
import {
  CATEGORY_SLUGS,
  demoSegmentsOf,
  VEHICLE_TYPES_OF_FIT,
  type DemoProduct,
  type DemoSize,
} from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { DEMO_PRODUCT_SPECS } from '@/demo/product-specs';
import { productRating } from '@/demo/reviews';
import type { CardView, ProductView } from './view';

const inStock = (s: DemoSize) => s.availability !== 'on_request';

/** The lowest price among the sizes that can be bought; null when none can. */
function lowestPrice(sizes: readonly DemoSize[]): number | null {
  const prices = sizes.filter(inStock).map((s) => s.pricePaise);
  return prices.length > 0 ? Math.min(...prices) : null;
}

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
    segments: demoSegmentsOf(raw).map((code) => ({
      code,
      name: locale === 'hi' ? DEFAULT_SEGMENT_TEXT[code].nameHi : DEFAULT_SEGMENT_TEXT[code].nameEn,
    })),
    price: { pricePaise: p.pricePaise, mrpPaise: p.mrpPaise ?? null },
    mrpFrom: null,
    pack: DEMO_PRODUCT_SPECS[raw.slug]?.netQuantity ?? null,
    availability: p.availability,
    sizes: p.sizes ? { count: p.sizes.length, fromPaise: lowestPrice(p.sizes) } : null,
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
    variants: (raw.sizes ?? [{ ...raw, label: '' }]).map((s) => ({
      sku: s.sku,
      label: s.label,
      pricePaise: s.pricePaise,
      mrpPaise: s.mrpPaise ?? null,
      priceOnRequest: false,
      inStock: s.availability !== 'on_request',
      leadDays: raw.leadDays,
      shippingPaise: null,
      pack: DEMO_PRODUCT_SPECS[raw.slug]?.netQuantity ?? null,
    })),
    defaultSku: raw.sku,
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
