import { signOut } from '@/demo/session';
import { AUTH_MODE } from './mode';

/**
 * Sign out of this device: the browser session the screens read, and in real mode (Q69) the Firebase session too
 * (loaded on demand, so pages with a sign-out button do not carry the Firebase SDK).
 */
export function signOutEverywhere(): void {
  signOut();
  if (AUTH_MODE === 'firebase')
    void import('./firebase-client').then(async (client) => {
      // This browser stops receiving this person's push first (needs the token the sign-out is about to drop).
      await import('../push/forget-device').then((m) => m.forgetPushDevice(document.documentElement.lang));
      await client.signOutReal();
    });
}
