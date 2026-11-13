import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { PRICE_REJECT_REASONS } from '@mechdost/shared/partners';
import { priceRequestMachine, type PriceRequestStatus } from '@mechdost/shared/state';
import {
  auditLog,
  productVariants,
  products,
  shopInventory,
  shopPincodes,
  shopPriceRequests,
  shops,
} from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { rowsOf } from './sql-rows';

/**
 * Seller prices (user 2026-11-13, approach 3): every price a shop asks for is a request that staff approve or
 * reject line by line. Approved → on sale at that price. Rejected → that product is off sale for that shop (the
 * listing is blocked; orders already placed keep their stock) and the next nearby shop serves the PIN. While a
 * change waits, the approved price stays on sale.
 */

async function variantForSku(tx: Tx, sku: string) {
  const [v] = await tx
    .select({
      id: productVariants.id,
      mrp: productVariants.mrpPaise,
      vStatus: productVariants.status,
      pStatus: products.status,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.sku, sku))
    .limit(1);
  if (!v) throw new NotFoundError('No such SKU');
  return v;
}

function checkPrice(pricePaise: number, mrp: number) {
  if (!Number.isSafeInteger(pricePaise) || pricePaise <= 0)
    throw new ValidationError('Enter a price above zero', 'PRICE_INVALID');
  if (pricePaise > mrp) throw new ValidationError('The price cannot be above the MRP', 'PRICE_ABOVE_MRP');
}

export async function submitPriceRequest(
  db: Tx,
  input: { shopId: string; userId: string; sku: string; pricePaise: number; onHand: number },
): Promise<{ id: string }> {
  if (!Number.isInteger(input.onHand) || input.onHand < 0 || input.onHand > 100_000)
    throw new ValidationError('Stock must be 0 to 100000', 'STOCK_INVALID');
  return db.transaction(async (tx) => {
    const v = await variantForSku(tx, input.sku);
    if (v.pStatus !== 'live' || v.vStatus !== 'active')
      throw new ConflictError('Only live products can be sold', 'PRODUCT_NOT_LIVE');
    checkPrice(input.pricePaise, v.mrp);
    const [current] = await tx
      .select({
        selling: shopInventory.sellingPaise,
        active: shopInventory.active,
        blocked: shopInventory.adminBlocked,
      })
      .from(shopInventory)
      .where(and(eq(shopInventory.shopId, input.shopId), eq(shopInventory.variantId, v.id)))
      .limit(1);
    // A newer request replaces the one still waiting (one pending per shop and product).
    await tx
      .update(shopPriceRequests)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(shopPriceRequests.shopId, input.shopId),
          eq(shopPriceRequests.variantId, v.id),
          eq(shopPriceRequests.status, 'pending'),
        ),
      );
    const [row] = await tx
      .insert(shopPriceRequests)
      .values({
        shopId: input.shopId,
        variantId: v.id,
        requestedPaise: input.pricePaise,
        previousPaise: current && current.active && !current.blocked ? current.selling : null,
        onHand: input.onHand,
        requestedBy: input.userId,
      })
      .returning({ id: shopPriceRequests.id });
    if (!row) throw new Error('price request insert returned no row');
    await recordServerEvent(tx, 'price_request_submitted', {
      userId: input.userId,
      props: { shopId: input.shopId, sku: input.sku },
    });
    return { id: row.id };
  });
}

/** The shop takes back a request that is still waiting. */
export async function withdrawPriceRequest(db: Tx, input: { shopId: string; id: string }): Promise<void> {
  const updated = await db
    .update(shopPriceRequests)
    .set({ status: 'withdrawn' })
    .where(
      and(
        eq(shopPriceRequests.id, input.id),
        eq(shopPriceRequests.shopId, input.shopId),
        eq(shopPriceRequests.status, 'pending'),
      ),
    )
    .returning({ id: shopPriceRequests.id });
  if (updated.length === 0) throw new NotFoundError('No waiting request with that id');
}

