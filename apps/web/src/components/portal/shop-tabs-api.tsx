'use client';

import { ShopAgreementApi } from './shop-onboarding-api';
import { ShopPricesApi } from './shop-prices-api';
import { ShopNewProductApi, ShopProfileApi } from './shop-profile-api';
import { ShopWarningsApi } from './shop-warnings-api';

/**
 * The three quiet tabs of the shop portal on the API (design 2026-11-27 § 5.1), each one a body for its page. The
 * blocks are the ones the one-page portal had, moved unchanged; the API scopes everything to the signed-in person's
 * shops. Loaded together with a dynamic import by `shop-portal.tsx` (real sign-in only).
 */

/** Stock & prices: your prices, sell another product, update stock with a file, offers to accept. */
export function ShopStockApi() {
  return (
    <>
      <ShopPricesApi />
      <ShopNewProductApi />
      <ShopProfileApi part="stock" />
    </>
  );
}

/** Numbers: how your shop is doing (owner), team or own performance and earnings, notes from MechDost. */
export function ShopNumbersApi() {
  return (
    <>
      <ShopProfileApi part="numbers" />
      <ShopWarningsApi />
    </>
  );
}

/** My shop: seller agreement, availability, working hours, delivery area, who delivers, photos, team. */
export function ShopMyShopApi() {
  return (
    <>
      <ShopAgreementApi />
      <ShopProfileApi part="profile" />
    </>
  );
}
