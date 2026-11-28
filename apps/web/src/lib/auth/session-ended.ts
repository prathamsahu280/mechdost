import { sessionSnapshot } from '@/demo/session';
import { markSessionEnded } from './session-ended-flag';
import { AUTH_MODE } from './mode';
import { forgetAccountOnDevice } from './sign-out';

/**
 * Bug 2026-11-28 (founder: "Signed in as QA Admin" while every panel said "Sign in again"). The site keeps its own
 * saved session beside the Firebase one. Firebase ends its session on its own (password changed on another device, a
 * staff role removed, the account disabled, "sign out of all devices"); the site session used to stay, so pages claimed
 * a sign-in that no request could use. The API helpers report here, and the site session is cleared once, without a
 * reload, so the normal sign-in card (with the return path) shows together with a one-shot note.
 *
 * Real mode only. Light on purpose (no Firebase import): the pages that call it already loaded Firebase.
 */

/** API 401 codes that mean "this sign-in is over" (`TokenError` codes the API sends; `TOKEN_EXPIRED` refreshes itself). */
export const SESSION_INVALID_CODES: ReadonlySet<string> = new Set(['TOKEN_REVOKED', 'SESSION_ENDED']);

function endSession(): void {
  forgetAccountOnDevice();
  markSessionEnded();
}

/**
 * Called by `currentIdToken` once Firebase has finished restoring the browser session (never before: a page that just
 * loaded must not read "no user yet" as "signed out"). A missing user while the site says signed in ends the site
 * session; a visitor with no site session is untouched.
 */
export function noteFirebaseUser(uid: string | null): void {
  if (AUTH_MODE !== 'firebase' || uid !== null) return;
  if (sessionSnapshot() === null) return;
  endSession();
}

/** Called with every API answer of a signed-in helper: a revoked-token 401 ends the sign-in, here and in Firebase. */
export function noteApiAnswer(status: number, code: string | null): void {
  if (AUTH_MODE !== 'firebase' || status !== 401 || code === null || !SESSION_INVALID_CODES.has(code)) return;
  if (sessionSnapshot() === null) return;
  endSession();
  // The local Firebase user is dead too: remove it so the next sign-in starts clean (Firebase is already loaded here).
  void import('./firebase-client').then((c) => c.signOutReal()).catch(() => undefined);
}
