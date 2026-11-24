import { and, eq, sql } from 'drizzle-orm';
import { variantLabel } from '@mechdost/shared/variants';
import { auditLog, productVariants, products } from '../schema';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * Staff editing the sizes (variants) of a product (user 2026-11-24, spec 02): add a size, edit its label, MRP and
 * barcode, archive and restore it. Every change is a conditional update on the size's `version` (a stale save is
 * refused, never merged), writes `audit_log` with before and after, and records `admin_variant_changed`.
 */

/** The keys of `options` staff may set (the importers' keys; the label is built from them, never typed twice). */
export const VARIANT_OPTION_KEYS = [
  'size',
  'loadIndex',
  'speedRating',
  'construction',
  'tlTt',
  'ply',
  'frontRear',
  'label',
  'model',
] as const;
export const VARIANT_OPTION_MAX = 60;
const MRP_MAX = 100_000_000;
const SKU_RE = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

export type VariantOptions = Partial<Record<(typeof VARIANT_OPTION_KEYS)[number], string>>;

export interface VariantChanges {
  /** Merged into the stored options; an empty text removes that key. */
  options?: VariantOptions;
  /** `null` = price on request. */
  mrpPaise?: number | null;
  barcode?: string | null;
  status?: 'active' | 'archived';
}

function cleanOptions(options: VariantOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(options)) {
    if (!(VARIANT_OPTION_KEYS as readonly string[]).includes(key))
      throw new ValidationError(`Unknown size field ${key}`, 'VARIANT_OPTION');
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (v.length > VARIANT_OPTION_MAX) throw new ValidationError(`${key} is too long`, 'VARIANT_OPTION');
    out[key] = v;
  }
  return out;
}

function checkMrp(mrp: number | null): void {
  if (mrp !== null && (!Number.isSafeInteger(mrp) || mrp < 1 || mrp > MRP_MAX))
    throw new ValidationError('An MRP is ₹0.01 to ₹10,00,000', 'MRP_INVALID');
}

function checkBarcode(code: string | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const v = code.trim();
  if (v === '') return null;
  if (!/^[0-9A-Za-z-]{4,32}$/.test(v))
    throw new ValidationError('A barcode is 4 to 32 letters or digits', 'BARCODE');
  return v;
}

/** Add a size to a product. The SKU is global (`product_variants.sku` is unique across all products). */
export async function addVariant(
  db: Tx,
  input: {
    slug: string;
    sku: string;
    options: VariantOptions;
    mrpPaise: number | null;
    barcode: string | null;
    staffUserId: string;
  },
): Promise<{ sku: string; version: number }> {
  if (!SKU_RE.test(input.sku))
    throw new ValidationError('A SKU is capital letters, digits and dashes', 'SKU_INVALID');
  checkMrp(input.mrpPaise);
  const options = cleanOptions(input.options);
  for (const k of Object.keys(options)) if (options[k] === '') delete options[k];
  if (variantLabel(options) === '') throw new ValidationError('A size needs a label', 'VARIANT_LABEL');
  const barcode = checkBarcode(input.barcode);
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (!product) throw new NotFoundError('Product not found');
    let row: { id: string; version: number } | undefined;
    try {
      [row] = await tx
        .insert(productVariants)
        .values({ productId: product.id, sku: input.sku, options, mrpPaise: input.mrpPaise, barcode })
        .returning({ id: productVariants.id, version: productVariants.version });
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictError('That SKU is already in use', 'SKU_TAKEN');
      throw err;
    }
    if (!row) throw new Error('variant insert returned no row');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'variant.added',
      entity: 'product_variant',
      entityId: row.id,
      before: null,
      after: { sku: input.sku, options, mrpPaise: input.mrpPaise, barcode },
    });
    await recordServerEvent(tx, 'admin_variant_changed', {
      userId: input.staffUserId,
      props: { productSlug: input.slug, sku: input.sku, action: 'added' },
    });
    return { sku: input.sku, version: row.version };
  });
}

/**
 * Change a size. The update only applies at `expectedVersion` (else `STALE_VARIANT`). An MRP is never lowered under a
 * price a shop or the admin already set (`MRP_BELOW_PRICE`, the legal ceiling), and the last active size of a live
 * product cannot be archived (`LAST_VARIANT`): archive the product instead.
 */
