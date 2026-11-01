import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CartView } from '@/components/commerce/cart-view';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return { title: t('title'), robots: { index: false } };
}

/** Cart (spec 03) — demo store until the server cart with re-pricing ships in Phase 1. */
export default async function CartPage() {
  const t = await getTranslations('cart');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {t('title')}
      </h1>
      <div className="mt-8">
        <ClientMessages namespaces={['cart', 'catalogue', 'quote', 'categories']}>
          <CartView />
        </ClientMessages>
      </div>
    </Container>
  );
}
