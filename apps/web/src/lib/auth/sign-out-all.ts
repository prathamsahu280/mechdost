/**
 * "Sign out of all devices" (founder 2026-11-28; spec 01 "Sessions"): `POST /v1/me/sessions/revoke-all` with the
 * caller's own token. The API ends every Firebase session of the account; this device then signs out locally
 * (`signOutEverywhere`, run by the caller). Loaded on the click only, so the profile page carries none of it.
 */
export type RevokeAllResult =
  { ok: true } | { ok: false; reason: 'rate' | 'network' | 'unavailable' | 'signed_out' };

const API = () => (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export async function revokeAllSessions(locale: string): Promise<RevokeAllResult> {
  const { currentIdToken } = await import('./firebase-client');
  // Security review 2026-11-28: success only when the API confirmed it. Without a token nothing reached the other
  // devices (a lost phone stays signed in), so the person is told to sign in again and retry, never "done".
  let token: string | null;
  try {
    token = await currentIdToken(locale);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!token) return { ok: false, reason: 'signed_out' };
  let res: Response;
  try {
    res = await fetch(`${API()}/v1/me/sessions/revoke-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: 'signed_out' };
  if (res.status === 429) return { ok: false, reason: 'rate' };
  return { ok: false, reason: 'unavailable' };
}
