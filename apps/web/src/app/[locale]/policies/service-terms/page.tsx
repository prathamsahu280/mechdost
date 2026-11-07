import { CalendarDays, Car, CreditCard, FilePenLine, Hand, MapPin } from 'lucide-react';
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
  const t = await getTranslations({ locale, namespace: 'policies.service' });
  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor('/policies/service-terms', locale),
  };
}

const SECTIONS = [
  { key: 'find', icon: MapPin },
  { key: 'proposal', icon: CalendarDays },
  { key: 'estimate', icon: FilePenLine },
  { key: 'cancel', icon: Hand },
  { key: 'bill', icon: CreditCard },
  { key: 'pickup', icon: Car },
] as const;

/**
 * Workshop bookings & work approval (concept policy "Workshop appointments & work approval", rewritten from the
 * service flow in spec 06: location first, proposal, per-line estimate approval, cancel until the vehicle is
 * received). Admin-editable as `policy.service` on the content API (spec 08).
 */
export default async function ServiceTermsPage() {
  const t = await getTranslations('policies.service');
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
        track="policy_service_call"
      />
    </Container>
  );
}
