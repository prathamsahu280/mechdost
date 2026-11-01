import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';
import { Container } from '../ui/page-intro';
import { SettingValue } from '../site/site-overrides';

/** Rich-text tags for admin settings inside copy: the server prints the default, the island the live value. */
const liveMinutes = (chunks: ReactNode) => <SettingValue setting="acceptMinutes" fallback={chunks} />;
const liveUnits = (chunks: ReactNode) => <SettingValue setting="bulkMinUnits" fallback={chunks} />;

const STOPS = [
  { n: 1, emoji: '🛒' },
  { n: 2, emoji: '🧭' },
  { n: 3, emoji: '🏪' },
  { n: 4, emoji: '🚚' },
] as const;

/**
 * "How your order reaches you" (decision 2026-11-01, home polish): the routing flow that sets MechDost apart —
 * customer → MechDost picks a verified shop → shop confirms within the timer → delivery — drawn as a dashed road
 * across a blueprint band. Server-only: no client JS.
 */
export function OrderRoute() {
  const t = useTranslations('home.route');
  return (
    <section aria-labelledby="route-title" className="pt-16">
      <Container>
        <div className="blueprint overflow-hidden rounded-hero px-6 py-10 text-white tab:px-12 tab:py-14">
          <p className="eyebrow text-accent-light">{t('eyebrow')}</p>
          <h2
            id="route-title"
            className="mt-4 max-w-3xl font-heading text-[clamp(28px,3.2vw,44px)] leading-[1.08] font-extrabold tracking-[-0.03em]"
          >
            {t('title')}
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-hero-copy">{t('lead')}</p>

          <ol aria-label={t('stopsLabel')} className="relative mt-10 grid gap-8 nav:grid-cols-4 nav:gap-6">
            {/* The road: vertical on phones, horizontal from 1024px, through the centre of each stop. */}
            <span
              aria-hidden="true"
              className="absolute top-7 bottom-7 left-7 border-l-2 border-dashed border-white/30 nav:right-[12%] nav:bottom-auto nav:left-[12%] nav:border-t-2 nav:border-l-0"
            />
            {STOPS.map(({ n, emoji }) => (
              <li key={n} className="relative flex gap-4 nav:flex-col nav:items-center nav:text-center">
                <span
                  aria-hidden="true"
                  className="grid size-14 shrink-0 place-items-center rounded-full bg-navy text-[26px] ring-2 ring-white/30"
                >
                  {emoji}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold text-accent-light tabular-nums">
                    {String(n).padStart(2, '0')}
                  </span>
                  <h3 className="mt-1 font-heading text-lg font-bold">{t(`step${n}Title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-hero-copy">
                    {t.rich(`step${n}Body`, { min: liveMinutes })}
                  </p>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            <ButtonLink href="/shop" data-track="home_route_shop" className="min-h-12 px-6">
              {t('cta')}
            </ButtonLink>
            <LocalLink
              href="/quotes/new"
              data-track="home_route_bulk"
              className="inline-flex min-h-11 items-center text-sm font-bold text-white underline-offset-4 hover:underline"
            >
              {t.rich('bulk', { min: liveUnits })}
            </LocalLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
