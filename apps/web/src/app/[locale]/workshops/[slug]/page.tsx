import { BadgeCheck, Clock, MapPin, Star, Truck, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container } from '@/components/ui/page-intro';
import { BookingForm } from '@/components/workshops/booking-form';
import { DEMO_WORKSHOPS, findWorkshop } from '@/demo/workshops';
import { routing, type Locale } from '@/i18n/routing';
import { formatDate, formatPrice } from '@/lib/format';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
}

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => DEMO_WORKSHOPS.map((w) => ({ locale, slug: w.slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const w = findWorkshop(slug);
  if (!w) return {};
  return {
    title: w.name,
    description: `${w.area}, Raipur · ${w.services.map((s) => s.name).join(', ')}`,
    alternates: alternatesFor(`/workshops/${slug}`, locale),
  };
}

/** Workshop profile (spec 06): verification, hours, service menu with price ranges, appointment request. */
export default async function WorkshopPage({ params }: Props) {
  const { slug } = await params;
  const w = findWorkshop(slug);
  if (!w) notFound();
  const [t, f, locale] = await Promise.all([
    getTranslations('workshop'),
    getTranslations('finder'),
    getLocale(),
  ]);

  return (
    <Container className="py-8 tab:py-12">
      <LocalLink href="/workshops" className="text-sm font-bold text-ink hover:underline">
        ← {t('back')}
      </LocalLink>

      <header className="mt-5 rounded-hero bg-navy p-6 text-white tab:p-10">
        <p className="eyebrow inline-flex items-center gap-1.5 text-accent-light">
          <BadgeCheck aria-hidden="true" className="size-4" />
          {t('checkedOn', { date: formatDate(w.checkedOn, locale) })}
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
            {w.hours}
          </li>
          <li className="flex items-center gap-1.5">
            <Star aria-hidden="true" className="size-4 fill-current text-accent-light" />
            {f('rating', { rating: w.rating.toFixed(1), count: w.reviews })}
          </li>
          {w.pickup ? (
            <li className="flex items-center gap-1.5">
              <Truck aria-hidden="true" className="size-4" />
              {f('pickup')}
            </li>
          ) : null}
          {w.ev ? (
            <li className="flex items-center gap-1.5">
              <Zap aria-hidden="true" className="size-4" />
              {f('ev')}
            </li>
          ) : null}
        </ul>
      </header>

      <div className="mt-8 grid gap-8 nav:grid-cols-[1fr_420px] nav:items-start">
        <section aria-labelledby="menu-title">
          <h2 id="menu-title" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {t('services')}
          </h2>
          <ul className="mt-4 grid gap-3">
            {w.services.map((s) => (
              <li
                key={s.key}
                className="reveal rounded-tile border border-line-card bg-surface p-5 shadow-card"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-heading font-bold text-ink">{s.name}</h3>
                  <p className="font-heading font-extrabold text-ink">
                    {t('range', { min: formatPrice(s.minPaise), max: formatPrice(s.maxPaise) })}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t('duration', { duration: s.duration })} · {s.vehicle === 'both' ? '2W · 4W' : s.vehicle}
                </p>
                <p className="mt-2 text-sm text-muted">
                  <span className="font-bold text-ink">{t('included')}:</span> {s.included}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="book-title"
          className="rounded-card border border-line-card bg-surface p-6 shadow-card nav:sticky nav:top-28"
        >
          <h2 id="book-title" className="font-heading text-xl font-extrabold text-ink">
            {t('bookTitle')}
          </h2>
          <p className="mt-2 text-sm text-muted">{t('bookIntro')}</p>
          <div className="mt-5">
            <ClientMessages namespaces={['workshop', 'checkout']}>
              <BookingForm workshop={w} />
            </ClientMessages>
          </div>
        </section>
      </div>
    </Container>
  );
}
