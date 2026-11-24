import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProductCard } from '@/components/catalogue/product-card';
import { ShopBrowser, type ServerListing } from '@/components/catalogue/shop-browser';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { CATEGORY_SLUGS, DEMO_PRODUCTS, type SortKey } from '@/demo/catalogue';
import type { Locale } from '@/i18n/routing';
import { fetchCataloguePage, fetchCatalogueCategories, fetchDidYouMean } from '@/lib/catalogue/api-source';
import { demoCard } from '@/lib/catalogue/demo-source';
import { resolveCategoryParam } from '@/lib/catalogue/shop-state';
import type { CardView } from '@/lib/catalogue/view';
import { DATA_MODE } from '@/lib/data-mode';
import { MAX_LIST_PAGES } from '@/lib/catalogue/load-more';
import { loadMoreCards, type ListingQuery } from './actions';
import { alternatesFor, openGraphFor } from '@/lib/seo';
import { site } from '@/lib/site';
import { localePath } from '@/lib/locale-path';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { RoadsideCard } from '@/components/roadside/roadside-promo';
import { publishedRoadside } from '@/lib/site-config-content';

type Search = Promise<{
  q?: string | string[];
  category?: string | string[];
  sort?: string | string[];
  vehicle?: string | string[];
  pages?: string | string[];
}>;

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Search;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SORTS: SortKey[] = ['popular', 'price_asc', 'price_desc'];

/**
 * The plain shop and each category are landing pages with their own canonical (`/shop?category=tyres`); sort,
 * vehicle and page parameters point back to that canonical, and a search result is `noindex, follow` (thin,
 * endless URL space).
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale }, sp] = await Promise.all([params, searchParams]);
  const [t, c, regions] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'categories' }),
    getTranslations({ locale, namespace: 'regions' }),
  ]);
  const region = regions(site.defaultRegion);
  const resolved = await resolveCategory(first(sp.category), locale);
  const category = resolved.category;
  const searched = Boolean(first(sp.q)?.trim());
  const label = resolved.sub?.name ?? (category ? c(category) : '');
  const href = category ? `/shop?category=${resolved.sub?.slug ?? CATEGORY_SLUGS[category]}` : '/shop';
  const title = category ? t('categoryTitle', { category: label, region }) : t('shopTitle', { region });
  const description = category
    ? t('categoryDescription', { category: label, region })
    : t('shopDescription', { region });
  return {
    title,
    description,
    alternates: alternatesFor(href, locale),
    openGraph: openGraphFor({ href, locale, title, description }),
    ...(searched ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * The `category` parameter: a top-level slug or (API mode) a sub-category slug such as the product breadcrumb's
 * (`car-engine-oil`), which filters to that sub-category and keeps its parent selected. Demo mode knows only the
 * nine top-level slugs.
 */
async function resolveCategory(slug: string | undefined, locale: Locale) {
  const top = resolveCategoryParam(slug, []);
  if (top.category || DATA_MODE !== 'api' || !slug) return top;
  try {
    return resolveCategoryParam(slug, await fetchCatalogueCategories(locale));
  } catch {
    return top; // the filter is dropped, the page still renders
  }
}

/**
 * Catalogue (spec 02). Demo mode: the server renders every product card once and the initial filters from the
 * URL (shareable links, SEO, works without JS); `ShopBrowser` then filters instantly in the browser.
 * API mode: the API filters, searches and pages; `?pages=N` (set by "Load more", at most 10) renders that many
 * pages, so Back from a product returns to the whole list at the same place (final review 2026-11-10).
 */
export default async function ShopPage({ searchParams }: Props) {
  const [t, footer, wa, locale] = await Promise.all([
    getTranslations('pages.shop'),
    getTranslations('footer'),
    getTranslations('whatsapp'),
    getLocale(),
  ]);
  const sp = await searchParams;
  const sortParam = first(sp.sort);
  const sort: SortKey = SORTS.find((s) => s === sortParam) ?? 'popular';
  const resolved = await resolveCategory(first(sp.category), locale);
  const initial = {
    query: first(sp.q)?.trim().slice(0, 120) ?? '',
    category: resolved.category,
    sub: resolved.sub,
    sort,
    vehicle: VEHICLE_TYPES.find((v) => v === first(sp.vehicle)),
  };
  let cards: Record<string, ReactNode>;
  let server: ServerListing | undefined;
  if (DATA_MODE === 'api') {
    // A failure throws to the shop's error boundary.
    const query: ListingQuery = {
      locale,
      q: initial.query,
      category: initial.sub?.slug ?? (initial.category ? CATEGORY_SLUGS[initial.category] : null),
      sort: sort === 'popular' ? null : sort,
      vehicle: initial.vehicle ?? null,
    };
    const pages = Math.min(MAX_LIST_PAGES, Math.max(1, Math.trunc(Number(first(sp.pages))) || 1));
    const items: CardView[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < pages; n++) {
      const page = await fetchCataloguePage({
        locale,
        q: query.q,
        category: query.category ?? undefined,
        sort: query.sort ?? undefined,
        vehicle: query.vehicle ?? undefined,
        cursor: cursor ?? undefined,
      });
      for (const item of page.items) if (!items.some((i) => i.slug === item.slug)) items.push(item);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    cards = Object.fromEntries(items.map((p) => [p.slug, <ProductCard key={p.slug} product={p} />]));
    const didYouMean = items.length === 0 && query.q ? await fetchDidYouMean(query.q, locale) : null;
    server = {
      query,
      pages,
      slugs: items.map((p) => p.slug),
      nextCursor: cursor,
      loadMore: loadMoreCards,
      didYouMean,
    };
  } else {
    cards = Object.fromEntries(
      DEMO_PRODUCTS.map((p) => [p.slug, <ProductCard key={p.slug} product={demoCard(p, locale)} />]),
    );
  }
  const c = await getTranslations('catalogue');
  const roadside = await publishedRoadside();

  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <ClientMessages namespaces={['catalogue', 'categories', 'product', 'pages']}>
        <ShopBrowser
          basePath={localePath('/shop', locale)}
          initial={initial}
          cards={cards}
          sourcingMessage={wa('sourcing')}
          whatsappNote={footer('whatsappNote')}
          server={server}
          roadside={
            roadside.enabled ? <RoadsideCard track="shop_search_roadside" title="shopCardTitle" /> : undefined
          }
        />
      </ClientMessages>
      <p className="mt-6 text-xs text-muted">{c('inclusive')}</p>
    </Container>
  );
}
