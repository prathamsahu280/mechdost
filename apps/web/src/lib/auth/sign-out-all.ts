/**
 * "Sign out of all devices" (founder 2026-11-28; spec 01 "Sessions"): `POST /v1/me/sessions/revoke-all` with the
 * caller's own token. The API ends every Firebase session of the account; this device then signs out locally
 * (`signOutEverywhere`, run by the caller). Loaded on the click only, so the profile page carries none of it.
 */
export type RevokeAllResult = { ok: true } | { ok: false; reason: 'rate' | 'network' | 'unavailable' };

const API = () => (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
};

export async function revokeAllSessions(locale: string): Promise<RevokeAllResult> {
  const { currentIdToken } = await import('./firebase-client');
  const token = await currentIdToken(locale).catch(() => null);
  // No Firebase session left: this device is already signed out everywhere it can be.
  if (!token) return { ok: true };
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
  const code = codeOf(await res.json().catch(() => null));
  if (res.status === 401 && code === 'TOKEN_REVOKED') return { ok: true };
  if (res.status === 429) return { ok: false, reason: 'rate' };
  return { ok: false, reason: 'unavailable' };
}
