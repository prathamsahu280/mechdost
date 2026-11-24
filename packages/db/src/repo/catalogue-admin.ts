import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  isNetQuantity,
  readAttributes,
  validateAttributes,
  type AttrValue,
  type NetQuantity,
} from '@mechdost/shared/product-attributes';
import { productMachine, type ProductStatus } from '@mechdost/shared/state';
import { VEHICLE_TYPES, isVehicleType, type VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, brands, categories, productVariants, products, settings } from '../schema';
import { variantLabel } from '@mechdost/shared/variants';
import { attributeSetFor } from './catalogue';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Admin catalogue editor (spec 02 "Localised fields", spec 08 Catalogue; hard rules 8 and 10). Staff with
 * `products:write` edit every customer-visible text in English and Hindi side by side; each product shows which
 * Hindi fields are missing (the storefront falls back to English there). `products:publish` moves products
 * through `productMachine`. Every change is compare-and-set on `version` with an audit row holding exactly the
 * fields that changed. Going live needs an active variant; with setting `catalogue.require_hindi_to_publish`
 * = true (the launch-blocking check, off until the catalogue team is ready) it also needs complete Hindi.
 */
export const TEXT_FIELDS = [
  'name',
  'nameHi',
  'specSummary',
  'specSummaryHi',
  'compatibility',
  'compatibilityHi',
  'description',
  'descriptionHi',
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];
const TEXT_MAX: Record<TextField, number> = {
  name: 160,
  nameHi: 160,
  specSummary: 200,
  specSummaryHi: 200,
  compatibility: 300,
  compatibilityHi: 300,
  description: 4000,
  descriptionHi: 4000,
};
export const HIGHLIGHT_MAX = 8;
export const HIGHLIGHT_LEN = 120;

export type HindiGap = 'name' | 'specSummary' | 'compatibility' | 'description' | 'highlights';

export interface AdminProduct {
  slug: string;
  status: string;
  version: number;
  brand: string;
  category: string;
  name: string;
  nameHi: string | null;
  specSummary: string | null;
  specSummaryHi: string | null;
  compatibility: string | null;
  compatibilityHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  highlights: string[];
  highlightsHi: string[];
  /** Vehicle types the product is for (decision 2026-11-12); empty = fitment not listed. */
  vehicleTypes: string[];
  rejectionReason: string | null;
  /** English fields with no Hindi version (shown in English on /hi). */
  missingHindi: HindiGap[];
}

const filled = (v: string | null | undefined) => typeof v === 'string' && v.trim() !== '';

export function hindiGaps(p: {
  name: string;
  nameHi: string | null;
  specSummary: string | null;
  specSummaryHi: string | null;
  compatibility: string | null;
  compatibilityHi: string | null;
  description: string | null;
  descriptionHi: string | null;
  highlights: string[];
  highlightsHi: string[];
}): HindiGap[] {
  const gaps: HindiGap[] = [];
  if (!filled(p.nameHi)) gaps.push('name');
  if (filled(p.specSummary) && !filled(p.specSummaryHi)) gaps.push('specSummary');
  if (filled(p.compatibility) && !filled(p.compatibilityHi)) gaps.push('compatibility');
  if (filled(p.description) && !filled(p.descriptionHi)) gaps.push('description');
  if (p.highlights.length > 0 && p.highlightsHi.length === 0) gaps.push('highlights');
  return gaps;
}

const select = {
  id: products.id,
  slug: products.slug,
  status: products.status,
  version: products.version,
  brand: brands.name,
  category: categories.slug,
  name: products.name,
  nameHi: products.nameHi,
  specSummary: products.specSummary,
  specSummaryHi: products.specSummaryHi,
  compatibility: products.compatibility,
  compatibilityHi: products.compatibilityHi,
  description: products.description,
  descriptionHi: products.descriptionHi,
  highlights: products.highlights,
  highlightsHi: products.highlightsHi,
  vehicleTypes: products.vehicleTypes,
  rejectionReason: products.rejectionReason,
};
type Row = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows(db: Tx, where: SQL | undefined, limit: number) {
  return db
    .select(select)
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(asc(products.slug))
    .limit(limit);
}

function toAdmin(r: Row): AdminProduct {
  const { id: _id, ...rest } = r;
  return { ...rest, missingHindi: hindiGaps(r) };
}

/** Same rule as `hindiGaps`, in SQL, so the "missing Hindi" filter pages correctly. */
const blank = (col: AnyPgColumn) => sql`coalesce(${col}, '') = ''`;
export const hasHindiGap = sql`(${blank(products.nameHi)}
  or (not ${blank(products.specSummary)} and ${blank(products.specSummaryHi)})
  or (not ${blank(products.compatibility)} and ${blank(products.compatibilityHi)})
  or (not ${blank(products.description)} and ${blank(products.descriptionHi)})
  or (cardinality(${products.highlights}) > 0 and cardinality(${products.highlightsHi}) = 0))`;

