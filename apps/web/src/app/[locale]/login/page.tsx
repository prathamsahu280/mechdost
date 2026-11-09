import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LoginFlow } from '@/components/auth/login-flow';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { AUTH_MODE } from '@/lib/auth/mode';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('title'), alternates: alternatesFor('/login', locale), robots: { index: false } };
}

/**
 * Sign-in for every role (spec 01). Real sign-in mode renders this page per request so its scripts carry the
 * proxy's CSP nonce (decisions 2026-11-09); demo mode stays a static page.
 */
export default async function LoginPage() {
  if (AUTH_MODE === 'firebase') await connection();
  const t = await getTranslations('auth');
  return (
    <Container className="py-10 tab:py-16">
      <div className="mx-auto grid max-w-5xl gap-10 nav:grid-cols-[1fr_440px] nav:items-start">
        <PageIntro eyebrow="MechDost" line1={t('title')} lead={t('lead')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['auth']}>
            <Suspense fallback={<div className="skeleton h-72 rounded-tile" aria-hidden="true" />}>
              <LoginFlow />
            </Suspense>
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
