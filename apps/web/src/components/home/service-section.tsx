import { useTranslations } from 'next-intl';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

const STEPS = [1, 2, 3] as const;

/** "Know the work. Approve the cost." band with the three request steps (concept §3.3). */
export function ServiceSection({ city }: { city: string }) {
  const t = useTranslations('home.service');
  return (
    <section aria-labelledby="service-title" className="mt-16 bg-surface-alt py-14 tab:py-16">
      <Container className="grid gap-10 tab:grid-cols-2 tab:items-start">
        <div>
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
        <ol aria-label={t('stepsLabel')} className="space-y-4">
          {STEPS.map((n) => (
            <li key={n} className="reveal flex gap-4 rounded-tile bg-surface p-6 shadow-card">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-heading text-sm font-extrabold text-accent-soft-text"
              >
                {String(n).padStart(2, '0')}
              </span>
              <span>
                <h3 className="font-heading text-lg font-bold text-ink">{t(`step${n}Title`)}</h3>
                <p className="mt-2 text-sm text-muted">{t(`step${n}Body`)}</p>
              </span>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
