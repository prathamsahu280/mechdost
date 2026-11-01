import { useLocale, useTranslations } from 'next-intl';
import type { DemoProduct } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { productRating } from '@/demo/reviews';
import { discountPercent, formatPrice } from '@/lib/format';
import { StarRating } from '../reviews/star-rating';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { ProductInfoButton } from './product-info-button';
import { ProductVisual } from './product-visual';

const FIT_LABEL: Record<DemoProduct['fits'], string> = {
  '2W': '2W',
  '4W': '4W',
  '2W/4W': '2W · 4W',
  EV: 'EV',
};

/**
 * Product card: blueprint artwork with an ⓘ quick-details popover, brand and category, name, rating, price with
 * MRP and saving, availability, add to cart. Calm by default — only the shadow responds to hover.
 */
export function ProductCard({ product: raw }: { product: DemoProduct }) {
  const product = localizeProduct(raw, useLocale());
  const t = useTranslations('catalogue');
  const c = useTranslations('categories');
  const r = useTranslations('reviews');
  const off = discountPercent(product.pricePaise, product.mrpPaise);
  const rating = productRating(product);
  const availability =
    product.availability === 'in_stock'
      ? t('inStock')
      : product.availability === 'low_stock'
        ? t('lowStock')
        : t('onRequest');

  return (
    <article className="group flex h-full flex-col rounded-card border border-line-card bg-surface p-3 shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover">
      <div className="relative">
        <LocalLink href={`/shop/${product.slug}`} className="block" tabIndex={-1} aria-hidden="true">
          <ProductVisual category={product.category} brand={product.brand} sku={product.sku} />
        </LocalLink>
        <ProductInfoButton product={product} />
        <div className="pointer-events-none absolute bottom-3 left-3 flex gap-1.5">
          {product.popular ? (
            <span className="rounded-md bg-accent-button px-2 py-0.5 text-[11px] font-bold text-white">
              {t('bestseller')}
            </span>
          ) : null}
          <span className="rounded-md bg-surface/95 px-2 py-0.5 text-[11px] font-bold text-ink">
            {FIT_LABEL[product.fits]}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        <p className="text-xs text-muted">{c(product.category)}</p>
        <h3 className="mt-0.5 font-heading text-[16px] leading-snug font-bold text-ink">
          <LocalLink
            href={`/shop/${product.slug}`}
            className="inline-block py-0.5 hover:underline"
            data-track={`product_${product.slug}`}
          >
            {product.brand} {product.name}
          </LocalLink>
        </h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <StarRating
            rating={rating.rating}
            label={r('ratedBy', { rating: rating.rating.toFixed(1), count: rating.count })}
          />
          <span aria-hidden="true" className="font-bold text-ink">
            {rating.rating.toFixed(1)}
          </span>
          <span aria-hidden="true">({rating.count})</span>
        </p>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-[22px] font-extrabold text-ink">
            {formatPrice(product.pricePaise)}
          </span>
          {product.mrpPaise && off ? (
            <>
              <span className="text-xs text-muted line-through">
                {t('mrp', { price: formatPrice(product.mrpPaise) })}
              </span>
              <span className="rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-bold text-success">
                {t('save', { percent: off })}
              </span>
            </>
          ) : null}
        </div>
        <p
          className={`mt-1 text-xs font-bold ${product.availability === 'on_request' ? 'text-warning' : 'text-success'}`}
        >
          {availability}
        </p>
        <div className="mt-auto pt-4">
          <AddToCartButton
            slug={product.slug}
            labels={{ add: t('addToCart'), added: t('added'), maxQty: t('maxQty'), maxLines: t('maxLines') }}
          />
        </div>
      </div>
    </article>
  );
}
