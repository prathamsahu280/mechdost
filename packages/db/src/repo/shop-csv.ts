import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  parseShopCsv,
  planShopCsv,
  shopCsvTemplate,
  SHOP_CSV_MAX_BYTES,
  type ShopCsvCatalogEntry,
  type ShopCsvPlan,
} from '@mechdost/shared/shop-csv';
import { auditLog, productVariants, products, shopInventory, shops } from '../schema';
import { ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { submitPriceRequest } from './price-requests';
import { saveShopOffer } from './shop-inventory';

/**
 * Shop stock and price CSV (design 2026-11-15 item 4; spec 07). The shop uploads the same file twice: once to check
 * (`previewShopCsv`, nothing changes) and once to apply (`applyShopCsv`, re-checked from scratch inside ONE transaction,
 * so a file that changed under the shop, or an offer edited meanwhile, can never half-apply). Stock and on/off go
 * through `saveShopOffer` (version compare-and-set, never below reserved, audited per row); a price in the file is only
 * ever a price REQUEST for staff (`submitPriceRequest`), never a price. One audit row summarises the whole file.
 */
export interface ShopCsvInput {
  shopId: string;
  userId: string;
  text: string;
}

type Parsed =
  | { kind: 'file'; code: 'EMPTY' | 'MALFORMED' | 'TOO_MANY_ROWS' | 'HEADER' | 'TOO_LARGE' }
  | { kind: 'ok'; rows: number; plan: ShopCsvPlan; skus: string[] };

async function loadCatalog(tx: Tx, shopId: string, skus: readonly string[]) {
  const map = new Map<string, ShopCsvCatalogEntry>();
  if (skus.length === 0) return map;
  const rows = await tx
    .select({
      sku: productVariants.sku,
      mrp: productVariants.mrpPaise,
      vStatus: productVariants.status,
      pStatus: products.status,
      offerId: shopInventory.id,
      onHand: shopInventory.onHand,
      reserved: shopInventory.reserved,
      active: shopInventory.active,
      adminBlocked: shopInventory.adminBlocked,
      selling: shopInventory.sellingPaise,
      version: shopInventory.version,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(
      shopInventory,
      and(eq(shopInventory.variantId, productVariants.id), eq(shopInventory.shopId, shopId)),
    )
    .where(inArray(productVariants.sku, [...skus]));
  for (const r of rows)
    map.set(r.sku, {
      mrpPaise: r.mrp,
      live: r.pStatus === 'live' && r.vStatus === 'active',
      offer:
        r.offerId === null
          ? null
          : {
              onHand: r.onHand ?? 0,
              reserved: r.reserved ?? 0,
              active: r.active ?? false,
              adminBlocked: r.adminBlocked ?? false,
              sellingPaise: r.selling ?? 0,
              version: r.version ?? 0,
            },
    });
  return map;
}

async function plan(tx: Tx, shopId: string, text: string): Promise<Parsed> {
  // The API enforces the byte limit on the upload; this keeps the repository safe for any other caller.
  if (new TextEncoder().encode(text).length > SHOP_CSV_MAX_BYTES) return { kind: 'file', code: 'TOO_LARGE' };
  const parsed = parseShopCsv(text);
  if (!parsed.ok) return { kind: 'file', code: parsed.code };
  const skus = [...new Set(parsed.rows.map((r) => r.sku))].filter((s) => /^[A-Z0-9][A-Z0-9-]{1,47}$/.test(s));
  const catalog = await loadCatalog(tx, shopId, skus);
  return {
    kind: 'ok',
    rows: parsed.rows.length,
    plan: planShopCsv(parsed.rows, parsed.errors, catalog),
    skus,
  };
}

const counts = (p: ShopCsvPlan) => ({
  stock: p.changes.filter((c) => c.stock).length,
  active: p.changes.filter((c) => c.active).length,
  priceRequests: p.changes.filter((c) => c.price).length,
});

export type ShopCsvPreviewResult =
  | { ok: false; code: 'EMPTY' | 'MALFORMED' | 'TOO_MANY_ROWS' | 'HEADER' | 'TOO_LARGE' }
  | { ok: true; rows: number; plan: ShopCsvPlan; counts: ReturnType<typeof counts> };

/** Check a file against the shop's offers: what would change and what is refused. Writes nothing but an event. */
export async function previewShopCsv(db: Tx, input: ShopCsvInput): Promise<ShopCsvPreviewResult> {
  const p = await plan(db, input.shopId, input.text);
  if (p.kind === 'file') return { ok: false, code: p.code };
  const [shop] = await db.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId));
  await recordServerEvent(db, 'shop_csv_previewed', {
    userId: input.userId,
    cityId: shop?.cityId,
    props: {
      shopId: input.shopId,
      rows: p.rows,
      errors: p.plan.errors.length,
      changes: p.plan.changes.length,
    },
  });
  return { ok: true, rows: p.rows, plan: p.plan, counts: counts(p.plan) };
}

/** Apply a file: refused as a whole when any line has an error; otherwise every change in one transaction. */
export async function applyShopCsv(db: Tx, input: ShopCsvInput) {
  return db.transaction(async (tx) => {
    const p = await plan(tx, input.shopId, input.text);
    if (p.kind === 'file') throw new ValidationError('The file cannot be read', `CSV_${p.code}`);
    if (p.plan.errors.length > 0)
      throw new ValidationError(
        'Fix the lines with errors and upload again; nothing was changed',
        'CSV_HAS_ERRORS',
        {
          errors: p.plan.errors.length,
        },
      );
    for (const c of p.plan.changes) {
      if (c.version !== null && (c.stock || c.active))
        await saveShopOffer(tx, {
          shopId: input.shopId,
          sku: c.sku,
          expectedVersion: c.version,
          changes: {
            ...(c.stock ? { onHand: c.stock.to } : {}),
            ...(c.active ? { active: c.active.to } : {}),
          },
          actorUserId: input.userId,
          actorRole: 'shop',
        });
      if (c.price)
        await submitPriceRequest(tx, {
          shopId: input.shopId,
          userId: input.userId,
          sku: c.sku,
          pricePaise: c.price.requestedPaise,
          onHand: c.price.onHand,
        });
    }
    const done = counts(p.plan);
    const [shop] = await tx.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'shop',
      action: 'inventory.csv_applied',
      entity: 'shop',
      entityId: input.shopId,
      after: { rows: p.rows, unchanged: p.plan.unchanged, ...done },
    });
    await recordServerEvent(tx, 'shop_csv_applied', {
      userId: input.userId,
      cityId: shop?.cityId,
      props: { shopId: input.shopId, ...done },
    });
    return done;
  });
}

/** The template: this shop's offers (stock and on/off as they are now), price column empty. */
export async function shopCsvTemplateFor(db: Tx, shopId: string): Promise<string> {
  const rows = await db
    .select({ sku: productVariants.sku, onHand: shopInventory.onHand, active: shopInventory.active })
    .from(shopInventory)
    .innerJoin(productVariants, eq(productVariants.id, shopInventory.variantId))
    .where(eq(shopInventory.shopId, shopId))
    .orderBy(asc(productVariants.sku))
    .limit(2000);
  return shopCsvTemplate(rows);
}
