import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import robots from '../src/app/robots';
import { DEMO_PRODUCTS } from '../src/demo/catalogue';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';
import type { ProductView } from '../src/lib/catalogue/view';
import { absoluteUrl, metaDescription, siteOrigin } from '../src/lib/seo';
import { CATEGORY_PATHS, PRIVATE_PATHS, STATIC_PATHS, sitemapEntries } from '../src/lib/sitemap-entries';
import {
  breadcrumbLd,
  jsonLdText,
  organizationLd,
  productLd,
  rupeesText,
  workshopLd,
} from '../src/lib/structured-data';

const page = (path: string) => {
  const base =
    path === '/'
      ? ''
      : (path.split('?')[0] ?? '').replace(/^\/partners\/apply\/[a-z]+$/, '/partners/apply/[kind]');
  return new URL(`../src/app/[locale]${base}/page.tsx`, import.meta.url);
};

const product: ProductView = {
  slug: 'castrol-activ-4t-20w40-900ml',
  sku: 'CAS-ACT4T-0900',
  brand: 'Castrol',
  name: 'Activ 4T 20W40 900 ml',
  category: { key: 'lubricants', slug: 'lubricants', name: 'Lubricants' },
  spec: 'Engine oil for 2W · 20W40 · 900 ml',
  compatibility: null,
  vehicleTypes: ['2W'],
  price: { pricePaise: 44_005, mrpPaise: 47_500 },
  pack: null,
  availability: 'in_stock',
  leadDays: 1,
  highlights: [],
  rating: null,
  popular: false,
  photo: null,
  description: null,
  seller: 'Raipur Lubes',
  countryOfOrigin: null,
  partNumbers: [{ kind: 'mpn', value: 'ACT4T-900' }],
  shippingPaise: null,
  attributeSet: null,
  attributes: {},
  warranty: null,
};

describe('SEO helpers', () => {
  it('builds absolute URLs from the site origin, home as the bare origin', () => {
    expect(absoluteUrl('/')).toBe(siteOrigin());
    expect(absoluteUrl('/hi/shop')).toBe(`${siteOrigin()}/hi/shop`);
  });

  it('trims long descriptions at a word with an ellipsis', () => {
    const long = 'Engine oil '.repeat(30);
    const out = metaDescription(long);
    expect(out.length).toBeLessThanOrEqual(155);
    expect(out.endsWith('…')).toBe(true);
    expect(metaDescription('  short   text ')).toBe('short text');
  });

  it('prints rupees from integer paise without floating maths', () => {
    expect(rupeesText(44_005)).toBe('440.05');
    expect(rupeesText(100)).toBe('1.00');
    expect(rupeesText(7)).toBe('0.07');
  });

  it('escapes < so text cannot close the script tag', () => {
    expect(jsonLdText({ name: '</script><script>x' })).not.toContain('</script>');
  });
});

