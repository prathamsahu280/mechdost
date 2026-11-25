import { useLocale, useTranslations } from 'next-intl';
import { localePath } from '@/lib/locale-path';
import type { CardView } from '@/lib/catalogue/view';
import { discountPercent, formatPrice } from '@/lib/format';
import { StarRating } from '../reviews/star-rating';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { CompareToggle } from './compare-toggle';
import { ProductInfoButton } from './product-info-button';
import { ProductPhoto } from './product-photo';
import { ProductVisual } from './product-visual';
import { SizeMatchChip } from './size-match-chip';
import { UnitPrice } from './unit-price';
import { mrpOnly } from '@/lib/catalogue/mrp-only';
import { WishlistHeartLazy } from './wishlist-lazy';
import { productFullName } from '@/lib/product-name';

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
  const locale = useLocale();
  const matched = product.matchedSizes ?? [];
  const first = matched[0];
  const sizeQuery = first ? { size: first.sku } : undefined;
  const cmp = useTranslations('compare');
  const c = useTranslations('categories');
  const r = useTranslations('reviews');
  const w = useTranslations('storefront');
  const price = product.price;
  const mrp = mrpOnly(product);
  const mrpLabel = mrp ? t(mrp.key, { price: formatPrice(mrp.paise) }) : null;
  const off = price ? discountPercent(price.pricePaise, price.mrpPaise ?? undefined) : 0;
  // Several sizes (user 2026-11-24): "from ₹X · N sizes" with the lowest price among them, and "Choose size" in place of
  // "Add to cart" (a card cannot know which size is wanted). One size looks exactly as before.
  const sizes = product.sizes;
  const rating = product.rating && product.rating.count > 0 ? product.rating : null;
  const categoryName = product.category.name ?? (product.category.key ? c(product.category.key) : null);

  return (
    <article className="group grid rounded-card border border-line-card bg-surface p-3 shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover">
      <div className="relative">
        <LocalLink
          href={`/shop/${product.slug}`}
          query={sizeQuery}
          className="block"
          tabIndex={-1}
          aria-hidden="true"
        >
          {product.photo ? (
            <ProductPhoto photo={product.photo} sizes="(min-width: 1024px) 280px, 50vw" />
          ) : (
            <ProductVisual category={product.category.key} brand={product.brand} sku={product.sku} />
          )}
        </LocalLink>
        {/* Badges under the picture, in normal flow (audit 2026-11-15, item 1: over the picture they covered the SKU
            printed at its foot on narrow cards). They wrap, so no width or language can make them overlap anything. */}
        <div data-slot="card-badges" className="mt-2 flex flex-wrap gap-1.5 px-1">
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
        {/* The category line carries the two round buttons (ⓘ details, ♡ save) at its right end, so they never sit on the
            picture (user 2026-11-24: "the i button and heart button gets over the images"). The row is the same
            height on every card, so the eight shared rows still line up. */}
        <div data-slot="card-tools" className="mt-1.5 flex items-center justify-between gap-2 px-1">
          <p className="min-w-0 flex-1 text-xs text-muted">{categoryName ?? ''}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <ProductInfoButton product={product} scope={scope} />
            <WishlistHeartLazy
              slug={product.slug}
              source="card"
              labels={{
                add: w('wishlistAdd', { name: productFullName(product.brand, product.name) }),
                remove: w('wishlistRemove', { name: productFullName(product.brand, product.name) }),
                saved: w('wishlistSaved'),
                removed: w('wishlistRemoved'),
                full: w('wishlistFull', { max: 100 }),
                failed: w('wishlistFailed'),
                signIn: w('wishlistSignIn'),
                pageSave: w('pageSave'),
                pageSaved: w('pageSaved'),
              }}
            />
          </div>
        </div>
        <h3 className="mt-0.5 px-1 font-heading text-[16px] leading-snug font-bold text-ink">
          <LocalLink
            href={`/shop/${product.slug}`}
            query={sizeQuery}
            className="inline-block py-0.5 hover:underline"
            data-track={`product_${product.slug}`}
          >
            {productFullName(product.brand, product.name)}
          </LocalLink>
        </h3>
        <div data-align="rating" className="mt-1 px-1">
          {first ? (
            <div className="mb-1">
              <SizeMatchChip
                href={`${localePath(`/shop/${product.slug}`, locale)}?size=${encodeURIComponent(first.sku)}`}
                slug={product.slug}
                sku={first.sku}
                text={t('sizeAvailable', { size: first.label })}
                more={
                  matched.length > 1
                    ? t('sizesAvailable', { sizes: matched.map((m) => m.label).join(', ') })
                    : null
                }
              />
            </div>
          ) : null}
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
          {sizes ? (
            sizes.fromPaise !== null ? (
              <span className="font-heading text-[17px] leading-snug font-extrabold text-ink">
                {t('fromSizes', { price: formatPrice(sizes.fromPaise), count: sizes.count })}
              </span>
            ) : (
              <span className="text-sm font-semibold text-muted">
                {mrpLabel ? `${mrpLabel} · ` : ''}
                {t('sizesOnly', { count: sizes.count })}
              </span>
            )
          ) : price ? (
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
          ) : mrpLabel ? (
            <span className="text-sm font-semibold text-muted">{mrpLabel}</span>
          ) : null}
        </div>
        <div className="mt-0.5 px-1 text-xs">
          {price && !sizes ? <UnitPrice pricePaise={price.pricePaise} pack={product.pack} /> : null}
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
                toggleName: cmp('toggleName', { name: productFullName(product.brand, product.name) }),
                added: cmp('added', { count: '{count}' }),
                removed: cmp('removed'),
                hint: cmp('hint'),
              }}
            />
          ) : null}
          {sizes ? (
            <div data-slot="card-actions" className={compare ? 'mt-1' : 'mt-2'}>
              <LocalLink
                href={`/shop/${product.slug}`}
                query={sizeQuery}
                data-track="card_choose_size"
                className="press cart-add"
              >
                {t('chooseSize')}
                <span className="sr-only"> {productFullName(product.brand, product.name)}</span>
              </LocalLink>
            </div>
          ) : price ? (
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
                  increase: t('cartIncrease', { name: productFullName(product.brand, product.name) }),
                  decrease: t('cartDecrease', { name: productFullName(product.brand, product.name) }),
                  remove: t('cartRemove', { name: productFullName(product.brand, product.name) }),
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
