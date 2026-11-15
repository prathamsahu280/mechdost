/**
 * Typed fixtures of the storefront audit rows (design 2026-11-15 items 1 and 5): the account wishlist (items with and
 * without a photo, empty, a failed load, a full list) and the admin catalogue list with the approval queue of shops'
 * photos (items, empty, and the "no access" answer that hides the card). One tiny PNG answers every
 * `/product-photos/*` request. Every body carries its shared schema.
 */
import { AdminProductList } from '@mechdost/shared/admin-catalogue';
import { PhotoQueueDto } from '@mechdost/shared/product-photos';
import { WishlistDto } from '@mechdost/shared/wishlist-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { auditProductName } from './audit-products.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imageMock: Mock = {
  method: 'GET',
  path: /^\/product-photos\//,
  reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
};
const long = (c: AuditCase) => c.state.stress === 'long-text';
const LONG =
  'Heavy-duty all-weather protective cover for two-wheelers with a reinforced stitched hem and a lock loop';
const LONG_HI = 'दोपहिया वाहनों के लिए मज़बूत सिलाई और ताला-लूप वाला भारी, हर मौसम का सुरक्षा कवर';

export function wishlistMocks(c: AuditCase): Mock[] {
  const state = c.state.list ?? 'items';
  const name = (i: number) =>
    long(c) ? (c.locale === 'hi' ? LONG_HI : LONG) : auditProductName(i, c.locale);
  const item = (i: number) => ({
    slug: `audit-product-${String(i)}`,
    name: name(i),
    brand: 'Castrol',
    photo: i % 2 === 0 ? { id: uuid(300 + i), alt: 'Front of the pack', width: 1200, height: 900 } : null,
    addedAt: '2026-11-15T09:00:00.000Z',
  });
  return [
    {
      method: 'GET',
      path: /^\/me\/wishlist$/,
      schema: WishlistDto,
      reply: (): Reply => {
        if (state === 'error') return { status: 500, code: 'INTERNAL' };
        const count = state === 'empty' ? 0 : state === 'full' ? 100 : 5;
        return {
          body: {
            items: Array.from({ length: count }, (_, i) => item(i)),
            max: 100,
            version: count,
          } satisfies Dto<typeof WishlistDto>,
        };
      },
    },
    imageMock,
  ];
}

export function photoQueueMocks(c: AuditCase): Mock[] {
  const state = c.state.queue ?? 'items';
  const product = (i: number) => ({
    slug: `audit-product-${String(i)}`,
    status: 'live',
    version: 1,
    brand: 'Castrol',
    category: 'Lubricants',
    // The catalogue editor lists `name` on every page: on /hi it must read in Hindi (hard rule 10, audit 2026-11-16).
    name: auditProductName(i, c.locale),
    nameHi: auditProductName(i, 'hi'),
    specSummary: null,
    specSummaryHi: null,
    compatibility: null,
    compatibilityHi: null,
    description: null,
    descriptionHi: null,
    highlights: [],
    highlightsHi: [],
    vehicleTypes: [],
    rejectionReason: null,
    missingHindi: [],
  });
  return [
    {
      method: 'GET',
      path: /^\/admin\/catalogue\/products$/,
      schema: AdminProductList,
      reply: (): Reply => ({
        body: { items: [product(0), product(1)], next: null } satisfies Dto<typeof AdminProductList>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/catalogue\/photo-queue$/,
      schema: PhotoQueueDto,
      reply: (): Reply => {
        if (state === 'forbidden') return { status: 403, code: 'FORBIDDEN' };
        return {
          body: {
            items:
              state === 'empty'
                ? []
                : Array.from({ length: 3 }, (_, i) => ({
                    photoId: uuid(400 + i),
                    productSlug: `audit-product-${String(i)}`,
                    productName: long(c)
                      ? c.locale === 'hi'
                        ? LONG_HI
                        : LONG
                      : auditProductName(i, c.locale),
                    alt: 'Front of the pack',
                    altHi: 'पैक का सामने का हिस्सा',
                    width: 1200,
                    height: 900,
                    lqip: null,
                    shopId: uuid(900),
                    shopName: c.locale === 'hi' ? 'शर्मा ऑटो पार्ट्स' : 'Sharma Auto Parts',
                    createdAt: '2026-11-15T09:00:00.000Z',
                    previewUrl: `/product-photos/${uuid(400 + i)}/640?e=9999999999&s=audit`,
                  })),
          } satisfies Dto<typeof PhotoQueueDto>,
        };
      },
    },
    imageMock,
  ];
}
