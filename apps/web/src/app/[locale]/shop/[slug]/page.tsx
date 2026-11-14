import { CheckCircle2, Clock, MessageCircle, ShieldCheck, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { AddToCartButton } from '@/components/catalogue/add-to-cart-button';
import { CompareToggle } from '@/components/catalogue/compare-toggle';
import { UnitPrice } from '@/components/catalogue/unit-price';
import { availabilityLabel, ProductCard } from '@/components/catalogue/product-card';
import { ProductVisual } from '@/components/catalogue/product-visual';
import { ReviewsSection } from '@/components/reviews/reviews-section';
import { StarRating } from '@/components/reviews/star-rating';
import { SettingValue } from '@/components/site/site-overrides';
import { LocalLink } from '@/components/ui/local-link';
import { Container } from '@/components/ui/page-intro';
import { DEMO_PRODUCTS, findProduct } from '@/demo/catalogue';
import { productRating, productReviews, type RatingSummary, type SeedReview } from '@/demo/reviews';
import { routing, type Locale } from '@/i18n/routing';
import { fetchCatalogueProduct, fetchCataloguePage } from '@/lib/catalogue/api-source';
import { demoCard, demoProduct } from '@/lib/catalogue/demo-source';
import type { CardView, ProductView } from '@/lib/catalogue/view';
import { DATA_MODE, QUOTES_AVAILABLE } from '@/lib/data-mode';
import { discountPercent, formatPrice } from '@/lib/format';
import { alternatesFor } from '@/lib/seo';
import { whatsappLink } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
}

/** API mode prerenders nothing at build (no build-time API dependency); pages render on first visit and are
 * kept for 60 s by the fetch cache (ISR). Demo mode prerenders every demo product. */
export function generateStaticParams() {
  if (DATA_MODE === 'api') return [];
  return routing.locales.flatMap((locale) => DEMO_PRODUCTS.map((p) => ({ locale, slug: p.slug })));
}

interface Loaded {
  product: ProductView;
  related: CardView[];
  /** Demo data only, until the reviews API. */
  reviews: { summary: RatingSummary; list: SeedReview[] } | null;
}

