import { ArrowRight, BatteryCharging, Bike, CarFront, Disc3, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SERVICE_MENU } from '@/demo/workshops';
import { formatPrice } from '@/lib/format';
import { stagger } from '@/lib/motion';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

const SERVICES: {
  key: 'routine2w' | 'routine4w' | 'brakes' | 'battery';
  icon: LucideIcon;
  vehicle?: '2W' | '4W';
}[] = [
  { key: 'routine2w', icon: Bike, vehicle: '2W' },
  { key: 'routine4w', icon: CarFront, vehicle: '4W' },
  { key: 'brakes', icon: Disc3 },
  { key: 'battery', icon: BatteryCharging },
];

/**
 * Popular workshop services (redesign 2026-11-05, Fixter-inspired "most popular services"): four cards with the
 * lowest listed price from the service menu and a link to the finder (pre-filtered by vehicle where it applies).
 * Prices come from the same data the workshop pages show, so the "From" figure is never invented.
 */
export function PopularServices({ city }: { city: string }) {
  const t = useTranslations('home.services');
  return (
    <section aria-labelledby="services-title" className="pt-20 tab:pt-28">
      <Container>
        <div className="reveal max-w-2xl">
          <Eyebrow>{t('eyebrow', { city })}</Eyebrow>
          <h2
            id="services-title"
            className="mt-4 font-heading text-[clamp(28px,3vw,40px)] font-extrabold tracking-[-0.03em] text-ink"
          >
            {t('title')}
          </h2>
        </div>
        <ul className="mt-8 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
          {SERVICES.map(({ key, icon: Icon, vehicle }, i) => (
            <li key={key} className="reveal" style={stagger(i)}>
              <LocalLink
                href="/workshops"
                query={vehicle ? { vehicle } : undefined}
                data-track={`home_service_${key}`}
                className="group press flex h-full flex-col overflow-hidden rounded-card border border-line-card bg-surface text-center shadow-card transition-shadow duration-[var(--duration-base)] hover:shadow-card-hover"
              >
                <span aria-hidden="true" className="h-1.5 w-full bg-accent-button" />
                <span className="flex flex-1 flex-col items-center px-5 pt-6 pb-5">
                  <span
                    aria-hidden="true"
                    className="grid size-14 place-items-center rounded-full bg-accent-button text-white shadow-card transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:-translate-y-0.5"
                  >
                    <Icon className="size-7" strokeWidth={1.75} />
                  </span>
                  <span className="mt-4 block font-heading text-lg font-extrabold text-ink">{t(key)}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {t('from', { price: formatPrice(SERVICE_MENU[key].minPaise) })}
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-bold text-accent-soft-text">
                    {t('cta')}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform duration-[var(--duration-base)] group-hover:translate-x-0.5"
                      strokeWidth={2.5}
                    />
                  </span>
                </span>
              </LocalLink>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
