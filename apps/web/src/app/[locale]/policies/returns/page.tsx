import { Ban, Coins, CreditCard, Undo2, Wrench } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { PolicySections } from '@/components/ui/policy-sections';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

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
  { key: 'noReturns', icon: Ban },
  { key: 'faulty', icon: Wrench },
  { key: 'unfulfilled', icon: Undo2 },
  { key: 'refunds', icon: CreditCard },
  { key: 'coins', icon: Coins },
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
      <PolicySections
        sections={SECTIONS.map(({ key, icon }) => ({
          icon,
          title: t(`${key}Title`),
          body: t(`${key}Body`, { days: CLAIM_DAYS }),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_returns_call"
      />
    </Container>
  );
}
