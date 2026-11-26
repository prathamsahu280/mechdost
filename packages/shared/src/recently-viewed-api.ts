/**
 * Recently viewed on the API (shopping personalisation phase 2). Kept on the server only for a signed-in customer who
 * gave the `personalisation` consent (Account → Privacy); without it the API stores nothing and answers
 * `{ stored: false, items: [] }`. Slugs and UTC times only: the page turns them into cards itself.
 */
import { z } from 'zod';
import { RECENT_MAX } from './recently-viewed';

export * from './recently-viewed';

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,119}$/);

export const RecentViewSchema = z.object({ slug: Slug, viewedAt: z.iso.datetime() }).strict();

/** One view (the product page) or a device's list merged in at sign-in; `city` is the shop city the page showed. */
export const RecentViewsBodySchema = z
  .object({
    views: z.array(RecentViewSchema).min(1).max(RECENT_MAX),
    city: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export type RecentViewsBody = z.infer<typeof RecentViewsBodySchema>;

export const RecentlyViewedDto = z.object({
  /** True when the account keeps the list (consent given); false = this device only. */
  stored: z.boolean(),
  items: z.array(z.object({ slug: Slug, viewedAt: z.string() })),
});
export type RecentlyViewed = z.infer<typeof RecentlyViewedDto>;
