import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ProductCard } from '@/components/catalogue/product-card';
import { ShopBrowser } from '@/components/catalogue/shop-browser';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { categoryFromSlug, DEMO_PRODUCTS, type SortKey } from '@/demo/catalogue';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

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
 * Catalogue (spec 02). The server renders every product card once and the initial filters from the URL
 * (shareable links, SEO, works without JS); `ShopBrowser` then filters instantly in the browser — no reload,
 * no scroll jump. With the catalogue API this becomes server pagination + `router.replace(…, { scroll: false })`.
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
  const initial = {
    query: first(sp.q)?.trim().slice(0, 120) ?? '',
    category: categoryFromSlug(first(sp.category)),
    sort,
  };
  const cards = Object.fromEntries(
    DEMO_PRODUCTS.map((p) => [p.slug, <ProductCard key={p.slug} product={p} />]),
  );
  const c = await getTranslations('catalogue');

  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <ClientMessages namespaces={['catalogue', 'categories', 'product', 'pages']}>
        <ShopBrowser
          basePath={getPathname({ href: '/shop', locale })}
          initial={initial}
          cards={cards}
          sourcingMessage={wa('sourcing')}
          whatsappNote={footer('whatsappNote')}
        />
      </ClientMessages>
      <p className="mt-6 text-xs text-muted">{c('inclusive')}</p>
    </Container>
  );
}
