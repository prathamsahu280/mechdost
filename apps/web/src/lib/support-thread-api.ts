import {
  SUPPORT_ATTACH_BYTES,
  SUPPORT_ATTACH_MAX,
  SUPPORT_THREAD_ERROR_CODES,
  SupportThreadOpened,
  type SupportIssueCode,
  type SupportThreadOpenedDto,
} from '@mechdost/shared/support-thread';
import { SupportReplied } from '@mechdost/shared/support-api';

/**
 * Order and request threads with support on the MechDost API (design 2026-11-15): multipart calls (a message with
 * photos) and the error codes the screens translate. Loaded only by the real-mode support screens. The caller's
 * token goes in the header; every answer is checked with the shared schema (hard rule 4).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type ThreadResult<T> = { ok: true; data: T } | { ok: false; code: string };

function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

/** Photos the API would refuse for size or count, refused here first so the message shows without a round trip. */
export function photoProblem(files: readonly File[]): 'ATTACHMENT_LIMIT' | 'PHOTO_TOO_LARGE' | null {
  if (files.length > SUPPORT_ATTACH_MAX) return 'ATTACHMENT_LIMIT';
  return files.some((f) => f.size > SUPPORT_ATTACH_BYTES) ? 'PHOTO_TOO_LARGE' : null;
}

async function postForm<T>(
  locale: string,
  path: string,
  form: FormData,
  parse: (body: unknown) => { success: true; data: T } | { success: false },
): Promise<ThreadResult<T>> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, code: errorCodeOf(body) ?? `HTTP_${String(res.status)}` };
  const parsed = parse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: 'BAD_RESPONSE' };
}

export interface OpenThreadFields {
  issueCode: SupportIssueCode;
  orderCode: string | null;
  serviceCode: string | null;
  body: string;
}

/** Open (or continue) the one thread of an order or service job, with up to four photos. */
export function openThread(
  locale: string,
  fields: OpenThreadFields,
  files: readonly File[],
): Promise<ThreadResult<SupportThreadOpenedDto>> {
  const problem = photoProblem(files);
  if (problem) return Promise.resolve({ ok: false, code: problem });
  const form = new FormData();
  form.set('issueCode', fields.issueCode);
  if (fields.orderCode) form.set('orderCode', fields.orderCode);
  if (fields.serviceCode) form.set('serviceCode', fields.serviceCode);
  form.set('body', fields.body);
  for (const file of files) form.append('file', file);
  return postForm(locale, '/support/threads', form, (b) => SupportThreadOpened.safeParse(b));
}

/** A reply with photos on one of the customer's own requests. */
export function sendPhotoMessage(locale: string, code: string, body: string, files: readonly File[]) {
  const problem = photoProblem(files);
  if (problem) return Promise.resolve<ThreadResult<{ status: string }>>({ ok: false, code: problem });
  const form = new FormData();
  form.set('body', body);
  for (const file of files) form.append('file', file);
  return postForm(locale, `/support/tickets/${encodeURIComponent(code)}/photo-messages`, form, (b) =>
    SupportReplied.safeParse(b),
  );
}

/** `supportThread.*` key for an API code (anything unknown is the generic message). */
export function threadErrorKey(code: string): string {
  if ((SUPPORT_THREAD_ERROR_CODES as readonly string[]).includes(code)) return `err_${code}`;
  switch (code) {
    case 'RATE_LIMITED':
    case 'HTTP_429':
      return 'err_RATE_LIMITED';
    case 'HTTP_413':
      return 'err_PHOTO_TOO_LARGE';
    case 'NOT_FOUND':
    case 'TICKET_CLOSED':
    case 'TICKET_DAILY_LIMIT':
    case 'REPLY_LIMIT':
    case 'DESTINATION_LOCKED':
    case 'ENCRYPTION_UNAVAILABLE':
    case 'REFUND_NOT_COLLECTED':
    case 'REFUND_EXCEEDS_ORDER':
    case 'FORBIDDEN':
      return `err_${code}`;
    case 'TICKET_BODY_EMPTY':
      return 'err_empty';
    default:
      return 'err_generic';
  }
}
