import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { VehicleType } from '@mechdost/shared/vehicles';
import type { ProductView } from '@/lib/catalogue/view';
import type { CellValue, CompareGroup } from '@/lib/compare/rows';
import { discountPercent, formatPrice } from '@/lib/format';
import { mrpOnly } from '@/lib/catalogue/mrp-only';
import { StarRating } from '../reviews/star-rating';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { CompareRemove } from './compare-islands';
import { ProductPhoto } from './product-photo';
import { ProductVisual } from './product-visual';
import { productFullName } from '@/lib/product-name';

const VEHICLE_LABEL: Record<VehicleType, 'twoWheeler' | 'threeWheeler' | 'fourWheeler'> = {
  '2W': 'twoWheeler',
  '3W': 'threeWheeler',
  '4W': 'fourWheeler',
};

/**
 * The comparison (redesign 2026-11-13, user: "the table is really bad"). An ARIA table built from a grid:
 * - a compact product strip (name, price, remove) sticks under the site header while the page scrolls, so the
 *   columns stay named — no scroll box inside the page any more;
 * - a summary row (artwork, rating, saving, add to cart), then the groups of rows;
 * - phones: each row's label sits on its own line above the values, so two products get the full width; three or
 *   four swipe sideways with snap, the strip following the body (`CompareScrollSync`);
 * - tablets and up: a label column on the left, sticky while swiping;
 * - the lowest price and the lowest price per unit are marked; rows the same for every product carry
 *   `data-same` for "Only differences".
 */
