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
  const t = await getTranslations({ locale, namespace: 'policies.terms' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/terms', locale),
  };
}

const SECTIONS = [
  { key: 'who', emoji: '🏢' },
  { key: 'account', emoji: '👤' },
  { key: 'orders', emoji: '🛒' },
  { key: 'payments', emoji: '💳' },
  { key: 'returns', emoji: '🔁' },
  { key: 'services', emoji: '🔧' },
  { key: 'coins', emoji: '🪙' },
  { key: 'messages', emoji: '💬' },
  { key: 'use', emoji: '✅' },
  { key: 'partners', emoji: '🤝' },
  { key: 'liability', emoji: '⚖️' },
  { key: 'privacy', emoji: '🔒' },
  { key: 'changes', emoji: '📝' },
  { key: 'contact', emoji: '📞' },
] as const;

/**
 * Terms of Service (user 2026-11-14: Meta requires a terms URL to publish the WhatsApp app, at /terms). Written
 * from what the product does and the user's decisions: no returns or exchanges (spec 05), refunds to the original
 * payment method, Coins with no cash value (spec 20), per-line approval of workshop work (spec 06), transactional
 * messages and opt-in offers (spec 10), Indian law and Raipur courts. Same layout as the other policy pages; like
 * them, the copy moves to the admin-editable policy store with the CMS (rule 8, spec 08).
 */
export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('policies.terms');
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
        track="policy_terms_call"
      />
    </Container>
  );
}
