import { CheckCircle2, Info, ShieldCheck, Truck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CardView } from '@/lib/catalogue/view';
import { formatPrice } from '@/lib/format';
import { LocalLink } from '../ui/local-link';

/**
 * The product card's ⓘ button (user, 2026-11-01): quick details without leaving the list. Uses the native Popover
 * API — light dismiss, Esc to close, focus returns to the button, works before JavaScript loads. Server component.
 * a11y review 2026-11-10: ids are `info-<scope>-<slug>` — a product appears at most once per list, and `scope`
 * tells lists on one page apart (`useId` repeats across server renders, e.g. "Load more" pages: final review);
 * focus moves to the close button on open (`autofocus`); unknown facts are left out instead of shown blank.
 */
export function ProductInfoButton({ product, scope }: { product: CardView; scope: string }) {
  const t = useTranslations('catalogue');
  const id = `info-${scope}-${product.slug}`;
  const rows = [
    { key: 'spec', term: t('specification'), value: product.spec },
    { key: 'compat', term: t('compatibility'), value: product.compatibility },
    { key: 'sku', term: t('sku'), value: product.sku },
  ].filter((row): row is { key: string; term: string; value: string } => Boolean(row.value));
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={t('info', { name: product.name })}
        data-track={`product_info_${product.slug}`}
        className="press absolute top-3 right-3 z-10 inline-flex size-10 items-center justify-center rounded-full bg-surface/95 text-ink shadow-card hover:bg-surface"
      >
        <Info aria-hidden="true" className="size-5" />
      </button>
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-dialog border border-line-card bg-surface p-0 text-ink shadow-dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted uppercase">{t('infoTitle')}</p>
            <h3 id={`${id}-title`} className="mt-0.5 font-heading text-lg leading-snug font-extrabold">
              {product.brand} {product.name}
            </h3>
          </div>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label={t('close')}
            autoFocus
            className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-pill"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4 text-sm">
          {product.price ? (
            <p className="font-heading text-2xl font-extrabold">{formatPrice(product.price.pricePaise)}</p>
          ) : null}
          {rows.length > 0 ? (
            <dl className="divide-y divide-line rounded-tile border border-line-card">
              {rows.map((row) => (
                <div key={row.key} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2.5">
                  <dt className="font-bold">{row.term}</dt>
                  <dd className="text-muted">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {product.highlights.length > 0 ? (
            <div>
              <p className="font-bold">{t('highlights')}</p>
              <ul className="mt-1.5 space-y-1">
                {product.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-muted">
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {product.leadDays !== null ? (
            <p className="flex items-center gap-2 text-ink">
              <Truck aria-hidden="true" className="size-4 text-muted" />
              {t('delivery', { days: product.leadDays })}
            </p>
          ) : null}
          <p className="flex items-center gap-2 text-ink">
            <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
            {t('fitNote')}
          </p>
        </div>
        <div className="border-t border-line px-5 py-4">
          <LocalLink
            href={`/shop/${product.slug}`}
            className="press inline-flex min-h-11 w-full items-center justify-center rounded-button bg-navy px-5 text-sm font-bold text-white hover:opacity-90"
          >
            {t('openProduct')}
          </LocalLink>
        </div>
      </div>
    </>
  );
}
