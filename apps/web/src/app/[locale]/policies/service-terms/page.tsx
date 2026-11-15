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
  const t = await getTranslations({ locale, namespace: 'policies.service' });
  const published = await publishedPolicy('policy.service', locale);
  return {
    title: published?.title ?? t('title'),
    description: published?.lead ?? t('lead'),
    alternates: alternatesFor('/policies/service-terms', locale),
  };
}

const SECTIONS = [
  { key: 'find', emoji: '📍' },
  { key: 'proposal', emoji: '🗓️' },
  { key: 'estimate', emoji: '📝' },
  { key: 'cancel', emoji: '✋' },
  { key: 'bill', emoji: '💳' },
  { key: 'pickup', emoji: '🚗' },
] as const;

/**
 * Workshop bookings & work approval (concept policy "Workshop appointments & work approval", rewritten from the
 * service flow in spec 06: location first, proposal, per-line estimate approval, cancel until the vehicle is
 * received). Admin-editable as `policy.service` on the content API (spec 08).
 */
export default async function ServiceTermsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.service');
  const published = await publishedPolicy('policy.service', locale);
  if (published)
    return (
      <PublishedPolicy
        doc={published}
        locale={locale}
        eyebrow={t('eyebrow')}
        help={t('help')}
        track="policy_service_call"
      />
    );
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <PolicySections
        sections={SECTIONS.map(({ key, emoji }) => ({
          emoji,
          title: t(`${key}Title`),
          body: t(`${key}Body`),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_service_call"
      />
      <GrievanceOfficer locale={locale} />
    </Container>
  );
}
