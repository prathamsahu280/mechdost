import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProductCard } from '@/components/catalogue/product-card';
import { ShopBrowser, type ServerListing } from '@/components/catalogue/shop-browser';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { CATEGORY_SLUGS, categoryFromSlug, DEMO_PRODUCTS, type SortKey } from '@/demo/catalogue';
import type { Locale } from '@/i18n/routing';
import { fetchCataloguePage } from '@/lib/catalogue/api-source';
import { demoCard } from '@/lib/catalogue/demo-source';
import type { CardView } from '@/lib/catalogue/view';
import { DATA_MODE } from '@/lib/data-mode';
import { loadMoreCards, type ListingQuery } from './actions';
import { alternatesFor } from '@/lib/seo';
import { localePath } from '@/lib/locale-path';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('shop'), alternates: alternatesFor('/shop', locale) };
}

/**
 * Catalogue (spec 02). Demo mode: the server renders every product card once and the initial filters from the
 * URL (shareable links, SEO, works without JS); `ShopBrowser` then filters instantly in the browser.
 * API mode: the API filters, searches and pages; `?pages=N` (set by "Load more", at most 10) renders that many
 * pages, so Back from a product returns to the whole list at the same place (final review 2026-11-10).
 */
const MAX_PAGES = 10;
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
  const initial = {
    query: first(sp.q)?.trim().slice(0, 120) ?? '',
    category: categoryFromSlug(first(sp.category)),
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
      category: initial.category ? CATEGORY_SLUGS[initial.category] : null,
      sort: sort === 'popular' ? null : sort,
      vehicle: initial.vehicle ?? null,
    };
    const pages = Math.min(MAX_PAGES, Math.max(1, Math.trunc(Number(first(sp.pages))) || 1));
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
    server = { query, pages, slugs: items.map((p) => p.slug), nextCursor: cursor, loadMore: loadMoreCards };
  } else {
    cards = Object.fromEntries(
      DEMO_PRODUCTS.map((p) => [p.slug, <ProductCard key={p.slug} product={demoCard(p, locale)} />]),
    );
  }
  const c = await getTranslations('catalogue');

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
        />
      </ClientMessages>
      <p className="mt-6 text-xs text-muted">{c('inclusive')}</p>
    </Container>
  );
}
