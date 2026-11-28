/**
 * Typed calls to the MechDost API for the admin screens (real sign-in only). The caller's Firebase ID token goes
 * in the Authorization header; every answer is checked against the caller's Zod schema before use (hard rule 4).
 * Errors come back as the API's error code (`STALE_PRICE`, `MRP_EXCEEDED` …) for the screen to translate.
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/** A Zod schema from `@mechdost/shared` (structural, so the web app does not depend on Zod itself). */
export interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export type AdminResult<T> =
  | { ok: true; data: T }
  /** `details` is the API's `error.details` (e.g. the rows of a refused import), unchecked: parse before use. */
  | { ok: false; status: number; code: string; details?: unknown };

function errorDetails(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'details' in error ? error.details : undefined;
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export async function adminApi<T>(
  locale: string,
  path: string,
  schema: ResponseSchema<T>,
  init: {
    method?: 'GET' | 'PATCH' | 'PUT' | 'POST' | 'DELETE';
    body?: unknown;
    /** Extra request headers, e.g. `Idempotency-Key` for a staff change that must apply once. */
    headers?: Record<string, string>;
  } = {},
): Promise<AdminResult<T>> {
  if (!API) return { ok: false, status: 0, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  // A revoked sign-in (bug 2026-11-28) ends the site session; loaded only on a 401, so no page pays for it.
  if (!res.ok && res.status === 401) {
    const code = errorCode(body);
    void import('./auth/session-ended').then((m) => {
      m.noteApiAnswer(401, code);
    });
  }
  if (!res.ok)
    return {
      ok: false,
      status: res.status,
      code: errorCode(body) ?? `HTTP_${String(res.status)}`,
      details: errorDetails(body),
    };
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: res.status, code: 'BAD_RESPONSE' };
}
