import { timingSafeEqual } from 'node:crypto';

/**
 * The check behind `/api/revalidate`: the API calls it after staff publish a policy, the home layout or company
 * details (design 2026-11-15 items 5, 6, 8). Only a server that knows `REVALIDATE_SECRET` (compared in constant
 * time) may ask, and only for the tags below; with no secret configured the route answers 404, as if absent.
 */
export const REVALIDATE_TAGS = ['content', 'site-layout', 'company'] as const;
export type RevalidateTag = (typeof REVALIDATE_TAGS)[number];

export type RevalidateCheck = { ok: true; tags: RevalidateTag[] } | { ok: false; status: 400 | 401 | 404 };

const isTag = (v: unknown): v is RevalidateTag => REVALIDATE_TAGS.some((t) => t === v);

function sameSecret(expected: string, given: string | null): boolean {
  if (given === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkRevalidate(
  expectedSecret: string | undefined,
  givenSecret: string | null,
  body: unknown,
): RevalidateCheck {
  if (!expectedSecret || expectedSecret.length < 32) return { ok: false, status: 404 };
  if (!sameSecret(expectedSecret, givenSecret)) return { ok: false, status: 401 };
  const tags = typeof body === 'object' && body !== null && 'tags' in body ? body.tags : null;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > REVALIDATE_TAGS.length || !tags.every(isTag))
    return { ok: false, status: 400 };
  return { ok: true, tags: [...new Set(tags)] };
}
