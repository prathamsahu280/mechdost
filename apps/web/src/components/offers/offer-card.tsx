import { BadgePercent, Truck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PublicOffer } from '@mechdost/shared/coupon-api';
import { conditionLines } from '@/lib/coupon-view';
import { formatDateTimeIst, formatPrice } from '@/lib/format';
import { CopyCodeButton } from './offer-actions';

/**
 * One offer on the public offers page (spec 03 "Public offers"). A Server Component: no client code except the copy
 * button (the page wraps the list in the `offers` client messages). The words come from the locale files, the numbers from the offer (integer paise, formatted here), the end
 * time in IST. An automatic offer has no code to copy: it says it applies on its own.
 */
export function OfferCard({ offer }: { offer: PublicOffer }) {
  const t = useTranslations('offers');
  const c = useTranslations('coupons');
  const locale = useLocale();
  const Icon = offer.kind === 'free_shipping' ? Truck : BadgePercent;
  const lines = conditionLines({ ...offer, endsAt: null });

  return (
    <li className="reveal flex flex-col gap-4 rounded-tile border border-line-card bg-surface p-6 shadow-card">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-text"
        >
          <Icon className="size-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-extrabold break-words text-ink">{offer.title}</h2>
          <p className="mt-1 text-sm text-muted">{t('mechdostOffer')}</p>
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
        {lines.map((l) => (
          <li key={l.key}>
            {c(l.key, {
              value: l.key === 'cond_percent' ? (l.value ?? 0) : formatPrice(l.value ?? 0),
              date: '',
            })}
          </li>
        ))}
        {offer.categoryName ? <li>{t('category', { name: offer.categoryName })}</li> : null}
      </ul>
      {offer.terms ? <p className="text-sm text-muted">{offer.terms}</p> : null}

      <p className="text-sm text-muted">
        {offer.endsAt ? t('endsIst', { date: formatDateTimeIst(offer.endsAt, locale) }) : t('noEnd')}
      </p>

      <div className="mt-auto">
        {offer.code ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              {t('codeLabel')}{' '}
              <code className="rounded-md border border-dashed border-line-card bg-pill px-2 py-1 font-mono text-base font-bold tracking-wider text-ink select-all">
                {offer.code}
              </code>
            </p>
            <CopyCodeButton code={offer.code} kind={offer.kind} />
          </div>
        ) : (
          <p className="text-sm font-bold text-ink">{t('auto')}</p>
        )}
      </div>
    </li>
  );
}
