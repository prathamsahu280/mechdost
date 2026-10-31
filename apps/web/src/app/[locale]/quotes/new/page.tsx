import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { QuoteRequestForm } from '@/components/quotes/quote-request-form';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'quote' });
  return { title: t('title'), alternates: alternatesFor('/quotes/new', locale), robots: { index: false } };
}

/** Bulk quote request (spec 19). `?product=slug` or `?from=cart` prefill the lines (read on the client). */
export default async function NewQuotePage() {
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
              <QuoteRequestForm />
            </Suspense>
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