describe('structured data', () => {
  it('marks up a priced product with an INR offer and its part number', () => {
    const ld = productLd(product, '/shop/castrol-activ-4t-20w40-900ml', 'Lubricants');
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Castrol Activ 4T 20W40 900 ml',
      brand: { name: 'Castrol' },
      mpn: 'ACT4T-900',
      offers: { price: '440.05', priceCurrency: 'INR', availability: 'https://schema.org/InStock' },
    });
    expect(ld).not.toHaveProperty('aggregateRating');
  });

  it('adds the rating only when there are reviews', () => {
    const rated = productLd({ ...product, rating: { avg: 4.25, count: 12 } }, '/shop/x', null);
    expect(rated).toMatchObject({ aggregateRating: { ratingValue: '4.3', reviewCount: 12 } });
    const none = productLd({ ...product, rating: { avg: 0, count: 0 } }, '/shop/x', null);
    expect(none).not.toHaveProperty('aggregateRating');
  });

  it('leaves out a product Google would reject (on request, no rating)', () => {
    expect(productLd({ ...product, availability: 'on_request' }, '/shop/x', null)).toBeNull();
    expect(productLd({ ...product, price: null }, '/shop/x', null)).toBeNull();
  });

  it('marks up a workshop as AutoRepair with hours, price range and no phone number', () => {
    const ld = workshopLd(
      {
        id: 'w1',
        slug: 'sharma-motors',
        name: 'Sharma Motors',
        area: 'Shankar Nagar',
        address: 'Shankar Nagar, Raipur',
        pincode: '492007',
        lat: 21.25,
        lng: 81.65,
        distanceKm: 2,
        vehicleTypes: ['4W'],
        evBasic: false,
        pickup: true,
        hours: { open: '09:00', close: '19:00', days: [1, 2, 3, 4, 5, 6] },
        ratingAvg: null,
        ratingCount: 0,
        gstRegistered: true,
        home: null,
        services: [
          {
            key: 'general',
            title: 'General service',
            included: null,
            lowPaise: 99_900,
            highPaise: 249_900,
            minMinutes: 60,
            maxMinutes: 180,
            vehicleType: '4W',
            homeAvailable: false,
          },
        ],
      },
      '/workshops/sharma-motors',
    );
    expect(ld).toMatchObject({
      '@type': 'AutoRepair',
      address: { postalCode: '492007', addressCountry: 'IN' },
      priceRange: '₹999–₹2499',
      openingHoursSpecification: [
        { dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
      ],
    });
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(JSON.stringify(ld)).not.toContain('telephone');
  });

  it('numbers breadcrumb items from 1 with absolute URLs', () => {
    const ld = breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Shop', path: '/shop' },
    ]);
    expect(ld).toMatchObject({
      itemListElement: [
        { position: 1, item: siteOrigin() },
        { position: 2, item: `${siteOrigin()}/shop` },
      ],
    });
  });

  it('names the operator with the support line', () => {
    expect(organizationLd()).toMatchObject({
      name: 'MechDost',
      contactPoint: { telephone: '+917978776551' },
    });
  });
});

describe('sitemap and robots', () => {
  it('lists every public page and demo record in both languages with hreflang pairs', async () => {
    const entries = await sitemapEntries();
    const urls = new Set(entries.map((e) => e.url));
    for (const path of [...STATIC_PATHS, ...CATEGORY_PATHS]) {
      expect(urls.has(absoluteUrl(path))).toBe(true);
      expect(urls.has(absoluteUrl(path === '/' ? '/hi' : `/hi${path}`))).toBe(true);
    }
    for (const p of DEMO_PRODUCTS) expect(urls.has(absoluteUrl(`/hi/shop/${p.slug}`))).toBe(true);
    // Demo workshops are not real businesses: never listed.
    for (const w of DEMO_WORKSHOPS) expect(urls.has(absoluteUrl(`/workshops/${w.slug}`))).toBe(false);
    expect(urls.size).toBe(entries.length);
    const shop = entries.find((e) => e.url === absoluteUrl('/shop'));
    expect(shop?.alternates?.languages).toEqual({
      en: absoluteUrl('/shop'),
      hi: absoluteUrl('/hi/shop'),
      'x-default': absoluteUrl('/shop'),
    });
  });

  it('lists only pages that exist and are indexable', () => {
    for (const path of STATIC_PATHS) {
      const file = page(path);
      expect(existsSync(file), path).toBe(true);
      const source = readFileSync(file, 'utf8');
      expect(source, path).not.toMatch(/robots: \{ index: false(, follow: false)? \}/);
      expect(source, path).toContain('alternatesFor(');
    }
  });

  it('blocks private screens in both languages, never the public pages', () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallow = [rule?.disallow ?? []].flat();
    for (const p of PRIVATE_PATHS) {
      expect(disallow).toContain(p);
      expect(disallow).toContain(`/hi${p}`);
    }
    const blocked = (path: string) => disallow.some((d) => path.startsWith(d));
    for (const path of [...STATIC_PATHS, ...CATEGORY_PATHS, '/shop/x', '/workshops/x'])
      expect(blocked(path), path).toBe(false);
    expect(robots().sitemap).toBe(absoluteUrl('/sitemap.xml'));
  });

  it('every noindex page sits under a blocked path', () => {
    const noindex = [
      '/account',
      '/admin',
      '/cart',
      '/checkout',
      '/compare',
      '/login',
      '/notifications',
      '/orders/x',
      '/service/x',
      '/quotes/new',
      '/quotes/x',
      '/partner/shop',
      '/partner/workshop',
      '/partners/status',
      '/partners/invite/x',
      '/partners/applications/x',
    ];
    for (const path of noindex)
      expect(
        PRIVATE_PATHS.some((d) => path.startsWith(d)),
        path,
      ).toBe(true);
  });
});
