/**
 * A plain "someone is signed in on this browser" flag the server can read (SIM-B1). Sign-in lives in the browser
 * (Firebase + local session), so the server cannot tell a signed-out visitor from a member; this cookie lets the
 * Ustaad layout answer the real 404 to signed-out visitors during the staff preview instead of rendering the network
 * for the client gate to hide. It carries no identity and is never an auth boundary: the API checks every
 * `/v1/ustaad/*` call, and a hand-set cookie only shows the client gate's own "page not found".
 */
export const SIGNED_IN_HINT = 'md-signed-in';

export const signedInHintCookie = (on: boolean): string =>
  on
    ? `${SIGNED_IN_HINT}=1; path=/; max-age=31536000; samesite=lax; secure`
    : `${SIGNED_IN_HINT}=; path=/; max-age=0; samesite=lax; secure`;

export function writeSignedInHint(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.cookie = signedInHintCookie(on);
}

let synced = false;
/** Once per page load: a session from before the hint existed gets it; a stale hint without a session is cleared. */
export function syncSignedInHint(signedIn: boolean): void {
  if (synced || typeof document === 'undefined') return;
  synced = true;
  const has = document.cookie.split('; ').includes(`${SIGNED_IN_HINT}=1`);
  if (has !== signedIn) writeSignedInHint(signedIn);
}

/** Server side: during the staff preview, in API mode, a request without the hint gets the real 404. */
export const ustaadHiddenOnServer = (
  access: 'staff_preview' | 'open',
  hint: string | undefined,
  mode: 'api' | 'demo',
): boolean => mode === 'api' && access === 'staff_preview' && hint !== '1';
