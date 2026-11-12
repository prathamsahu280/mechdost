import { and, asc, eq, sql } from 'drizzle-orm';
import { auditLog, productVariants, products, shopInventory, shops } from '../schema';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import type { CatalogueLocale } from './catalogue';

/**
 * Shop offers: price, stock, lead time and on/off per SKU (spec 07; decision 2026-11-01 "Pincode-wise prices":
 * shops set their prices and admin can edit them per shop). Rules: the price is above zero and never above the
 * variant's MRP (Legal Metrology: no sale above MRP; spec 02 "MRP ≥ selling"); stock is set as an absolute count
 * and can never go below what open orders have reserved (`STOCK_BELOW_RESERVED`; the DB CHECK is the last line);
 * only live products with an active variant can be offered. Edits are compare-and-set on `version` and audited
 * with before/after; the actor is the shop user or the staff member.
 */
export interface ShopOffer {
  sku: string;
  product: string;
  productSlug: string;
  mrpPaise: number;
  sellingPaise: number;
  onHand: number;
  reserved: number;
  free: number;
  leadDays: number | null;
  active: boolean;
  version: number;
}

export async function listShopInventory(
  db: Tx,
  shopId: string,
  locale: CatalogueLocale,
): Promise<ShopOffer[]> {
  const rows = await db
    .select({
      sku: productVariants.sku,
      name: products.name,
      nameHi: products.nameHi,
      slug: products.slug,
      mrp: productVariants.mrpPaise,
      selling: shopInventory.sellingPaise,
      onHand: shopInventory.onHand,
      reserved: shopInventory.reserved,
      leadDays: shopInventory.leadDays,
      active: shopInventory.active,
      version: shopInventory.version,
    })
    .from(shopInventory)
    .innerJoin(productVariants, eq(productVariants.id, shopInventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(shopInventory.shopId, shopId))
    .orderBy(asc(productVariants.sku))
    .limit(1000);
  return rows.map((r) => ({
    sku: r.sku,
    product: localized(r.name, r.nameHi, locale),
    productSlug: r.slug,
    mrpPaise: r.mrp,
    sellingPaise: r.selling,
    onHand: r.onHand,
    reserved: r.reserved,
    free: r.onHand - r.reserved,
    leadDays: r.leadDays,
    active: r.active,
    version: r.version,
  }));
}

export interface OfferInput {
  sellingPaise?: number;
  onHand?: number;
  leadDays?: number | null;
  active?: boolean;
}

function check(input: OfferInput, mrpPaise: number) {
  if (input.sellingPaise !== undefined) {
    if (!Number.isSafeInteger(input.sellingPaise) || input.sellingPaise <= 0)
      throw new ValidationError('Enter a price above zero', 'PRICE_INVALID');
    if (input.sellingPaise > mrpPaise)
      throw new ValidationError('The price cannot be above the MRP', 'PRICE_ABOVE_MRP');
  }
  if (
    input.onHand !== undefined &&
    (!Number.isInteger(input.onHand) || input.onHand < 0 || input.onHand > 100_000)
  )
    throw new ValidationError('Stock must be 0 to 100000', 'STOCK_INVALID');
  if (
    input.leadDays !== undefined &&
    input.leadDays !== null &&
    (!Number.isInteger(input.leadDays) || input.leadDays < 0 || input.leadDays > 60)
  )
    throw new ValidationError('Lead time must be 0 to 60 days', 'LEAD_DAYS_INVALID');
}

/**
 * Create (`expectedVersion` null) or change an offer. Returns the new version. `actorRole` = 'shop' | 'staff'
 * for the audit row; scope (which shop the caller may edit) is checked by the caller's repository function.
 */
export async function saveShopOffer(
  db: Tx,
  input: {
    shopId: string;
    sku: string;
    expectedVersion: number | null;
    changes: OfferInput;
    actorUserId: string;
    actorRole: 'shop' | 'staff';
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select({
        id: productVariants.id,
        mrp: productVariants.mrpPaise,
        vStatus: productVariants.status,
        pStatus: products.status,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.sku, input.sku))
      .limit(1);
    if (!variant) throw new NotFoundError('No such SKU');
    check(input.changes, variant.mrp);
    // A shop's own price is always a request for staff approval (user 2026-11-13); stock and on/off stay direct.
    if (input.actorRole === 'shop' && input.changes.sellingPaise !== undefined)
      throw new ConflictError('Prices need approval: send a price request instead', 'PRICE_NEEDS_APPROVAL');

    if (input.expectedVersion === null) {
      if (variant.pStatus !== 'live' || variant.vStatus !== 'active')
        throw new ConflictError('Only live products can be offered', 'PRODUCT_NOT_LIVE');
      if (input.changes.sellingPaise === undefined)
        throw new ValidationError('Enter a price', 'PRICE_INVALID');
      try {
        const [row] = await tx.transaction(async (sp) =>
          sp
            .insert(shopInventory)
            .values({
              shopId: input.shopId,
              variantId: variant.id,
              sellingPaise: input.changes.sellingPaise ?? 0,
              onHand: input.changes.onHand ?? 0,
              leadDays: input.changes.leadDays ?? null,
              active: input.changes.active ?? true,
            })
            .returning({ id: shopInventory.id, version: shopInventory.version }),
        );
        if (!row) throw new Error('offer insert returned no row');
        await audit(tx, input, row.id, null, { ...input.changes });
        return { version: row.version };
      } catch (err) {
        if (pgCode(err) === '23505')
          throw new ConflictError('This shop already offers this SKU', 'ALREADY_LISTED');
        throw err;
      }
    }

    const [current] = await tx
      .select()
      .from(shopInventory)
      .where(and(eq(shopInventory.shopId, input.shopId), eq(shopInventory.variantId, variant.id)))
      .limit(1);
    if (!current) throw new NotFoundError('This shop does not offer this SKU yet');
    if (input.actorRole === 'shop' && input.changes.active === true && current.adminBlocked)
      throw new ConflictError('MechDost took this product off sale for your shop', 'LISTING_BLOCKED');
    if (input.changes.onHand !== undefined && input.changes.onHand < current.reserved)
      throw new ConflictError(
        `${String(current.reserved)} unit(s) are reserved for open orders; stock cannot go below that`,
        'STOCK_BELOW_RESERVED',
      );
    const set: Record<string, unknown> = Object.fromEntries(
      Object.entries(input.changes).filter(([, v]) => v !== undefined),
    );
    // Staff putting a blocked listing back on sale lifts the block.
    if (input.actorRole === 'staff' && input.changes.active === true && current.adminBlocked)
      Object.assign(set, { adminBlocked: false, blockedReasonCode: null });
    if (Object.keys(set).length === 0) throw new ValidationError('Nothing to change', 'EMPTY_PATCH');
    const [row] = await tx
      .update(shopInventory)
      .set(set)
      .where(
        and(
          eq(shopInventory.id, current.id),
          eq(shopInventory.version, input.expectedVersion),
          // Stock is re-checked against the reservation count at write time (an order may have arrived).
          input.changes.onHand !== undefined
            ? sql`${shopInventory.reserved} <= ${input.changes.onHand}`
            : undefined,
        ),
      )
      .returning({ version: shopInventory.version });
    if (!row) throw new ConflictError('This offer changed meanwhile; reload', 'STALE_OFFER');
    const before = Object.fromEntries(
      Object.keys(set).map((k) => [k, current[k as keyof typeof current] ?? null]),
    );
    await audit(tx, input, current.id, before, set);
    return { version: row.version };
  });
}

async function audit(
  tx: Tx,
  input: { shopId: string; sku: string; actorUserId: string; actorRole: 'shop' | 'staff' },
  inventoryId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  await tx.insert(auditLog).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: before === null ? 'inventory.listed' : 'inventory.updated',
    entity: 'shop_inventory',
    entityId: inventoryId,
    before: before === null ? null : { ...before, shopId: input.shopId, sku: input.sku },
    after: { ...after, shopId: input.shopId, sku: input.sku },
  });
  await recordServerEvent(tx, 'inventory_updated', {
    userId: input.actorUserId,
    cityId: (await tx.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId)))[0]
      ?.cityId,
    props: { shopId: input.shopId, sku: input.sku, fields: Object.keys(after).sort(), by: input.actorRole },
  });
}

/** Staff editing a shop's offers: the shop must be in the caller's cities (404 otherwise). */
export async function shopInStaffScope(
  db: Tx,
  shopId: string,
  scope: { all: true } | { all: false; cityIds: string[] },
): Promise<void> {
  const [shop] = await db.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop || (!scope.all && !scope.cityIds.includes(shop.cityId)))
    throw new NotFoundError('Shop not found');
}
