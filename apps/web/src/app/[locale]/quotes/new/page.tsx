import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { QuoteRequestForm } from '@/components/quotes/quote-request-form';
import { QuoteRequestFormLazy } from '@/components/quotes/quote-lazy';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor, openGraphFor } from '@/lib/seo';
import { site } from '@/lib/site';
import { QUOTES_AVAILABLE, QUOTES_ON_API } from '@/lib/data-mode';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, cities] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'cities' }),
  ]);
  const city = cities(site.defaultCity);
  // The public "Bulk orders" landing (footer link) is indexable; quote records under /quotes/<code> stay private.
  const title = t('bulkTitle', { city });
  const description = t('bulkDescription', { city });
  return {
    title,
    description,
    alternates: alternatesFor('/quotes/new', locale),
    openGraph: openGraphFor({ href: '/quotes/new', locale, title, description }),
  };
}

/**
 * Bulk quote request (spec 19). `?product=slug` or `?from=cart` prefill the lines (read on the client). Real data
 * mode: the API form (products from the live catalogue), loaded on demand; demo: the browser store.
 */
export default async function NewQuotePage() {
  if (!QUOTES_AVAILABLE) notFound();
  const t = await getTranslations('quote');
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink href="/shop" className="text-sm font-bold text-ink hover:underline">
        ← {t('back')}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,680px)] nav:items-start">
        <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('intro')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['quote']}>
            <Suspense fallback={<div className="skeleton h-96 rounded-tile" aria-hidden="true" />}>
              {QUOTES_ON_API ? <QuoteRequestFormLazy /> : <QuoteRequestForm />}
            </Suspense>
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