export async function decidePriceRequest(
  db: Tx,
  input: {
    id: string;
    expectedVersion: number;
    staffUserId: string;
    decision: 'approved' | 'rejected';
    reasonCode?: (typeof PRICE_REJECT_REASONS)[number] | null;
    scope?: CityScope;
  },
): Promise<{ status: PriceRequestStatus }> {
  if (
    input.decision === 'rejected' &&
    !(PRICE_REJECT_REASONS as readonly string[]).includes(input.reasonCode ?? '')
  )
    throw new ValidationError('Choose a reason', 'REASON_CODE');
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ req: shopPriceRequests, cityId: shops.cityId, sku: productVariants.sku })
      .from(shopPriceRequests)
      .innerJoin(shops, eq(shops.id, shopPriceRequests.shopId))
      .innerJoin(productVariants, eq(productVariants.id, shopPriceRequests.variantId))
      .where(eq(shopPriceRequests.id, input.id))
      .for('update', { of: shopPriceRequests });
    if (!r || (input.scope && !input.scope.all && !input.scope.cityIds.includes(r.cityId)))
      throw new NotFoundError('Price request not found');
    const req = r.req;
    priceRequestMachine.assert(req.status as PriceRequestStatus, input.decision, 'admin');
    if (req.version !== input.expectedVersion)
      throw new ConflictError('This request changed meanwhile; reload', 'STALE_REQUEST');

    const [inv] = await tx
      .select()
      .from(shopInventory)
      .where(and(eq(shopInventory.shopId, req.shopId), eq(shopInventory.variantId, req.variantId)))
      .for('update');
    if (input.decision === 'approved') {
      // Re-checked here: the product may have been archived, or its MRP lowered, since the seller asked.
      const v = await variantForSku(tx, r.sku);
      if (v.pStatus !== 'live' || v.vStatus !== 'active')
        throw new ConflictError('This product is no longer live', 'PRODUCT_NOT_LIVE');
      checkPrice(req.requestedPaise, v.mrp);
      if (inv && !inv.adminBlocked) {
        // Only the price waits for approval; stock and the on/off switch are the shop's own and may have
        // changed while the request waited (review 2026-11-13), so they are left as they are now.
        await tx
          .update(shopInventory)
          .set({ sellingPaise: req.requestedPaise })
          .where(eq(shopInventory.id, inv.id));
      } else if (inv) {
        // Lifting a block (taken off sale after a rejected change): back on sale with the stock asked for.
        await tx
          .update(shopInventory)
          .set({
            sellingPaise: req.requestedPaise,
            onHand: sql`greatest(${req.onHand}, ${shopInventory.reserved})`,
            active: true,
            adminBlocked: false,
            blockedReasonCode: null,
          })
          .where(eq(shopInventory.id, inv.id));
      } else {
        await tx.insert(shopInventory).values({
          shopId: req.shopId,
          variantId: req.variantId,
          sellingPaise: req.requestedPaise,
          onHand: req.onHand,
        });
      }
    } else if (inv) {
      // Off sale for this shop; reservations of orders already placed stay as they are.
      await tx
        .update(shopInventory)
        .set({ active: false, adminBlocked: true, blockedReasonCode: input.reasonCode ?? 'other' })
        .where(eq(shopInventory.id, inv.id));
    }
    const done = await tx
      .update(shopPriceRequests)
      .set({
        status: input.decision,
        reasonCode: input.decision === 'rejected' ? (input.reasonCode ?? null) : null,
        decidedBy: input.staffUserId,
        decidedAt: sql`now()`,
      })
      .where(
        and(
          eq(shopPriceRequests.id, req.id),
          eq(shopPriceRequests.status, 'pending'),
          eq(shopPriceRequests.version, req.version),
        ),
      )
      .returning({ id: shopPriceRequests.id });
    if (done.length === 0) throw new ConflictError('This request changed meanwhile; reload', 'STALE_REQUEST');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `price_request.${input.decision}`,
      entity: 'shop_price_request',
      entityId: req.id,
      before: { pricePaise: req.previousPaise },
      after: { pricePaise: req.requestedPaise, reasonCode: input.reasonCode ?? null, sku: r.sku },
    });
    await recordServerEvent(tx, 'price_request_decided', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        shopId: req.shopId,
        sku: r.sku,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
      },
    });
    await maybeGoLive(tx, req.shopId, input.staffUserId);
    return { status: input.decision };
  });
}