/** Products in slug order (keyset on slug), optionally one status and/or only those with Hindi gaps. */
export async function listAdminProducts(
  db: Tx,
  opts: {
    status?: ProductStatus | null;
    missingHindiOnly?: boolean;
    /** Packs without an MRP ("price on request"), design 2026-11-22. */
    missingMrpOnly?: boolean;
    brand?: string | null;
    range?: string | null;
    after?: string | null;
    limit?: number;
  },
): Promise<{ items: AdminProduct[]; next: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await loadRows(
    db,
    and(
      opts.status ? eq(products.status, opts.status) : undefined,
      opts.missingHindiOnly ? hasHindiGap : undefined,
      opts.missingMrpOnly
        ? sql`exists (select 1 from product_variants v where v.product_id = ${products.id} and v.mrp_paise is null)`
        : undefined,
      opts.brand ? eq(brands.slug, opts.brand) : undefined,
      opts.range
        ? sql`${products.rangeId} = (select id from product_ranges where slug = ${opts.range})`
        : undefined,
      opts.after ? gt(products.slug, opts.after) : undefined,
    ),
    limit + 1,
  );
  const page = rows.slice(0, limit);
  return { items: page.map(toAdmin), next: rows.length > limit ? (page.at(-1)?.slug ?? null) : null };
}

/** One pack of a product, as the editor shows it (net quantity for the unit price, MRP for the price rules). */
export interface AdminVariant {
  sku: string;
  /** Null = price on request: the admin sets it (design 2026-11-22). */
  mrpPaise: number | null;
  netQuantity: NetQuantity | null;
  /** The size as one line ("145/70 R12 69T TL"), built from `options`. */
  label: string;
  options: Record<string, unknown>;
  barcode: string | null;
  status: 'active' | 'archived';
  /** The token the editor sends back with a change (conditional update, hard rule 3). */
  version: number;
}

/**
 * One product for the editor: the list fields plus its typed attributes and packs, so the "Fit & specs" form
 * starts from what is stored (the attribute save replaces the whole set).
 */
export async function getAdminProduct(
  db: Tx,
  slug: string,
): Promise<AdminProduct & { id: string; attributes: Record<string, AttrValue>; variants: AdminVariant[] }> {
  const [r] = await loadRows(db, eq(products.slug, slug), 1);
  if (!r) throw new NotFoundError('Product not found');
  const [extra] = await db.select({ spec: products.spec }).from(products).where(eq(products.id, r.id));
  const packs = await db
    .select({
      sku: productVariants.sku,
      mrpPaise: productVariants.mrpPaise,
      netQty: productVariants.netQty,
      netUnit: productVariants.netUnit,
      options: productVariants.options,
      barcode: productVariants.barcode,
      status: productVariants.status,
      version: productVariants.version,
    })
    .from(productVariants)
    .where(eq(productVariants.productId, r.id))
    .orderBy(asc(productVariants.sku));
  const variants = packs.map((v) => {
    const q = { qty: v.netQty, unit: v.netUnit };
    return {
      sku: v.sku,
      mrpPaise: v.mrpPaise,
      netQuantity: isNetQuantity(q) ? q : null,
      label: variantLabel(v.options as Record<string, unknown>),
      options: v.options as Record<string, unknown>,
      barcode: v.barcode,
      status: v.status === 'archived' ? ('archived' as const) : ('active' as const),
      version: v.version,
    };
  });
  return { ...toAdmin(r), id: r.id, attributes: readAttributes(r.category, extra?.spec), variants };
}

export interface TextPatch {
  name?: string;
  nameHi?: string | null;
  specSummary?: string | null;
  specSummaryHi?: string | null;
  compatibility?: string | null;
  compatibilityHi?: string | null;
  description?: string | null;
  descriptionHi?: string | null;
  highlights?: string[];
  highlightsHi?: string[];
}

