import { refreshCart } from './cart-sync';
import { startPolling } from './storefront-poll';
import { refreshWishlist } from './wishlist-store';

/**
 * The one entry point for "the saved cart and wishlist may have changed elsewhere" (design 2026-11-15, user: phone and
 * laptop at once). Real sign-in mode only, loaded by dynamic import from the header's cart pill when someone is signed
 * in. `refreshStorefront` is what the poll, a tab becoming visible, opening the cart or checkout, and (next step) the
 * single shared live listener for the bell, shop offers, cart and wishlist all call: it re-reads both and resolves to
 * false when either failed, so the poller backs off.
 */
type Locale = 'en' | 'hi';

export async function refreshStorefront(locale: Locale): Promise<boolean> {
  const [cart, wishlist] = await Promise.all([refreshCart(locale), refreshWishlist(locale)]);
  return cart && wishlist;
}

/** Check now, then every 60 s while the tab is visible. Returns the stop function. */
export function startStorefrontSync(locale: Locale): () => void {
  const refresh = () => refreshStorefront(locale);
  const stop = startPolling(refresh);
  void refresh();
  return stop;
}
