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
 * client code (home JS budget). Each card is ONE link, the whole card clickable through a stretched pseudo-element
 * on the title link, so there are no nested interactive elements; the description is plain text inside the card.
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
            <li
              key={key}
              className="relative flex gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card transition-colors duration-200 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus hover:border-accent"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-text">
                <Icon aria-hidden="true" className="size-6" />
              </span>
              <div className="min-w-0">
                <h3 className="font-heading text-lg font-extrabold text-ink">
                  <LocalLink
                    href={href}
                    data-track={track}
                    className="underline-offset-4 focus-visible:outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    {t(`${key}Title`)}
                  </LocalLink>
                </h3>
                <p className="mt-1 text-sm text-muted">{t(`${key}Body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
