import {
  ShopCsvApplied,
  ShopCsvPreview,
  type ShopCsvAppliedDto,
  type ShopCsvPreviewDto,
} from '@mechdost/shared/shop-tools';
import { SHOP_CSV_MAX_BYTES } from '@mechdost/shared/shop-csv';
import type { ApplicationStatusView } from '@mechdost/shared/shop-tools';
import { ApplicationStatusDto } from '@mechdost/shared/shop-tools';

/**
 * Calls of the shop CSV upload and the public status lookup (design 2026-11-15, items 4 and 7). Real sign-in only.
 * Uploads are multipart with the caller's token; answers are validated with the shared schemas (hard rule 4).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

function codeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

export type CsvResult<T> = { ok: true; data: T } | { ok: false; code: string };

async function post<T>(
  locale: string,
  path: string,
  init: { body: BodyInit; json?: boolean },
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  token?: string,
): Promise<CsvResult<T>> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  let bearer = token;
  if (!bearer) {
    const { currentIdToken } = await import('./auth/firebase-client');
    bearer = (await currentIdToken(locale)) ?? undefined;
  }
  if (!bearer) return { ok: false, code: 'AUTH_REQUIRED' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(init.json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, code: codeOf(body) ?? `HTTP_${String(res.status)}` };
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: 'BAD_RESPONSE' };
}

function csvForm(file: File): FormData {
  const form = new FormData();
  form.set('file', file);
  return form;
}

/** Check a file against the shop's offers; nothing changes. A file over the limit is refused here first. */
export function previewCsv(
  locale: string,
  shopId: string,
  file: File,
): Promise<CsvResult<ShopCsvPreviewDto>> {
  if (file.size > SHOP_CSV_MAX_BYTES) return Promise.resolve({ ok: false, code: 'CSV_TOO_LARGE' });
  return post(locale, `/shop/csv/${shopId}/preview`, { body: csvForm(file) }, ShopCsvPreview);
}

/** Apply the file: all of it or nothing. */
export function applyCsv(locale: string, shopId: string, file: File): Promise<CsvResult<ShopCsvAppliedDto>> {
  return post(locale, `/shop/csv/${shopId}/apply`, { body: csvForm(file) }, ShopCsvApplied);
}

/** The template (the shop's own offers) as a download. */
export async function downloadTemplate(locale: string, shopId: string): Promise<CsvResult<true>> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
  try {
    const res = await fetch(`${API}/v1/shop/csv/${shopId}/template`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, code: `HTTP_${String(res.status)}` };
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mechdost-stock-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true, data: true };
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
}

/** Where is my application? `token` is the ID token of the phone just proved by a one-time code. */
export function lookupApplication(
  locale: string,
  code: string,
  token: string,
): Promise<CsvResult<ApplicationStatusView>> {
  return post(
    locale,
    '/partner-applications/status',
    { body: JSON.stringify({ code }), json: true },
    ApplicationStatusDto,
    token,
  );
}
