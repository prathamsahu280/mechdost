import { inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  coerceAttributes,
  PRODUCT_SLUG_RE,
  productSlug,
  slugify,
  type ImportErrorCode,
  type ImportRowError,
} from '@mechdost/shared/catalogue-import';
import { validateAttributes, type AttrValue, type NetQuantity } from '@mechdost/shared/product-attributes';
import { productMachine, type ProductStatus } from '@mechdost/shared/state';
import { VEHICLE_TYPES, type VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, brands, categories, productVariants, products } from '../schema';
import { attributeSetFor } from './catalogue';
import { hindiGaps, requireHindiToPublish } from './catalogue-admin';
import { ConflictError, ValidationError } from './errors';
import { recordServerEvent, recordServerEvents } from './events';
import type { Tx } from './orders';

/**
 * Adding products (spec 02/08; plan 2026-11-14 Stream B): one at a time from the admin form, or many from a CSV
 * import. Both run the same checks (`prepare`) inside one transaction under one advisory lock, so two imports or
 * an import and the form never race on a slug or SKU. A product starts as `draft`; `live` only when the caller
 * also has `products:publish` (checked by the API) and asks for it, through `productMachine` (draft → live).
 * Each product gets its first pack (variant) with SKU, MRP and net quantity; HSN and GST rate sit on the product.
 * Audited per product (and per brand created on the way); an analytics event per product.
 */
export interface NewProduct {
  categorySlug: string;
  /** Brand display name ("Exide"); found by its slug, created when new. */
  brand: string;
  name: string;
  nameHi?: string | null;
  /** Defaults to brand + name (`productSlug`). */
  slug?: string | null;
  specSummary?: string | null;
  specSummaryHi?: string | null;
  compatibility?: string | null;
  compatibilityHi?: string | null;
  description?: string | null;
  descriptionHi?: string | null;
  highlights?: string[];
  highlightsHi?: string[];
  vehicleTypes?: VehicleType[];
  attributes?: Record<string, unknown>;
  sku: string;
  mrpPaise: number;
  hsn: string;
  gstRateBp: number;
  netQuantity?: NetQuantity | null;
}

export interface CreatedProduct {
  row: number;
  slug: string;
  sku: string;
}

export interface SkippedRow {
  row: number;
  sku: string;
  reason: 'SKU_EXISTS';
}

