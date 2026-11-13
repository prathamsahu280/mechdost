import { useTranslations } from 'next-intl';
import type { VehicleType } from '@mechdost/shared/vehicles';
import type { ProductView } from '@/lib/catalogue/view';
import type { CellValue, CompareGroup } from '@/lib/compare/rows';
import { formatPrice } from '@/lib/format';
import { LocalLink } from '../ui/local-link';
import { AddToCartButton } from './add-to-cart-button';
import { CompareRemove } from './compare-islands';

const VEHICLE_LABEL: Record<VehicleType, 'twoWheeler' | 'threeWheeler' | 'fourWheeler'> = {
  '2W': 'twoWheeler',
  '3W': 'threeWheeler',
  '4W': 'fourWheeler',
};

/**
 * The comparison table (design 2026-11-13): a real `<table>` with a caption, product columns (`th scope=col`,
 * sticky top) and row labels (`th scope=row`, sticky left) inside one scroll box, so both stay in view. Two
 * product columns fit a 390 px phone; more scroll sideways with snap. Rows the same for every product carry
 * `data-same` for "Only differences".
 */
export function CompareTable({
  items,
  groups,
  caption,
  prefix,
}: {
  items: readonly ProductView[];
  groups: readonly CompareGroup[];
  caption: string;
  prefix: string;
}) {
  const t = useTranslations('compare');
  const cat = useTranslations('catalogue');
  const slugs = items.map((p) => p.slug);

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

  return (
    <div
      className="max-h-[calc(100dvh-170px)] snap-x snap-mandatory scroll-pl-[26vw] overflow-auto tab:scroll-pl-48 overscroll-x-contain rounded-card border border-line-card bg-surface shadow-card"
      tabIndex={0}
      role="region"
      aria-labelledby="compare-caption"
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption id="compare-caption" className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr>
            <td className="sticky top-0 left-0 z-30 w-[26vw] min-w-[26vw] border-b border-line-card bg-surface tab:w-48 tab:min-w-48" />
            {items.map((p) => (
              <th
                key={p.slug}
                scope="col"
                className="sticky top-0 z-20 min-w-[32vw] snap-start border-b border-l border-line-card bg-surface p-3 text-left align-top font-normal tab:min-w-56"
              >
                <div className="flex items-start justify-between gap-1">
                  <LocalLink
                    href={`/shop/${p.slug}`}
                    className="font-heading text-[15px] leading-snug font-bold text-ink hover:underline"
                  >
                    {p.brand} {p.name}
                  </LocalLink>
                  <CompareRemove
                    slug={p.slug}
                    slugs={slugs}
                    prefix={prefix}
                    label={t('remove', { name: `${p.brand} ${p.name}` })}
                  />
                </div>
                {p.price ? (
                  <>
                    <p className="mt-1 font-heading text-lg font-extrabold text-ink">
                      {formatPrice(p.price.pricePaise)}
                    </p>
                    <div className="mt-2">
                      <AddToCartButton
                        slug={p.slug}
                        source="compare"
                        labels={{
                          add: cat('addToCart'),
                          added: cat('added'),
                          maxQty: cat('maxQty'),
                          maxLines: cat('maxLines'),
                          saveFailed: cat('saveFailed'),
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs font-bold text-warning">{cat('onRequest')}</p>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={items.length + 1}
                className="sticky left-0 bg-surface-alt px-3 pt-4 pb-2 text-left text-xs font-extrabold tracking-wide text-muted"
              >
                {t(`group.${g.key}`)}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.key} data-same={r.same && items.length > 1 ? '' : undefined}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-line-card bg-surface p-3 text-left align-top text-xs font-bold text-muted"
                >
                  {r.label.ns === 'row'
                    ? t(`row.${r.label.key}` as 'row.price')
                    : t(`attr.${r.label.key}` as 'attr.saeGrade')}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={slugs[i]}
                    className={`border-b border-l border-line-card p-3 align-top ${c === null ? 'text-muted' : 'text-ink'}`}
                  >
                    {cell(c)}
                    {c?.kind === 'unitPrice' && r.lowestIdx?.includes(i) ? (
                      <span className="mt-1 block w-fit rounded-md bg-success-bg px-1.5 py-0.5 text-[11px] font-bold text-success">
                        {t(`lowest_${c.per}`)}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
