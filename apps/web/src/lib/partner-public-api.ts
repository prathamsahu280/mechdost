import {
  ApiErrorBody,
  ApplicationReceived,
  FieldsDetails,
  OpenInvite,
  type OpenInviteDto,
} from '@mechdost/shared/partner-api';

/**
 * The public seller onboarding calls (spec 07, Stream D 2026-11-14): the application form and the invite link.
 * No sign-in, so a plain fetch (no ID token); the API checks Turnstile and per-IP / per-phone limits. Answers are
 * validated with the shared schemas. **Real sign-in builds only**: import with `import()` so the demo bundle never
 * carries it (or Zod).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export interface PublicFail {
  ok: false;
  code: string;
  fields: string[];
}

async function call(
  path: string,
  init?: { body: unknown },
): Promise<{ ok: true; body: unknown } | PublicFail> {
  if (!API) return { ok: false, code: 'UNAVAILABLE', fields: [] };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: init ? 'POST' : 'GET',
      cache: 'no-store',
      ...(init ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
    });
  } catch {
    return { ok: false, code: 'NETWORK', fields: [] };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, body };
  const err = ApiErrorBody.safeParse(body);
  if (!err.success) return { ok: false, code: `HTTP_${String(res.status)}`, fields: [] };
  const details = FieldsDetails.safeParse(err.data.error.details);
  return { ok: false, code: err.data.error.code, fields: details.success ? details.data.fields : [] };
}

/** Submit a seller application; with `inviteToken`, the invite's name, email and mobile number are used. */
export async function submitApplication(
  application: Record<string, unknown>,
  turnstileToken: string,
  inviteToken?: string,
): Promise<{ ok: true; code: string } | PublicFail> {
  const path = inviteToken
    ? `/partner-invites/${encodeURIComponent(inviteToken)}/application`
    : '/partner-applications';
  const res = await call(path, { body: { application, turnstileToken } });
  if (!res.ok) return res;
  const parsed = ApplicationReceived.safeParse(res.body);
  return parsed.success
    ? { ok: true, code: parsed.data.code }
    : { ok: false, code: 'BAD_RESPONSE', fields: [] };
}

/** What an invite link shows before the form (phone masked), or why it cannot be used. */
export async function fetchInvite(token: string): Promise<{ ok: true; invite: OpenInviteDto } | PublicFail> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { ok: false, code: 'NOT_FOUND', fields: [] };
  const res = await call(`/partner-invites/${token}`);
  if (!res.ok) return res;
  const parsed = OpenInvite.safeParse(res.body);
  return parsed.success ? { ok: true, invite: parsed.data } : { ok: false, code: 'BAD_RESPONSE', fields: [] };
}
