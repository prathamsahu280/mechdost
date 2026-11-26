import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AgentFrame } from '@/components/delivery/agent-portal';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
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
 * Delivery agent portal (spec 24). The frame (guard, status strip with the online switch, tab bar, message bundles)
 * lives in this layout and stays mounted while the tabs change (no reload feel). Tabs are pages below.
 */
export default async function DeliveryAgentLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('deliveryAgent');
  return (
    <Container className="py-8 tab:py-12">
      <div className="mx-auto max-w-xl">
        <PageIntro eyebrow={t('eyebrow')} line1={t('title')} />
      </div>
      <div className="mt-6">
        <ClientMessages namespaces={['deliveryAgent', 'delivery', 'portal', 'auth']}>
          <AgentFrame>{children}</AgentFrame>
        </ClientMessages>
      </div>
    </Container>
  );
}
