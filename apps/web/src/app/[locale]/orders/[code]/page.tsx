import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { OrderView } from '@/components/commerce/order-view';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'order' });
  return { title: t('title', { code }), robots: { index: false } };
}

/** Order tracking (spec 04). Codes are MD-{CITY}-{YYYY}-{6 base32}; anything else is not looked up. */
export default async function OrderPage({ params }: Props) {
  const { code } = await params;
  const safe = /^MD-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/.test(code) ? code : '';
  const t = await getTranslations('order');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(26px,3vw,40px)] font-extrabold tracking-[-0.02em] break-all text-ink">
        {t('title', { code: safe || code.slice(0, 40) })}
      </h1>
      <div className="mt-8">
        <ClientMessages namespaces={['order', 'cart', 'demo']}>
          <Suspense>
            <OrderView code={safe} />
          </Suspense>
        </ClientMessages>
      </div>
    </Container>
  );
}