interface Prepared {
  row: number;
  sku: string;
  brandSlug: string;
  brandName: string;
  netQuantity: NetQuantity | null;
  mrpPaise: number;
  product: Omit<typeof products.$inferInsert, 'brandId'>;
}

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('catalogue:create', 0))`;
const parentCategories = alias(categories, 'parent_categories');

const clean = (v: string | null | undefined) => {
  const s = v?.trim() ?? '';
  return s === '' ? null : s;
};
const cleanList = (list: string[] | undefined) => (list ?? []).map((h) => h.trim()).filter((h) => h !== '');

/** Every check that needs the database, for all rows at once (batched lookups, no per-row queries). */
async function prepare(
  tx: Tx,
  rows: { row: number; input: NewProduct }[],
  status: ProductStatus,
): Promise<{ ready: Prepared[]; errors: ImportRowError[]; skipped: SkippedRow[] }> {
  const errors: ImportRowError[] = [];
  const fail = (row: number, field: ImportRowError['field'], code: ImportErrorCode) => {
    errors.push({ row, field, code });
  };
  const skus = [...new Set(rows.map((r) => r.input.sku))];
  const catSlugs = [...new Set(rows.map((r) => r.input.categorySlug))];
  const cats =
    catSlugs.length === 0
      ? []
      : await tx
          .select({
            id: categories.id,
            slug: categories.slug,
            parentSlug: parentCategories.slug,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .leftJoin(parentCategories, sql`${parentCategories.id} = ${categories.parentId}`)
          .where(inArray(categories.slug, catSlugs));
  const catBySlug = new Map(cats.filter((c) => c.archivedAt === null).map((c) => [c.slug, c]));
  const existingSkus = new Set(
    skus.length === 0
      ? []
      : (
          await tx
            .select({ sku: productVariants.sku })
            .from(productVariants)
            .where(inArray(productVariants.sku, skus))
        ).map((r) => r.sku),
  );
  const hindiRequired = status === 'live' && (await requireHindiToPublish(tx));

  const skipped: SkippedRow[] = [];
  const seenSku = new Set<string>();
  const seenSlug = new Map<string, number>();
  const candidates: Prepared[] = [];
  for (const { row, input } of rows) {
    if (seenSku.has(input.sku)) {
      fail(row, 'sku', 'SKU_REPEATED');
      continue;
    }
    seenSku.add(input.sku);
    if (existingSkus.has(input.sku)) {
      skipped.push({ row, sku: input.sku, reason: 'SKU_EXISTS' });
      continue;
    }
    const before = errors.length;
    const cat = catBySlug.get(input.categorySlug);
    if (!cat) fail(row, 'category', 'UNKNOWN_CATEGORY');
    const brandName = input.brand.trim();
    const brandSlug = slugify(brandName);
    if (brandSlug === '') fail(row, 'brand', 'INVALID');
    const slug = clean(input.slug) ?? productSlug(brandName, input.name);
    if (!PRODUCT_SLUG_RE.test(slug)) fail(row, 'slug', 'INVALID');
    else if (seenSlug.has(slug)) fail(row, 'slug', 'SLUG_REPEATED');
    else seenSlug.set(slug, row);

    let spec: Record<string, AttrValue> = {};
    if (cat) {
      const set = attributeSetFor(cat.slug, cat.parentSlug) ?? cat.slug;
      const check = validateAttributes(set, coerceAttributes(set, input.attributes ?? {}));
      if (check.ok) spec = check.values;
      else fail(row, 'attributes', check.code === 'UNKNOWN_KEY' ? 'ATTRIBUTE_UNKNOWN' : 'ATTRIBUTE_VALUE');
    }
    const highlights = cleanList(input.highlights);
    const highlightsHi = cleanList(input.highlightsHi);
    if (highlightsHi.length > 0 && highlightsHi.length !== highlights.length)
      fail(row, 'highlights_hi', 'HIGHLIGHTS_HI_ALIGNED');

    const texts = {
      name: input.name.trim(),
      nameHi: clean(input.nameHi),
      specSummary: clean(input.specSummary),
      specSummaryHi: clean(input.specSummaryHi),
      compatibility: clean(input.compatibility),
      compatibilityHi: clean(input.compatibilityHi),
      description: clean(input.description),
      descriptionHi: clean(input.descriptionHi),
      highlights,
      highlightsHi,
    };
    if (hindiRequired && hindiGaps(texts).length > 0) fail(row, 'name_hi', 'HINDI_MISSING');
    if (errors.length > before || !cat) continue;
    candidates.push({
      row,
      sku: input.sku,
      brandSlug,
      brandName,
      mrpPaise: input.mrpPaise,
      netQuantity: input.netQuantity ?? null,
      product: {
        slug,
        ...texts,
        categoryId: cat.id,
        hsn: input.hsn,
        gstRateBp: input.gstRateBp,
        vehicleTypes: VEHICLE_TYPES.filter((t) => (input.vehicleTypes ?? []).includes(t)),
        spec,
        status,
      },
    });
  }

  const slugs = candidates.map((c) => c.product.slug);
  const takenSlugs = new Set(
    slugs.length === 0
      ? []
      : (await tx.select({ slug: products.slug }).from(products).where(inArray(products.slug, slugs))).map(
          (r) => r.slug,
        ),
  );
  const ready: Prepared[] = [];
  for (const c of candidates) {
    if (takenSlugs.has(c.product.slug)) fail(c.row, 'slug', 'SLUG_TAKEN');
    else ready.push(c);
  }
  errors.sort((a, b) => a.row - b.row);
  return { ready, errors, skipped };
}

/** Insert prepared rows: missing brands first, then products, packs, audit rows and events (one transaction). */
async function insertPrepared(
  tx: Tx,
  ready: Prepared[],
  staffUserId: string,
  source: 'form' | 'import',
  status: ProductStatus,
): Promise<{ slug: string; sku: string; version: number }[]> {
  if (ready.length === 0) return [];
  const brandNames = new Map(ready.map((r) => [r.brandSlug, r.brandName]));
  const newBrands = await tx
    .insert(brands)
    .values([...brandNames].map(([slug, name]) => ({ slug, name })))
    .onConflictDoNothing({ target: brands.slug })
    .returning({ id: brands.id, slug: brands.slug, name: brands.name });
  const brandRows = await tx
    .select({ id: brands.id, slug: brands.slug })
    .from(brands)
    .where(inArray(brands.slug, [...brandNames.keys()]));
  const brandId = new Map(brandRows.map((b) => [b.slug, b.id]));

  const inserted = await tx
    .insert(products)
    .values(ready.map((r) => ({ ...r.product, brandId: brandId.get(r.brandSlug) ?? '' })))
    .returning({ id: products.id, slug: products.slug, version: products.version });
  const productId = new Map(inserted.map((p) => [p.slug, p]));
  const packs = await tx
    .insert(productVariants)
    .values(
      ready.map((r) => ({
        productId: productId.get(r.product.slug)?.id ?? '',
        sku: r.sku,
        mrpPaise: r.mrpPaise,
        netQty: r.netQuantity?.qty ?? null,
        netUnit: r.netQuantity?.unit ?? null,
      })),
    )
    .returning({ id: productVariants.id, sku: productVariants.sku });
  const variantId = new Map(packs.map((v) => [v.sku, v.id]));

  await tx.insert(auditLog).values([
    ...newBrands.map((b) => ({
      actorUserId: staffUserId,
      actorRole: 'staff',
      action: 'brand.created',
      entity: 'brand',
      entityId: b.id,
      after: { slug: b.slug, name: b.name, source },
    })),
    ...ready.map((r) => ({
      actorUserId: staffUserId,
      actorRole: 'staff',
      action: 'product.created',
      entity: 'product',
      entityId: productId.get(r.product.slug)?.id ?? '',
      after: {
        slug: r.product.slug,
        status,
        categoryId: r.product.categoryId,
        brand: r.brandSlug,
        hsn: r.product.hsn,
        gstRateBp: r.product.gstRateBp,
        variant: { id: variantId.get(r.sku), sku: r.sku, mrpPaise: r.mrpPaise, netQuantity: r.netQuantity },
        source,
      },
    })),
  ]);
  await recordServerEvents(
    tx,
    'admin_product_created',
    ready.map((r) => ({
      userId: staffUserId,
      props: { productSlug: r.product.slug, sku: r.sku, status, source },
    })),
  );
  return ready.map((r) => ({
    slug: r.product.slug,
    sku: r.sku,
    version: productId.get(r.product.slug)?.version ?? 1,
  }));
}

function statusFor(publish: boolean): ProductStatus {
  if (!publish) return 'draft';
  productMachine.assert('draft', 'live', 'admin');
  return 'live';
}

/** One product from the admin form. SKU or slug already in use → 409 (`SKU_TAKEN` / `SLUG_TAKEN`). */
export async function createProduct(
  db: Tx,
  input: { product: NewProduct; publish: boolean; staffUserId: string },
): Promise<{ slug: string; sku: string; status: ProductStatus; version: number }> {
  const status = statusFor(input.publish);
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const { ready, errors, skipped } = await prepare(tx, [{ row: 1, input: input.product }], status);
    if (skipped.length > 0) throw new ConflictError('This SKU is already in the catalogue', 'SKU_TAKEN');
    const [first] = errors;
    if (first?.code === 'SLUG_TAKEN')
      throw new ConflictError('Another product already uses this web address (slug)', 'SLUG_TAKEN');
    if (first) throw new ValidationError(`Check the field "${first.field}"`, first.code, { errors });
    const [created] = await insertPrepared(tx, ready, input.staffUserId, 'form', status);
    if (!created) throw new Error('createProduct: nothing inserted');
    return { ...created, status };
  });
}

export interface ImportReport {
  dryRun: boolean;
  status: ProductStatus;
  created: CreatedProduct[];
  skipped: SkippedRow[];
}

/**
 * Many products from the CSV import. Every row is checked first; any error (including the ones the API found
 * while reading the file, passed in `invalid`) → nothing is written and `IMPORT_ROWS_INVALID` lists them all.
 * SKUs already in the catalogue are skipped and reported (re-running the same file is safe). `dryRun` checks
 * only. All rows go in one transaction.
 */
export async function importProducts(
  db: Tx,
  input: {
    rows: { row: number; input: NewProduct }[];
    invalid: ImportRowError[];
    dryRun: boolean;
    publish: boolean;
    staffUserId: string;
  },
): Promise<ImportReport> {
  const status = statusFor(input.publish);
  return db.transaction(async (tx) => {
    await tx.execute(LOCK);
    const { ready, errors, skipped } = await prepare(tx, input.rows, status);
    const all = [...input.invalid, ...errors].sort((a, b) => a.row - b.row);
    if (all.length > 0)
      throw new ValidationError('Some rows need fixing; nothing was imported', 'IMPORT_ROWS_INVALID', {
        errors: all,
        skipped,
      });
    const created = ready.map((r) => ({ row: r.row, slug: r.product.slug, sku: r.sku }));
    if (input.dryRun) return { dryRun: true, status, created, skipped };
    await insertPrepared(tx, ready, input.staffUserId, 'import', status);
    await recordServerEvent(tx, 'admin_catalogue_imported', {
      userId: input.staffUserId,
      props: { rows: input.rows.length, created: created.length, skipped: skipped.length, status },
    });
    return { dryRun: false, status, created, skipped };
  });
}
