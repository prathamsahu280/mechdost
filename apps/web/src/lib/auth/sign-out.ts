import { signOut } from '@/demo/session';
import { clearCart } from '@/demo/store';
import { AUTH_MODE } from './mode';

/** `<html data-signing-out>` hides the page content at once, so nothing of the signed-out account stays on screen. */
export const SIGNING_OUT_ATTRIBUTE = 'data-signing-out';

/** The longest the Firebase sign-out may hold the page before the fresh load (slow networks). */
const FIREBASE_SIGN_OUT_WAIT_MS = 4000;

/**
 * Sign out of this device: the browser session the screens read, and in real mode (Q69) the Firebase session too
 * (loaded on demand, so pages with a sign-out button do not carry the Firebase SDK).
 *
 * Bug 2026-11-23 (user: "that page's data still shows for a bit after sign out"): the page content is hidden and the
 * session cleared synchronously, the Firebase sign-out is awaited, and then the home page is loaded fresh
 * (`location.replace`), so no data of the signed-out account survives in memory and Back does not return to it.
 */
export async function signOutEverywhere(): Promise<void> {
  const root = document.documentElement;
  root.setAttribute(SIGNING_OUT_ATTRIBUTE, '');
  signOut();
  if (AUTH_MODE === 'firebase') {
    // The saved cart and wishlist on this browser belong to the person who signed out (shared devices, security review
    // 2026-11-15): the browser cart goes at once, and the sync and wishlist state are reset so nothing reaches the
    // next person who signs in.
    clearCart();
    void import('../cart-sync').then((m) => m.resetCartSync());
    void import('../live/live-hub').then((m) => {
      m.resetLive();
    });
    void import('../wishlist-store').then((m) => {
      m.resetWishlist();
    });
    const firebase = import('./firebase-client').then(async (client) => {
      // This browser stops receiving this person's push first (needs the token the sign-out is about to drop).
      await import('../push/forget-device').then((m) => m.forgetPushDevice(root.lang));
      await client.signOutReal();
    });
    await Promise.race([
      firebase.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, FIREBASE_SIGN_OUT_WAIT_MS)),
    ]);
  }
  window.location.replace(root.lang === 'hi' ? '/hi' : '/');
}
