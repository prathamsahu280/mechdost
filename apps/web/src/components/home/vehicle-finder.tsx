import { ArrowRight, Bike, Car, PlugZap, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VehicleFilter } from '@/demo/catalogue';
import { stagger } from '@/lib/motion';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

const CHOICES: { vehicle: VehicleFilter; key: 'twoW' | 'fourW' | 'ev'; icon: LucideIcon }[] = [
  { vehicle: '2W', key: 'twoW', icon: Bike },
  { vehicle: '4W', key: 'fourW', icon: Car },
  { vehicle: 'EV', key: 'ev', icon: PlugZap },
];

/**
 * Search by vehicle (redesign 2026-11-05, boodmo-inspired): three big choices that open the shop filtered to parts
 * that fit (`/shop?vehicle=2W|4W|EV`). Make/model search waits for the vehicle master (pending decision).
 */
export function VehicleFinder() {
  const t = useTranslations('home.vehicle');
  return (
    <section aria-labelledby="vehicle-title" className="pt-20 tab:pt-24">
      <Container>
        <div className="reveal max-w-2xl">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2
            id="vehicle-title"
            className="mt-4 font-heading text-[clamp(28px,3vw,40px)] font-extrabold tracking-[-0.03em] text-ink"
          >
            {t('title')}
          </h2>
          <p className="mt-3 text-[15px] text-muted">{t('lead')}</p>
        </div>
        <ul className="mt-8 grid grid-cols-1 gap-3 tab:grid-cols-3 tab:gap-4">
          {CHOICES.map(({ vehicle, key, icon: Icon }, i) => (
            <li key={vehicle} className="reveal" style={stagger(i)}>
              <LocalLink
                href="/shop"
                query={{ vehicle }}
                data-track={`home_vehicle_${vehicle}`}
                className="group press flex h-full items-center gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card transition-[box-shadow,border-color] duration-[var(--duration-base)] hover:border-accent hover:shadow-card-hover"
              >
                <span
                  aria-hidden="true"
                  className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-soft-text transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-soft)] group-hover:-translate-y-0.5"
                >
                  <Icon className="size-8" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-heading text-lg font-extrabold text-ink">{t(key)}</span>
                  <span className="mt-0.5 block text-sm text-muted">{t(`${key}Hint`)}</span>
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-accent-soft-text">
                  <span className="sr-only min-[480px]:not-sr-only">{t('cta')}</span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform duration-[var(--duration-base)] group-hover:translate-x-0.5"
                    strokeWidth={2.5}
                  />
                </span>
              </LocalLink>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
