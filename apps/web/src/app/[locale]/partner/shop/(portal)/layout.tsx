import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ShopFrame } from '@/components/portal/shop/shop-frame';
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
  return { title: t('shopTitle'), robots: { index: false } };
}

/**
 * Shop portal (spec 07; partner portals UI upgrade, batch A). The frame (guard, strip, tabs, message bundles) lives in
 * this layout and stays mounted while the tabs change (no reload feel). Tabs are pages below: Today, Orders, Stock &
 * prices, Numbers, My shop. It is a route group so the packing slip (`/partner/shop/slip/{code}`, a print page) stays
 * outside the frame.
 */
export default async function ShopPortalLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('portal');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('partnerEyebrow')} line1={t('shopTitle')} />
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
            'shopTier1',
            'shopTier2',
            'shopGiveUp',
            'storefront',
            'coupons',
            'trust',
            // Delivery agents (spec 24): ready for pickup, pickup/return codes, delivery mode requests.
            'deliveryShop',
            'deliveryAgent',
            'delivery',
            // Partner kit (design 2026-11-27): offer timer, order sound, updated line.
            'partnerKit',
            'partnerShop',
          ]}
        >
          <ShopFrame>{children}</ShopFrame>
        </ClientMessages>
      </div>
    </Container>
  );
}
