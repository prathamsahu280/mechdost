import { useTranslations } from 'next-intl';
import type { CardView } from '@/lib/catalogue/view';
import { discountPercent, formatPrice } from '@/lib/format';
import { StarRating } from '../reviews/star-rating';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { CompareToggle } from './compare-toggle';
import { ProductInfoButton } from './product-info-button';
import { ProductPhoto } from './product-photo';
import { ProductVisual } from './product-visual';
import { UnitPrice } from './unit-price';
import { WishlistHeartLazy } from './wishlist-lazy';

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
  const w = useTranslations('storefront');
  const price = product.price;
  const off = price ? discountPercent(price.pricePaise, price.mrpPaise ?? undefined) : 0;
  const rating = product.rating && product.rating.count > 0 ? product.rating : null;
  const categoryName = product.category.name ?? (product.category.key ? c(product.category.key) : null);

  return (
    <article className="group grid rounded-card border border-line-card bg-surface p-3 shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover">
      <div className="relative">
        <LocalLink href={`/shop/${product.slug}`} className="block" tabIndex={-1} aria-hidden="true">
          {product.photo ? (
            <ProductPhoto photo={product.photo} sizes="(min-width: 1024px) 280px, 50vw" />
          ) : (
            <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} />
          )}
        </LocalLink>
        <ProductInfoButton product={product} scope={scope} />
        <WishlistHeartLazy
          slug={product.slug}
          source="card"
          labels={{
            add: w('wishlistAdd', { name: `${product.brand} ${product.name}` }),
            remove: w('wishlistRemove', { name: `${product.brand} ${product.name}` }),
            saved: w('wishlistSaved'),
            removed: w('wishlistRemoved'),
            full: w('wishlistFull', { max: 100 }),
            failed: w('wishlistFailed'),
            signIn: w('wishlistSignIn'),
            pageSave: w('pageSave'),
            pageSaved: w('pageSaved'),
          }}
        />
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
      {/* Rows line up across a row of cards (user report 2026-11-15: prices and "In stock" at different heights).
          The body is `display: contents`, so its eight rows (picture, category, name, rating, price, unit price,
          stock, foot) are the card's grid rows; inside a `.card-grid` list the card's rows are a subgrid of the
          list's rows (globals.css), so every row starts at the same height across a row of cards, whatever the name
          length. Always eight children, empty when there is nothing to show. `data-align` marks rows for the UI
          state audit's aligned check. */}
      <div className="contents">
        <p className="mt-3 px-1 text-xs text-muted">{categoryName ?? ''}</p>
        <h3 className="mt-0.5 px-1 font-heading text-[16px] leading-snug font-bold text-ink">
          <LocalLink
            href={`/shop/${product.slug}`}
            className="inline-block py-0.5 hover:underline"
            data-track={`product_${product.slug}`}
          >
            {product.brand} {product.name}
          </LocalLink>
        </h3>
        <div data-align="rating" className="mt-1 px-1">
          {rating ? (
            <p className="flex items-center gap-1.5 text-xs text-muted">
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
        </div>
        <div data-align="price" className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1">
          {price ? (
            <>
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
            </>
          ) : null}
        </div>
        <div className="mt-0.5 px-1 text-xs">
          {price ? <UnitPrice pricePaise={price.pricePaise} pack={product.pack} /> : null}
        </div>
        <p
          data-align="stock"
          className={`mt-1 px-1 text-xs font-bold ${product.availability === 'on_request' ? 'text-warning' : 'text-success'}`}
        >
          {availabilityLabel(t, product.availability)}
        </p>
        {/* Foot of the card (user ruling 2026-11-15, "Checkbox style"): "☐ Compare" on its own line, then the action
            row with only "Add to cart" (or the stepper) at full width. Both sit at the foot, so they line up across a
            row of cards. Nothing else ever enters the row: compare questions and cart limits are told in the tray. */}
        <div className="flex flex-col justify-end px-1 pt-2">
          {compare ? (
            <CompareToggle
              slug={product.slug}
              category={product.category.slug}
              categoryName={categoryName}
              labels={{
                toggle: cmp('toggle'),
                toggleName: cmp('toggleName', { name: `${product.brand} ${product.name}` }),
                added: cmp('added', { count: '{count}' }),
                removed: cmp('removed'),
              }}
            />
          ) : null}
          {price ? (
            <div data-slot="card-actions" className={compare ? 'mt-1' : 'mt-2'}>
              <AddToCartButton
                sku={product.sku}
                slug={product.slug}
                notify="tray"
                labels={{
                  add: t('addToCart'),
                  added: t('added'),
                  maxQty: t('maxQty'),
                  maxLines: t('maxLines'),
                  saveFailed: t('saveFailed'),
                  increase: t('cartIncrease', { name: `${product.brand} ${product.name}` }),
                  decrease: t('cartDecrease', { name: `${product.brand} ${product.name}` }),
                  remove: t('cartRemove', { name: `${product.brand} ${product.name}` }),
                  removed: t('cartRemoved'),
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
