import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PlannedProduct } from '../catalogue-v2/plan';
import {
  auditLog,
  brands,
  categories,
  productPhotos,
  productRanges,
  productVariants,
  products,
} from '../schema';
import { ValidationError } from './errors';
import { rowsOf } from './sql-rows';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Writing the catalogue-v2 plan (design 2026-11-22; runbook `catalogue-import.md`). Idempotent by construction:
 * a product is found by any of its pack SKUs (else by slug, else it is new), a re-run changes only what differs and
 * never deletes. Rules that keep the admin's work safe:
 *  - brands, ranges and categories that exist are left alone (their `hidden` switches are the admin's);
 *  - a product the admin has edited (`hindi_machine = false`) keeps its texts, tax and fitment; only brand-new packs
 *    are added to it;
 *  - an MRP is only ever filled in where the pack has none (the admin's MRP is never overwritten);
 *  - `status` of an existing product is never touched (unpublishing survives a re-run).
 * Written in batches (one transaction and one advisory lock each), so a stopped run resumes where it left off.
 */
export interface ImportCounts {
  categoriesCreated: number;
  brandsCreated: number;
  rangesCreated: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnchanged: number;
  packsCreated: number;
  packsUpdated: number;
  mrpFilled: number;
  /** Slugs that were taken by a product this import did not create (the new product got a `-cv2` slug). */
  slugsRenamed: number;
}

export const emptyCounts = (): ImportCounts => ({
  categoriesCreated: 0,
  brandsCreated: 0,
  rangesCreated: 0,
  productsCreated: 0,
  productsUpdated: 0,
  productsUnchanged: 0,
  packsCreated: 0,
  packsUpdated: 0,
  mrpFilled: 0,
  slugsRenamed: 0,
});

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('catalogue:create', 0))`;
const CHUNK = 400;

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type ProductRow = typeof products.$inferSelect;
type VariantRow = Pick<
  typeof productVariants.$inferSelect,
  'id' | 'productId' | 'sku' | 'mrpPaise' | 'netQty' | 'netUnit' | 'options'
>;

interface Lookup {
  categoryIds: Map<string, string>;
  brandIds: Map<string, string>;
  rangeIds: Map<string, string>;
  variantsBySku: Map<string, VariantRow>;
  productsById: Map<string, ProductRow>;
  slugOwners: Map<string, string>;
}

async function loadLookup(db: Tx, batch: readonly PlannedProduct[]): Promise<Lookup> {
  const catSlugs = [...new Set(batch.flatMap((p) => [p.category.slug, p.category.parent]))];
  const brandSlugs = [...new Set(batch.map((p) => p.brand.slug))];
  const rangeSlugs = [...new Set(batch.flatMap((p) => (p.range ? [p.range.slug] : [])))];
  const skus = batch.flatMap((p) => p.packs.map((k) => k.sku));
  const slugs = batch.map((p) => p.slug);

  const cats = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, catSlugs));
  const bs = await db
    .select({ id: brands.id, slug: brands.slug })
    .from(brands)
    .where(inArray(brands.slug, brandSlugs));
  const rs =
    rangeSlugs.length === 0
      ? []
      : await db
          .select({ id: productRanges.id, slug: productRanges.slug })
          .from(productRanges)
          .where(inArray(productRanges.slug, rangeSlugs));
  const variants: VariantRow[] = [];
  for (const part of chunks(skus, CHUNK))
    variants.push(
      ...(await db
        .select({
          id: productVariants.id,
          productId: productVariants.productId,
          sku: productVariants.sku,
          mrpPaise: productVariants.mrpPaise,
          netQty: productVariants.netQty,
          netUnit: productVariants.netUnit,
          options: productVariants.options,
        })
        .from(productVariants)
        .where(inArray(productVariants.sku, part))),
    );
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const rows: ProductRow[] = [];
  for (const part of chunks(productIds, CHUNK))
    rows.push(...(await db.select().from(products).where(inArray(products.id, part))));
  const owners = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(inArray(products.slug, slugs));
  return {
    categoryIds: new Map(cats.map((c) => [c.slug, c.id])),
    brandIds: new Map(bs.map((b) => [b.slug, b.id])),
    rangeIds: new Map(rs.map((r) => [r.slug, r.id])),
    variantsBySku: new Map(variants.map((v) => [v.sku, v])),
    productsById: new Map(rows.map((r) => [r.id, r])),
    slugOwners: new Map(owners.map((o) => [o.slug, o.id])),
  };
}

/** The existing product a plan entry belongs to: found through any of its pack SKUs. */
function existingFor(p: PlannedProduct, lookup: Lookup): ProductRow | null {
  for (const pack of p.packs) {
    const v = lookup.variantsBySku.get(pack.sku);
    const row = v ? lookup.productsById.get(v.productId) : undefined;
    if (row) return row;
  }
  return null;
}

/** JSON with sorted keys: jsonb returns keys in its own order, so plain stringify would see false differences. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null)
    return `{${Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
const sameJson = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Fields of an existing, still machine-made product that differ from the plan (empty = unchanged). */
function productChanges(
  p: PlannedProduct,
  row: ProductRow,
  ids: { brandId: string; categoryId: string; rangeId: string | null },
) {
  const want = {
    name: p.name,
    nameHi: p.nameHi,
    description: p.description,
    descriptionHi: p.descriptionHi,
    specSummary: p.specSummary,
    specSummaryHi: p.specSummaryHi,
    compatibility: p.compatibility,
    compatibilityHi: p.compatibilityHi,
    highlights: p.highlights,
    highlightsHi: p.highlightsHi,
    vehicleTypes: p.vehicleTypes,
    spec: p.attributes,
    hsn: p.hsn,
    gstRateBp: p.gstRateBp,
    warranty: p.warranty,
    ...ids,
  };
  const changed: Partial<typeof want> = {};
  for (const key of Object.keys(want) as (keyof typeof want)[])
    if (!sameJson(want[key], row[key])) (changed as Record<string, unknown>)[key] = want[key];
  return changed;
}

/** Whether migration 0079 (ranges, hidden switches, optional MRP) is in the database. */
export async function catalogueV2Migrated(db: Tx): Promise<boolean> {
  const [row] = rowsOf<{ ok: boolean }>(
    await db.execute(sql`select to_regclass('public.product_ranges') is not null as ok`),
  );
  return row?.ok === true;
}

/**
 * Read-only: what `applyCatalogueImport` would do (the dry run). Never writes. Before migration 0079 is applied it
 * can only compare names and SKUs (the new columns do not exist yet): everything not found by SKU or slug counts as
 * new, and `migrationApplied` is false so the report says so.
 */
export type ProductClass = 'new' | 'updated' | 'unchanged';
export type DiffResult = ImportCounts & {
  migrationApplied: boolean;
  skuConflicts: number;
  /** Per planned product slug: what the import does with it. */
  classes: Map<string, ProductClass>;
};

export async function diffCatalogueImport(db: Tx, plan: readonly PlannedProduct[]): Promise<DiffResult> {
  const migrationApplied = await catalogueV2Migrated(db);
  const counts: DiffResult = { ...emptyCounts(), migrationApplied, skuConflicts: 0, classes: new Map() };
  const subs = new Map(plan.map((p) => [p.category.slug, p.category]));
  const existingCats = new Set(
    (
      await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(inArray(categories.slug, [...subs.keys()]))
    ).map((c) => c.slug),
  );
  counts.categoriesCreated = [...subs.keys()].filter((s) => !existingCats.has(s)).length;
  const missingParents = [...new Set(plan.map((p) => p.category.parent))];
  const parents = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, missingParents));
  const absent = missingParents.filter((s) => !parents.some((c) => c.slug === s));
  if (absent.length > 0)
    throw new ValidationError(`Top-level categories missing: ${absent.join(', ')}`, 'CATEGORY_MISSING');

  const brandSlugs = [...new Set(plan.map((p) => p.brand.slug))];
  const haveBrands = new Set(
    (await db.select({ slug: brands.slug }).from(brands).where(inArray(brands.slug, brandSlugs))).map(
      (b) => b.slug,
    ),
  );
  counts.brandsCreated = brandSlugs.filter((s) => !haveBrands.has(s)).length;
  const rangeSlugs = [...new Set(plan.flatMap((p) => (p.range ? [p.range.slug] : [])))];
  const haveRanges = new Set(
    rangeSlugs.length === 0 || !migrationApplied
      ? []
      : (
          await db
            .select({ slug: productRanges.slug })
            .from(productRanges)
            .where(inArray(productRanges.slug, rangeSlugs))
        ).map((r) => r.slug),
  );
  counts.rangesCreated = rangeSlugs.filter((s) => !haveRanges.has(s)).length;

  if (!migrationApplied) {
    counts.rangesCreated = rangeSlugs.length;
    const skus = plan.flatMap((p) => p.packs.map((k) => k.sku));
    const taken = new Set<string>();
    for (const part of chunks(skus, CHUNK))
      for (const row of await db
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .where(inArray(productVariants.sku, part)))
        taken.add(row.sku);
    const owners = new Set<string>();
    for (const part of chunks(
      plan.map((p) => p.slug),
      CHUNK,
    ))
      for (const row of await db
        .select({ slug: products.slug })
        .from(products)
        .where(inArray(products.slug, part)))
        owners.add(row.slug);
    counts.skuConflicts = taken.size;
    for (const p of plan) counts.classes.set(p.slug, 'new');
    counts.productsCreated = plan.length;
    counts.packsCreated = skus.length;
    counts.slugsRenamed = plan.filter((p) => owners.has(p.slug)).length;
    return counts;
  }

  for (const batch of chunks(plan, 200)) {
    const lookup = await loadLookup(db, batch);
    for (const p of batch) {
      const row = existingFor(p, lookup);
      if (!row) {
        counts.classes.set(p.slug, 'new');
        counts.productsCreated += 1;
        counts.packsCreated += p.packs.length;
        if (lookup.slugOwners.has(p.slug)) counts.slugsRenamed += 1;
        continue;
      }
      let touched = false;
      for (const pack of p.packs) {
        const v = lookup.variantsBySku.get(pack.sku);
        if (!v) {
          counts.packsCreated += 1;
          touched = true;
        } else if (v.mrpPaise === null && pack.mrpPaise !== null) {
          counts.mrpFilled += 1;
          touched = true;
        } else if (
          row.hindiMachine &&
          (v.netQty !== (pack.netQuantity?.qty ?? null) || !sameJson(v.options, pack.options))
        ) {
          counts.packsUpdated += 1;
          touched = true;
        }
      }
      const ids = {
        brandId: lookup.brandIds.get(p.brand.slug) ?? row.brandId,
        categoryId: lookup.categoryIds.get(p.category.slug) ?? row.categoryId,
        rangeId: p.range ? (lookup.rangeIds.get(p.range.slug) ?? row.rangeId) : null,
      };
      if (row.hindiMachine && Object.keys(productChanges(p, row, ids)).length > 0) {
        counts.productsUpdated += 1;
        touched = true;
      }
      counts.classes.set(p.slug, touched ? 'updated' : 'unchanged');
      if (!touched) counts.productsUnchanged += 1;
    }
  }
  return counts;
}

async function ensureGroups(
  tx: Tx,
  batch: readonly PlannedProduct[],
  staffUserId: string,
  counts: ImportCounts,
) {
  // Sub-categories (their parents must exist: the seed's top-level categories).
  const wantedCats = new Map(batch.map((p) => [p.category.slug, p.category]));
  const parentSlugs = [...new Set([...wantedCats.values()].map((c) => c.parent))];
  const parents = await tx
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(inArray(categories.slug, parentSlugs));
  const parentId = new Map(parents.map((c) => [c.slug, c.id]));
  const have = new Set(
    (
      await tx
        .select({ slug: categories.slug })
        .from(categories)
        .where(inArray(categories.slug, [...wantedCats.keys()]))
    ).map((c) => c.slug),
  );
  const newCats = [...wantedCats.values()].filter((c) => !have.has(c.slug));
  for (const c of newCats)
    if (!parentId.has(c.parent))
      throw new ValidationError(`Top-level category "${c.parent}" is missing`, 'CATEGORY_MISSING');
  if (newCats.length > 0) {
    const made = await tx
      .insert(categories)
      .values(
        newCats.map((c, i) => ({
          slug: c.slug,
          name: c.name,
          nameHi: c.nameHi,
          parentId: parentId.get(c.parent) ?? null,
          sort: 100 + i,
        })),
      )
      .onConflictDoNothing({ target: categories.slug })
      .returning({ id: categories.id, slug: categories.slug });
    counts.categoriesCreated += made.length;
    if (made.length > 0)
      await tx.insert(auditLog).values(
        made.map((c) => ({
          actorUserId: staffUserId,
          actorRole: 'staff',
          action: 'category.created',
          entity: 'category',
          entityId: c.id,
          after: { slug: c.slug, source: 'catalogue_v2_import' },
        })),
      );
  }
  // Brands.
  const wantedBrands = new Map(batch.map((p) => [p.brand.slug, p.brand]));
  const madeBrands = await tx
    .insert(brands)
    .values([...wantedBrands.values()].map((b) => ({ slug: b.slug, name: b.name })))
    .onConflictDoNothing({ target: brands.slug })
    .returning({ id: brands.id, slug: brands.slug });
  counts.brandsCreated += madeBrands.length;
  if (madeBrands.length > 0)
    await tx.insert(auditLog).values(
      madeBrands.map((b) => ({
        actorUserId: staffUserId,
        actorRole: 'staff',
        action: 'brand.created',
        entity: 'brand',
        entityId: b.id,
        after: { slug: b.slug, source: 'catalogue_v2_import' },
      })),
    );
  const brandRows = await tx
    .select({ id: brands.id, slug: brands.slug })
    .from(brands)
    .where(inArray(brands.slug, [...wantedBrands.keys()]));
  const brandId = new Map(brandRows.map((b) => [b.slug, b.id]));
  // Ranges.
  const wantedRanges = new Map(
    batch.flatMap((p) => (p.range ? [[p.range.slug, { range: p.range, brand: p.brand.slug }] as const] : [])),
  );
  if (wantedRanges.size > 0) {
    const madeRanges = await tx
      .insert(productRanges)
      .values(
        [...wantedRanges.values()].map(({ range, brand }) => ({
          brandId: brandId.get(brand) ?? '',
          slug: range.slug,
          name: range.name,
          nameHi: range.nameHi,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: productRanges.id, slug: productRanges.slug });
    counts.rangesCreated += madeRanges.length;
    if (madeRanges.length > 0)
      await tx.insert(auditLog).values(
        madeRanges.map((r) => ({
          actorUserId: staffUserId,
          actorRole: 'staff',
          action: 'product_range.created',
          entity: 'product_range',
          entityId: r.id,
          after: { slug: r.slug, source: 'catalogue_v2_import' },
        })),
      );
  }
}

/**
 * Write the plan in batches of `batchSize` products (one transaction each). `onBatch` is called after each commit
 * (progress, and the resume point if the run is stopped).
 */
export async function applyCatalogueImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string; batchSize?: number; onBatch?: (done: number, total: number) => void },
): Promise<ImportCounts> {
  const counts = emptyCounts();
  const total = plan.length;
  let done = 0;
  for (const batch of chunks(plan, opts.batchSize ?? 100)) {
    await db.transaction(async (tx) => {
      await tx.execute(LOCK);
      await ensureGroups(tx, batch, opts.staffUserId, counts);
      const lookup = await loadLookup(tx, batch);
      const audits: (typeof auditLog.$inferInsert)[] = [];

      const fresh: PlannedProduct[] = [];
      for (const p of batch) {
        const ids = {
          brandId: lookup.brandIds.get(p.brand.slug) ?? '',
          categoryId: lookup.categoryIds.get(p.category.slug) ?? '',
          rangeId: p.range ? (lookup.rangeIds.get(p.range.slug) ?? null) : null,
        };
        if (ids.brandId === '' || ids.categoryId === '')
          throw new ValidationError(`No brand or category for ${p.slug}`, 'GROUP_MISSING');
        const row = existingFor(p, lookup);
        if (!row) {
          fresh.push(p);
          continue;
        }
        let touched = false;
        if (row.hindiMachine) {
          const changed = productChanges(p, row, ids);
          if (Object.keys(changed).length > 0) {
            await tx.update(products).set(changed).where(eq(products.id, row.id));
            audits.push({
              actorUserId: opts.staffUserId,
              actorRole: 'staff',
              action: 'product.updated',
              entity: 'product',
              entityId: row.id,
              after: { fields: Object.keys(changed), source: 'catalogue_v2_import' },
            });
            counts.productsUpdated += 1;
            touched = true;
          }
        }
        const newPacks = p.packs.filter((k) => !lookup.variantsBySku.has(k.sku));
        if (newPacks.length > 0) {
          await tx.insert(productVariants).values(
            newPacks.map((k) => ({
              productId: row.id,
              sku: k.sku,
              options: k.options,
              mrpPaise: k.mrpPaise,
              netQty: k.netQuantity?.qty ?? null,
              netUnit: k.netQuantity?.unit ?? null,
            })),
          );
          counts.packsCreated += newPacks.length;
          touched = true;
        }
        for (const k of p.packs) {
          const v = lookup.variantsBySku.get(k.sku);
          if (!v) continue;
          const patch: Partial<typeof productVariants.$inferInsert> = {};
          if (v.mrpPaise === null && k.mrpPaise !== null) {
            patch.mrpPaise = k.mrpPaise;
            counts.mrpFilled += 1;
          }
          if (
            row.hindiMachine &&
            (v.netQty !== (k.netQuantity?.qty ?? null) || v.netUnit !== (k.netQuantity?.unit ?? null))
          ) {
            patch.netQty = k.netQuantity?.qty ?? null;
            patch.netUnit = k.netQuantity?.unit ?? null;
          }
          if (row.hindiMachine && !sameJson(v.options, k.options)) patch.options = k.options;
          if (Object.keys(patch).length > 0) {
            await tx.update(productVariants).set(patch).where(eq(productVariants.id, v.id));
            counts.packsUpdated += patch.mrpPaise === undefined || Object.keys(patch).length > 1 ? 1 : 0;
            touched = true;
          }
        }
        if (!touched) counts.productsUnchanged += 1;
      }

      if (fresh.length > 0) {
        const rows = fresh.map((p) => {
          // A slug held by a product this import did not create (no pack of ours): take a `-cv2` slug.
          let slug = p.slug;
          if (lookup.slugOwners.has(slug)) {
            counts.slugsRenamed += 1;
            slug = `${p.slug}-cv2`.slice(0, 120);
          }
          return {
            slug,
            name: p.name,
            nameHi: p.nameHi,
            brandId: lookup.brandIds.get(p.brand.slug) ?? '',
            categoryId: lookup.categoryIds.get(p.category.slug) ?? '',
            rangeId: p.range ? (lookup.rangeIds.get(p.range.slug) ?? null) : null,
            description: p.description,
            descriptionHi: p.descriptionHi,
            specSummary: p.specSummary,
            specSummaryHi: p.specSummaryHi,
            compatibility: p.compatibility,
            compatibilityHi: p.compatibilityHi,
            highlights: p.highlights,
            highlightsHi: p.highlightsHi,
            spec: p.attributes,
            hsn: p.hsn,
            gstRateBp: p.gstRateBp,
            warranty: p.warranty,
            vehicleTypes: p.vehicleTypes,
            status: p.status,
            hindiMachine: true,
          };
        });
        const made = await tx
          .insert(products)
          .values(rows)
          .returning({ id: products.id, slug: products.slug });
        const idBySlug = new Map(made.map((m) => [m.slug, m.id]));
        const packRows = fresh.flatMap((p, i) =>
          p.packs.map((k) => ({
            productId: idBySlug.get(rows[i]?.slug ?? '') ?? '',
            sku: k.sku,
            options: k.options,
            mrpPaise: k.mrpPaise,
            netQty: k.netQuantity?.qty ?? null,
            netUnit: k.netQuantity?.unit ?? null,
          })),
        );
        for (const part of chunks(packRows, 500)) await tx.insert(productVariants).values(part);
        counts.productsCreated += made.length;
        counts.packsCreated += packRows.length;
        for (const [i, p] of fresh.entries())
          audits.push({
            actorUserId: opts.staffUserId,
            actorRole: 'staff',
            action: 'product.created',
            entity: 'product',
            entityId: idBySlug.get(rows[i]?.slug ?? '') ?? '',
            after: {
              slug: rows[i]?.slug,
              status: p.status,
              brand: p.brand.slug,
              range: p.range?.slug ?? null,
              category: p.category.slug,
              packs: p.packs.length,
              source: 'catalogue_v2_import',
              sourceId: p.sourceId,
              section: p.section,
            },
          });
      }
      for (const part of chunks(audits, 500)) if (part.length > 0) await tx.insert(auditLog).values(part);
    });
    done += batch.length;
    opts.onBatch?.(done, total);
  }
  return counts;
}

/** Products of the plan that have no live photo yet (resume point for the photo step). */
export async function productsWithoutPhoto(
  db: Tx,
  plan: readonly PlannedProduct[],
): Promise<PlannedProduct[]> {
  const withPhoto = new Set<string>();
  for (const part of chunks(plan, CHUNK)) {
    const skus = part.flatMap((p) => p.packs.slice(0, 1).map((k) => k.sku));
    const rows = await db
      .select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(
        productPhotos,
        and(eq(productPhotos.productId, productVariants.productId), isNull(productPhotos.deletedAt)),
      )
      .where(inArray(productVariants.sku, skus));
    for (const r of rows) withPhoto.add(r.sku);
  }
  return plan.filter((p) => p.photo !== null && !withPhoto.has(p.packs[0]?.sku ?? ''));
}

/** Slug and id a planned product ended up with in the database (via a pack SKU), for the photo step. */
export async function productsBySku(
  db: Tx,
  skus: readonly string[],
): Promise<Map<string, { slug: string; productId: string }>> {
  const out = new Map<string, { slug: string; productId: string }>();
  for (const part of chunks(skus, CHUNK)) {
    const rows = await db
      .select({ sku: productVariants.sku, slug: products.slug, productId: products.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.sku, part));
    for (const r of rows) out.set(r.sku, { slug: r.slug, productId: r.productId });
  }
  return out;
}

export async function recordImportEvent(db: Tx, staffUserId: string, counts: ImportCounts): Promise<void> {
  await recordServerEvent(db, 'admin_catalogue_v2_imported', {
    userId: staffUserId,
    props: {
      productsCreated: counts.productsCreated,
      productsUpdated: counts.productsUpdated,
      packsCreated: counts.packsCreated,
      mrpFilled: counts.mrpFilled,
    },
  });
}

/** What the Admin "Import status" panel shows: counts of the last real import run, per brand and per skip reason. */
export interface ImportRunSummary {
  at: string;
  brands: Record<string, { imported: number; updated: number; unchanged: number; skipped: number }>;
  reasons: Record<string, number>;
  totals: { products: number; imported: number; updated: number; unchanged: number; skipped: number };
}

/** Summarise status rows (one per source product) for the audit row and the panel. */
export function summariseStatus(
  rows: readonly { brand: string; status: string; reason: string }[],
  at: Date,
): ImportRunSummary {
  const out: ImportRunSummary = {
    at: at.toISOString(),
    brands: {},
    reasons: {},
    totals: { products: rows.length, imported: 0, updated: 0, unchanged: 0, skipped: 0 },
  };
  for (const r of rows) {
    const key =
      r.status === 'imported' || r.status === 'updated' || r.status === 'unchanged' ? r.status : 'skipped';
    const b = (out.brands[r.brand] ??= { imported: 0, updated: 0, unchanged: 0, skipped: 0 });
    b[key] += 1;
    out.totals[key] += 1;
    if (r.reason !== '') out.reasons[r.reason] = (out.reasons[r.reason] ?? 0) + 1;
  }
  return out;
}

/** Keep the summary of a real run so Admin → Catalogue can show it (audit row, append-only). */
export async function recordImportRun(db: Tx, staffUserId: string, summary: ImportRunSummary): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: staffUserId,
    actorRole: 'staff',
    action: 'catalogue.v2_import_run',
    entity: 'catalogue',
    entityId: 'v2',
    after: summary,
  });
}

/** The newest recorded run, or null before the first real import. */
export async function lastImportRun(db: Tx): Promise<ImportRunSummary | null> {
  const [row] = await db
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(eq(auditLog.action, 'catalogue.v2_import_run'))
    .orderBy(sql`${auditLog.id} desc`)
    .limit(1);
  return (row?.after as ImportRunSummary | null | undefined) ?? null;
}
