import { Ban, CheckCircle2, ShieldCheck, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AddToCartButton } from '@/components/catalogue/add-to-cart-button';
import { ProductCard } from '@/components/catalogue/product-card';
import { ProductVisual } from '@/components/catalogue/product-visual';
import { ReviewsSection } from '@/components/reviews/reviews-section';
import { StarRating } from '@/components/reviews/star-rating';
import { SettingValue } from '@/components/site/site-overrides';
import { LocalLink } from '@/components/ui/local-link';
import { Container } from '@/components/ui/page-intro';
import { CATEGORY_SLUGS, DEMO_PRODUCTS, findProduct } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { productRating, productReviews } from '@/demo/reviews';
import { routing, type Locale } from '@/i18n/routing';
import { discountPercent, formatPrice } from '@/lib/format';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => DEMO_PRODUCTS.map((p) => ({ locale, slug: p.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const found = findProduct(slug);
  if (!found) return {};
  const product = localizeProduct(found, locale);
  return {
    title: `${product.brand} ${product.name}`,
    description: `${product.spec}. ${product.compatibility}.`,
    alternates: alternatesFor(`/shop/${slug}`, locale),
  };
}

/** Product detail (spec 02): artwork, price + MRP, availability, delivery estimate, highlights, specs, related. */
export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  const found = findProduct(slug);
  if (!found) notFound();
  const product = localizeProduct(found, locale);

  const [t, c, r] = await Promise.all([
    getTranslations('catalogue'),
    getTranslations('categories'),
    getTranslations('reviews'),
  ]);
  const rating = productRating(product);
  const off = discountPercent(product.pricePaise, product.mrpPaise);
  const related = DEMO_PRODUCTS.filter(
    (p) => p.category === product.category && p.slug !== product.slug,
  ).slice(0, 4);
  const availability =
    product.availability === 'in_stock'
      ? t('inStock')
      : product.availability === 'low_stock'
        ? t('lowStock')
        : t('onRequest');

  return (
    <Container className="py-8 tab:py-12">
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <LocalLink href="/shop" className="font-bold text-ink hover:underline">
              {t('back')}
            </LocalLink>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <LocalLink
              href="/shop"
              query={{ category: CATEGORY_SLUGS[product.category] }}
              className="hover:underline"
            >
              {c(product.category)}
            </LocalLink>
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 tab:grid-cols-2 nav:gap-14">
        <figure>
          <ProductVisual slug={product.slug} category={product.category} brand={product.brand} size="hero" />
          <figcaption className="mt-2 text-xs text-muted">{t('photoNote')}</figcaption>
        </figure>

        <div>
          <p className="text-xs text-muted">
            <span className="font-bold uppercase">{product.brand}</span> · {c(product.category)}
          </p>
          <h1 className="mt-2 font-heading text-[clamp(28px,3vw,40px)] leading-tight font-extrabold tracking-[-0.02em] text-ink">
            {product.name}
          </h1>
          <p className="mt-2 text-[15px] text-muted">{product.spec}</p>
          <a
            href={`#reviews-${product.slug}`}
            className="mt-3 inline-flex min-h-7 items-center gap-2 text-sm"
          >
            <StarRating
              rating={rating.rating}
              size="md"
              label={r('ratedBy', { rating: rating.rating.toFixed(1), count: rating.count })}
            />
            <span aria-hidden="true" className="font-bold text-ink">
              {rating.rating.toFixed(1)}
            </span>
            <span aria-hidden="true" className="text-muted underline-offset-4 hover:underline">
              {r('count', { count: rating.count })}
            </span>
          </a>

          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="font-heading text-[34px] font-extrabold text-ink">
              {formatPrice(product.pricePaise)}
            </span>
            {product.mrpPaise && off ? (
              <>
                <span className="text-sm text-muted line-through">
                  {t('mrp', { price: formatPrice(product.mrpPaise) })}
                </span>
                <span className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-bold text-success">
                  {t('save', { percent: off })}
                </span>
              </>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">{t('inclusive')}</p>

          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex items-center gap-2 font-bold text-success">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {availability}
            </li>
            <li className="flex items-center gap-2 text-ink">
              <Truck aria-hidden="true" className="size-4 text-muted" />
              {t('delivery', { days: product.leadDays })}
            </li>
            <li className="flex items-center gap-2 text-ink">
              <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
              {t('fitNote')}
            </li>
          </ul>

          <div className="mt-6 max-w-sm">
            <AddToCartButton
              slug={product.slug}
              labels={{
                add: t('addToCart'),
                added: t('added'),
                maxQty: t('maxQty'),
                maxLines: t('maxLines'),
              }}
              className="min-h-12"
            />
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
            <p className="mt-2 text-sm text-muted">
              <Ban aria-hidden="true" className="mr-1 inline size-4 -translate-y-px align-middle" />
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

          <section aria-labelledby="highlights" className="mt-8">
            <h2 id="highlights" className="font-heading text-lg font-bold text-ink">
              {t('highlights')}
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              {product.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </section>

          <dl className="mt-6 divide-y divide-line rounded-tile border border-line-card bg-surface text-sm">
            {[
              [t('specification'), product.spec],
              [t('compatibility'), product.compatibility],
              [t('sku'), product.sku],
            ].map(([term, value]) => (
              <div key={term} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-3">
                <dt className="font-bold text-ink">{term}</dt>
                <dd className="text-muted">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <ReviewsSection
        target="product"
        slug={product.slug}
        summary={rating}
        reviews={productReviews(product)}
      />

      {related.length > 0 ? (
        <section aria-labelledby="related" className="mt-14">
          <h2 id="related" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {t('related', { category: c(product.category) })}
          </h2>
          <ul className="mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
            {related.map((p) => (
              <li key={p.slug}>
                <ProductCard product={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
