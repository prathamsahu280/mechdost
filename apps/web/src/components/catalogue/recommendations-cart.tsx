import type { Locale } from '@/i18n/routing';
import { LeanCard, RecommendationsCore } from './recommendations-core';

/**
 * "Add before checkout" on the cart page (spec 11) with the lean card only: the cart page is at its JavaScript budget, so
 * it must not import the catalogue card (add to cart, compare, wishlist). Guard: `test/cart-pill-lazy.test.ts`.
 */
export function CartRecommendations({ slugs, locale }: { slugs: readonly string[]; locale: Locale }) {
  return (
    <RecommendationsCore
      slugs={slugs}
      slot="cart"
      locale={locale}
      renderCard={(card) => <LeanCard product={card} />}
    />
  );
}
