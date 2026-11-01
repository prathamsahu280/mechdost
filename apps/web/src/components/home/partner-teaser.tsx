import { Handshake } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ButtonLink } from '../ui/button-link';
import { Container, Eyebrow } from '../ui/page-intro';

/** Partner recruitment teaser (concept §3.7 / plan §10), linking to the partners page. */
export function PartnerTeaser() {
  const t = useTranslations('home.partners');
  return (
    <section aria-labelledby="partners-teaser" className="pt-16">
      <Container>
        <div className="grid items-center gap-6 rounded-hero border border-line-card bg-surface p-8 shadow-card tab:grid-cols-[auto_1fr_auto] tab:p-10">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-text">
            <Handshake aria-hidden="true" className="size-8" />
          </span>
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2
              id="partners-teaser"
              className="mt-2 font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink"
            >
              {t('title')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">{t('body')}</p>
          </div>
          <ButtonLink href="/partners" data-track="home_partners">
            {t('action')}
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
