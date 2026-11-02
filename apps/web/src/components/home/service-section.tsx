import { useTranslations } from 'next-intl';
import { stagger } from '@/lib/motion';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

const STEPS = [1, 2, 3] as const;

/** "Know the work. Approve the cost." band with the three request steps (concept §3.3). */
export function ServiceSection({ city }: { city: string }) {
  const t = useTranslations('home.service');
  return (
    <section aria-labelledby="service-title" className="mt-16 bg-surface-alt py-14 tab:py-16">
      <Container className="grid gap-10 tab:grid-cols-2 tab:items-start">
        <div className="reveal">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2
            id="service-title"
            className="mt-5 font-heading text-[clamp(32px,3.6vw,48px)] leading-[1.05] font-extrabold tracking-[-0.035em] text-ink"
          >
            {t('titleLine1')}
            <br />
            {t('titleLine2')}
          </h2>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted">{t('lead')}</p>
          <ButtonLink href="/workshops" data-track="home_service_find_workshop" className="mt-6">
            {t('cta')}
          </ButtonLink>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">{t('note', { city })}</p>
        </div>
        {/* One card, one list (user 2026-11-02): steps are rows separated by hairlines, joined by a rail. */}
        <ol
          aria-label={t('stepsLabel')}
          className="reveal-panel divide-y divide-line rounded-card border border-line-card bg-surface px-6 shadow-card tab:px-7"
        >
          {STEPS.map((n, i) => (
            <li key={n} style={stagger(i + 1)} className="reveal relative flex gap-4 py-6">
              {n < STEPS.length ? (
                <span
                  aria-hidden="true"
                  className="absolute top-[4.25rem] bottom-[-1.5rem] left-[1.375rem] w-px bg-line-card"
                />
              ) : null}
              <span
                aria-hidden="true"
                className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-heading text-sm font-extrabold text-accent-soft-text"
              >
                {String(n).padStart(2, '0')}
              </span>
              <span>
                <h3 className="font-heading text-lg font-bold text-ink">{t(`step${n}Title`)}</h3>
                <p className="mt-1.5 text-sm text-muted">{t(`step${n}Body`)}</p>
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
