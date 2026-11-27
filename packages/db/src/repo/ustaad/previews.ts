/**
 * Link previews (spec 23 § 10a, SR-22/23): one `ustaad_link_previews` row per URL hash (sha256 of the normalised URL).
 * The SSRF-safe fetcher lives in the API (`apps/api/src/ustaad/link-preview/`, no database access); it hands its
 * result here after the post's transaction has committed. A failed or blocked fetch is stored too (no retry storm) and
 * never blocks the post; only `ok` previews are shown. The og:image is not fetched yet (next step: through the
 * image pipeline), so `image_media_id` stays null.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LINK_PREVIEW_STATES } from '@mechdost/shared/ustaad/codes';
import { ustaadLinkPreviews } from '../../schema';
import type { Tx } from '../orders';

/** Stored previews are refreshed after a week. */
export const LINK_PREVIEW_MAX_AGE_HOURS = 168;

export function ustaadLinkUrlHash(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

/** True when there is no preview for the URL or it is older than `maxAgeHours`. */
export async function ustaadLinkPreviewNeeded(
  db: Tx,
  url: string,
  maxAgeHours = LINK_PREVIEW_MAX_AGE_HOURS,
): Promise<boolean> {
  const [row] = await db
    .select({
      fresh: sql<boolean>`${ustaadLinkPreviews.checkedAt} > now() - make_interval(hours => ${maxAgeHours})`,
    })
    .from(ustaadLinkPreviews)
    .where(eq(ustaadLinkPreviews.urlHash, ustaadLinkUrlHash(url)))
    .limit(1);
  return !row?.fresh;
}

export interface LinkPreviewResult {
  status: (typeof LINK_PREVIEW_STATES)[number];
  finalHost: string | null;
  title: string | null;
  description: string | null;
  /** oEmbed `author_name` (video links, spec 23 § 10b). */
  author?: string | null;
}

const clip = (v: string | null, max: number) => (v === null ? null : v.slice(0, max));

export async function saveUstaadLinkPreview(db: Tx, url: string, r: LinkPreviewResult): Promise<void> {
  const values = {
    finalHost: clip(r.finalHost, 253),
    title: r.status === 'ok' ? clip(r.title, 200) : null,
    description: r.status === 'ok' ? clip(r.description, 500) : null,
    authorName: r.status === 'ok' ? clip(r.author ?? null, 100) : null,
    status: r.status,
    checkedAt: new Date(),
  };
  await db
    .insert(ustaadLinkPreviews)
    .values({ urlHash: ustaadLinkUrlHash(url), ...values })
    .onConflictDoUpdate({ target: ustaadLinkPreviews.urlHash, set: values });
}

/** `ok` previews by URL (for post views). */
export async function ustaadLinkPreviewsFor(
  tx: Tx,
  urls: readonly string[],
): Promise<Map<string, { title: string | null; description: string | null }>> {
  const out = new Map<string, { title: string | null; description: string | null }>();
  if (urls.length === 0) return out;
  const byHash = new Map(urls.map((u) => [ustaadLinkUrlHash(u), u]));
  const rows = await tx
    .select()
    .from(ustaadLinkPreviews)
    .where(inArray(ustaadLinkPreviews.urlHash, [...byHash.keys()]));
  for (const r of rows) {
    const url = byHash.get(r.urlHash);
    if (url && r.status === 'ok') out.set(url, { title: r.title, description: r.description });
  }
  return out;
}

/**
 * The cached oEmbed title and author of a video's canonical watch URL when the row is `ok` and fresh, else null (the
 * API then asks oEmbed again). Refreshed after `maxAgeHours`; failures are not cached as answers.
 */
export async function ustaadVideoMetaCached(
  db: Tx,
  watchUrl: string,
  maxAgeHours = LINK_PREVIEW_MAX_AGE_HOURS,
): Promise<{ title: string | null; author: string | null } | null> {
  const [row] = await db
    .select({ title: ustaadLinkPreviews.title, author: ustaadLinkPreviews.authorName })
    .from(ustaadLinkPreviews)
    .where(
      and(
        eq(ustaadLinkPreviews.urlHash, ustaadLinkUrlHash(watchUrl)),
        eq(ustaadLinkPreviews.status, 'ok'),
        sql`${ustaadLinkPreviews.checkedAt} > now() - make_interval(hours => ${maxAgeHours})`,
      ),
    )
    .limit(1);
  return row ?? null;
}
