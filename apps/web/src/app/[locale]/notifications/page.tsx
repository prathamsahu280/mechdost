import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { NoticeCentre } from '@/components/notices/notice-centre';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { routing, type Locale } from '@/i18n/routing';
import { AUTH_MODE } from '@/lib/auth/mode';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'bell' });
  return { title: t('centreTitle'), robots: { index: false } };
}

/**
 * The notification centre (spec 10, design 2026-11-15): every notification of the signed-in person, for customers,
 * shops, workshops and staff alike, plus this device's push card and choices. Real sign-in builds only; the browser
 * demo has no bell, so the page does not exist there.
 */
export default async function NotificationsPage() {
  if (AUTH_MODE !== 'firebase') notFound();
  const t = await getTranslations('bell');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow="MechDost" line1={t('centreTitle')} lead={t('centreIntro')} />
      <div className="mt-8">
        <ClientMessages namespaces={['bell', 'account']}>
          {/* The filter chip is read from the URL (`?filter=`), so the centre waits for the search params. */}
          <Suspense fallback={<div className="skeleton h-96 rounded-card" aria-hidden="true" />}>
            <NoticeCentre />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
