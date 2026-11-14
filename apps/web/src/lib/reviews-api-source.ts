import { PublicReviewsDto, type PublicReviews } from '@mechdost/shared/reviews-api';
import type { ReviewTargetType } from '@mechdost/shared/reviews';

/**
 * Approved reviews from the MechDost API for Server Components (data mode `api`, spec 02 § Reviews). Server-side
 * only. Unlike the catalogue, a failure never throws: reviews are secondary on a product or workshop page, so the
 * page renders with a short "could not load" note instead of the error boundary. Kept 60 s by the fetch cache
 * (the API sends the same max-age); tagged per target for on-demand revalidation later.
 */
const TIMEOUT_MS = 3000;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Newest reviews shown on the page (server-rendered, no client JS). */
export const REVIEWS_ON_PAGE = 10;

export type PublicReviewsResult = { ok: true; data: PublicReviews } | { ok: false; reason: 'none' | 'error' };

export async function fetchPublicReviews(
  targetType: ReviewTargetType,
  slug: string,
): Promise<PublicReviewsResult> {
  if (!SLUG_RE.test(slug) || slug.length > 120) return { ok: false, reason: 'none' };
  const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (!api) return { ok: false, reason: 'error' };
  try {
    const url = `${api}/v1/reviews/${targetType}/${encodeURIComponent(slug)}?limit=${String(REVIEWS_ON_PAGE)}`;
    const res = await fetch(url, {
      next: { revalidate: 60, tags: ['reviews', `reviews:${targetType}:${slug}`] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: false, reason: 'none' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const parsed = PublicReviewsDto.safeParse(await res.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
