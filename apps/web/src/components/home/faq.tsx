import { ChevronDown, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { stagger } from '@/lib/motion';
import { whatsappLink } from '@/lib/site';
import { Container, Eyebrow } from '../ui/page-intro';

const ITEMS = [1, 2, 3, 4, 5, 6] as const;

/**
 * FAQ (concept `.automart-faq`, which never rendered — concept bug #6). Native <details> (no JS) plus FAQPage
 * structured data for search. Copy lives in the locale files now; admin-editable via content blocks in Phase 1
 * (spec 08).
 */
export function Faq() {
  const t = useTranslations('home.faq');
  const wa = useTranslations('whatsapp');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ITEMS.map((n) => ({
      '@type': 'Question',
      name: t(`q${n}`),
      acceptedAnswer: { '@type': 'Answer', text: t(`a${n}`) },
    })),
  };
  return (
    <section aria-labelledby="faq-title" className="pt-16">
      <Container className="grid gap-8 nav:grid-cols-[1fr_1.6fr]">
        <div className="reveal">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h2
            id="faq-title"
            className="mt-4 font-heading text-[clamp(26px,2.8vw,36px)] font-extrabold tracking-[-0.03em] text-ink"
          >
            {t('title')}
          </h2>
          <a
            href={whatsappLink(wa('general'))}
            target="_blank"
            rel="noopener noreferrer"
            data-track="home_faq_whatsapp"
            className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
          >
            <MessageCircle aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.25} />
            {t('more')}
          </a>
        </div>
        {/* One card, one list (user 2026-11-02): questions are rows separated by hairlines. */}
        <ul className="reveal-panel divide-y divide-line overflow-hidden rounded-card border border-line-card bg-surface shadow-card">
          {ITEMS.map((n, i) => (
            <li key={n} style={stagger(i)} className="reveal">
              <details className="group transition-colors duration-[var(--duration-base)] open:bg-surface-alt/60">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 font-heading font-bold text-ink hover:bg-surface-alt/60 [&::-webkit-details-marker]:hidden">
                  {t(`q${n}`)}
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-pill transition-colors duration-[var(--duration-base)] group-open:bg-accent-soft"
                  >
                    <ChevronDown className="size-4 text-muted transition-transform duration-[var(--duration-base)] group-open:rotate-180 group-open:text-accent-soft-text" />
                  </span>
                </summary>
                <p className="faq-answer px-5 pb-5 text-sm leading-relaxed text-muted">{t(`a${n}`)}</p>
              </details>
            </li>
          ))}
        </ul>
      </Container>
      <script
        type="application/ld+json"
        // Server-built JSON from our own locale files (no user input); `<` escaped as JSON-LD in HTML requires.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </section>
  );
}
