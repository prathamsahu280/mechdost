import { readCompany, type CompanyDetails, EMPTY_COMPANY } from '@mechdost/shared/company';
import { cleanPolicy, type PolicyDoc, type PolicyKey } from '@mechdost/shared/policy';
import { DEFAULT_HOME_LAYOUT, readHomeLayout, type HomeLayout } from '@mechdost/shared/site-layout';
import { DATA_MODE } from '@/lib/data-mode';

/**
 * What the admin published, for Server Components only (design 2026-11-15 items 5, 6, 8): the home layout, the
 * company details and policy pages. Real data mode reads the public API (cached 60 s under a tag that the API
 * refreshes through `/api/revalidate` right after a publish); the demo build has no API and shows the built-in
 * texts (the demo layout is applied in the browser by the pre-paint script). A failed or malformed answer is the
 * built-in default: these are site furniture and must never break a page. No client code: nothing here reaches a
 * browser bundle.
 */
const CITY = 'RPR'; // until the city selector (spec 15)
const TIMEOUT_MS = 2000;

async function readJson(path: string, params: Record<string, string>, tag: string): Promise<unknown> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (DATA_MODE !== 'api' || !base) return null;
  try {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      next: { revalidate: 60, tags: [tag] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
  }
}

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null && name in body ? (body as Record<string, unknown>)[name] : null;

/** The home layout for the launch city; the default layout when none is saved or the API is unreachable. */
export async function publishedLayout(): Promise<HomeLayout> {
  const body = await readJson('/v1/site/home-layout', { city: CITY }, 'site-layout');
  return body === null ? DEFAULT_HOME_LAYOUT : readHomeLayout(field(body, 'layout'));
}

/**
 * Is roadside help on in the launch city (spec 22, 2026-11-24)? The header item, the SOS tab, the home band, the
 * footer link, the /workshops card and the search suggestion all read this one answer, so a city without roadside never
 * shows a dead end. The browser demo shows it (the demo has roadside); real mode asks the API (cached 60 s) and a failed
 * or malformed answer hides it. Server Components only.
 */
export async function publishedRoadside(): Promise<{ enabled: boolean; alwaysOpen: boolean }> {
  if (DATA_MODE !== 'api') return { enabled: true, alwaysOpen: true };
  const body = await readJson('/v1/roadside/city', { city: CITY }, 'roadside-city');
  return {
    enabled: field(body, 'enabled') === true,
    alwaysOpen: field(body, 'alwaysOpen') !== false,
  };
}

/** The filled company details ('' = not filled). */
export async function publishedCompany(): Promise<CompanyDetails> {
  const body = await readJson('/v1/company', {}, 'company');
  return body === null ? EMPTY_COMPANY : readCompany(field(body, 'company'));
}

/** One published policy page in a language, or null (the page then shows its built-in text). */
export async function publishedPolicy(key: PolicyKey, locale: string): Promise<PolicyDoc | null> {
  const body = await readJson(
    `/v1/content/policies/${key}`,
    { locale: locale === 'hi' ? 'hi' : 'en', city: CITY },
    'content',
  );
  const raw = field(body, 'policy');
  if (raw === null) return null;
  const checked = cleanPolicy(raw);
  return checked.ok ? checked.doc : null;
}