export function CompareTable({
  items,
  groups,
  caption,
  prefix,
}: {
  /** `sizeLabel`: the size shown for a product sold in several sizes (user 2026-11-24). */
  items: readonly (ProductView & { sizeLabel?: string | null })[];
  groups: readonly CompareGroup[];
  caption: string;
  prefix: string;
}) {
  const t = useTranslations('compare');
  const cat = useTranslations('catalogue');
  const r = useTranslations('reviews');
  // A product shown for one size keeps that size in the link ("slug:SKU"), so removing another column keeps it.
  const slugs = items.map((p) => (p.sizeLabel && p.sku ? `${p.slug}:${p.sku}` : p.slug));
  const prices = items.map((p) => p.price?.pricePaise ?? null);
  const priced = prices.filter((p): p is number => p !== null);
  const lowestPrice = priced.length >= 2 ? Math.min(...priced) : null;
  const isLowestPrice = (i: number) => lowestPrice !== null && prices[i] === lowestPrice;
  const style = { '--cols': items.length } as CSSProperties;

  function cell(c: CellValue | null): string {
    if (c === null) return t('notListed');
    switch (c.kind) {
      case 'price':
        return formatPrice(c.paise);
      case 'unitPrice':
        return cat(`unitPrice_${c.per}`, { price: formatPrice(c.paise) });
      case 'days':
        return t('deliveryDays', { days: c.days });
      case 'text':
        return c.text;
      case 'code':
        return c.prefix ? `${c.prefix} ${c.code}` : c.code;
      case 'enum':
        return t(`value.${c.key}.${c.value}` as 'value.baseType.mineral');
      case 'number':
        return c.unit ? t(`unit.${c.unit}`, { n: c.n }) : String(c.n);
      case 'bool':
        return c.on ? t('value.yes') : t('value.no');
      case 'vehicleTypes':
        return c.types.map((v) => cat(VEHICLE_LABEL[v])).join(', ');
      case 'rating':
        return t('ratingValue', { rating: c.avg.toFixed(1), count: c.count });
    }
  }

  const badge = (text: string) => (
    <span className="mt-1.5 block w-fit rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] leading-tight font-bold text-success">
      {text}
    </span>
  );
  const labelCell = 'compare-label';

  return (
    <>
      {/* The caption sits outside the table: a table may only contain rows and row groups (review 2026-11-14). */}
      <p id="compare-caption" className="sr-only">
        {caption}
      </p>
      <div role="table" aria-labelledby="compare-caption" style={style} className="compare">
        {/* Sticky product strip: scrolls sideways with the body (kept in step by CompareScrollSync). */}
        <div
          role="rowgroup"
          data-compare-head=""
          className="sticky top-[71px] z-20 border-b border-line-card bg-bg/95 tab:bg-surface/95 backdrop-blur nav:top-[83px] tab:rounded-t-card tab:border tab:px-0"
        >
          <div
            data-compare-scroll="head"
            // The sticky "Detail" column (11rem) covers the first product when the strip scrolls sideways: focus and
            // keyboard scrolling stop 11rem short of the edge (audit 2026-11-16, CMP-TABLE at 768 px).
            className="no-scrollbar overflow-x-auto overscroll-x-contain tab:scroll-pl-44"
          >
            <div role="row" className="compare-track compare-grid">
              {/* A real header cell in every layout, so each product's cells sit under its own name for screen
                readers; on phones it is visually hidden and out of the grid (review 2026-11-14). */}
              <div role="columnheader" className={`${labelCell} sr-only tab:not-sr-only`}>
                <span className="sr-only">{t('detailColumn')}</span>
              </div>
              {items.map((p, i) => (
                <div key={p.slug} role="columnheader" className="compare-col py-3 pr-1 tab:px-4">
                  <div className="flex items-start justify-between gap-1">
                    <LocalLink
                      href={`/shop/${p.slug}`}
                      className="min-w-0 font-heading break-words text-[14px] leading-snug font-bold text-ink hover:underline tab:text-[15px]"
                    >
                      {productFullName(p.brand, p.name)}
                    </LocalLink>
                    <CompareRemove
                      slug={p.slug}
                      slugs={slugs}
                      prefix={prefix}
                      label={t('remove', { name: productFullName(p.brand, p.name) })}
                    />
                  </div>
                  {p.sizeLabel ? (
                    <p className="text-xs font-bold text-muted" data-slot="compare-size">
                      <span className="sr-only">{cat('size')}: </span>
                      {p.sizeLabel}
                    </p>
                  ) : null}
                  {p.price ? (
                    <p className="flex flex-wrap items-baseline gap-x-2 font-heading text-lg font-extrabold text-ink">
                      {formatPrice(p.price.pricePaise)}
                      {isLowestPrice(i) ? (
                        <span className="rounded-md bg-success-bg px-1.5 py-0.5 font-sans text-[11px] font-bold text-success">
                          {t('lowestPrice')}
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <>
                      {mrpOnly(p) ? (
                        <p className="text-sm font-semibold text-muted">
                          {cat(mrpOnly(p)?.key ?? 'mrp', { price: formatPrice(mrpOnly(p)?.paise ?? 0) })}
                        </p>
                      ) : null}
                      <p className="text-xs font-bold text-warning">{cat('onRequest')}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          data-compare-scroll="body"
          className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain tab:scroll-pl-44 tab:rounded-b-card tab:border tab:border-t-0 tab:border-line-card tab:bg-surface tab:px-0 tab:shadow-card"
        >
          <div className="compare-track">
            {/* Summary: what the cards on the shop show, so a product can be bought straight from here. */}
            <div role="rowgroup">
              <div role="row" className="compare-grid border-b border-line-card">
                <div role="rowheader" className={`${labelCell} sr-only tab:not-sr-only`}>
                  <span className="sr-only">{t('summaryRow')}</span>
                </div>
                {items.map((p) => {
                  const off = p.price
                    ? discountPercent(p.price.pricePaise, p.price.mrpPaise ?? undefined)
                    : 0;
                  const rating = p.rating && p.rating.count > 0 ? p.rating : null;
                  return (
                    // Fixed slots (bug 2026-11-14: a "Save 11%" in one column pushed its button lower): artwork of
                    // a bounded size, a rating line and a saving line kept even when empty, then the action at the
                    // foot of the cell — the grid row makes every cell as tall as the tallest, so actions align.
                    <div
                      key={p.slug}
                      role="cell"
                      className="compare-col flex snap-start flex-col py-4 pr-1 tab:px-4"
                    >
                      <div className="mx-auto w-full max-w-[13rem]">
                        {/* The real photo when the product has one (live check 2026-11-22: compare showed artwork only). */}
                        {p.photo ? (
                          <ProductPhoto photo={p.photo} sizes="208px" />
                        ) : (
                          <ProductVisual category={p.category.key} brand={p.brand} />
                        )}
                      </div>
                      <div className="mt-2 flex min-h-5 items-center gap-1.5 text-xs text-muted">
                        {rating ? (
                          <>
                            <StarRating
                              rating={rating.avg}
                              label={r('ratedBy', { rating: rating.avg.toFixed(1), count: rating.count })}
                            />
                            <span aria-hidden="true">{rating.avg.toFixed(1)}</span>
                          </>
                        ) : null}
                      </div>
                      {/* Tall enough for the badge in Hindi too (Devanagari line height), empty or not. */}
                      <div className="min-h-7">
                        {off !== null && off > 0 ? badge(cat('save', { percent: off })) : null}
                      </div>
                      {p.price ? (
                        <div className="mt-auto pt-3">
                          <AddToCartButton
                            sku={p.sku}
                            slug={p.slug}
                            source="compare"
                            labels={{
                              add: cat('addToCart'),
                              added: cat('added'),
                              maxQty: cat('maxQty'),
                              maxLines: cat('maxLines'),
                              saveFailed: cat('saveFailed'),
                              increase: cat('cartIncrease', { name: productFullName(p.brand, p.name) }),
                              decrease: cat('cartDecrease', { name: productFullName(p.brand, p.name) }),
                              remove: cat('cartRemove', { name: productFullName(p.brand, p.name) }),
                              removed: cat('cartRemoved'),
                              inCart: cat('inCart', { count: '#' }),
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {groups.map((g) => (
              <div key={g.key} role="rowgroup" aria-label={t(`group.${g.key}`)}>
                <div aria-hidden="true" className="compare-group">
                  <span className="sticky left-0 inline-block px-0 tab:px-4">{t(`group.${g.key}`)}</span>
                </div>
                {g.rows.map((row) => (
                  <div
                    key={row.key}
                    role="row"
                    data-same={row.same && items.length > 1 ? '' : undefined}
                    className="compare-grid border-b border-line-card"
                  >
                    <div role="rowheader" className={labelCell}>
                      <span className="sticky left-0 inline-block tab:static">
                        {row.label.ns === 'row'
                          ? t(`row.${row.label.key}` as 'row.price')
                          : t(`attr.${row.label.key}` as 'attr.saeGrade')}
                      </span>
                    </div>
                    {row.cells.map((c, i) => (
                      <div
                        key={slugs[i]}
                        role="cell"
                        className={`compare-col pb-3 pr-1 text-sm tab:px-4 tab:py-3 ${c === null ? 'text-muted' : 'text-ink'}`}
                      >
                        {cell(c)}
                        {c?.kind === 'unitPrice' && row.lowestIdx?.includes(i)
                          ? badge(t(`lowest_${c.per}`))
                          : null}
                        {c?.kind === 'price' && row.key === 'price' && isLowestPrice(i)
                          ? badge(t('lowestPrice'))
                          : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
