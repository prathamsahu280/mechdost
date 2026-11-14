import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutForm } from '@/components/commerce/checkout-form';
import { TrustLine } from '@/components/site/trust-line';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return { title: t('title'), robots: { index: false } };
}

/** Checkout (spec 03): delivery details → order placed → admin routing. Demo store until the API ships. */
export default async function CheckoutPage() {
  const t = await getTranslations('checkout');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {t('title')}
      </h1>
      <TrustLine placement="checkout" className="mt-3 max-w-prose text-[15px] text-muted" />
      <div className="mt-8">
        <ClientMessages namespaces={['checkout', 'cart', 'catalogue', 'quote', 'categories', 'gstStates']}>
          <CheckoutForm />
        </ClientMessages>
      </div>
    </Container>
  );
}