export async function updateVariant(
  db: Tx,
  input: { sku: string; expectedVersion: number; changes: VariantChanges; staffUserId: string },
): Promise<{ sku: string; version: number }> {
  const c = input.changes;
  if (
    c.options === undefined &&
    c.mrpPaise === undefined &&
    c.barcode === undefined &&
    c.status === undefined
  )
    throw new ValidationError('Nothing to change', 'EMPTY_PATCH');
  if (c.mrpPaise !== undefined) checkMrp(c.mrpPaise);
  const optionChanges = c.options === undefined ? undefined : cleanOptions(c.options);
  const barcode = c.barcode === undefined ? undefined : checkBarcode(c.barcode);
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        options: productVariants.options,
        mrpPaise: productVariants.mrpPaise,
        barcode: productVariants.barcode,
        status: productVariants.status,
        version: productVariants.version,
      })
      .from(productVariants)
      .where(eq(productVariants.sku, input.sku))
      .for('update')
      .limit(1);
    if (!cur) throw new NotFoundError('Size not found');
    if (cur.version !== input.expectedVersion)
      throw new ConflictError('Someone else changed this size; reload', 'STALE_VARIANT');

    const nextOptions: Record<string, unknown> = { ...cur.options, ...(optionChanges ?? {}) };
    for (const k of Object.keys(nextOptions)) if (nextOptions[k] === '') delete nextOptions[k];
    if (optionChanges !== undefined && variantLabel(nextOptions) === '')
      throw new ValidationError('A size needs a label', 'VARIANT_LABEL');
    const nextMrp = c.mrpPaise === undefined ? cur.mrpPaise : c.mrpPaise;
    const nextStatus = c.status ?? (cur.status === 'archived' ? 'archived' : 'active');

    if (c.mrpPaise !== undefined && c.mrpPaise !== null) {
      const [over] = rowsOf<{ over: boolean }>(
        await tx.execute(sql`
          select (exists (select 1 from shop_inventory si where si.variant_id = ${cur.id} and si.selling_paise > ${c.mrpPaise})
            or exists (select 1 from admin_prices ap where ap.variant_id = ${cur.id} and ap.selling_paise > ${c.mrpPaise})) as over`),
      );
      if (over?.over)
        throw new ConflictError(
          'Fix the prices set under this size first: an MRP is the ceiling',
          'MRP_BELOW_PRICE',
        );
    }
    if (nextStatus === 'archived' && cur.status !== 'archived') {
      const [other] = rowsOf<{ live: boolean; others: unknown }>(
        await tx.execute(sql`
          select (p.status = 'live') as live,
            (select count(*) from product_variants v where v.product_id = p.id and v.status = 'active' and v.id <> ${cur.id}) as others
          from products p where p.id = ${cur.productId}`),
      );
      if (other?.live && Number(other.others) === 0)
        throw new ConflictError('A live product needs at least one active size', 'LAST_VARIANT');
    }

    const [row] = await tx
      .update(productVariants)
      .set({
        options: nextOptions,
        mrpPaise: nextMrp,
        barcode: barcode === undefined ? cur.barcode : barcode,
        status: nextStatus,
        version: sql`${productVariants.version} + 1`,
      })
      .where(and(eq(productVariants.id, cur.id), eq(productVariants.version, input.expectedVersion)))
      .returning({ version: productVariants.version });
    if (!row) throw new ConflictError('Someone else changed this size; reload', 'STALE_VARIANT');

    const action =
      nextStatus !== cur.status ? (nextStatus === 'archived' ? 'archived' : 'restored') : 'edited';
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: action === 'edited' ? 'variant.updated' : `variant.${action}`,
      entity: 'product_variant',
      entityId: cur.id,
      before: { options: cur.options, mrpPaise: cur.mrpPaise, barcode: cur.barcode, status: cur.status },
      after: { options: nextOptions, mrpPaise: nextMrp, barcode: barcode ?? cur.barcode, status: nextStatus },
    });
    const [prod] = await tx
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.id, cur.productId))
      .limit(1);
    await recordServerEvent(tx, 'admin_variant_changed', {
      userId: input.staffUserId,
      props: { productSlug: prod?.slug ?? '', sku: input.sku, action },
    });
    return { sku: input.sku, version: row.version };
  });
}
