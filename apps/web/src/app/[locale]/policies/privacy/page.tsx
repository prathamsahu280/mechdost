import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { PolicySections } from '@/components/ui/policy-sections';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { companyFacts } from '@/lib/site';

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
  { key: 'errors', emoji: '🛠️' },
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
      <PolicySections
        sections={SECTIONS.map(({ key, emoji }) => ({
          emoji,
          title: t(`${key}Title`),
          body: t(`${key}Body`, { company, address: registeredAddress }),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_privacy_call"
      />
    </Container>
  );
}
