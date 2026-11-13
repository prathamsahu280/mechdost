import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ApplicationStatus } from '@/components/partners/application-status';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'apply' });
  return { title: t('reference', { code }), robots: { index: false } };
}

/** Partner application status (spec 07). Codes are PA-{CITY}-{YYYY}-{6 base32}. */
export default async function ApplicationPage({ params }: Props) {
  const { code } = await params;
  const safe = /^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/.test(code) ? code : '';
  const t = await getTranslations('apply');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(22px,3vw,40px)] font-extrabold tracking-[-0.02em] break-words text-ink">
        {t('reference', { code: safe || code.slice(0, 40) })}
      </h1>
      <div className="mt-8">
        <ClientMessages namespaces={['apply', 'demo']}>
          <Suspense>
            <ApplicationStatus code={safe} />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
