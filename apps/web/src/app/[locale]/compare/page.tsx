import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DifferencesToggle } from '@/components/catalogue/compare-islands';
import { CompareTable } from '@/components/catalogue/compare-table';
import { LocalLink } from '@/components/ui/local-link';
import { Container, EmptyState } from '@/components/ui/page-intro';
import { findProduct } from '@/demo/catalogue';
import type { Locale } from '@/i18n/routing';
import { fetchCatalogueProduct } from '@/lib/catalogue/api-source';
import { demoProduct } from '@/lib/catalogue/demo-source';
import type { ProductView } from '@/lib/catalogue/view';
import { buildCompareRows, parseCompareParam } from '@/lib/compare/rows';
import { DATA_MODE } from '@/lib/data-mode';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ p?: string | string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'compare' });
  // A list of products picked by one shopper: not a page for search engines.
  return { title: t('title'), robots: { index: false } };
}

async function load(slugs: readonly string[], locale: Locale): Promise<ProductView[]> {
  if (DATA_MODE === 'api') {
    const found = await Promise.all(slugs.map((s) => fetchCatalogueProduct(s, locale)));
    return found.filter((p): p is ProductView => p !== null);
  }
  return slugs.flatMap((s) => {
    const p = findProduct(s);
    return p ? [demoProduct(p, locale)] : [];
  });
}

/**
 * Product comparison (design `docs/superpowers/specs/2026-11-13-product-comparison-design.md`, spec 21): up to 4
 * products of one category from `?p=a,b,c`, side by side. The link is the list, so it can be shared. Unknown or
 * extra slugs and other categories are left out with a note. Client islands get their labels as props, so this
 * page needs no `ClientMessages`.
 */
export default async function ComparePage({ params, searchParams }: Props) {
  const [{ locale }, { p }] = await Promise.all([params, searchParams]);
  const [t, c] = await Promise.all([getTranslations('compare'), getTranslations('categories')]);
  const prefix = locale === 'hi' ? '/hi' : '';
  const requested = parseCompareParam(p);
  const loaded = await load(requested, locale);
  const category = loaded[0]?.category ?? null;
  const items = loaded.filter((x) => x.category.slug === category?.slug);
  const leftOut =
    (typeof p === 'string' ? p.split(',').filter((s) => s.trim() !== '').length : 0) > items.length;
  const categoryName = category ? (category.name ?? (category.key ? c(category.key) : category.slug)) : '';

  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] text-muted">{t('intro')}</p>
      {leftOut && items.length > 0 ? (
        <p role="note" className="mt-4 max-w-2xl rounded-tile bg-warning-bg px-4 py-3 text-sm text-ink">
          {t('leftOut')}
        </p>
      ) : null}
      <div className="mt-6">
        {items.length < 2 ? (
          <EmptyState
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              <LocalLink
                href={category ? `/shop?category=${category.slug}` : '/shop'}
                className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
              >
                {t('emptyAction')}
              </LocalLink>
            }
          />
        ) : (
          <DifferencesToggle
            label={t('onlyDifferences')}
            count={items.length}
            category={category?.slug ?? null}
          >
            <CompareTable
              items={items}
              groups={buildCompareRows(items)}
              caption={t('caption', { category: categoryName, count: items.length })}
              prefix={prefix}
            />
          </DifferencesToggle>
        )}
      </div>
    </Container>
  );
}