function cleanPatch(patch: TextPatch): TextPatch {
  const out: TextPatch = {};
  for (const f of TEXT_FIELDS) {
    if (!(f in patch)) continue;
    const raw = patch[f];
    const v = typeof raw === 'string' ? raw.trim() : null;
    if (v !== null && v.length > TEXT_MAX[f]) throw new ValidationError(`${f} is too long`, 'TEXT_TOO_LONG');
    if (f === 'name') {
      if (!v || v.length < 3) throw new ValidationError('The English name is required', 'NAME_REQUIRED');
      out.name = v;
    } else out[f] = v === '' ? null : v;
  }
  for (const f of ['highlights', 'highlightsHi'] as const) {
    const list = patch[f];
    if (list === undefined) continue;
    const trimmed = list.map((h) => h.trim()).filter((h) => h !== '');
    if (trimmed.length > HIGHLIGHT_MAX || trimmed.some((h) => h.length > HIGHLIGHT_LEN))
      throw new ValidationError(
        `Up to ${String(HIGHLIGHT_MAX)} highlights of ${String(HIGHLIGHT_LEN)} characters`,
        'HIGHLIGHTS',
      );
    out[f] = trimmed;
  }
  return out;
}

/** Edit texts (English and Hindi). Hindi highlights must be empty or line up with the English ones (DB CHECK). */
export async function updateProductTexts(
  db: Tx,
  input: { slug: string; expectedVersion: number; patch: TextPatch; staffUserId: string },
): Promise<{ version: number; missingHindi: HindiGap[] }> {
  const patch = cleanPatch(input.patch);
  if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to change', 'EMPTY_PATCH');
  return db.transaction(async (tx) => {
    const current = await getAdminProduct(tx, input.slug);
    const next = { ...current, ...patch };
    const hi = next.highlightsHi;
    if (hi.length > 0 && hi.length !== next.highlights.length)
      throw new ValidationError(
        'Give one Hindi highlight per English highlight, or none',
        'HIGHLIGHTS_HI_ALIGNED',
      );
    const changed = Object.fromEntries(
      Object.entries(patch).filter(
        ([k, v]) => JSON.stringify(v) !== JSON.stringify(current[k as keyof TextPatch]),
      ),
    );
    if (Object.keys(changed).length === 0)
      return { version: current.version, missingHindi: current.missingHindi };
    const touchesHindi = Object.keys(changed).some((k) => k.endsWith('Hi'));
    const [row] = await tx
      .update(products)
      // A person edited the Hindi: it is no longer machine-made, and a catalogue re-import leaves it alone.
      .set(touchesHindi ? { ...changed, hindiMachine: false } : changed)
      .where(and(eq(products.id, current.id), eq(products.version, input.expectedVersion)))
      .returning({ version: products.version });
    if (!row) throw new ConflictError('Someone else changed this product; reload', 'STALE_PRODUCT');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'product.texts_updated',
      entity: 'product',
      entityId: current.id,
      before: Object.fromEntries(Object.keys(changed).map((k) => [k, current[k as keyof TextPatch] ?? null])),
      after: changed,
    });
    return { version: row.version, missingHindi: hindiGaps(next) };
  });
}

/** Setting `catalogue.require_hindi_to_publish` (global only): going live needs complete Hindi. */
export async function requireHindiToPublish(tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, 'catalogue.require_hindi_to_publish'), sql`${settings.cityId} is null`));
  return row?.value === true;
}

/** Publish, reject (reason shown to the submitting shop), archive or revive through `productMachine`. */
export async function setProductStatus(
  db: Tx,
  input: {
    slug: string;
    to: ProductStatus;
    expectedVersion: number;
    staffUserId: string;
    rejectionReason?: string | null;
  },
): Promise<{ version: number; status: ProductStatus }> {
  return db.transaction(async (tx) => {
    const current = await getAdminProduct(tx, input.slug);
    const from = current.status as ProductStatus;
    productMachine.assert(from, input.to, 'admin');
    const reason = input.rejectionReason?.trim() ?? '';
    if (input.to === 'rejected' && (reason.length < 5 || reason.length > 300))
      throw new ValidationError('Tell the shop why (5 to 300 characters)', 'REJECTION_REASON');
    if (input.to === 'live') {
      const active = await tx.$count(
        productVariants,
        and(eq(productVariants.productId, current.id), eq(productVariants.status, 'active')),
      );
      if (active === 0)
        throw new ConflictError('Add an active variant (SKU) before publishing', 'NO_VARIANT');
      if (current.missingHindi.length > 0 && (await requireHindiToPublish(tx)))
        throw new ValidationError('Add the missing Hindi texts before publishing', 'HINDI_MISSING', {
          fields: current.missingHindi,
        });
    }
    const [row] = await tx
      .update(products)
      .set({ status: input.to, rejectionReason: input.to === 'rejected' ? reason : null })
      .where(
        and(
          eq(products.id, current.id),
          eq(products.version, input.expectedVersion),
          eq(products.status, from),
        ),
      )
      .returning({ version: products.version });
    if (!row) throw new ConflictError('Someone else changed this product; reload', 'STALE_PRODUCT');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'product.status_changed',
      entity: 'product',
      entityId: current.id,
      before: { status: from },
      after: { status: input.to },
      reason: input.to === 'rejected' ? reason : null,
    });
    await recordServerEvent(tx, 'admin_product_status_changed', {
      userId: input.staffUserId,
      props: { productSlug: input.slug, from, to: input.to },
    });
    return { version: row.version, status: input.to };
  });
}

