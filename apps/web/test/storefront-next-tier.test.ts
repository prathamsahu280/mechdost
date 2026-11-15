/**
 * Product photos, server cart and wishlist on the website (design 2026-11-15 items 1, 3, 5): the JS-budget guards
 * (the heart and the cart sync are reached only through lazy imports; header, layout and shop code do not import the
 * photo or wishlist screens), the loader that maps `next/image` widths onto the three stored variants, the account
 * section being real-sign-in only, and every new string existing in English and Hindi with the same placeholders.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { productPhotoLoader } from '../src/lib/product-photo-loader';
import { apiProduct } from '../src/lib/catalogue/api-source';
import type { CatalogueProduct } from '@mechdost/shared/catalogue';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('product photo loader', () => {
  it('serves the smallest stored variant that is wide enough, as a /v1 API path', () => {
    const id = '0190a2b3-0000-7000-8000-000000000001';
    const at = (width: number) => productPhotoLoader({ src: id, width });
    expect(at(256)).toMatch(new RegExp(`/v1/product-photos/${id}/320$`));
    expect(at(384)).toMatch(/\/640$/);
    expect(at(750)).toMatch(/\/1600$/);
    expect(at(3840)).toMatch(/\/1600$/);
  });

  it('the product view carries every approved photo and the cover is the first', () => {
    const photo = { path: 'p1', alt: 'Front', width: 1200, height: 900, lqip: null };
    const product = {
      slug: 's',
      name: 'N',
      brand: { slug: 'b', name: 'B' },
      category: { slug: 'c', name: 'C' },
      specSummary: null,
      highlights: [],
      vehicleTypes: [],
      rating: null,
      photo: null,
      description: null,
      compatibility: null,
      spec: {},
      attributeSet: null,
      attributes: {},
      countryOfOrigin: 'India',
      warranty: null,
      gstRateBp: 1800,
      partNumbers: [],
      photos: [photo, { ...photo, path: 'p2' }],
      variants: [],
    } as unknown as CatalogueProduct;
    const view = apiProduct(product, 'en');
    expect(view.photo?.path).toBe('p1');
    expect(view.photos?.map((p) => p.path)).toEqual(['p1', 'p2']);
  });
});

describe('JS budget guards', () => {
  it('the shop card and the product page reach the heart only through the lazy wrapper', () => {
    for (const file of [
      '../src/components/catalogue/product-card.tsx',
      '../src/app/[locale]/shop/[slug]/page.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain('wishlist-lazy');
      expect(src, file).not.toMatch(/from '[^']*wishlist-heart'|wishlist-store|wishlist-api/);
    }
    const wrapper = read('../src/components/catalogue/wishlist-lazy.tsx');
    expect(wrapper).toMatch(/import\('\.\/wishlist-heart'\)/);
    // the only static import of the real component is a type
    expect(wrapper).not.toMatch(/^import (?!type)[^;]*wishlist-heart/m);
    // the demo build drops the lazy import: it hangs on the build-time constant
    expect(wrapper).toContain("AUTH_MODE === 'firebase'");
  });

  it('the header, layout and cart page never import the photo, wishlist or sync code eagerly', () => {
    for (const file of [
      '../src/components/site/header.tsx',
      '../src/app/[locale]/layout.tsx',
      '../src/components/commerce/cart-view.tsx',
    ]) {
      expect(read(file), file).not.toMatch(
        /wishlist|product-photos-api|cart-sync|product-photo['"]|photo-queue/,
      );
    }
    const pill = read('../src/components/commerce/cart-pill.tsx');
    expect(pill).toMatch(/import\('@\/lib\/cart-sync'\)/);
    expect(pill).not.toMatch(/^import [^;]*cart-sync/m);
    expect(pill).toContain("AUTH_MODE !== 'firebase'");
  });

  it('the sign-in screen merges the guest cart through a dynamic import', () => {
    const src = read('../src/components/auth/login-flow.tsx');
    expect(src.match(/import\('@\/lib\/cart-sync'\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/^import [^;]*cart-sync/m);
  });

  it('the product photo is a server component with no client code', () => {
    const src = read('../src/components/catalogue/product-photo.tsx');
    expect(src).not.toMatch(/'use client'/);
    expect(src).toContain('getImageProps');
  });

  it('only the product page marks an image as priority (the first photo), never the card', () => {
    expect(read('../src/components/catalogue/product-card.tsx')).not.toMatch(/priority/);
    expect(read('../src/app/[locale]/shop/[slug]/page.tsx').match(/\bpriority\b/g)?.length).toBeGreaterThan(
      0,
    );
  });

  it('the cart sync never sends a price', () => {
    // Comments aside (they explain why prices are absent), the code never names a price.
    const src = read('../src/lib/cart-sync.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/price|paise/i);
  });
});

describe('strings', () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

  it('the storefront namespace is complete in Hindi with the same placeholders and Devanagari text', () => {
    const e = en.storefront as Record<string, string>;
    const h = hi.storefront as Record<string, string>;
    expect(keys(h)).toEqual(keys(e));
    for (const k of Object.keys(e)) {
      expect(placeholders(h[k] ?? ''), k).toEqual(placeholders(e[k] ?? ''));
      expect(h[k], k).toMatch(/[ऀ-ॿ]/);
    }
  });

  it('every error code a photo screen can show has a message', () => {
    const e = en.storefront as Record<string, string>;
    for (const code of [
      'PRODUCT_PHOTO_LIMIT',
      'PRODUCT_PHOTO_ALT',
      'PRODUCT_PHOTO_ORDER',
      'PRODUCT_PHOTO_NOT_PENDING',
      'PRODUCT_PHOTO_SHOP_UPLOADS_OFF',
      'PRODUCT_PHOTO_NOT_SOLD',
      'PHOTO_TYPE',
      'PHOTO_HEIC',
      'PHOTO_TOO_LARGE',
      'PHOTO_UNREADABLE',
      'PHOTOS_UNAVAILABLE',
    ])
      expect(e[`err_${code}`], code).toBeTruthy();
  });

  it('the wishlist account section and the setting label exist in both languages', () => {
    expect(en.account.nav_wishlist).toBeTruthy();
    expect(hi.account.nav_wishlist).toMatch(/[ऀ-ॿ]/);
    const e = en.portal as Record<string, string>;
    expect(e.api_set_catalogue_shop_photo_uploads).toBeTruthy();
    expect((hi.portal as Record<string, string>).api_set_catalogue_shop_photo_uploads).toMatch(/[ऀ-ॿ]/);
  });
});
