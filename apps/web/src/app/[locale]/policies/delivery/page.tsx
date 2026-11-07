import { Banknote, Hand, KeyRound, MapPin, ReceiptText, Store } from 'lucide-react';
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
  const t = await getTranslations({ locale, namespace: 'policies.delivery' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies/delivery', locale),
  };
}

const SECTIONS = [
  { key: 'pin', icon: MapPin },
  { key: 'prices', icon: ReceiptText },
  { key: 'confirm', icon: Store },
  { key: 'code', icon: KeyRound },
  { key: 'pay', icon: Banknote },
  { key: 'cancel', icon: Hand },
] as const;

/**
 * Delivery & payment (concept policy "Delivery & product payments", rewritten from what the product does:
 * specs 02–05). Amounts that the admin sets (delivery charge, free-delivery amount, cash-on-delivery limit) are
 * referred to as "shown at checkout" so this page never contradicts the settings. Admin-editable as
 * `policy.delivery` on the content API (spec 08).
 */
export default async function DeliveryPolicyPage() {
  const t = await getTranslations('policies.delivery');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <PolicySections
        sections={SECTIONS.map(({ key, icon }) => ({
          icon,
          title: t(`${key}Title`),
          body: t(`${key}Body`),
        }))}
        help={t('help')}
        updated={t('updated')}
        track="policy_delivery_call"
      />
    </Container>
  );
}
