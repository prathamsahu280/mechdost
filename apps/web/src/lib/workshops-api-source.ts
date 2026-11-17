import { NearbyWorkshopsDto, PublicWorkshopDto, type PublicWorkshop } from '@mechdost/shared/service-api';
import { WORKSHOP_SLUG_RE } from '@mechdost/shared/service-requests';
import type { Locale } from '@/i18n/routing';

/**
 * Workshops from the MechDost API for Server Components (data mode `api`, spec 06). Every answer is parsed with the
 * shared DTOs. The profile throws on failure (status, timeout, malformed body) so Next keeps the last good page
 * (ISR) or shows the error boundary; only a 404 (not bookable) is `null`. The home strip returns `null` on failure so
 * one slow call never breaks the home page.
 */
const TIMEOUT_MS = 3000;
/** Raipur centre until the city selector (spec 15); the home strip ranks the city's bookable workshops. */
const CITY_CENTRE = { lat: 21.2514, lng: 81.6296 };

function base(): string {
  const url = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!url) throw new Error('NEXT_PUBLIC_API_URL is not set (data mode api)');
  return url;
}

export async function fetchWorkshopProfile(slug: string, locale: Locale): Promise<PublicWorkshop | null> {
  // A slug the API would reject cannot exist: a 404 page, no API call, no cache entry.
  if (!WORKSHOP_SLUG_RE.test(slug) || slug.length < 3 || slug.length > 80) return null;
  const url = new URL(`${base()}/v1/workshops/${encodeURIComponent(slug)}`);
  url.searchParams.set('locale', locale);
  const res = await fetch(url.toString(), {
    next: { revalidate: 30, tags: ['workshops'] },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`workshops API ${String(res.status)}`);
  return PublicWorkshopDto.parse(await res.json());
}

/** The city's bookable workshops (nearest first), or null when the API cannot answer (home strip, sitemap). */
export async function fetchCityWorkshops(locale: Locale): Promise<PublicWorkshop[] | null> {
  try {
    const url = new URL(`${base()}/v1/workshops`);
    url.searchParams.set('lat', String(CITY_CENTRE.lat));
    url.searchParams.set('lng', String(CITY_CENTRE.lng));
    url.searchParams.set('radiusKm', '50');
    url.searchParams.set('locale', locale);
    const res = await fetch(url.toString(), {
      next: { revalidate: 60, tags: ['workshops'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = NearbyWorkshopsDto.safeParse(await res.json());
    return parsed.success ? parsed.data.workshops : null;
  } catch {
    return null;
  }
}

/** Top-rated bookable workshops of the city (rating, then review count), or null when the API cannot answer. */
export async function fetchTopWorkshops(locale: Locale, max = 3): Promise<PublicWorkshop[] | null> {
  const workshops = await fetchCityWorkshops(locale);
  if (!workshops) return null;
  return workshops
    .toSorted((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount)
    .slice(0, max);
}
