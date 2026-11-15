import { describe, expect, it } from 'vitest';
import { CartMergeBody, CartLineQtyBody, CART_MAX_LINES } from '../src/cart-api';
import {
  PRODUCT_PHOTO_MAX,
  PRODUCT_PHOTO_WIDTHS,
  PhotoOrderBody,
  PhotoPatchBody,
  productPhotoPath,
  variantForWidth,
} from '../src/product-photos';
import { OPERATIONAL_SETTINGS } from '../src/settings';
import { PRODUCT_SLUG_RE, WISHLIST_MAX } from '../src/wishlist-api';

describe('product photo constants', () => {
  it('keep to eight photos and three widths, and pick the smallest variant that is wide enough', () => {
    expect(PRODUCT_PHOTO_MAX).toBe(8);
    expect(PRODUCT_PHOTO_WIDTHS).toEqual([320, 640, 1600]);
    expect([100, 320, 321, 640, 641, 1080, 1600, 3840].map(variantForWidth)).toEqual([
      320, 320, 640, 640, 1600, 1600, 1600, 1600,
    ]);
    expect(productPhotoPath('0190a2b3-0000-7000-8000-000000000001', 640)).toBe(
      '/product-photos/0190a2b3-0000-7000-8000-000000000001/640',
    );
  });

  it('require alt text in both languages and an order of at most eight ids', () => {
    const id = '0190a2b3-0000-7000-8000-000000000001';
    expect(PhotoPatchBody.safeParse({ version: 1, alt: 'Front', altHi: 'सामने' }).success).toBe(true);
    expect(PhotoPatchBody.safeParse({ version: 1, alt: 'Front' }).success).toBe(false);
    expect(PhotoPatchBody.safeParse({ version: 1, alt: 'ab', altHi: 'सामने' }).success).toBe(false);
    expect(PhotoPatchBody.safeParse({ version: 1, alt: 'Front', altHi: 'सामने', extra: 1 }).success).toBe(
      false,
    );
    expect(PhotoOrderBody.safeParse({ ids: Array.from({ length: 9 }, () => id) }).success).toBe(false);
    expect(PhotoOrderBody.safeParse({ ids: [id] }).success).toBe(true);
  });

  it('keeps shop uploads off by default', () => {
    expect(OPERATIONAL_SETTINGS['catalogue.shop_photo_uploads']).toMatchObject({
      kind: 'boolean',
      default: false,
      globalOnly: true,
    });
  });
});

describe('cart bodies', () => {
  it('a line holds a quantity of 1 to 99 and nothing else (no price, no extra field)', () => {
    expect(CartLineQtyBody.safeParse({ qty: 2 }).success).toBe(true);
    expect(CartLineQtyBody.safeParse({ qty: 99 }).success).toBe(true);
    expect(CartLineQtyBody.safeParse({ qty: 2, pricePaise: 1 }).success).toBe(false);
    expect(CartLineQtyBody.safeParse({ qty: 100 }).success).toBe(false);
    expect(CartLineQtyBody.safeParse({ qty: 0 }).success).toBe(false);
    expect(CartLineQtyBody.safeParse({ qty: 1.5 }).success).toBe(false);
  });

  it('the guest merge holds SKUs and quantities, at most 20 lines, never a price', () => {
    const ok = { lines: [{ sku: 'CAS-ACT4T-0900', qty: 2 }] };
    expect(CartMergeBody.safeParse(ok).success).toBe(true);
    expect(
      CartMergeBody.safeParse({ lines: [{ sku: 'CAS-ACT4T-0900', qty: 2, pricePaise: 1 }] }).success,
    ).toBe(false);
    const many = Array.from({ length: CART_MAX_LINES + 1 }, (_, i) => ({ sku: `SKU-${String(i)}X`, qty: 1 }));
    expect(CartMergeBody.safeParse({ lines: many }).success).toBe(false);
  });
});

describe('wishlist', () => {
  it('holds 100 products and accepts the catalogue’s slugs', () => {
    expect(WISHLIST_MAX).toBe(100);
    expect(PRODUCT_SLUG_RE.test('exide-xltz4a-2w-battery')).toBe(true);
    expect(PRODUCT_SLUG_RE.test('Bad_Slug')).toBe(false);
  });
});
