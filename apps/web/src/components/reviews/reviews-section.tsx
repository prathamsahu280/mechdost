import { BadgeCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { localizeArea } from '@/demo/i18n/localize';
import type { RatingSummary, SeedReview } from '@/demo/reviews';
import type { ReviewTarget } from '@/demo/store';
import { formatDate } from '@/lib/format';
import { ClientMessages } from '../ui/client-messages';
import { LocalReviews } from './local-reviews';
import { StarRating } from './star-rating';

/**
 * Ratings & reviews block for product and workshop pages: average, distribution bars, recent reviews, and a
 * "Write a review" form whose submissions wait for admin approval (decision 2026-10-31).
 */
export async function ReviewsSection({
  target,
  slug,
  summary,
  reviews,
}: {
  target: ReviewTarget;
  slug: string;
  summary: RatingSummary;
  reviews: SeedReview[];
}) {
  const [t, locale] = await Promise.all([getTranslations('reviews'), getLocale()]);
  const rating = summary.rating.toFixed(1);

  return (
    <section aria-labelledby={`reviews-${slug}`} className="mt-14">
      <h2 id={`reviews-${slug}`} className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
        {t('title')}
      </h2>
      <div className="mt-6 grid gap-8 nav:grid-cols-[320px_1fr]">
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card nav:self-start">
          <p className="font-heading text-5xl font-extrabold text-ink">{rating}</p>
          <div className="mt-2">
            <StarRating
              rating={summary.rating}
              size="md"
              label={t('ratedBy', { rating, count: summary.count })}
            />
          </div>
          <p className="mt-1 text-sm text-muted">{t('count', { count: summary.count })}</p>
          <ul className="mt-5 space-y-2">
            {summary.distribution.map((n, i) => {
              const stars = 5 - i;
              const percent = summary.count ? Math.round((n / summary.count) * 100) : 0;
              return (
                <li key={stars} className="grid grid-cols-[52px_1fr_40px] items-center gap-2 text-xs">
                  <span className="font-bold text-ink">{t('stars', { n: stars })}</span>
                  <span
                    role="img"
                    aria-label={t('starShare', { n: stars, percent })}
                    className="h-2 overflow-hidden rounded-full bg-pill"
                  >
                    <span className="block h-full rounded-full bg-star" style={{ width: `${percent}%` }} />
                  </span>
                  <span aria-hidden="true" className="text-right text-muted tabular-nums">
                    {percent}%
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-xs text-muted">{t('moderationNote')}</p>
        </div>

        <div>
          <h3 className="sr-only">{t('recent')}</h3>
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-card border border-line-card bg-surface p-5 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StarRating rating={r.rating} label={t('average', { rating: r.rating })} />
                  <span className="text-xs text-muted">{formatDate(r.date, locale)}</span>
                </div>
                {/* Reviews are user-written: shown as typed (hard rule 10 exception, `data-user-content`). */}
                <p data-user-content className="mt-2 font-heading font-bold text-ink">
                  {r.title}
                </p>
                <p data-user-content className="mt-1 text-sm leading-relaxed text-muted">
                  {r.body}
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span data-user-content className="font-bold text-ink">
                    {r.name}
                  </span>
                  <span className="text-muted">{localizeArea(r.area, locale)}</span>
                  {r.verified ? (
                    <span className="inline-flex items-center gap-1 font-bold text-success">
                      <BadgeCheck aria-hidden="true" className="size-3.5" />
                      {target === 'product' ? t('verifiedPurchase') : t('verifiedService')}
                    </span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
          <ClientMessages namespaces={['reviews']}>
            <LocalReviews target={target} slug={slug} />
          </ClientMessages>
        </div>
      </div>
    </section>
  );
}
