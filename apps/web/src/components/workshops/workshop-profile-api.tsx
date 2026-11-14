import { BadgeCheck, Clock, Home, MapPin, Star, Truck, Zap } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import type { PublicWorkshop } from '@mechdost/shared/service-api';
import { Suspense } from 'react';
import { ReviewsApiSection, ReviewsApiSkeleton } from '@/components/reviews/reviews-api-section';
import { LabourPromise } from '@/components/site/labour-promise';
import { TrustLine } from '@/components/site/trust-line';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container } from '@/components/ui/page-intro';
import { formatPrice } from '@/lib/format';
import { visitFeeGstPaise } from '@/lib/home-service-views';
import { directionsHref, mapUi } from '@/lib/map-ui';
import { daysLabel, durationParts } from '@/lib/service-views';
import { WorkshopGalleryLazy } from '@/components/photos/photos-lazy';
import { BookingFormLazy } from './booking-form-lazy';
import { WorkshopMap } from './workshop-map';

/**
 * Workshop profile from the API (data mode `api`, spec 06, Stream E): verification, hours, the active service menu
 * with price ranges and times, map and the appointment request. Texts come localised from the API (`?locale=`).
 * Approved reviews stream in below the map (`ReviewsApiSection`, server-rendered).
 */
export async function WorkshopProfileApi({ workshop: w }: { workshop: PublicWorkshop }) {
  const [t, f, m, h, locale] = await Promise.all([
    getTranslations('workshop'),
    getTranslations('finder'),
    getTranslations('map'),
    getTranslations('homeService'),
    getLocale(),
  ]);
  const hours = `${daysLabel(w.hours.days, locale)} · ${w.hours.open}–${w.hours.close}`;
  const duration = (min: number, max: number) => {
    const d = durationParts(min, max);
    return d.unit === 'min'
      ? t('api_durationMin', { min: d.min, max: d.max })
      : t('api_durationHours', { min: d.min, max: d.max });
  };

  return (
    <Container className="py-8 tab:py-12">
      <LocalLink href="/workshops" className="text-sm font-bold text-ink hover:underline">
        ← {t('back')}
      </LocalLink>

      <header className="mt-5 rounded-hero bg-navy p-6 text-white tab:p-10">
        <p className="eyebrow inline-flex items-center gap-1.5 text-accent-light">
          <BadgeCheck aria-hidden="true" className="size-4" />
          {t('api_checked')}
        </p>
        <h1 className="mt-3 font-heading text-[clamp(28px,3.6vw,48px)] leading-tight font-extrabold tracking-[-0.03em]">
          {w.name}
        </h1>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-hero-copy">
          <li className="flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-4" />
            {w.address} · {w.pincode}
          </li>
          <li className="flex items-center gap-1.5">
            <Clock aria-hidden="true" className="size-4" />
            {hours}
          </li>
          {w.ratingAvg !== null && w.ratingCount > 0 ? (
            <li className="flex items-center gap-1.5">
              <Star aria-hidden="true" className="size-4 fill-current text-accent-light" />
              {f('rating', { rating: w.ratingAvg.toFixed(1), count: w.ratingCount })}
            </li>
          ) : null}
          {w.pickup ? (
            <li className="flex items-center gap-1.5">
              <Truck aria-hidden="true" className="size-4" />
              {f('pickup')}
            </li>
          ) : null}
          {w.evBasic ? (
            <li className="flex items-center gap-1.5">
              <Zap aria-hidden="true" className="size-4" />
              {f('ev')}
            </li>
          ) : null}
          {/* Trust lines (design 2026-11-15): the verified-workshop line, and the labour promise while the admin has it on. */}
          <TrustLine
            placement="workshop"
            as="li"
            className="before:mr-1.5 before:font-bold before:text-accent-light before:content-['✓']"
          />
          <LabourPromise
            days={w.labourPromiseDays}
            className="before:mr-1.5 before:font-bold before:text-accent-light before:content-['✓']"
          />
          {w.home ? (
            <li className="flex items-center gap-1.5">
              <Home aria-hidden="true" className="size-4" />
              {h('homeBadge')} · {h('cardRadius', { km: w.home.radiusKm })} ·{' '}
              {w.home.visitFeePaise === 0
                ? h('cardFeeFree')
                : visitFeeGstPaise(w.home.visitFeePaise, w.gstRegistered) > 0
                  ? h('cardFeeGst', {
                      fee: formatPrice(w.home.visitFeePaise),
                      gst: formatPrice(visitFeeGstPaise(w.home.visitFeePaise, w.gstRegistered)),
                    })
                  : h('cardFee', { fee: formatPrice(w.home.visitFeePaise) })}
            </li>
          ) : null}
        </ul>
      </header>

      <div className="mt-8 grid gap-8 nav:grid-cols-[1fr_420px] nav:items-start">
        <section aria-labelledby="menu-title">
          <h2 id="menu-title" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {t('services')}
          </h2>
          {w.services.length === 0 ? (
            <p className="mt-4 rounded-tile border border-line-card bg-surface p-5 text-sm text-muted">
              {t('api_menuEmpty')}
            </p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {w.services.map((s) => (
                <li key={s.key} className="rounded-tile border border-line-card bg-surface p-5 shadow-card">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-heading font-bold text-ink">{s.title}</h3>
                    <p className="font-heading font-extrabold text-ink">
                      {t('range', { min: formatPrice(s.lowPaise), max: formatPrice(s.highPaise) })}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t('duration', { duration: duration(s.minMinutes, s.maxMinutes) })} ·{' '}
                    {s.vehicleType ?? w.vehicleTypes.join(' · ')}
                  </p>
                  {s.included ? (
                    <p className="mt-2 text-sm text-muted">
                      <span className="font-bold text-ink">{t('included')}:</span> {s.included}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-10 font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {t('address')}
          </h2>
          <WorkshopMap
            points={[
              {
                slug: w.slug,
                name: w.name,
                lat: w.lat,
                lng: w.lng,
                href: `#book-title`,
                detail: w.address,
                rating: w.ratingAvg ?? 0,
              },
            ]}
            label={f('mapLabel')}
            youAreHere={f('youAreHere')}
            ui={mapUi(m)}
            locale={locale}
            className="mt-4 h-[320px]"
          />
          <p className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>{w.address}</span>
            <a
              href={directionsHref(w.lat, w.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-button border border-input-border px-4 font-bold text-ink hover:bg-pill"
            >
              <MapPin aria-hidden="true" className="size-4" />
              {f('directions')}
            </a>
          </p>

          <ClientMessages namespaces={['photos']}>
            <WorkshopGalleryLazy slug={w.slug} />
          </ClientMessages>

          <Suspense fallback={<ReviewsApiSkeleton />}>
            <ReviewsApiSection target="workshop" slug={w.slug} />
          </Suspense>
        </section>

        <section
          aria-labelledby="book-title"
          className="rounded-card border border-line-card bg-surface p-6 shadow-card nav:sticky nav:top-28"
        >
          <h2 id="book-title" className="font-heading text-xl font-extrabold text-ink">
            {t('bookTitle')}
          </h2>
          <p className="mt-2 text-sm text-muted">{t('bookIntro')}</p>
          <LabourPromise
            days={w.labourPromiseDays}
            variant="full"
            as="p"
            className="mt-2 text-sm font-bold text-ink"
          />
          <div className="mt-5">
            <ClientMessages namespaces={['workshop', 'request', 'homeService']}>
              <BookingFormLazy
                workshop={{
                  slug: w.slug,
                  name: w.name,
                  vehicleTypes: w.vehicleTypes,
                  pickup: w.pickup,
                  gstRegistered: w.gstRegistered,
                  home: w.home,
                  services: w.services.map((s) => ({
                    key: s.key,
                    title: s.title,
                    lowPaise: s.lowPaise,
                    highPaise: s.highPaise,
                    vehicleType: s.vehicleType,
                    homeAvailable: s.homeAvailable,
                  })),
                }}
              />
            </ClientMessages>
          </div>
        </section>
      </div>
    </Container>
  );
}
