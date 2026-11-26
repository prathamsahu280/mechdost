import { SAVINGS_CONTENT_KEYS, type SavingsContentKey } from '@mechdost/shared/content';
import { DATA_MODE } from '@/lib/data-mode';

/**
 * The admin's published "Your savings" wording (decision 2026-11-26) for Server Components, passed to the client
 * screens as props (no i18n or fetch code ships for it). Real data mode reads `GET /v1/content` (the same cached
 * request as the trust lines, 60 s, tag `content`); the demo build has no API and uses the locale-file defaults. A
 * failed or malformed answer is `{}`: wording is never a reason to break a page.
 */
const CITY = 'RPR'; // until the city selector (spec 15)
const TIMEOUT_MS = 2000;

export type PublishedSavings = Partial<Record<SavingsContentKey, string>>;

export async function publishedSavings(locale: string): Promise<PublishedSavings> {
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
    const out: PublishedSavings = {};
    for (const [key, value] of Object.entries(content)) {
      if ((SAVINGS_CONTENT_KEYS as readonly string[]).includes(key) && typeof value === 'string')
        out[key as SavingsContentKey] = value;
    }
    return out;
  } catch {
    return {};
  }
}
