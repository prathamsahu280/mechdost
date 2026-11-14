import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import { RequestView } from '@/components/workshops/request-view';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'request' });
  return { title: t('title', { code }), robots: { index: false } };
}

/** Service request status (spec 06). Codes are SR-{CITY}-{YYYY}-{6 base32}. */
export default async function ServiceRequestPage({ params }: Props) {
  const { code } = await params;
  const safe = /^SR-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/.test(code) ? code : '';
  const t = await getTranslations('request');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(22px,3vw,40px)] font-extrabold tracking-[-0.02em] break-words text-ink">
        {t('title', { code: safe || code.slice(0, 40) })}
      </h1>
      <div className="mt-8">
        <ClientMessages
          namespaces={
            DATA_MODE === 'api'
              ? ['request', 'workshop', 'demo', 'reviews', 'trust', 'homeService']
              : ['request', 'workshop', 'demo', 'trust']
          }
        >
          <Suspense>
            <RequestView code={safe} />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
