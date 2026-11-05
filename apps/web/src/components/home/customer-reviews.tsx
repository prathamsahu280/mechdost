import { BadgeCheck, Quote } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { workshopReviews } from '@/demo/reviews';
import { DEMO_WORKSHOPS } from '@/demo/workshops';
import { getPathname } from '@/i18n/navigation';
import { StarRating } from '../reviews/star-rating';
import { Container } from '../ui/page-intro';
import { Rail } from './rail';

/**
 * Customer reviews (redesign 2026-11-05, Fixter-inspired testimonials): an overall rating from every workshop's
 * reviews and a rail of the best recent ones, each naming the workshop. Demo seed reviews until the reviews API
 * (spec 10) — the summary is computed from the same data the workshop pages show.
 */
export function CustomerReviews() {
  const t = useTranslations('home.reviews');
  const workshops = useTranslations('home.workshops');
  const locale = useLocale();
  const count = DEMO_WORKSHOPS.reduce((n, w) => n + w.reviews, 0);
  const rating = DEMO_WORKSHOPS.reduce((sum, w) => sum + w.rating * w.reviews, 0) / Math.max(1, count);
  const items = DEMO_WORKSHOPS.flatMap((w) => workshopReviews(w).map((r) => ({ ...r, workshop: w })))
    .filter((r) => r.rating >= 5)
    // The seed pool repeats titles across workshops; show each story once.
    .filter((r, i, all) => all.findIndex((x) => x.title === r.title) === i)
    .slice(0, 8);
  const summary = t('summary', { rating: rating.toFixed(1), count });

  return (
    <section aria-labelledby="reviews-title" className="pt-20 tab:pt-28">
      <Container>
        <h2 id="reviews-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="reveal mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StarRating rating={rating} size="md" label={summary} />
          <span aria-hidden="true" className="font-bold text-ink">
            {summary}
          </span>
        </div>
        <Rail
          id="reviews-rail"
          title={t('title')}
          viewAll={{
            href: getPathname({ href: '/workshops', locale }),
            label: workshops('viewAll'),
            track: 'home_reviews_all',
          }}
          labels={{ prev: t('prev'), next: t('next') }}
        >
          {items.map((r) => (
            <li key={r.id} className="w-[min(84vw,360px)] shrink-0 snap-start">
              <figure className="flex h-full flex-col rounded-card border border-line-card bg-surface p-6 shadow-card">
                <Quote aria-hidden="true" className="size-7 text-accent-light" strokeWidth={1.5} />
                <StarRating rating={r.rating} label={`${String(r.rating)} / 5`} />
                <blockquote className="mt-3 flex-1">
                  <p className="font-heading text-[17px] leading-snug font-bold text-ink">{r.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{r.body}</p>
                </blockquote>
                <figcaption className="mt-5 border-t border-line pt-4 text-sm">
                  <span className="block font-bold text-ink">
                    {r.name}, {r.area}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1 text-success">
                      <BadgeCheck aria-hidden="true" className="size-3.5" />
                      {t('verified')}
                    </span>
                    <span>{t('at', { workshop: r.workshop.name })}</span>
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </Rail>
      </Container>
    </section>
  );
}
