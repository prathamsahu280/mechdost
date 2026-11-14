import { useTranslations } from 'next-intl';
import type { CardView } from '@/lib/catalogue/view';
import { discountPercent, formatPrice } from '@/lib/format';
import { StarRating } from '../reviews/star-rating';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { CompareToggle } from './compare-toggle';
import { ProductInfoButton } from './product-info-button';
import { ProductVisual } from './product-visual';
import { UnitPrice } from './unit-price';

/**
 * Product card: blueprint artwork with an ⓘ quick-details popover, brand and category, name, rating, price with
 * MRP and saving, availability, add to cart. Calm by default — only the shadow responds to hover.
 * Facts the source does not know are left out, never shown as blanks (a11y review 2026-11-10): no price → no
 * price block and no add-to-cart (the product page offers "Ask about this product"); no rating → no star row.
 */
export function ProductCard({
  product,
  scope = 'list',
  compare = true,
}: {
  product: CardView;
  /** Distinguishes lists on one page (ids of the quick-details popover). */
  scope?: string;
  /** Shows the "Compare" toggle (shop pages, where the compare tray lives; not the home page). */
  compare?: boolean;
}) {
  const t = useTranslations('catalogue');
  const cmp = useTranslations('compare');
  const c = useTranslations('categories');
  const r = useTranslations('reviews');
  const price = product.price;
  const off = price ? discountPercent(price.pricePaise, price.mrpPaise ?? undefined) : 0;
  const rating = product.rating && product.rating.count > 0 ? product.rating : null;
  const categoryName = product.category.name ?? (product.category.key ? c(product.category.key) : null);

  return (
    <article className="group flex h-full flex-col rounded-card border border-line-card bg-surface p-3 shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover">
      <div className="relative">
        <LocalLink href={`/shop/${product.slug}`} className="block" tabIndex={-1} aria-hidden="true">
          <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} />
        </LocalLink>
        <ProductInfoButton product={product} scope={scope} />
        <div className="pointer-events-none absolute bottom-3 left-3 flex gap-1.5">
          {product.popular ? (
            <span className="rounded-md bg-accent-button px-2 py-0.5 text-[11px] font-bold text-white">
              {t('bestseller')}
            </span>
          ) : null}
          <span className="rounded-md bg-surface/95 px-2 py-0.5 text-[11px] font-bold text-ink">
            {product.vehicleTypes.length > 0 ? (
              <>
                <span className="sr-only">{t('fitsLabel')} </span>
                {product.vehicleTypes.join(' · ')}
              </>
            ) : (
              t('fitUnknown')
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        {categoryName ? <p className="text-xs text-muted">{categoryName}</p> : null}
        <h3 className="mt-0.5 font-heading text-[16px] leading-snug font-bold text-ink">
          <LocalLink
            href={`/shop/${product.slug}`}
            className="inline-block py-0.5 hover:underline"
            data-track={`product_${product.slug}`}
          >
            {product.brand} {product.name}
          </LocalLink>
        </h3>
        {rating ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <StarRating
              rating={rating.avg}
              label={r('ratedBy', { rating: rating.avg.toFixed(1), count: rating.count })}
            />
            <span aria-hidden="true" className="font-bold text-ink">
              {rating.avg.toFixed(1)}
            </span>
            <span aria-hidden="true">({rating.count})</span>
          </p>
        ) : null}
        {price ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-heading text-[22px] font-extrabold text-ink">
              {formatPrice(price.pricePaise)}
            </span>
            {price.mrpPaise && off ? (
              <>
                <span className="text-xs text-muted line-through">
                  {t('mrp', { price: formatPrice(price.mrpPaise) })}
                </span>
                <span className="rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-bold text-success">
                  {t('save', { percent: off })}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
        {price ? <UnitPrice pricePaise={price.pricePaise} pack={product.pack} className="mt-0.5" /> : null}
        <p
          className={`mt-1 text-xs font-bold ${product.availability === 'on_request' ? 'text-warning' : 'text-success'}`}
        >
          {availabilityLabel(t, product.availability)}
        </p>
        {/* Compare sits beside Add to cart (user 2026-11-13: it was a whole extra row at the bottom of the card). */}
        <div className="mt-auto flex items-start gap-2 pt-4">
          {compare ? (
            <CompareToggle
              className="shrink-0"
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
            />
          ) : null}
          {price ? (
            <div className="min-w-0 flex-1">
              <AddToCartButton
                slug={product.slug}
                className="px-3"
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
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** "In stock" / "Low stock" / "Confirmed on request" (one wording for card, popover and page). */
export function availabilityLabel(
  t: (key: 'inStock' | 'lowStock' | 'onRequest') => string,
  availability: CardView['availability'],
): string {
  return availability === 'in_stock'
    ? t('inStock')
    : availability === 'low_stock'
      ? t('lowStock')
      : t('onRequest');
}
