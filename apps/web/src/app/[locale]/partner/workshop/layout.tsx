import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { WorkshopFrame } from '@/components/portal/workshop/workshop-frame';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'portal' });
  return { title: t('workshopTitle'), robots: { index: false } };
}

/**
 * Workshop portal (spec 07; partner portals UI upgrade, batch B). The frame (guard, tabs, message bundles) lives in
 * this layout and stays mounted while the tabs change (no reload feel). Tabs are pages below: Today, Jobs, Numbers,
 * My workshop.
 */
export default async function WorkshopPortalLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('portal');
  return (
    <Container className="min-h-dvh py-10 tab:py-14">
      <PageIntro eyebrow={t('partnerEyebrow')} line1={t('workshopTitle')} />
      <div className="mt-8">
        <ClientMessages
          namespaces={[
            'portal',
            'account',
            'auth',
            'order',
            'request',
            'quote',
            'apply',
            'bell',
            'homeService',
            'photos',
            'workshopTier1',
            'workshop',
            'workshopAnalytics',
            'trust',
            'roadside',
            'partnerKit',
            'partnerWorkshop',
          ]}
        >
          <WorkshopFrame>{children}</WorkshopFrame>
        </ClientMessages>
      </div>
    </Container>
  );
}
