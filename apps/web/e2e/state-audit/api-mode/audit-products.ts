/**
 * The audit catalogue: one definition of the products the API-mode audit shows (wishlist, photo queue, and what the
 * Next server reads while rendering a product page), typed with the shared catalogue DTOs. Like real content data,
 * every text carries a Hindi version (hard rule 10): the API answers in the language the page asks for, so the
 * mocks do too. The brand (Castrol) stays in Latin script; the seller's name is transliterated.
 */
import type { CatalogueCard, CatalogueProduct } from '@mechdost/shared/catalogue';

export type AuditLocale = 'en' | 'hi';

export const AUDIT_BRAND = 'Castrol';
/** How many audit products exist: a full wishlist holds 100. */
export const AUDIT_PRODUCT_COUNT = 100;
const AUDIT_SLUG = /^audit-product-(\d+)$/;

export const auditSlug = (i: number): string => `audit-product-${String(i)}`;

/** The index in an audit slug, or null for a slug that is not an audit product. */
export function auditIndex(slug: string): number | null {
  const m = AUDIT_SLUG.exec(slug);
  const i = m ? Number(m[1]) : NaN;
  return Number.isInteger(i) && i >= 0 && i < AUDIT_PRODUCT_COUNT ? i : null;
}

export const auditProductName = (i: number, locale: AuditLocale): string =>
  locale === 'hi' ? `ऑडिट उत्पाद ${String(i + 1)}` : `Audit product ${String(i + 1)}`;

const COPY = {
  en: {
    category: 'Lubricants',
    spec: 'Fully synthetic · 900 ml',
    highlights: ['Smooth starts', 'Long drain interval'],
    description: 'A product made only for the audit.',
    compatibility: 'Fits most two-wheelers.',
    seller: 'Sharma Auto Parts',
  },
  hi: {
    category: 'लुब्रिकेंट',
    spec: 'पूरी तरह सिंथेटिक · 900 ml',
    highlights: ['आसान स्टार्ट', 'लंबा ड्रेन अंतराल'],
    description: 'सिर्फ़ ऑडिट के लिए बना उत्पाद।',
    compatibility: 'ज़्यादातर दोपहिया वाहनों में लगता है।',
    seller: 'शर्मा ऑटो पार्ट्स',
  },
} as const;

const offer = (i: number) => ({
  sku: `AUDIT-${String(i + 1)}`,
  pricePaise: 89_900 + i * 100,
  mrpPaise: 99_900 + i * 100,
  netQuantity: { qty: 900, unit: 'ml' as const },
  shippingPaise: 4_900,
  leadDays: 1,
});

export function auditCard(i: number, locale: AuditLocale): CatalogueCard {
  const t = COPY[locale];
  return {
    slug: auditSlug(i),
    name: auditProductName(i, locale),
    brand: { slug: 'castrol', name: AUDIT_BRAND },
    category: { slug: 'lubricants', name: t.category },
    mrpFromPaise: null,
    mrpVaries: false,
    sizeCount: 1,
    matchedSizes: [],
    specSummary: t.spec,
    highlights: [...t.highlights],
    vehicleTypes: ['2W'],
    segments: [{ code: 'two_wheeler', name: 'Two-wheeler' }],
    rating: null,
    offer: offer(i),
    photo: null,
  };
}

/** How many pictures audit product `i` has: none, one, two, then many (the product-page gallery rows pick by index). */
export const AUDIT_PHOTO_COUNTS = [0, 1, 2, 6] as const;

function auditPhotos(i: number, locale: AuditLocale): CatalogueProduct['photos'] {
  const count = AUDIT_PHOTO_COUNTS[i % AUDIT_PHOTO_COUNTS.length] ?? 0;
  const alt =
    locale === 'hi'
      ? 'ऑडिट उत्पाद की बहुत लंबे नाम वाली फ़ोटो जो कई पंक्तियों में लिपटती है'
      : 'Audit product photograph with a very long description that wraps over several lines';
  return Array.from({ length: count }, (_, n) => ({
    path: `audit-photo-${String(i)}-${String(n)}`,
    alt: `${alt} ${String(n + 1)}`,
    width: n % 2 === 0 ? 1200 : 900,
    height: 1200,
    lqip: null,
  }));
}

export function auditProduct(i: number, locale: AuditLocale): CatalogueProduct {
  const t = COPY[locale];
  return {
    slug: auditSlug(i),
    name: auditProductName(i, locale),
    brand: { slug: 'castrol', name: AUDIT_BRAND },
    category: { slug: 'lubricants', name: t.category },
    mrpFromPaise: null,
    mrpVaries: false,
    sizeCount: 1,
    specSummary: t.spec,
    highlights: [...t.highlights],
    vehicleTypes: ['2W'],
    segments: [{ code: 'two_wheeler', name: 'Two-wheeler' }],
    rating: null,
    description: t.description,
    compatibility: t.compatibility,
    spec: {},
    attributeSet: null,
    attributes: {},
    countryOfOrigin: 'India',
    warranty: null,
    gstRateBp: 1800,
    partNumbers: [],
    photos: auditPhotos(i, locale),
    variants: [
      {
        sku: `AUDIT-${String(i + 1)}`,
        label: '1 pack',
        options: {},
        mrpPaise: offer(i).mrpPaise,
        netQuantity: offer(i).netQuantity,
        offer: { ...offer(i), seller: t.seller },
      },
    ],
    place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
  };
}
