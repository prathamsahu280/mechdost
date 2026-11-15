import { ConsentListDto, ExportStatusDto, PrivacyViewDto } from '@mechdost/shared/privacy-api';
import type { ExportStatus, PrivacyPurpose, PrivacyView } from '@mechdost/shared/privacy-api';
import { authed, type ApiResult } from './orders-api';

/**
 * Account -> Privacy on the API (design 2026-11-15 item 6): consents, the data download request and the download
 * itself. Every answer is checked with the shared schemas. The download goes through the signed-in API call (there is
 * no public link) and is handed to the browser as a file.
 */
export const fetchPrivacy = (locale: string): Promise<ApiResult<PrivacyView>> =>
  authed(locale, '/me/privacy', PrivacyViewDto);

export const saveConsent = (locale: string, purpose: PrivacyPurpose, granted: boolean) =>
  authed(locale, `/me/privacy/consents/${purpose}`, ConsentListDto, { method: 'PUT', body: { granted } });

export const requestExport = (locale: string): Promise<ApiResult<ExportStatus>> =>
  authed(locale, '/me/data-exports', ExportStatusDto, { method: 'POST' });

/** Whatever JSON the API sends: it is only turned into a file, never read by the page. */
const anyJson = { safeParse: (v: unknown) => ({ success: true as const, data: v }) };

/** Fetches the export and saves it as `mechdost-my-data.json`. */
export async function downloadExport(locale: string, id: string): Promise<ApiResult<true>> {
  const res = await authed(locale, `/me/data-exports/${encodeURIComponent(id)}/download`, anyJson);
  if (!res.ok) return res;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mechdost-my-data.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
  return { ok: true, data: true };
}
