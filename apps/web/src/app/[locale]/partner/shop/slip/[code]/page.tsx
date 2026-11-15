import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SlipScreen } from '@/components/portal/shop-slip-screen';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'shopTier2' });
  return { title: t('slipTitle'), robots: { index: false } };
}

/** Printable packing slip for one order (spec 07); the API decides who may open it. */
export default async function SlipPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const safe = /^MD-[A-Z0-9]{2,6}-\d{4}-[0-9A-Z]{6}(-\d{1,3})?$/.test(code) ? code : '';
  return (
    <Container className="py-8 tab:py-12">
      <ClientMessages namespaces={['shopTier2', 'portal']}>
        <SlipScreen code={safe} />
      </ClientMessages>
    </Container>
  );
}
