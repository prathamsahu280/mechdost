import { and, desc, eq, sql } from 'drizzle-orm';
import type { CouponKind } from '@mechdost/shared/coupon';
import type { ShopOffer } from '@mechdost/shared/coupon-api';
import { auditLog, couponShopTerms, coupons } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Offers a shop is asked to fund (spec 07, design 2026-11-15). A shop-funded coupon cannot be used until its shop has
 * accepted the terms here (`coupon_shop_terms`); the shop may also decline, or withdraw an acceptance later (the coupon
 * then stops working at once; orders already placed keep their discount, which the shop then funds). The caller (the
 * API) passes the shops the user owns; another shop's offer is a 404 (spec 13). The decision is a compare-and-set on the
 * terms row's `version`, so a shop can only accept the terms it was shown: when admin changes them the row is bumped
 * back to `pending` and the old screen's accept fails with 409.
 */
export async function listShopOffers(
  db: Tx,
  input: { shopId: string; ownedShopIds: readonly string[] },
): Promise<ShopOffer[]> {
  if (!input.ownedShopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const rows = await db
    .select({ t: couponShopTerms, c: coupons })
    .from(couponShopTerms)
    .innerJoin(coupons, eq(coupons.id, couponShopTerms.couponId))
    .where(eq(couponShopTerms.shopId, input.shopId))
    // Waiting for an answer first, then newest.
    .orderBy(sql`(${couponShopTerms.status} = 'pending') desc`, desc(coupons.createdAt), desc(coupons.id))
    .limit(100);
  return rows.map(({ t, c }) => ({
    couponId: c.id,
    code: c.code,
    title: c.title,
    titleHi: c.titleHi,
    terms: c.terms,
    termsHi: c.termsHi,
    kind: c.kind as CouponKind,
    value: c.value,
    minSubtotalPaise: c.minSubtotalPaise,
    maxDiscountPaise: c.maxDiscountPaise,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt?.toISOString() ?? null,
    usageLimitTotal: c.usageLimitTotal,
    usageLimitPerUser: c.usageLimitPerUser,
    usedCount: c.usedCount,
    firstOrderOnly: c.firstOrderOnly,
    status: t.status === 'accepted' || t.status === 'declined' ? t.status : 'pending',
    version: t.version,
    decidedAt: t.decidedAt?.toISOString() ?? null,
  }));
}

export async function decideShopOffer(
  db: Tx,
  input: {
    shopId: string;
    ownedShopIds: readonly string[];
    couponId: string;
    decision: 'accept' | 'decline';
    expectedVersion: number;
    userId: string;
  },
): Promise<{ status: 'accepted' | 'declined'; version: number }> {
  if (!input.ownedShopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const status = input.decision === 'accept' ? 'accepted' : 'declined';
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(couponShopTerms)
      .set({ status, decidedBy: input.userId, decidedAt: sql`now()` })
      .where(
        and(
          eq(couponShopTerms.couponId, input.couponId),
          eq(couponShopTerms.shopId, input.shopId),
          eq(couponShopTerms.version, input.expectedVersion),
        ),
      )
      .returning({ id: couponShopTerms.id, version: couponShopTerms.version });
    if (!row) {
      // Not this shop's offer (404) or the terms changed since the screen loaded (409).
      const [exists] = await tx
        .select({ id: couponShopTerms.id })
        .from(couponShopTerms)
        .where(and(eq(couponShopTerms.couponId, input.couponId), eq(couponShopTerms.shopId, input.shopId)));
      if (!exists) throw new NotFoundError('Offer not found');
      throw new ConflictError('The offer changed; please read it again', 'STALE_OFFER');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: `coupon.shop_${status}`,
      entity: 'coupon',
      entityId: input.couponId,
      after: { shopId: input.shopId, status },
    });
    await recordServerEvent(tx, 'shop_coupon_decided', {
      userId: input.userId,
      props: { couponId: input.couponId, shopId: input.shopId, decision: status },
    });
    return { status, version: row.version };
  });
}
