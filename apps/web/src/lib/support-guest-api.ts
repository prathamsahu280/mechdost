import {
  GuestCreated,
  GuestReplied,
  GuestTicket,
  type GuestCreatedDto,
} from '@mechdost/shared/support-guest';

/**
 * Public guest-ticket calls (design 2026-11-15 item 6): no sign-in, so a plain fetch. The API checks Turnstile and its
 * per-address, per-phone and per-reference limits; every answer is validated with the shared schemas. **Real
 * sign-in builds only**: import with `import()` so the demo bundle never carries it (or Zod).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

function failureCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}
export interface GuestFail {
  ok: false;
  code: string;
}
export interface GuestOk<T> {
  ok: true;
  data: T;
}

async function call<T>(
  path: string,
  body: unknown,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): Promise<GuestOk<T> | GuestFail> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1/support-guest${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, code: failureCode(json) ?? `HTTP_${String(res.status)}` };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: 'BAD_RESPONSE' };
}

export const createGuestTicketCall = (input: {
  name: string;
  phone: string;
  kind: string;
  body: string;
  turnstileToken: string;
}): Promise<GuestOk<GuestCreatedDto> | GuestFail> => call('/tickets', input, GuestCreated);

export const lookupGuestTicketCall = (code: string, key: string) =>
  call('/lookup', { code, key }, GuestTicket);

export const replyGuestTicketCall = (code: string, key: string, body: string) =>
  call('/reply', { code, key, body }, GuestReplied);
