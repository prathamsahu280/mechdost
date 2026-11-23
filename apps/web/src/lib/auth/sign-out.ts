import { signOut } from '@/demo/session';
import { clearCart } from '@/demo/store';
import { AUTH_MODE } from './mode';

/** `<html data-signing-out>` hides the page content at once, so nothing of the signed-out account stays on screen. */
export const SIGNING_OUT_ATTRIBUTE = 'data-signing-out';

/** The longest the push clean-up may hold the sign-out (slow networks); the Firebase sign-out still runs after it. */
const PUSH_FORGET_WAIT_MS = 2500;
/** If the Firebase sign-out has not finished by then, its saved session is deleted from this browser directly. */
const FIREBASE_SIGN_OUT_WAIT_MS = 6000;
/** Where the Firebase web SDK keeps the signed-in user (IndexedDB, with a localStorage fallback). */
const FIREBASE_AUTH_DB = 'firebaseLocalStorageDb';
const FIREBASE_AUTH_KEY_PREFIX = 'firebase:authUser:';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Last resort: remove the Firebase session from this browser's storage so the reload cannot restore it. */
export async function forgetSavedFirebaseSession(): Promise<void> {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(FIREBASE_AUTH_KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing saved there.
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      try {
        const request = indexedDB.deleteDatabase(FIREBASE_AUTH_DB);
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          resolve();
        };
        request.onblocked = () => {
          resolve();
        };
      } catch {
        resolve();
      }
    }),
    wait(1500),
  ]);
}

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
    // Only the push clean-up is capped; the Firebase sign-out itself always runs before the page reloads, and if it
    // cannot finish the saved Firebase session is deleted from this browser directly (security review 2026-11-23:
    // a hanging push request must never leave the account signed in after the reload).
    const firebase = import('./firebase-client').then(async (client) => {
      await Promise.race([
        import('../push/forget-device').then((m) => m.forgetPushDevice(root.lang)).catch(() => undefined),
        wait(PUSH_FORGET_WAIT_MS),
      ]);
      await client.signOutReal();
      return true;
    });
    const ended = await Promise.race([
      firebase.catch(() => false),
      wait(FIREBASE_SIGN_OUT_WAIT_MS).then(() => false),
    ]);
    if (!ended) await forgetSavedFirebaseSession();
  }
  window.location.replace(root.lang === 'hi' ? '/hi' : '/');
}
