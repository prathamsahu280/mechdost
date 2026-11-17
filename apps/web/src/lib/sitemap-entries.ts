import type { MetadataRoute } from 'next';
import { CATEGORY_KEYS, CATEGORY_SLUGS, DEMO_PRODUCTS } from '@/demo/catalogue';
import { routing } from '@/i18n/routing';
import { fetchCataloguePage } from './catalogue/api-source';
import { DATA_MODE } from './data-mode';
import { localePath } from './locale-path';
import { absoluteUrl } from './seo';
import { fetchCityWorkshops } from './workshops-api-source';

/**
 * What `sitemap.xml` lists (decisions 2026-11-17 "SEO"): every public page that has a canonical tag, in both
 * languages, each with its hreflang pair. Private screens (account, cart, checkout, orders, portals, admin, sign-in,
 * compare, record pages) are `noindex` and blocked in robots.txt, so they are never listed.
 */
export const STATIC_PATHS: readonly string[] = [
  '/',
  '/shop',
  '/workshops',
  '/offers',
  '/partners',
  '/partners/apply/seller',
  '/partners/apply/garage',
  '/partners/apply/mechanic',
  '/support/guest',
  '/policies/company',
  '/policies/delivery',
  '/policies/privacy',
  '/policies/returns',
  '/policies/service-terms',
  '/terms',
];

/**
 * Private screens: signed-in areas, portals, admin, cart and checkout, record pages reached by code or token. They
 * are also `noindex`; blocking them saves crawl budget and keeps codes out of search. Product images, scripts and
 * styles stay crawlable (concept bug: its robots.txt blocked product images).
 */
export const PRIVATE_PATHS: readonly string[] = [
  '/account',
  '/admin',
  '/partner/',
  '/partners/status',
  '/partners/invite/',
  '/partners/applications/',
  '/cart',
  '/checkout',
  '/compare',
  '/login',
  '/notifications',
  '/orders/',
  '/quotes/',
  '/service/',
];

/** Category landing pages: the shop filtered by one category is its own canonical page (`/shop?category=…`). */
export const CATEGORY_PATHS: readonly string[] = CATEGORY_KEYS.map(
  (k) => `/shop?category=${CATEGORY_SLUGS[k]}`,
);

/** Products in the sitemap at most (48 per catalogue page); raise it with a sitemap index when the catalogue grows. */
const MAX_PRODUCT_PAGES = 40;

/** Product slugs of the active data source. API failures leave the list short (the static pages still ship). */
async function productSlugs(): Promise<string[]> {
  if (DATA_MODE !== 'api') return DEMO_PRODUCTS.map((p) => p.slug);
  const slugs: string[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
      const res = await fetchCataloguePage({
        locale: 'en',
        limit: 48,
        sort: 'newest',
        cursor,
        restartOnBadCursor: false,
      });
      slugs.push(...res.items.map((c) => c.slug));
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
  } catch {
    // The API is down or unreachable (e.g. at build time): list what was read.
  }
  return slugs;
}

/** Real workshops only: the demo build's workshops are not real businesses, so they are `noindex` and not listed. */
async function workshopSlugs(): Promise<string[]> {
  if (DATA_MODE !== 'api') return [];
  return ((await fetchCityWorkshops('en')) ?? []).map((w) => w.slug);
}

/** One `<url>` per language, each with the full hreflang set (Google's recommended sitemap form). */
export function entriesFor(
  path: string,
  extra: Pick<MetadataRoute.Sitemap[number], 'changeFrequency' | 'priority'> = {},
): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = absoluteUrl(localePath(path, l));
  languages['x-default'] = absoluteUrl(localePath(path, routing.defaultLocale));
  return routing.locales.map((l) => ({
    url: absoluteUrl(localePath(path, l)),
    alternates: { languages },
    ...extra,
  }));
}

export async function sitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const [products, workshops] = await Promise.all([productSlugs(), workshopSlugs()]);
  return [
    ...entriesFor('/', { changeFrequency: 'daily', priority: 1 }),
    ...STATIC_PATHS.filter((p) => p !== '/').flatMap((p) =>
      entriesFor(p, {
        changeFrequency: p.startsWith('/policies') || p === '/terms' ? 'yearly' : 'weekly',
        priority: 0.5,
      }),
    ),
    ...CATEGORY_PATHS.flatMap((p) => entriesFor(p, { changeFrequency: 'daily', priority: 0.8 })),
    ...[...new Set(products)].flatMap((slug) =>
      entriesFor(`/shop/${slug}`, { changeFrequency: 'daily', priority: 0.7 }),
    ),
    ...[...new Set(workshops)].flatMap((slug) =>
      entriesFor(`/workshops/${slug}`, { changeFrequency: 'weekly', priority: 0.7 }),
    ),
  ];
}
