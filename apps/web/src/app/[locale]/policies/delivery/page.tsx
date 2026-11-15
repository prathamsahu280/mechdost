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
  const t = await getTranslations({ locale, namespace: 'policies.delivery' });
  const published = await publishedPolicy('policy.delivery', locale);
  return {
    title: published?.title ?? t('title'),
    description: published?.lead ?? t('lead'),
    alternates: alternatesFor('/policies/delivery', locale),
  };
}

const SECTIONS = [
  { key: 'pin', emoji: '📍' },
  { key: 'prices', emoji: '🧾' },
  { key: 'confirm', emoji: '🏪' },
  { key: 'code', emoji: '🔑' },
  { key: 'pay', emoji: '💵' },
  { key: 'cancel', emoji: '✋' },
] as const;

/**
 * Delivery & payment (concept policy "Delivery & product payments", rewritten from what the product does:
 * specs 02–05). Amounts that the admin sets (delivery charge, free-delivery amount, cash-on-delivery limit) are
 * referred to as "shown at checkout" so this page never contradicts the settings. Admin-editable as
 * `policy.delivery` on the content API (spec 08).
 */
export default async function DeliveryPolicyPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.delivery');
  const published = await publishedPolicy('policy.delivery', locale);
  if (published)
    return (
      <PublishedPolicy
        doc={published}
        locale={locale}
        eyebrow={t('eyebrow')}
        help={t('help')}
        track="policy_delivery_call"
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
        track="policy_delivery_call"
      />
      <GrievanceOfficer locale={locale} />
    </Container>
  );
}
