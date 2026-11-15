'use client';

import { useEffect } from 'react';
import { useSession } from '@/demo/session-state';
import { useCart } from '@/demo/store';

/**
 * The signed-in cart and wishlist sync (real sign-in mode only; user 2026-11-15: the saved cart follows the customer
 * between devices). Fetched by the cart pill with `import()` after the page loads, so neither this module nor the session
 * store rides in the header's first load (JS budget, spec 16; guard test `test/cart-pill-lazy.test.ts`). A local change
 * is sent after a short pause, the server is re-read every 60 s while the tab is visible and when it comes back, and
 * when the cart or checkout opens. Nothing runs for a signed-out visitor.
 */
export default function CartSyncMount({ locale, onCartPage }: { locale: 'en' | 'hi'; onCartPage: boolean }) {
  const lines = useCart();
  const signedIn = useSession() !== null;
  useEffect(() => {
    if (!signedIn) return;
    void import('@/lib/cart-sync').then((m) => {
      m.syncCart(locale);
    });
  }, [signedIn, lines, locale]);
  useEffect(() => {
    if (!signedIn) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@/lib/storefront-sync').then((m) => {
      if (!cancelled) stop = m.startStorefrontSync(locale);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [signedIn, locale]);
  useEffect(() => {
    if (!signedIn || !onCartPage) return;
    void import('@/lib/storefront-sync').then((m) => m.refreshStorefront(locale));
  }, [signedIn, locale, onCartPage]);
  return null;
}
