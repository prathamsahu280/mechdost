import { isTrustKey, type TrustKey } from '@mechdost/shared/content';
import { DATA_MODE } from '@/lib/data-mode';

/**
 * The admin's published trust lines ("genuine parts", design 2026-11-15) for Server Components. Real data mode reads
 * `GET /v1/content` (cached 60 s, tag `content`); the demo build has no API, so the lines come from the locale
 * files and the browser-stored demo overrides (`TrustText`). A failed or malformed answer is `{}`: these are
 * wording, never a reason to break a page, and the locale-file default is always a safe text.
 */
const CITY = 'RPR'; // until the city selector (spec 15)
const TIMEOUT_MS = 2000;

export type PublishedTrust = Partial<Record<TrustKey, string>>;

export async function publishedTrust(locale: string): Promise<PublishedTrust> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (DATA_MODE !== 'api' || !base) return {};
  try {
    const url = new URL(`${base}/v1/content`);
    url.searchParams.set('locale', locale === 'hi' ? 'hi' : 'en');
    url.searchParams.set('city', CITY);
    const res = await fetch(url.toString(), {
      next: { revalidate: 60, tags: ['content'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const body: unknown = await res.json();
    const content = typeof body === 'object' && body !== null && 'content' in body ? body.content : null;
    if (typeof content !== 'object' || content === null) return {};
    const out: PublishedTrust = {};
    for (const [key, value] of Object.entries(content)) {
      if (isTrustKey(key) && typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
