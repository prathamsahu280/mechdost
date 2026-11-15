import {
  ExportOptionsDto,
  ExportTicketDto,
  type ExportOptions,
  type ExportRequest,
  type ExportTicket,
} from '@mechdost/shared/exports';
import { adminApi, type AdminResult } from './admin-api';

/**
 * The Exports screen on the MechDost API (real sign-in only; design 2026-11-15 item 4): what the viewer may export,
 * the request (which audits it and returns a 10-minute link) and the file download. Loaded only by that screen
 * (dynamic import). The file is fetched with the same bearer token (a link alone never works), kept in memory as a
 * Blob and handed to the browser to save; nothing is stored.
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export const fetchExportOptions = (locale: string): Promise<AdminResult<ExportOptions>> =>
  adminApi(locale, '/admin/exports/options', ExportOptionsDto);

export const requestExport = (locale: string, body: ExportRequest): Promise<AdminResult<ExportTicket>> =>
  adminApi(locale, '/admin/exports', ExportTicketDto, { method: 'POST', body });

async function errorCodeOf(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body;
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string')
      return error.code;
  }
  return `HTTP_${String(res.status)}`;
}

export async function downloadExportFile(locale: string, path: string): Promise<AdminResult<Blob>> {
  if (!API) return { ok: false, status: 0, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
  if (!res.ok) return { ok: false, status: res.status, code: await errorCodeOf(res) };
  return { ok: true, data: await res.blob() };
}

/** Hand a file to the browser's save flow. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
