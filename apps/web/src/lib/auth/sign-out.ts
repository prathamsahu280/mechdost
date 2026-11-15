import { signOut } from '@/demo/session';
import { clearCart } from '@/demo/store';
import { AUTH_MODE } from './mode';

/**
 * Sign out of this device: the browser session the screens read, and in real mode (Q69) the Firebase session too
 * (loaded on demand, so pages with a sign-out button do not carry the Firebase SDK).
 */
export function signOutEverywhere(): void {
  signOut();
  if (AUTH_MODE === 'firebase') {
    // The saved cart and wishlist on this browser belong to the person who signed out (shared devices, security review
    // 2026-11-15): the browser cart goes at once, and the sync and wishlist state are reset so nothing reaches the
    // next person who signs in.
    clearCart();
    void import('../cart-sync').then((m) => m.resetCartSync());
    void import('../wishlist-store').then((m) => {
      m.resetWishlist();
    });
  }
  if (AUTH_MODE === 'firebase')
    void import('./firebase-client').then(async (client) => {
      // This browser stops receiving this person's push first (needs the token the sign-out is about to drop).
      await import('../push/forget-device').then((m) => m.forgetPushDevice(document.documentElement.lang));
      await client.signOutReal();
    });
}
