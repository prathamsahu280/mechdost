import { Siren } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';
import { Container } from '../ui/page-intro';

/**
 * Roadside help, shown where people look for it (spec 22 "Where it shows", user 2026-11-24: "really hard to find").
 * Server components, no client code (JS budget); the callers decide whether the city has roadside on, so this never
 * renders a dead end.
 *
 * - `RoadsideBand`: the home section right after the hero (admin can hide or move it in Admin, Layout). One primary
 *   action: "Get roadside help".
 * - `RoadsideCard`: the highlighted card at the top of /workshops and above search results that mean a breakdown. The
 *   link is a secondary (outlined) action there, because those pages already have their own primary action.
 */
export function RoadsideBand({ alwaysOpen }: { alwaysOpen: boolean }) {
  const t = useTranslations('roadside');
  const city = useTranslations('regions')('raipur');
  return (
    <section aria-labelledby="roadside-band-title" className="pt-10 tab:pt-12">
      <Container>
        <div className="flex flex-col gap-5 rounded-hero border border-accent/45 bg-accent-soft p-6 tab:flex-row tab:items-center tab:gap-6 tab:p-8">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-button text-white">
            <Siren aria-hidden="true" className="size-7" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="roadside-band-title"
              className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink"
            >
              {t('promoTitle')}
            </h2>
            <p className="mt-1.5 max-w-2xl text-[15px] text-ink">
              {t(alwaysOpen ? 'promoBodyAlways' : 'promoBody', { city })}
            </p>
          </div>
          <ButtonLink href="/roadside" data-track="home_roadside" className="self-start tab:self-center">
            {t('promoCta')}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

export function RoadsideCard({
  track,
  title = 'workshopsLink',
  className = '',
}: {
  track: string;
  title?: 'workshopsLink' | 'shopCardTitle';
  className?: string;
}) {
  const t = useTranslations('roadside');
  return (
    <aside
      aria-labelledby={`${track}-title`}
      className={`flex flex-col gap-4 rounded-card border border-accent/45 bg-accent-soft p-5 tab:flex-row tab:items-center ${className}`}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-button text-white">
        <Siren aria-hidden="true" className="size-6" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={`${track}-title`} className="font-heading text-lg font-extrabold text-ink">
          {t(title)}
        </h2>
        <p className="mt-0.5 text-sm text-ink">{t('workshopsCardBody')}</p>
      </div>
      <LocalLink
        href="/roadside"
        data-track={track}
        className="inline-flex min-h-11 items-center justify-center self-start rounded-button border-2 border-accent-button px-5 text-sm font-bold text-accent-soft-text transition-colors duration-200 hover:bg-accent-button hover:text-white tab:self-center"
      >
        {t('workshopsLinkCta')}
      </LocalLink>
    </aside>
  );
}
