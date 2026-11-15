import { and, eq, sql } from 'drizzle-orm';
import { WISHLIST_MAX, type Wishlist } from '@mechdost/shared/wishlist-api';
import { products, users, wishlistItems } from '../schema';
import { NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * The customer's wishlist (spec 02 "Wishlist", design 2026-11-15 item 5): products, newest first, at most
 * `WISHLIST_MAX`. Every function takes the session's `userId`; the list of another customer cannot be named. The limit
 * is held under the customer's user-row lock (the same lock the cart uses), so parallel adds cannot pass 100. Adding
 * what is already there, or removing what is not, changes nothing and records no event.
 */
export type WishlistLocale = 'en' | 'hi';

/**
 * A fingerprint of the saved products: the sum of a hash of each product id, kept inside a positive 31-bit number.
 * An add or a remove changes it, an unchanged list gives the same number, and it needs one indexed read of at most
 * 100 rows. The refresh sends it back as `since`.
 */
export async function wishlistVersion(db: Tx, userId: string): Promise<number> {
  const [row] = rowsOf<{ v: number | string | null }>(
    await db.execute(
      sql`select (coalesce(sum(hashtext(product_id::text)::bigint), 0) % 2147483647 + 2147483647) % 2147483647 as v
        from wishlist_items where user_id = ${userId}`,
    ),
  );
  return Number(row?.v ?? 0);
}

/** The refresh: the list, or `{ unchanged: true }` when it is still the one the caller already has. */
export async function getWishlistIfChanged(
  db: Tx,
  userId: string,
  locale: WishlistLocale,
  since: number,
): Promise<Wishlist | { unchanged: true; version: number }> {
  const version = await wishlistVersion(db, userId);
  return version === since ? { unchanged: true, version } : listWishlist(db, userId, locale);
}

export async function listWishlist(db: Tx, userId: string, locale: WishlistLocale = 'en'): Promise<Wishlist> {
  const rows = rowsOf<{
    slug: string;
    name: string;
    name_hi: string | null;
    brand: string;
    added_at: Date | string;
    photo_id: string | null;
    photo_alt: string | null;
    photo_alt_hi: string | null;
    photo_width: number | null;
    photo_height: number | null;
  }>(
    await db.execute(sql`
      select p.slug, p.name, p.name_hi, b.name as brand, w.created_at as added_at,
        ph.id::text as photo_id, ph.alt as photo_alt, ph.alt_hi as photo_alt_hi, ph.width as photo_width,
        ph.height as photo_height
      from wishlist_items w
      join products p on p.id = w.product_id and p.status = 'live'
      join brands b on b.id = p.brand_id
      left join lateral (
        select id, alt, alt_hi, width, height from product_photos
        where product_id = p.id and status = 'approved' and deleted_at is null order by sort, id limit 1) ph on true
      where w.user_id = ${userId}
      order by w.created_at desc, w.id desc
      limit ${WISHLIST_MAX}`),
  );
  return {
    max: WISHLIST_MAX,
    version: await wishlistVersion(db, userId),
    items: rows.map((r) => ({
      slug: r.slug,
      name: localized(r.name, r.name_hi, locale),
      brand: r.brand,
      photo:
        r.photo_id === null
          ? null
          : {
              id: r.photo_id,
              alt: localized(r.photo_alt ?? '', r.photo_alt_hi, locale),
              width: Number(r.photo_width),
              height: Number(r.photo_height),
            },
      addedAt: new Date(r.added_at).toISOString(),
    })),
  };
}

/** Put a live product on the list or take it off. Returns the new state and the size of the list. */
export async function setWishlisted(
  db: Tx,
  userId: string,
  slug: string,
  on: boolean,
): Promise<{ slug: string; on: boolean; count: number; version: number }> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) throw new NotFoundError('User not found');
    const [p] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, slug), eq(products.status, 'live')));
    if (!p) throw new NotFoundError('Product not found');
    const count = async () => {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(wishlistItems)
        .where(eq(wishlistItems.userId, userId));
      return row?.n ?? 0;
    };
    const before = await count();
    if (on) {
      const [exists] = await tx
        .select({ id: wishlistItems.id })
        .from(wishlistItems)
        .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, p.id)));
      if (exists) return { slug, on: true, count: before, version: await wishlistVersion(tx, userId) };
      if (before >= WISHLIST_MAX)
        throw new ValidationError(`Your wishlist can hold ${String(WISHLIST_MAX)} products`, 'WISHLIST_FULL');
      await tx.insert(wishlistItems).values({ userId, productId: p.id });
      await recordServerEvent(tx, 'wishlist_changed', {
        userId,
        props: { productId: p.id, on: true, count: before + 1 },
      });
      return { slug, on: true, count: before + 1, version: await wishlistVersion(tx, userId) };
    }
    const gone = await tx
      .delete(wishlistItems)
      .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, p.id)))
      .returning({ id: wishlistItems.id });
    if (gone.length === 0)
      return { slug, on: false, count: before, version: await wishlistVersion(tx, userId) };
    await recordServerEvent(tx, 'wishlist_changed', {
      userId,
      props: { productId: p.id, on: false, count: before - 1 },
    });
    return { slug, on: false, count: before - 1, version: await wishlistVersion(tx, userId) };
  });
}
