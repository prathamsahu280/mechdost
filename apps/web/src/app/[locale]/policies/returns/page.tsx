import { Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { site } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.returns' });
  return { title: t('title'), alternates: alternatesFor('/policies/returns', locale) };
}

/** Claim window for faulty or wrong parts (inbox Q25 default; becomes a per-city setting with the CMS). */
const CLAIM_DAYS = 7;

const SECTIONS = [
  { key: 'noReturns', emoji: '🚫' },
  { key: 'faulty', emoji: '🛠️' },
  { key: 'unfulfilled', emoji: '↩️' },
  { key: 'refunds', emoji: '💳' },
  { key: 'coins', emoji: '🪙' },
] as const;

/**
 * Returns & refunds policy (decision 2026-11-01: no returns or exchanges; faulty parts through support). Shown
 * before purchase as the Consumer Protection (E-Commerce) Rules 2020 require. Copy moves to admin-editable
 * policy pages with the CMS (spec 08, rule 8).
 */
export default async function ReturnsPolicyPage() {
  const t = await getTranslations('policies.returns');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <ul className="mt-10 grid max-w-4xl gap-4">
        {SECTIONS.map(({ key, emoji }) => (
          <li
            key={key}
            className="flex gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
          >
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
            >
              {emoji}
            </span>
            <div>
              <h2 className="font-heading text-lg font-extrabold text-ink">{t(`${key}Title`)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {t(`${key}Body`, { days: CLAIM_DAYS })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex max-w-4xl flex-wrap items-center gap-x-2 text-sm text-muted">
        {t('help')}
        <a
          href={`tel:${site.supportPhoneE164}`}
          data-track="policy_returns_call"
          className="inline-flex min-h-11 items-center gap-2 font-bold text-ink underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-4" />
          {site.supportPhone}
        </a>
      </p>
      <p className="mt-2 max-w-4xl text-xs text-muted">{t('updated')}</p>
    </Container>
  );
}
