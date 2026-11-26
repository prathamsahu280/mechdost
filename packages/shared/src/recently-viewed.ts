/**
 * Recently viewed products (shopping personalisation phase 2, design 2026-11-25, founder approval 2026-11-26).
 * The browser's copy of the list: product slugs with the time of the last view (UTC milliseconds), newest first, one
 * entry per product, at most `RECENT_MAX`. Zod-free and tiny, so the lazy storefront chunk can use it; the API's
 * shapes live in `./recently-viewed-api`.
 */

/** The list keeps this many products (design: "last 8–10"). */
export const RECENT_MAX = 10;
/** The home page shows the list only from this many products on (design: "home once 2+ items exist"). */
export const RECENT_MIN_HOME = 2;
/** The same product viewed again within this window is not written to the server again (idempotent per minute). */
export const RECENT_WRITE_WINDOW_SECONDS = 60;

export interface RecentEntry {
  slug: string;
  /** UTC milliseconds of the last view. */
  at: number;
}

/** Same rule as the catalogue's product slugs. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const isRecentSlug = (slug: unknown): slug is string => typeof slug === 'string' && SLUG_RE.test(slug);

function newestFirst(list: readonly RecentEntry[]): RecentEntry[] {
  const best = new Map<string, number>();
  for (const e of list) {
    const prev = best.get(e.slug);
    if (prev === undefined || e.at > prev) best.set(e.slug, e.at);
  }
  return [...best.entries()]
    .map(([slug, at]) => ({ slug, at }))
    .sort((a, b) => b.at - a.at || (a.slug < b.slug ? -1 : 1))
    .slice(0, RECENT_MAX);
}

/** The list after viewing `slug` at `at`; an invalid slug leaves it unchanged. */
export function pushRecent(list: readonly RecentEntry[], slug: string, at: number): RecentEntry[] {
  if (!isRecentSlug(slug)) return [...list];
  return newestFirst([{ slug, at }, ...list.filter((e) => e.slug !== slug)]);
}

export function removeRecent(list: readonly RecentEntry[], slug: string): RecentEntry[] {
  return list.filter((e) => e.slug !== slug);
}

/** Two lists as one, keeping each product's latest view (a device list merged into the account's at sign-in). */
export function mergeRecent(a: readonly RecentEntry[], b: readonly RecentEntry[]): RecentEntry[] {
  return newestFirst([...a, ...b]);
}

/** Reads the stored text; anything broken or foreign is dropped, never thrown (storage can hold anything). */
export function parseRecent(raw: string | null): RecentEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RecentEntry[] = [];
  for (const item of data as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { slug, at } = item as { slug?: unknown; at?: unknown };
    if (isRecentSlug(slug) && typeof at === 'number' && Number.isFinite(at)) out.push({ slug, at });
  }
  return newestFirst(out);
}

export const serialiseRecent = (list: readonly RecentEntry[]): string =>
  JSON.stringify(list.map((e) => ({ slug: e.slug, at: e.at })));
