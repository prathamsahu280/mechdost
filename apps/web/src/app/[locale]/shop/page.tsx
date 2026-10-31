import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProductCard } from '@/components/catalogue/product-card';
import { ExternalButtonLink } from '@/components/ui/button-link';
import { LocalLink } from '@/components/ui/local-link';
import { Container, EmptyState, PageIntro } from '@/components/ui/page-intro';
import {
  CATEGORY_KEYS,
  CATEGORY_SLUGS,
  categoryFromSlug,
  searchProducts,
  type SortKey,
} from '@/demo/catalogue';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { whatsappLink } from '@/lib/site';

type Search = Promise<{ q?: string | string[]; category?: string | string[]; sort?: string | string[] }>;

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
 * Catalogue (spec 02) on demo data: GET-form search + category + sort, all in the URL (shareable, works without
 * JS, back button friendly). The catalogue API (Postgres FTS → Meilisearch) replaces `searchProducts`.
 */
export default async function ShopPage({ searchParams }: Props) {
  const [t, c, cat, footer, wa, locale, productT] = await Promise.all([
    getTranslations('pages.shop'),
    getTranslations('catalogue'),
    getTranslations('categories'),
    getTranslations('footer'),
    getTranslations('whatsapp'),
    getLocale(),
    getTranslations('product'),
  ]);
  const sp = await searchParams;
  const query = first(sp.q)?.trim().slice(0, 120) ?? '';
  const category = categoryFromSlug(first(sp.category));
  const sortParam = first(sp.sort);
  const sort: SortKey = SORTS.find((s) => s === sortParam) ?? 'popular';
  const products = searchProducts({ query, category, sort });
  const shopPath = getPathname({ href: '/shop', locale });

  const chip = (active: boolean) =>
    `press inline-flex min-h-10 items-center rounded-pill border px-4 text-[13px] font-bold whitespace-nowrap transition-colors duration-[var(--duration-base)] ${
      active
        ? 'border-accent-soft bg-accent-soft text-accent-soft-text'
        : 'border-line-card bg-surface text-ink hover:bg-pill'
    }`;

  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />

      <form
        role="search"
        action={shopPath}
        method="get"
        data-track-search="shop"
        className="mt-8 grid gap-3 rounded-card border border-line-card bg-surface p-4 shadow-card tab:grid-cols-[1fr_220px_200px_auto] tab:items-end"
      >
        <div>
          <label htmlFor="shop-q" className="text-xs font-bold text-muted">
            {c('searchLabel')}
          </label>
          <input
            id="shop-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={120}
            placeholder={c('searchPlaceholder')}
            className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted"
          />
        </div>
        <div>
          <label htmlFor="shop-category" className="text-xs font-bold text-muted">
            {c('categoryLabel')}
          </label>
          <select
            id="shop-category"
            name="category"
            defaultValue={category ? CATEGORY_SLUGS[category] : ''}
            className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
          >
            <option value="">{cat('all')}</option>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={CATEGORY_SLUGS[k]}>
                {cat(k)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shop-sort" className="text-xs font-bold text-muted">
            {c('sortLabel')}
          </label>
          <select
            id="shop-sort"
            name="sort"
            defaultValue={sort}
            className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink"
          >
            <option value="popular">{c('sortPopular')}</option>
            <option value="price_asc">{c('sortPriceAsc')}</option>
            <option value="price_desc">{c('sortPriceDesc')}</option>
          </select>
        </div>
        <button
          type="submit"
          className="press min-h-11 rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {c('searchSubmit')}
        </button>
      </form>

      <nav aria-label={c('categoryLabel')} className="-mx-[5%] mt-5 overflow-x-auto px-[5%] pb-2">
        <ul className="flex gap-2">
          <li>
            <LocalLink href="/shop" className={chip(!category)} aria-current={!category ? 'page' : undefined}>
              {cat('all')}
            </LocalLink>
          </li>
          {CATEGORY_KEYS.map((k) => (
            <li key={k}>
              <LocalLink
                href="/shop"
                query={{ category: CATEGORY_SLUGS[k] }}
                className={chip(category === k)}
                aria-current={category === k ? 'page' : undefined}
                data-track={`shop_category_${CATEGORY_SLUGS[k]}`}
              >
                {cat(k)}
              </LocalLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm font-bold text-ink">
          {query ? `${t('searchedFor', { query })} ` : ''}
          {c('results', { count: products.length })}
        </p>
        {query || category || sort !== 'popular' ? (
          <LocalLink
            href="/shop"
            className="text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            {c('clear')}
          </LocalLink>
        ) : null}
      </div>

      {products.length > 0 ? (
        <ul className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 tab:grid-cols-3 nav:grid-cols-4">
          {products.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState
            body={query ? productT('noMatch', { query }) : t('empty')}
            action={
              <ExternalButtonLink
                variant="whatsapp"
                href={whatsappLink(query ? `${wa('sourcing')} ${query}` : wa('sourcing'))}
                target="_blank"
                rel="noopener noreferrer"
                note={footer('whatsappNote')}
                data-track="shop_empty_whatsapp"
              >
                {t('emptyAction')}
              </ExternalButtonLink>
            }
          />
        </div>
      )}
      <p className="mt-6 text-xs text-muted">{c('inclusive')}</p>
    </Container>
  );
}
