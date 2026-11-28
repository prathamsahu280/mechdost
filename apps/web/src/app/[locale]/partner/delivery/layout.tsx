import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AgentFrame } from '@/components/delivery/agent-portal';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'deliveryAgent' });
  return { title: t('title'), robots: { index: false } };
}

/**
 * Delivery agent portal (spec 24). The partner frame (guard, status strip with the online switch, bottom tabs / side
 * rail, message bundles) lives in this layout and stays mounted while the tabs change (no reload feel). Tabs are pages below.
 */
export default async function DeliveryAgentLayout({ children }: { children: ReactNode }) {
  // The page intro moved into the navy strip (design 2026-11-27 § 7), so the offer starts above the fold at 390 × 844;
  // the page title stays in the tab title (metadata) and the strip's heading.
  const t = await getTranslations('deliveryAgent');
  return (
    <Container className="min-h-dvh py-4 tab:py-8">
      <h1 className="sr-only">{t('title')}</h1>
      <ClientMessages
        namespaces={['deliveryAgent', 'delivery', 'portal', 'auth', 'partnerKit', 'partnerRider']}
      >
        <AgentFrame>{children}</AgentFrame>
      </ClientMessages>
    </Container>
  );
}
