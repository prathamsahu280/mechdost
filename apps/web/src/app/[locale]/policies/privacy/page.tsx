import { Phone } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { companyFacts, site } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.privacy' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies/privacy', locale),
  };
}

const SECTIONS = [
  { key: 'who', emoji: '🏢' },
  { key: 'collect', emoji: '🗂️' },
  { key: 'purpose', emoji: '🎯' },
  { key: 'share', emoji: '🤝' },
  { key: 'analytics', emoji: '📊' },
  { key: 'safe', emoji: '🔒' },
  { key: 'rights', emoji: '✋' },
] as const;

/**
 * Privacy notice (DPDP Act 2023: plain language, itemised purposes, how to withdraw, whom to contact). Written
 * from what the product actually does (docs/specs 01, 04, 10, 12, 13), replacing the concept's outdated text
 * (recovery keys, no notifications). Linked from the privacy choice banner and the footer. Copy moves to
 * admin-editable policy pages with the CMS (spec 08, rule 8); the grievance officer's name follows inbox Q15.
 */
export default async function PrivacyPolicyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.privacy');
  const { company, registeredAddress } = companyFacts(locale);
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
                {t(`${key}Body`, { company, address: registeredAddress })}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex max-w-4xl flex-wrap items-center gap-x-2 text-sm text-muted">
        {t('help')}
        <a
          href={`tel:${site.supportPhoneE164}`}
          data-track="policy_privacy_call"
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