/**
 * Set the vehicle types a product is for (admin control, rule 8; decision 2026-11-12). Codes come from the shared
 * list only, duplicates collapse, the order is always 2W, 3W, 4W. Optimistic version; audited.
 */
export async function setProductVehicleTypes(
  db: Tx,
  input: { slug: string; expectedVersion: number; vehicleTypes: readonly VehicleType[]; staffUserId: string },
): Promise<{ version: number; vehicleTypes: VehicleType[] }> {
  if (!input.vehicleTypes.every(isVehicleType))
    throw new ValidationError('Vehicle types are 2W, 3W or 4W', 'VEHICLE_TYPES');
  const next = VEHICLE_TYPES.filter((t) => input.vehicleTypes.includes(t));
  return db.transaction(async (tx) => {
    const current = await getAdminProduct(tx, input.slug);
    const [row] = await tx
      .update(products)
      .set({ vehicleTypes: next })
      .where(and(eq(products.id, current.id), eq(products.version, input.expectedVersion)))
      .returning({ version: products.version });
    if (!row) throw new ConflictError('Someone else changed this product; reload', 'STALE_PRODUCT');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'product.vehicle_types_updated',
      entity: 'product',
      entityId: current.id,
      before: { vehicleTypes: current.vehicleTypes },
      after: { vehicleTypes: next },
    });
    return { version: row.version, vehicleTypes: next };
  });
}

const parentCategories = alias(categories, 'parent_categories');

/**
 * Set a product's typed attributes (design 2026-11-13 "Product comparison"; admin control, rule 8). The list of
 * attributes comes from the shared definitions of the product's category (or its parent); every key must be
 * known and every value valid (strict). Replaces the whole set. Optimistic version; audited.
 */
export async function setProductAttributes(
  db: Tx,
  input: { slug: string; expectedVersion: number; attributes: Record<string, unknown>; staffUserId: string },
): Promise<{ version: number; attributes: Record<string, AttrValue> }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: products.id,
        spec: products.spec,
        categorySlug: categories.slug,
        parentSlug: parentCategories.slug,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(parentCategories, eq(parentCategories.id, categories.parentId))
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (!current) throw new NotFoundError('Product not found');
    const set = attributeSetFor(current.categorySlug, current.parentSlug) ?? current.categorySlug;
    const check = validateAttributes(set, input.attributes);
    if (!check.ok)
      throw new ValidationError(
        check.code === 'UNKNOWN_KEY'
          ? `"${check.key}" is not an attribute of this category`
          : `"${check.key}" has a value this category does not accept`,
        'ATTRIBUTES',
      );
    const [row] = await tx
      .update(products)
      .set({ spec: check.values })
      .where(and(eq(products.id, current.id), eq(products.version, input.expectedVersion)))
      .returning({ version: products.version });
    if (!row) throw new ConflictError('Someone else changed this product; reload', 'STALE_PRODUCT');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'product.attributes_updated',
      entity: 'product',
      entityId: current.id,
      before: { attributes: readAttributes(set, current.spec) },
      after: { attributes: check.values },
    });
    return { version: row.version, attributes: check.values };
  });
}

/** Set or clear the net quantity of one pack (variant) by SKU (design 2026-11-13). Audited. */
export async function setVariantNetQuantity(
  db: Tx,
  input: { sku: string; netQuantity: NetQuantity | null; staffUserId: string },
): Promise<{ sku: string; netQuantity: NetQuantity | null }> {
  if (input.netQuantity !== null && !isNetQuantity(input.netQuantity))
    throw new ValidationError('Net quantity is a whole number in ml, g, piece or m', 'NET_QUANTITY');
  const next = input.netQuantity;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: productVariants.id, netQty: productVariants.netQty, netUnit: productVariants.netUnit })
      .from(productVariants)
      .where(eq(productVariants.sku, input.sku))
      .limit(1);
    if (!current) throw new NotFoundError('Variant not found');
    await tx
      .update(productVariants)
      .set({ netQty: next?.qty ?? null, netUnit: next?.unit ?? null })
      .where(eq(productVariants.id, current.id));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'variant.net_quantity_updated',
      entity: 'product_variant',
      entityId: current.id,
      before: {
        netQuantity: current.netQty === null ? null : { qty: current.netQty, unit: current.netUnit },
      },
      after: { netQuantity: next },
    });
    return { sku: input.sku, netQuantity: next };
  });
}
