import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { QuoteThread } from '@/components/quotes/quote-thread';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

const CODE = /^QT-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'quote' });
  return { title: t('reference', { code: code.slice(0, 40) }), robots: { index: false } };
}

/** Bulk quote thread (spec 19). Codes are QT-{CITY}-{YYYY}-{6 base32}. */
export default async function QuotePage({ params }: Props) {
  const { code } = await params;
  const safe = CODE.test(code) ? code : '';
  const t = await getTranslations('quote');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(22px,3vw,40px)] font-extrabold tracking-[-0.02em] break-words text-ink">
        {t('reference', { code: safe || code.slice(0, 40) })}
      </h1>
      <div className="mt-6">
        <ClientMessages namespaces={['quote', 'demo']}>
          <Suspense fallback={<div className="skeleton h-80 rounded-card" aria-hidden="true" />}>
            <QuoteThread code={safe} />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
