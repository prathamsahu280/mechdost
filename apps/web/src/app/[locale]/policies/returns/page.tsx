import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { GrievanceOfficer } from '@/components/site/company-legal';
import { PolicySections } from '@/components/ui/policy-sections';
import { PublishedPolicy } from '@/components/ui/published-policy';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { publishedPolicy } from '@/lib/site-config-content';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.returns' });
  const published = await publishedPolicy('policy.returns', locale);
  return { title: published?.title ?? t('title'), alternates: alternatesFor('/policies/returns', locale) };
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
export default async function ReturnsPolicyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.returns');
  const published = await publishedPolicy('policy.returns', locale);
  if (published)
    return (
      <PublishedPolicy
        doc={published}
        locale={locale}
        eyebrow={t('eyebrow')}
        help={t('help')}
        track="policy_returns_call"
      />
    );
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <PolicySections
        sections={SECTIONS.map(({ key, emoji }) => ({
          emoji,
          title: t(`${key}Title`),
          body: t(`${key}Body`, { days: CLAIM_DAYS }),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_returns_call"
      />
      <GrievanceOfficer locale={locale} />
    </Container>
  );
}
