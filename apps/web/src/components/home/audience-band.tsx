import { Building2, CarFront, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { Container, Eyebrow } from '../ui/page-intro';

const CARDS = [
  { key: 'retail', href: '/shop', track: 'home_audience_retail', Icon: CarFront },
  { key: 'garages', href: '/business/garages', track: 'home_audience_garages', Icon: Wrench },
  { key: 'fleets', href: '/business/fleets', track: 'home_audience_fleets', Icon: Building2 },
] as const;

/**
 * "Who are you shopping for?" (design 2026-11-22): three entry paths right after the hero. Server component, no
 * client code (home JS budget). Each card IS one link, named by all its visible text (WCAG 2.5.3 label in name), focus
 * ring on the link itself; a stretched ::after overlay painted over the title and hid the ring from the focused element (state
 * audit 2026-11-22). No nested interactive elements.
 */
export function AudienceBand() {
  const t = useTranslations('home.audiences');
  return (
    <section aria-labelledby="audiences-title" className="pt-10 tab:pt-12">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2
          id="audiences-title"
          className="mt-2 font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink"
        >
          {t('title')}
        </h2>
        <ul className="mt-5 grid gap-4 tab:grid-cols-3">
          {CARDS.map(({ key, href, track, Icon }) => (
            <li key={key}>
              <LocalLink
                href={href}
                data-track={track}
                className="group flex h-full min-h-11 gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card transition-colors duration-200 hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-text">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
                <span className="min-w-0">
                  <span
                    id={`audience-${key}-title`}
                    className="block font-heading text-lg font-extrabold text-ink underline-offset-4 group-hover:underline"
                  >
                    {t(`${key}Title`)}
                  </span>
                  <span id={`audience-${key}-body`} className="mt-1 block text-sm text-muted">
                    {t(`${key}Body`)}
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
