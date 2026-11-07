import { Bike, Car, MapPin, Truck, Zap } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { localizeWorkshop } from '@/demo/i18n/localize';
import { DEMO_WORKSHOPS, fromPricePaise } from '@/demo/workshops';
import { formatPrice } from '@/lib/format';
import { workshopPhoto } from '@/lib/media';
import { stagger } from '@/lib/motion';
import { StarRating } from '../reviews/star-rating';
import { HideIfSuspended } from '../site/site-overrides';
import { ButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

/** Top-rated workshops (demo data; the API ranks by rating × review count per city). Server-only. */
export function TopWorkshops({ city }: { city: string }) {
  const t = useTranslations('home.workshops');
  const finder = useTranslations('finder');
  const locale = useLocale();
  const top = DEMO_WORKSHOPS.toSorted((a, b) => b.rating - a.rating || b.reviews - a.reviews)
    .slice(0, 3)
    .map((w) => localizeWorkshop(w, locale));
  return (
    <section aria-labelledby="top-workshops" className="pt-20 tab:pt-28">
      <Container>
        <div className="reveal flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow', { city })}</Eyebrow>
            <h2
              id="top-workshops"
              className="mt-4 font-heading text-[clamp(26px,2.8vw,36px)] font-extrabold tracking-[-0.03em] text-ink"
            >
              {t('title')}
            </h2>
          </div>
          <ButtonLink href="/workshops" variant="quiet" data-track="home_workshops_all">
            {t('viewAll')}
          </ButtonLink>
        </div>
        <ul className="mt-6 grid gap-4 tab:grid-cols-3">
          {top.map((w, i) => (
            <HideIfSuspended key={w.slug} kind="workshop" slug={w.slug}>
              <li className="reveal" style={stagger(i)}>
                <article className="group flex h-full flex-col overflow-hidden rounded-card border border-line-card bg-surface shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover">
                  <div className="relative aspect-[16/9] overflow-hidden bg-pill">
                    <Image
                      src={workshopPhoto(w.slug)}
                      alt=""
                      fill
                      sizes="(min-width: 760px) 30vw, 92vw"
                      className="object-cover transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:scale-[1.03]"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-2.5 left-2.5 grid size-9 place-items-center rounded-full bg-surface/95 text-ink shadow-card"
                    >
                      {w.vehicles.includes('4W') ? (
                        <Car className="size-[18px]" strokeWidth={2} />
                      ) : (
                        <Bike className="size-[18px]" strokeWidth={2} />
                      )}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0">
                        <h3 className="font-heading text-lg leading-snug font-extrabold text-ink">
                          <LocalLink href={`/workshops/${w.slug}`} className="hover:underline">
                            {w.name}
                          </LocalLink>
                        </h3>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                          <MapPin aria-hidden="true" className="size-4 shrink-0" />
                          {w.area} · {w.pincode}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 flex items-center gap-2 text-sm">
                      <StarRating
                        rating={w.rating}
                        label={finder('rating', { rating: w.rating.toFixed(1), count: w.reviews })}
                      />
                      <span aria-hidden="true" className="font-bold text-ink">
                        {w.rating.toFixed(1)}
                      </span>
                      <span aria-hidden="true" className="text-muted">
                        {t('reviews', { count: w.reviews })}
                      </span>
                    </p>
                    <ul className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                      <li className="rounded-md bg-pill px-2 py-1 text-ink">{w.vehicles.join(' · ')}</li>
                      {w.pickup ? (
                        <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
                          <Truck aria-hidden="true" className="size-3.5" />
                          {t('pickup')}
                        </li>
                      ) : null}
                      {w.ev ? (
                        <li className="inline-flex items-center gap-1 rounded-md bg-pill px-2 py-1 text-ink">
                          <Zap aria-hidden="true" className="size-3.5" />
                          {t('ev')}
                        </li>
                      ) : null}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <p className="text-sm font-bold text-ink">
                        {t('from', { price: formatPrice(fromPricePaise(w)) })}
                      </p>
                      <ButtonLink
                        href={`/workshops/${w.slug}`}
                        data-track={`home_workshop_${w.slug}`}
                        className="min-h-11 px-4"
                      >
                        {finder('view')}
                      </ButtonLink>
                    </div>
                  </div>
                </article>
              </li>
            </HideIfSuspended>
          ))}
        </ul>
      </Container>
    </section>
  );
}
