/**
 * Tells the API this device is signing out, so its row leaves the "Where you're signed in" lists of the other devices
 * (spec 01 § Devices). Best effort: fire and forget with a short timeout, never throws, never delays the sign-out.
 * Called with the ID token read before the Firebase sign-out. A missing API, an ended session or a slow network just
 * means the row ages out of use (the person's other devices can still end it).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 2000;

export function endCurrentDevice(idToken: string | null): void {
  if (!API || !idToken) return;
  try {
    void fetch(`${API}/v1/me/devices/current/sign-out`, {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}` },
      cache: 'no-store',
      keepalive: true,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  } catch {
    // Nothing to do: the sign-out goes on.
  }
}
