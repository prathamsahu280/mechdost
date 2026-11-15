import { PublicOffersDto, type PublicOffer } from '@mechdost/shared/coupon-api';
import type { Locale } from '@/i18n/routing';

/**
 * The public offers list from the API (spec 03 "Public offers", 2026-11-16). Server side only: imported by the
 * Server Component page, never by client code. The answer is parsed with the shared DTO. A failure is returned as
 * `null` (the page shows its "could not load" state with the same single next action) instead of an empty list that
 * would look like "no offers". City is Raipur until the city selector (spec 15), like the catalogue.
 */
const CITY = 'RPR';
const TIMEOUT_MS = 3000;

export async function fetchOffers(locale: Locale): Promise<PublicOffer[] | null> {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!base) return null;
  const url = new URL(`${base}/v1/offers`);
  url.searchParams.set('city', CITY);
  url.searchParams.set('locale', locale);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 60, tags: ['offers'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = PublicOffersDto.safeParse(await res.json());
    return parsed.success ? parsed.data.offers : null;
  } catch {
    return null;
  }
}
