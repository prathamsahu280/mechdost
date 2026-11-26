import { and, desc, eq, sql } from 'drizzle-orm';
import { RECENT_MAX, RECENT_WRITE_WINDOW_SECONDS } from '@mechdost/shared/recently-viewed';
import type { RecentlyViewed } from '@mechdost/shared/recently-viewed-api';
import { consents, products, recentlyViewed as rv, users } from '../schema';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { productVisible } from './visibility';

/**
 * Recently viewed products on the server (shopping personalisation phase 2, design 2026-11-25). Only for a signed-in
 * customer whose latest `personalisation` consent is a grant: without it nothing is written and the list reads as
 * `{ stored: false }` (the browser keeps its own copy). Every function takes the session's `userId`; another person's
 * list cannot be named. Writes run under the customer's user-row lock (the cart and wishlist lock), so two tabs cannot
 * push the list past `RECENT_MAX`. A view of a product already in the list within `RECENT_WRITE_WINDOW_SECONDS` changes
 * nothing (idempotent per product per minute); a view time in the future is stored as now.
 */

export async function hasPersonalisationConsent(tx: Tx, userId: string): Promise<boolean> {
  const [latest] = await tx
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.purpose, 'personalisation')))
    .orderBy(desc(consents.createdAt), desc(consents.id))
    .limit(1);
  return latest?.granted === true;
}

async function listOf(tx: Tx, userId: string): Promise<RecentlyViewed['items']> {
  const rows = await tx
    .select({ slug: products.slug, viewedAt: rv.viewedAt })
    .from(rv)
    .innerJoin(products, eq(products.id, rv.productId))
    .where(and(eq(rv.userId, userId), productVisible('products')))
    .orderBy(desc(rv.viewedAt), products.slug)
    .limit(RECENT_MAX);
  return rows.map((r) => ({ slug: r.slug, viewedAt: r.viewedAt.toISOString() }));
}

/** The customer's list, newest first (hidden products are left out); `stored: false` without the consent. */
export async function recentlyViewed(db: Tx, userId: string): Promise<RecentlyViewed> {
  if (!(await hasPersonalisationConsent(db, userId))) return { stored: false, items: [] };
  return { stored: true, items: await listOf(db, userId) };
}

/**
 * Records one view (the product page) or a device's list (merged at sign-in): each product keeps its latest view,
 * unknown or hidden slugs are skipped, then the list is cut back to `RECENT_MAX`. Returns the list as it is now.
 */
export async function recordRecentViews(
  db: Tx,
  input: { userId: string; cityCode: string; views: readonly { slug: string; viewedAt: string }[] },
): Promise<RecentlyViewed> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');
    if (!u) throw new NotFoundError('User not found');
    if (!(await hasPersonalisationConsent(tx, input.userId))) return { stored: false, items: [] };
    const now = Date.now();
    for (const view of input.views.slice(0, RECENT_MAX)) {
      const parsed = Date.parse(view.viewedAt);
      if (!Number.isFinite(parsed)) continue;
      const when = new Date(Math.min(parsed, now));
      // One statement: insert, or move the time forward only when the stored view is a minute older (idempotent).
      await tx.execute(sql`
        insert into recently_viewed (user_id, product_id, city_code, viewed_at)
        select ${input.userId}::uuid, p.id, ${input.cityCode}, ${when.toISOString()}::timestamptz
        from products p where p.slug = ${view.slug} and ${productVisible('p')}
        on conflict (user_id, product_id) do update set viewed_at = excluded.viewed_at, city_code = excluded.city_code
        where recently_viewed.viewed_at < excluded.viewed_at - make_interval(secs => ${RECENT_WRITE_WINDOW_SECONDS})`);
    }
    await tx.execute(sql`
      delete from recently_viewed where user_id = ${input.userId}::uuid and product_id not in (
        select product_id from recently_viewed where user_id = ${input.userId}::uuid
        order by viewed_at desc, product_id limit ${RECENT_MAX})`);
    return { stored: true, items: await listOf(tx, input.userId) };
  });
}

/** "Clear": deletes the customer's stored list; returns how many products it held. */
export async function clearRecentlyViewed(
  db: Tx,
  userId: string,
  reason: 'cleared' | 'consent_withdrawn' = 'cleared',
): Promise<number> {
  return db.transaction(async (tx) => {
    const gone = await tx.delete(rv).where(eq(rv.userId, userId)).returning({ productId: rv.productId });
    if (gone.length > 0)
      await recordServerEvent(tx, 'recently_viewed_deleted', {
        userId,
        props: { count: gone.length, reason },
      });
    return gone.length;
  });
}