/** The price queue for staff (oldest waiting first) or one shop's own requests (newest first). */
export async function listPriceRequests(
  db: Tx,
  opts: {
    scope?: CityScope;
    shopId?: string;
    status?: PriceRequestStatus | null;
    limit?: number;
    /** The last row of the previous page (keyset paging, final review 2026-11-13). */
    cursor?: { createdAt: string; id: string } | null;
  },
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  // A shop reads its own history newest first; the staff queue is worked oldest first.
  const newestFirst = Boolean(opts.shopId);
  const c = opts.cursor;
  const at = c ? new Date(c.createdAt) : null;
  const rows = await db
    .select({
      id: shopPriceRequests.id,
      version: shopPriceRequests.version,
      status: shopPriceRequests.status,
      shopId: shopPriceRequests.shopId,
      shopName: shops.name,
      sku: productVariants.sku,
      product: products.name,
      mrpPaise: productVariants.mrpPaise,
      requestedPaise: shopPriceRequests.requestedPaise,
      previousPaise: shopPriceRequests.previousPaise,
      onHand: shopPriceRequests.onHand,
      reasonCode: shopPriceRequests.reasonCode,
      createdAt: shopPriceRequests.createdAt,
      decidedAt: shopPriceRequests.decidedAt,
    })
    .from(shopPriceRequests)
    .innerJoin(shops, eq(shops.id, shopPriceRequests.shopId))
    .innerJoin(productVariants, eq(productVariants.id, shopPriceRequests.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(
      and(
        opts.shopId ? eq(shopPriceRequests.shopId, opts.shopId) : undefined,
        opts.scope && !opts.scope.all
          ? inArray(
              shops.cityId,
              opts.scope.cityIds.length ? opts.scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
            )
          : undefined,
        opts.status ? eq(shopPriceRequests.status, opts.status) : undefined,
        c && at
          ? newestFirst
            ? or(
                lt(shopPriceRequests.createdAt, at),
                and(eq(shopPriceRequests.createdAt, at), lt(shopPriceRequests.id, c.id)),
              )
            : or(
                gt(shopPriceRequests.createdAt, at),
                and(eq(shopPriceRequests.createdAt, at), gt(shopPriceRequests.id, c.id)),
              )
          : undefined,
      ),
    )
    .orderBy(
      ...(newestFirst
        ? [desc(shopPriceRequests.createdAt), desc(shopPriceRequests.id)]
        : [asc(shopPriceRequests.createdAt), asc(shopPriceRequests.id)]),
    )
    .limit(limit + 1);
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

async function agreementRequired(tx: Tx): Promise<boolean> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(
      sql`select value from settings where key = 'partners.agreement_required' and city_id is null limit 1`,
    ),
  );
  return row?.value !== false;
}

/**
 * A new (`pending`) shop goes live when it has accepted the agreement (if required), has at least one product on
 * sale at an approved price, and delivers somewhere. A one-time gate: live shops are never taken back offline here.
 */
export async function maybeGoLive(tx: Tx, shopId: string, actorUserId: string | null): Promise<boolean> {
  const [shop] = await tx
    .select({ status: shops.status, cityId: shops.cityId })
    .from(shops)
    .where(eq(shops.id, shopId));
  if (shop?.status !== 'pending') return false;
  if (await agreementRequired(tx)) {
    // The current version: a shop that accepted only an older text does not go live (security review). Until a
    // first version is published (text from the user, Q77) there is nothing to accept, so nothing holds a shop
    // back; shops see the card once a version exists (final review 2026-11-13).
    const [accepted] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select not exists (select 1 from agreement_versions)
        or exists (select 1 from shop_agreements a
          where a.shop_id = ${shopId} and a.version = (select max(version) from agreement_versions)) as ok`),
    );
    if (!accepted?.ok) return false;
  }
  const [onSale] = await tx
    .select({ id: shopInventory.id })
    .from(shopInventory)
    .where(
      and(
        eq(shopInventory.shopId, shopId),
        eq(shopInventory.active, true),
        eq(shopInventory.adminBlocked, false),
      ),
    )
    .limit(1);
  const [delivers] = await tx
    .select({ id: shopPincodes.shopId })
    .from(shopPincodes)
    .where(and(eq(shopPincodes.shopId, shopId), eq(shopPincodes.active, true)))
    .limit(1);
  if (!onSale || !delivers) return false;
  const live = await tx
    .update(shops)
    .set({ status: 'approved', statusChangedAt: sql`now()` })
    .where(and(eq(shops.id, shopId), eq(shops.status, 'pending')))
    .returning({ id: shops.id });
  if (live.length === 0) return false;
  await tx.insert(auditLog).values({
    actorUserId,
    actorRole: actorUserId ? 'staff' : 'system',
    action: 'shop.went_live',
    entity: 'shop',
    entityId: shopId,
    before: { status: 'pending' },
    after: { status: 'approved' },
  });
  await recordServerEvent(tx, 'shop_went_live', {
    userId: actorUserId,
    cityId: shop.cityId,
    props: { shopId },
  });
  return true;
}
