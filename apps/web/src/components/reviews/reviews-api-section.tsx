import { BadgeCheck } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReviewTargetType } from '@mechdost/shared/reviews';
import { LocalLink } from '@/components/ui/local-link';
import { formatDate } from '@/lib/format';
import { reviewShares } from '@/lib/review-views';
import { fetchPublicReviews } from '@/lib/reviews-api-source';
import { StarRating } from './star-rating';

/**
 * Ratings & reviews from the API (data mode `api`, spec 02 § Reviews): the approved reviews' average, distribution
 * and the newest ten, server-rendered (no client JS, inside the page's JS budget). Only verified purchases can be
 * reviewed, so every review carries the verified badge. Empty → one next action (review from your order or
 * service); failure → a short note, never the page's error boundary. Wrap in `<Suspense>` with
 * `ReviewsApiSkeleton` so the rest of the page streams first.
 */
export async function ReviewsApiSection({ target, slug }: { target: ReviewTargetType; slug: string }) {
  const [result, t, locale] = await Promise.all([
    fetchPublicReviews(target, slug),
    getTranslations('reviews'),
    getLocale(),
  ]);
  if (!result.ok && result.reason === 'none') return null;
  const heading = (
    <h2 id={`reviews-${slug}`} className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
      {t('title')}
    </h2>
  );
  if (!result.ok)
    return (
      <section aria-labelledby={`reviews-${slug}`} className="mt-14">
        {heading}
        <p role="status" className="mt-4 text-sm text-muted">
          {t('api_error')}
        </p>
      </section>
    );

  const { summary, reviews } = result.data;
  if (summary.count === 0)
    return (
      <section aria-labelledby={`reviews-${slug}`} className="mt-14">
        {heading}
        <div className="mt-4 rounded-card border border-line-card bg-surface p-6 shadow-card">
          <p className="font-heading font-bold text-ink">{t('api_empty')}</p>
          <p className="mt-1 text-sm text-muted">
            {target === 'product' ? t('api_emptyProduct') : t('api_emptyWorkshop')}
          </p>
          <LocalLink
            href={target === 'product' ? '/account/orders' : '/account/services'}
            data-track={`reviews_empty_${target}`}
            className="press mt-4 inline-flex min-h-11 items-center rounded-button border border-input-border px-5 text-sm font-bold text-ink hover:bg-pill"
          >
            {target === 'product' ? t('api_emptyOrders') : t('api_emptyServices')}
          </LocalLink>
        </div>
      </section>
    );

  const avg = summary.avg ?? 0;
  const rating = avg.toFixed(1);
  return (
    <section aria-labelledby={`reviews-${slug}`} className="mt-14">
      {heading}
      <div className="mt-6 grid gap-8 nav:grid-cols-[320px_1fr]">
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card nav:self-start">
          <p className="font-heading text-5xl font-extrabold text-ink">{rating}</p>
          <div className="mt-2">
            <StarRating rating={avg} size="md" label={t('ratedBy', { rating, count: summary.count })} />
          </div>
          <p className="mt-1 text-sm text-muted">{t('count', { count: summary.count })}</p>
          <ul className="mt-5 space-y-2">
            {reviewShares(summary).map(({ stars, percent }) => (
              <li key={stars} className="grid grid-cols-[52px_1fr_40px] items-center gap-2 text-xs">
                <span className="font-bold text-ink">{t('stars', { n: stars })}</span>
                <span
                  role="img"
                  aria-label={t('starShare', { n: stars, percent })}
                  className="h-2 overflow-hidden rounded-full bg-pill"
                >
                  <span
                    className="block h-full rounded-full bg-star"
                    style={{ width: `${String(percent)}%` }}
                  />
                </span>
                <span aria-hidden="true" className="text-right text-muted tabular-nums">
                  {percent}%
                </span>
              </li>
            ))}
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
                  <span className="text-xs text-muted">{formatDate(r.createdAt, locale)}</span>
                </div>
                {/* Review text and names are user-written: shown as typed (hard rule 10 exception). */}
                {r.body ? (
                  <p data-user-content className="mt-2 text-sm leading-relaxed text-muted">
                    {r.body}
                  </p>
                ) : null}
                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {r.author ? (
                    <span data-user-content className="font-bold text-ink">
                      {r.author}
                    </span>
                  ) : (
                    <span className="font-bold text-ink">{t('api_customer')}</span>
                  )}
                  <span className="inline-flex items-center gap-1 font-bold text-success">
                    <BadgeCheck aria-hidden="true" className="size-3.5" />
                    {target === 'product' ? t('verifiedPurchase') : t('verifiedService')}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          {summary.count > reviews.length ? (
            <p className="mt-3 text-xs text-muted">
              {t('api_newest', { shown: reviews.length, count: summary.count })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Placeholder while the reviews stream in (same height as the summary card: no layout shift). */
export function ReviewsApiSkeleton() {
  return <div className="skeleton mt-14 h-72 rounded-card" aria-hidden="true" />;
}
