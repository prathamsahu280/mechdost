'use client';

import { useLocale, useTranslations } from 'next-intl';
import { offerTimerState } from '@/lib/partner-kit';

/**
 * Offer countdown (design 2026-11-27 § 4): big text ("4:32 left") and the orange tread bar draining above the
 * Accept button (our own tread mark from the nav chip, never another app's look). The bar is decoration
 * (`aria-hidden`): the text is the source of truth, and a polite live region speaks only at 5 min, 1 min and the end.
 * Under a minute it turns amber and says "Hurry" in words. Reduced motion: the bar stays still (CSS).
 *
 * `now` comes from the caller's ticking clock (`useNow(1000)`), so one list ticks once for all its cards.
 */
export function OfferTimer({
  endsAt,
  now,
  windowMs,
  showRule = false,
}: {
  endsAt: string | null;
  now: number;
  /** The offer's full length; without it the bar is not drawn. */
  windowMs?: number | null;
  /** Say plainly what happens when the time runs out (shop offers). */
  showRule?: boolean;
}) {
  const t = useTranslations('partnerKit');
  const locale = useLocale();
  const s = offerTimerState(endsAt, now, windowMs);
  if (!s) return null;
  const endsAtText = endsAt
    ? new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(endsAt))
    : '';
  const spoken =
    s.milestone === 'ended'
      ? t('timer_ended')
      : s.milestone === 'one'
        ? t('timer_hurry')
        : s.milestone === 'five'
          ? t('timer_five')
          : '';
  return (
    <div className="grid gap-1.5" data-urgent={s.urgent || undefined}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          aria-hidden="true"
          className={`font-heading text-2xl font-extrabold tabular-nums ${s.urgent ? 'text-warning' : s.ended ? 'text-muted' : 'text-ink'}`}
        >
          {s.ended ? t('timer_ended') : t('timer_left', { time: s.text })}
        </span>
        {s.urgent ? (
          <span
            aria-hidden="true"
            className="rounded-pill bg-warning-bg px-2 py-0.5 text-xs font-extrabold text-warning"
          >
            {t('timer_hurry')}
          </span>
        ) : null}
        {endsAtText && !s.ended ? (
          <span className="sr-only">{t('timer_ends_at', { time: endsAtText })}</span>
        ) : null}
      </p>
      {s.fraction !== null ? (
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-pill bg-pill">
          <div
            className={`partner-tread h-full origin-left ${s.urgent ? 'partner-tread-urgent' : ''}`}
            style={{ transform: `scaleX(${s.fraction})` }}
          />
        </div>
      ) : null}
      {showRule && !s.ended ? <p className="text-xs text-muted">{t('timer_rule')}</p> : null}
      <p aria-live="polite" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}
