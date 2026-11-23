import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { EmailAction } from '@/components/auth/email-action';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'emailAction' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Firebase's custom email action URL (verification, password reset, email change, recovery), set in the Firebase
 * console (docs/runbooks/firebase.md "Email links on mechdost.com"). Firebase appends `lang`: `hi` on the English
 * route moves to the Hindi route with the same query. Never indexed; works signed out.
 */
export default async function EmailActionPage({ params, searchParams }: Props) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  if (locale === 'en' && query.lang === 'hi') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === 'string') qs.set(key, value);
    redirect(`/hi/auth/action?${qs.toString()}`);
  }
  return (
    <Container className="py-10 tab:py-16">
      <div className="mx-auto max-w-md">
        <ClientMessages namespaces={['auth', 'emailAction']}>
          <Suspense fallback={<div className="skeleton h-56 rounded-tile" aria-hidden="true" />}>
            <EmailAction />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
