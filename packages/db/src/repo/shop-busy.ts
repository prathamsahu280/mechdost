import { eq } from 'drizzle-orm';
import { busyUntilFor, type ShopBusyBody } from '@mechdost/shared/shop-team';
import { auditLog, shops } from '../schema';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * The owner marks the shop "Closed today" (until midnight IST) or "Busy for N hours", or clears it (spec 04/07,
 * design 2026-11-15). The shop stays visible, but routing, suggestions, checkout and catalogue prices skip it while
 * `busy and busy_until > now()` is true: the end time is compared with the database clock wherever shops are read,
 * so the toggle expires by itself and no job is needed. Audited as the shop; the API checks the caller owns the
 * shop (`ownedShopIds`), another shop's id is a 404 (spec 13).
 */
export async function setShopBusy(
  db: Tx,
  input: { shopId: string; ownedShopIds: readonly string[]; userId: string; body: ShopBusyBody; now?: Date },
): Promise<{ busy: boolean; busyUntil: string | null }> {
  if (!input.ownedShopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const until = busyUntilFor(input.body, input.now ?? new Date());
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ busy: shops.busy, busyUntil: shops.busyUntil, cityId: shops.cityId })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for('update');
    if (!before) throw new NotFoundError('Shop not found');
    await tx
      .update(shops)
      .set({ busy: until !== null, busyUntil: until })
      .where(eq(shops.id, input.shopId));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'shop.busy_changed',
      entity: 'shop',
      entityId: input.shopId,
      before: { busy: before.busy, busyUntil: before.busyUntil?.toISOString() ?? null },
      after: { mode: input.body.mode, busyUntil: until?.toISOString() ?? null },
    });
    await recordServerEvent(tx, 'shop_busy_set', {
      userId: input.userId,
      cityId: before.cityId,
      props: {
        shopId: input.shopId,
        mode: input.body.mode,
        hours: input.body.mode === 'hours' ? input.body.hours : null,
      },
    });
    return { busy: until !== null, busyUntil: until?.toISOString() ?? null };
  });
}
