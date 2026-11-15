import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { CartRecommendations } from '@/components/catalogue/recommendations-cart';
import { CartView } from '@/components/commerce/cart-view';
import { TrustLine } from '@/components/site/trust-line';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cart' });
  return { title: t('title'), robots: { index: false } };
}

/** Product slugs the browser mirrored into its cookie (`demo/store.ts`); anything that is not a slug is dropped. */
async function cartSlugs(): Promise<string[]> {
  const raw = (await cookies()).get('mechdost-cart-slugs')?.value ?? '';
  return raw
    .split(',')
    .filter((s) => /^[a-z0-9][a-z0-9-]{0,78}$/.test(s))
    .slice(0, 20);
}

async function CartSuggestions({ locale }: { locale: Locale }) {
  const slugs = await cartSlugs();
  if (slugs.length === 0) return null;
  return <CartRecommendations slugs={slugs} locale={locale} />;
}

/** Cart (spec 03) — demo store until the server cart with re-pricing ships in Phase 1. */
export default async function CartPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslations('cart');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {t('title')}
      </h1>
      <TrustLine placement="checkout" className="mt-3 max-w-prose text-[15px] text-muted" />
      <div className="mt-8">
        <ClientMessages namespaces={['cart', 'catalogue', 'quote', 'categories', 'checkout']}>
          <CartView />
        </ClientMessages>
      </div>
      {/* "Add before checkout" (spec 11): a Server Component under the cart, real data mode only. */}
      {DATA_MODE === 'api' ? (
        <Suspense fallback={null}>
          <CartSuggestions locale={locale} />
        </Suspense>
      ) : null}
    </Container>
  );
}
