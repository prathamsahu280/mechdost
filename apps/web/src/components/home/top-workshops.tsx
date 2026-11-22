import { useLocale, useTranslations } from 'next-intl';
import { localizeWorkshop } from '@/demo/i18n/localize';
import { DEMO_WORKSHOPS, fromPricePaise } from '@/demo/workshops';
import { formatPrice } from '@/lib/format';
import { StarRating } from '../reviews/star-rating';
import { HideIfSuspended } from '../site/site-overrides';
import { ButtonLink } from '../ui/button-link';
import { VEHICLE_ICON } from '@mechdost/shared/vehicles';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';
import { DATA_MODE } from '@/lib/data-mode';
import { TopWorkshopsApi } from './top-workshops-api';

/** Top-rated workshops: from the API in real data mode (Stream E), else the demo data. Server-only. */
export function TopWorkshops({ region }: { region: string }) {
  return DATA_MODE === 'api' ? <TopWorkshopsApi region={region} /> : <DemoTopWorkshops region={region} />;
}

/** Top-rated workshops (demo data; the API ranks by rating × review count per region). Server-only. */
function DemoTopWorkshops({ region }: { region: string }) {
  const t = useTranslations('home.workshops');
  const finder = useTranslations('finder');
  const locale = useLocale();
  const top = DEMO_WORKSHOPS.toSorted((a, b) => b.rating - a.rating || b.reviews - a.reviews)
    .slice(0, 3)
    .map((w) => localizeWorkshop(w, locale));
  return (
    <section aria-labelledby="top-workshops" className="pt-16">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow', { region })}</Eyebrow>
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
          {top.map((w) => (
            <HideIfSuspended key={w.slug} kind="workshop" slug={w.slug}>
              <li>
                <article className="flex h-full flex-col rounded-card border border-line-card bg-surface p-5 shadow-card">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
                    >
                      {VEHICLE_ICON[w.vehicles.includes('4W') ? '4W' : (w.vehicles[0] ?? '2W')]}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-heading text-lg leading-snug font-extrabold text-ink">
                        <LocalLink href={`/workshops/${w.slug}`} className="hover:underline">
                          {w.name}
                        </LocalLink>
                      </h3>
                      <p className="text-sm text-muted">
                        <span aria-hidden="true">📍 </span>
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
                      <li className="rounded-md bg-pill px-2 py-1 text-ink">
                        <span aria-hidden="true">🚐 </span>
                        {t('pickup')}
                      </li>
                    ) : null}
                    {w.ev ? (
                      <li className="rounded-md bg-pill px-2 py-1 text-ink">
                        <span aria-hidden="true">⚡ </span>
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
                </article>
              </li>
            </HideIfSuspended>
          ))}
        </ul>
      </Container>
    </section>
  );
}
