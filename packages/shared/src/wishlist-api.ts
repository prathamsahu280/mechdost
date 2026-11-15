/**
 * Wishlist (spec 02 "Wishlist", design 2026-11-15 item 5): one list per signed-in customer, products not packs, at
 * most `WISHLIST_MAX`. The product is named by its slug in the URL; the customer by the session, never by an id.
 */
import { z } from 'zod';
// A product slug as the catalogue accepts it. Not imported from ./catalogue: that module's schemas must load after
// @hono/zod-openapi in the API (see routes/catalogue.ts), and the database package imports this file early.
export const PRODUCT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const WISHLIST_MAX = 100;

export const WishlistSlug = z.string().regex(PRODUCT_SLUG_RE);

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
  /** A fingerprint of the saved products: changes on every add or remove; sent back as `since` by the refresh. */
  version: z.number().int().min(0),
});
/** The answer to `GET /me/wishlist?since=` when nothing changed. */
export const WishlistUnchangedDto = z.object({
  unchanged: z.literal(true),
  version: z.number().int().min(0),
});
export type Wishlist = z.infer<typeof WishlistDto>;

/** The result of an add or remove, with the list's new version (so the next refresh does not fetch what this device just did). */
export const WishlistChangeDto = z.object({
  slug: z.string(),
  on: z.boolean(),
  count: z.number().int(),
  version: z.number().int().min(0),
});