/** The product, its related products and its reviews; `null` → 404. Cached per request (metadata + page). */
const load = cache(async (slug: string, locale: Locale): Promise<Loaded | null> => {
  if (DATA_MODE === 'api') {
    const product = await fetchCatalogueProduct(slug, locale);
    if (!product) return null;
    const page = await fetchCataloguePage({ locale, category: product.category.slug, limit: 5 });
    return {
      product,
      related: page.items.filter((p) => p.slug !== slug).slice(0, 4),
      reviews: null,
    };
  }
  const found = findProduct(slug);
  if (!found) return null;
  return {
    product: demoProduct(found, locale),
    related: DEMO_PRODUCTS.filter((p) => p.category === found.category && p.slug !== slug)
      .slice(0, 4)
      .map((p) => demoCard(p, locale)),
    reviews: { summary: productRating(found), list: productReviews(found) },
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await load(slug, locale);
  if (!data) return {};
  const { product } = data;
  return {
    title: `${product.brand} ${product.name}`,
    description: [product.spec, product.compatibility].filter(Boolean).join('. '),
    alternates: alternatesFor(`/shop/${slug}`, locale),
  };
}

/**
 * Product detail (spec 02): artwork, price + MRP, availability, delivery estimate, highlights, specs, related.
 * a11y review 2026-11-10: unknown facts are left out (no blank rows, no "0 stars", no empty headings); a product
 * with no price offers one next step, "Ask about this product" on WhatsApp, instead of add to cart.
 */
export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  const data = await load(slug, locale);
  if (!data) notFound();
  const { product, related, reviews } = data;

  const [t, c, r, footer, cmp] = await Promise.all([
    getTranslations('catalogue'),
    getTranslations('categories'),
    getTranslations('reviews'),
    getTranslations('footer'),
    getTranslations('compare'),
  ]);
  const categoryName = product.category.name ?? (product.category.key ? c(product.category.key) : null);
  // The star row links to the reviews section, so it shows only when that section does.
  const rating = reviews && product.rating && product.rating.count > 0 ? product.rating : null;
  const price = product.price;
  const off = price ? discountPercent(price.pricePaise, price.mrpPaise ?? undefined) : 0;
  const onRequest = product.availability === 'on_request';
  const rows = productRows(t, product);

  return (
    <Container className="py-8 tab:py-12">
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <LocalLink href="/shop" className="font-bold text-ink hover:underline">
              {t('back')}
            </LocalLink>
          </li>
          {categoryName ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <LocalLink
                  href="/shop"
                  query={{ category: product.category.slug }}
                  className="hover:underline"
                >
                  {categoryName}
                </LocalLink>
              </li>
            </>
          ) : null}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 tab:grid-cols-2 nav:gap-14">
        <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} size="hero" />

        <div>
          <p className="text-xs text-muted">
            <span className="font-bold uppercase">{product.brand}</span>
            {categoryName ? ` · ${categoryName}` : null}
          </p>
          <h1 className="mt-2 font-heading text-[clamp(28px,3vw,40px)] leading-tight font-extrabold tracking-[-0.02em] text-ink">
            {product.name}
          </h1>
          {product.spec ? <p className="mt-2 text-[15px] text-muted">{product.spec}</p> : null}
          {rating ? (
            <a
              href={`#reviews-${product.slug}`}
              className="mt-3 inline-flex min-h-6 items-center gap-2 text-sm"
            >
              <StarRating
                rating={rating.avg}
                size="md"
                label={r('ratedBy', { rating: rating.avg.toFixed(1), count: rating.count })}
              />
              <span aria-hidden="true" className="font-bold text-ink">
                {rating.avg.toFixed(1)}
              </span>
              <span className="text-muted underline-offset-4 hover:underline">
                {r('count', { count: rating.count })}
              </span>
            </a>
          ) : null}

          {price ? (
            <>
              <div className="mt-5 flex flex-wrap items-baseline gap-3">
                <span className="font-heading text-[34px] font-extrabold text-ink">
                  {formatPrice(price.pricePaise)}
                </span>
                {price.mrpPaise && off ? (
                  <>
                    <span className="text-sm text-muted line-through">
                      {t('mrp', { price: formatPrice(price.mrpPaise) })}
                    </span>
                    <span className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-bold text-success">
                      {t('save', { percent: off })}
                    </span>
                  </>
                ) : null}
              </div>
              <UnitPrice pricePaise={price.pricePaise} pack={product.pack} className="mt-1 text-sm" />
              <p className="mt-1 text-xs text-muted">{t('inclusive')}</p>
            </>
          ) : null}

          <ul className="mt-5 space-y-2 text-sm">
            <li
              className={`flex items-center gap-2 font-bold ${onRequest ? 'text-warning' : 'text-success'}`}
            >
              {onRequest ? (
                <Clock aria-hidden="true" className="size-4" />
              ) : (
                <CheckCircle2 aria-hidden="true" className="size-4" />
              )}
              {availabilityLabel(t, product.availability)}
            </li>
            {product.leadDays !== null ? (
              <li className="flex items-center gap-2 text-ink">
                <Truck aria-hidden="true" className="size-4 text-muted" />
                {t('delivery', { days: product.leadDays })}
              </li>
            ) : null}
            <li className="flex items-center gap-2 text-ink">
              <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
              {t('fitNote')}
            </li>
          </ul>

          {/* Compare beside the main action (UI review 2026-11-14: it sat below the fold on phones). */}
          <div className="mt-6 flex max-w-md items-start gap-2">
            <div className="min-w-0 flex-1">
              {price ? (
                <AddToCartButton
                  sku={product.sku}
                  slug={product.slug}
                  labels={{
                    add: t('addToCart'),
                    added: t('added'),
                    maxQty: t('maxQty'),
                    maxLines: t('maxLines'),
                    saveFailed: t('saveFailed'),
                    increase: t('cartIncrease', { name: `${product.brand} ${product.name}` }),
                    decrease: t('cartDecrease', { name: `${product.brand} ${product.name}` }),
                    remove: t('cartRemove', { name: `${product.brand} ${product.name}` }),
                    inCart: t('inCart', { count: '#' }),
                  }}
                  className="min-h-12"
                />
              ) : (
                <a
                  href={whatsappLink(t('askAboutMessage', { product: `${product.brand} ${product.name}` }))}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track="product_ask_whatsapp"
                  className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-button bg-whatsapp px-5 text-sm font-bold text-white"
                >
                  <MessageCircle aria-hidden="true" className="size-4" />
                  {t('askAboutProduct')}
                  <span className="sr-only"> ({footer('whatsappNote')})</span>
                </a>
              )}
            </div>
            <CompareToggle
              slug={product.slug}
              category={product.category.slug}
              labels={{
                toggle: cmp('toggle'),
                toggleName: cmp('toggleName', { name: `${product.brand} ${product.name}` }),
                added: cmp('added', { count: '{count}' }),
                removed: cmp('removed'),
                full: cmp('full'),
                otherCategory: cmp('otherCategory'),
                startNew: cmp('startNew'),
                saveFailed: t('saveFailed'),
              }}
              className="shrink-0"
            />
          </div>
          <div className="max-w-md">
            {QUOTES_AVAILABLE ? (
              <p className="mt-3 text-sm text-muted">
                <LocalLink
                  href="/quotes/new"
                  query={{ product: product.slug }}
                  data-track="product_bulk_quote"
                  className="font-bold text-accent-soft-text underline-offset-4 hover:underline"
                >
                  {t.rich('bulkHint', {
                    min: (chunks) => <SettingValue setting="bulkMinUnits" fallback={chunks} />,
                  })}
                </LocalLink>
              </p>
            ) : null}
            <p className="mt-2 text-sm text-muted">
              <span aria-hidden="true">🚫 </span>
              {t('policyNote')}{' '}
              <LocalLink
                href="/policies/returns"
                data-track="product_returns_policy"
                className="font-bold text-ink underline underline-offset-2"
              >
                {t('policyLink')}
              </LocalLink>
            </p>
          </div>

          {product.highlights.length > 0 ? (
            <div className="mt-8">
              <h2 id="highlights" className="font-heading text-lg font-bold text-ink">
                {t('highlights')}
              </h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
                {product.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <dl className="mt-6 divide-y divide-line rounded-tile border border-line-card bg-surface text-sm">
              {rows.map((row) => (
                <div key={row.key} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-3">
                  <dt className="font-bold text-ink">{row.term}</dt>
                  <dd className="text-muted">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      {reviews ? (
        <ReviewsSection
          target="product"
          slug={product.slug}
          summary={reviews.summary}
          reviews={reviews.list}
        />
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related" className="mt-14">
          <h2 id="related" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {categoryName ? t('related', { category: categoryName }) : t('relatedAny')}
          </h2>
          <ul className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
            {related.map((p) => (
              <li key={p.slug}>
                <ProductCard product={p} scope="related" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}

/** Specification table rows; empty facts are dropped (no blank definitions). */
function productRows(
  t: (key: 'specification' | 'compatibility' | 'sku' | 'soldBy' | 'origin') => string,
  p: ProductView,
): { key: string; term: string; value: string }[] {
  return [
    { key: 'spec', term: t('specification'), value: p.spec },
    { key: 'compat', term: t('compatibility'), value: p.compatibility },
    { key: 'sku', term: t('sku'), value: p.sku },
    { key: 'seller', term: t('soldBy'), value: p.seller },
    { key: 'origin', term: t('origin'), value: p.countryOfOrigin },
  ].filter((row): row is { key: string; term: string; value: string } => Boolean(row.value));
}
