import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GrievanceOfficer } from '@/components/site/company-legal';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { PolicySections } from '@/components/ui/policy-sections';
import { PublishedPolicy } from '@/components/ui/published-policy';
import type { Locale } from '@/i18n/routing';
import { COMMUNITY_RULES_SECTIONS } from '@/lib/policy-view';
import { alternatesFor } from '@/lib/seo';
import { publishedPolicy } from '@/lib/site-config-content';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'policies.communityRules' });
  const published = await publishedPolicy('policy.community_rules', locale);
  return {
    title: published?.title ?? t('title'),
    description: published?.lead ?? t('lead'),
    alternates: alternatesFor('/policies/community-rules', locale),
  };
}

/**
 * Ustaad Network Community Rules (spec 23 § 13, IT Rules 2021 Rule 3(1)(b): the prohibited-content list in English and
 * Hindi; task F3). Public so a member can read them before joining and the quarterly reminder can link here.
 * Admin-editable as `policy.community_rules` (Admin → Content → Policies), the built-in text below until a version is
 * published; the same layout as the other policy pages.
 */
export default async function CommunityRulesPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.communityRules');
  const published = await publishedPolicy('policy.community_rules', locale);
  if (published)
    return (
      <PublishedPolicy
        doc={published}
        locale={locale}
        eyebrow={t('eyebrow')}
        help={t('help')}
        track="policy_community_rules_call"
      />
    );
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <PolicySections
        sections={COMMUNITY_RULES_SECTIONS.map(({ key, emoji }) => ({
          emoji,
          title: t(`${key}Title`),
          body: t(`${key}Body`),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_community_rules_call"
      />
      <GrievanceOfficer locale={locale} />
    </Container>
  );
}
