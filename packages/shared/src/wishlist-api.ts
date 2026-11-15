/**
 * Wishlist (spec 02 "Wishlist", design 2026-11-15 item 5): one list per signed-in customer, products not packs, at
 * most `WISHLIST_MAX`. The product is named by its slug in the URL; the customer by the session, never by an id.
 */
import { z } from 'zod';
import { CATALOGUE_SLUG_RE } from './catalogue';

export const WISHLIST_MAX = 100;

export const WishlistSlug = z.string().regex(CATALOGUE_SLUG_RE);

export const WishlistItemDto = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  /** The product's cover photo (public path of the 640 variant's id), when it has an approved one. */
  photo: z
    .object({ id: z.uuid(), alt: z.string(), width: z.number().int(), height: z.number().int() })
    .nullable(),
  addedAt: z.string(),
});

export const WishlistDto = z.object({
  items: z.array(WishlistItemDto),
  max: z.number().int(),
});
export type Wishlist = z.infer<typeof WishlistDto>;

export const WishlistChangeDto = z.object({ slug: z.string(), on: z.boolean(), count: z.number().int() });
