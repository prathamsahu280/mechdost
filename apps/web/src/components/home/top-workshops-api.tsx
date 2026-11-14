import { getLocale, getTranslations } from 'next-intl/server';
import { VEHICLE_ICON } from '@mechdost/shared/vehicles';
import { formatPrice } from '@/lib/format';
import { fromPaise } from '@/lib/service-views';
import { fetchTopWorkshops } from '@/lib/workshops-api-source';
import { StarRating } from '../reviews/star-rating';
import { ButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

/**
 * Top-rated workshops of the city from the API (data mode `api`, Stream E): the city's bookable workshops ranked by
 * rating and review count. No workshops yet → one next action ("Find a workshop"); API unreachable → the section
 * is left out (the rest of the home page still renders). Server-only, no client JS.
 */
export async function TopWorkshopsApi({ city }: { city: string }) {
  const locale = await getLocale();
  const [top, t, finder, w] = await Promise.all([
    fetchTopWorkshops(locale),
    getTranslations('home.workshops'),
    getTranslations('finder'),
    getTranslations('workshop'),
  ]);
  if (top === null) return null;
  return (
    <section aria-labelledby="top-workshops" className="pt-16">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow', { city })}</Eyebrow>
            <h2
              id="top-workshops"
              className="mt-4 font-heading text-[clamp(26px,2.8vw,36px)] font-extrabold tracking-[-0.03em] text-ink"
            >
              {t('title')}
            </h2>
          </div>
          {top.length > 0 ? (
            <ButtonLink href="/workshops" variant="quiet" data-track="home_workshops_all">
              {t('viewAll')}
            </ButtonLink>
          ) : null}
        </div>
        {top.length === 0 ? (
          <div className="mt-6 rounded-card border border-line-card bg-surface p-6 shadow-card">
            <p className="text-ink">{w('api_homeEmpty', { city })}</p>
            <ButtonLink href="/workshops" data-track="home_workshops_empty" className="mt-4">
              {w('api_homeEmptyCta')}
            </ButtonLink>
          </div>
        ) : (
          <ul className="mt-6 grid gap-4 tab:grid-cols-3">
            {top.map((ws) => {
              const from = fromPaise(ws.services);
              const rating = ws.ratingAvg;
              return (
                <li key={ws.slug}>
                  <article className="flex h-full flex-col rounded-card border border-line-card bg-surface p-5 shadow-card">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
                      >
                        {VEHICLE_ICON[ws.vehicleTypes.includes('4W') ? '4W' : (ws.vehicleTypes[0] ?? '2W')]}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-heading text-lg leading-snug font-extrabold text-ink">
                          <LocalLink href={`/workshops/${ws.slug}`} className="hover:underline">
                            {ws.name}
                          </LocalLink>
                        </h3>
                        <p className="text-sm text-muted">
                          <span aria-hidden="true">📍 </span>
                          {ws.area} · {ws.pincode}
                        </p>
                      </div>
                    </div>
                    {rating !== null && ws.ratingCount > 0 ? (
                      <p className="mt-4 flex items-center gap-2 text-sm">
                        <StarRating
                          rating={rating}
                          label={finder('rating', { rating: rating.toFixed(1), count: ws.ratingCount })}
                        />
                        <span aria-hidden="true" className="font-bold text-ink">
                          {rating.toFixed(1)}
                        </span>
                        <span aria-hidden="true" className="text-muted">
                          {t('reviews', { count: ws.ratingCount })}
                        </span>
                      </p>
                    ) : (
                      <p className="mt-4 text-sm font-bold text-success">{w('api_newOnMechdost')}</p>
                    )}
                    <ul className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                      <li className="rounded-md bg-pill px-2 py-1 text-ink">{ws.vehicleTypes.join(' · ')}</li>
                      {ws.pickup ? (
                        <li className="rounded-md bg-pill px-2 py-1 text-ink">
                          <span aria-hidden="true">🚐 </span>
                          {t('pickup')}
                        </li>
                      ) : null}
                      {ws.evBasic ? (
                        <li className="rounded-md bg-pill px-2 py-1 text-ink">
                          <span aria-hidden="true">⚡ </span>
                          {t('ev')}
                        </li>
                      ) : null}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      {from !== null ? (
                        <p className="text-sm font-bold text-ink">
                          {t('from', { price: formatPrice(from) })}
                        </p>
                      ) : (
                        <span />
                      )}
                      <ButtonLink
                        href={`/workshops/${ws.slug}`}
                        data-track={`home_workshop_${ws.slug}`}
                        className="min-h-11 px-4"
                      >
                        {finder('view')}
                      </ButtonLink>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </Container>
    </section>
  );
}
