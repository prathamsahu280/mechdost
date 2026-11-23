import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ExidePlannedProduct } from '../exide/plan';
import { BRAND } from '../exide/plan';
import {
  auditLog,
  brands,
  categories,
  mediaObjects,
  partNumbers,
  productPhotos,
  productRanges,
  productVariants,
  products,
} from '../schema';
import { ConflictError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Writing the Exide plan (user 2026-11-23, runbook `catalogue-import.md` "Exide import"). One transaction, one
 * advisory lock:
 *  1. every existing product of brand `exide` that is not in the plan is ARCHIVED (conditional update on `version`;
 *     its variants too). Never deleted: old orders and carts point at them;
 *  2. every planned product is created, or updated in place when its SKU or slug already exists;
 *  3. a re-run changes nothing. A product this importer made earlier (`spec.source = 'exidecare'`) that staff have
 *     since edited (`hindi_machine = false`) keeps its texts, and an MRP is only filled where the pack has none.
 * `diffExideImport` runs the same code without writing (the dry run).
 */
export interface ExideCounts {
  brandsCreated: number;
  categoriesCreated: number;
  rangesCreated: number;
  productsCreated: number;
  productsUpdated: number;
  productsUnchanged: number;
  productsArchived: number;
  variantsArchived: number;
  packsCreated: number;
  mrpSet: number;
}

export type ExideRowResult = 'created' | 'updated' | 'unchanged';

export interface ExideRunResult {
  counts: ExideCounts;
  /** By planned slug. */
  results: Map<string, ExideRowResult>;
  /** Old Exide products archived (or to be archived in a dry run). */
  archived: { slug: string; name: string; status: string }[];
}

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('catalogue:create', 0))`;
const SOURCE = 'exide_import';

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof productVariants.$inferSelect;

/** JSON with sorted keys (jsonb returns its own key order, so plain stringify would see false differences). */
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

function emptyCounts(): ExideCounts {
  return {
    brandsCreated: 0,
    categoriesCreated: 0,
    rangesCreated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    productsUnchanged: 0,
    productsArchived: 0,
    variantsArchived: 0,
    packsCreated: 0,
    mrpSet: 0,
  };
}

/** The statuses a product passes through to go live (the product machine has no archived → live step). */
function pathToLive(from: string): string[] {
  if (from === 'live') return [];
  if (from === 'archived' || from === 'rejected') return ['draft', 'live'];
  return ['live'];
}

async function execute(
  db: Tx,
  plan: readonly ExidePlannedProduct[],
  opts: { write: boolean; staffUserId: string },
): Promise<ExideRunResult> {
  const { write, staffUserId } = opts;
  const counts = emptyCounts();
  const results = new Map<string, ExideRowResult>();
  const audits: (typeof auditLog.$inferInsert)[] = [];
  const audit = (action: string, entityId: string, before: unknown, after: Record<string, unknown>) =>
    audits.push({
      actorUserId: staffUserId,
      actorRole: 'staff',
      action,
      entity: 'product',
      entityId,
      before: before ?? null,
      after: { ...after, source: SOURCE },
    });
  if (write) await db.execute(LOCK);

  // Brand.
  let [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, BRAND.slug));
  if (!brand) {
    counts.brandsCreated = 1;
    if (write) {
      [brand] = await db
        .insert(brands)
        .values({ slug: BRAND.slug, name: BRAND.name })
        .returning({ id: brands.id });
    }
  }
  const brandId = brand?.id ?? null;

  // Categories (sub-categories need their top-level parent; `home-power` is top-level itself).
  const wantedCats = new Map(plan.map((p) => [p.category.slug, p.category]));
  const catRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(
      inArray(categories.slug, [
        ...wantedCats.keys(),
        ...new Set(plan.flatMap((p) => (p.category.parent ? [p.category.parent] : []))),
      ]),
    );
  const categoryId = new Map(catRows.map((c) => [c.slug, c.id]));
  const missingCats = [...wantedCats.values()].filter((c) => !categoryId.has(c.slug));
  counts.categoriesCreated = missingCats.length;
  for (const c of missingCats) {
    if (c.parent !== null && !categoryId.has(c.parent))
      throw new ValidationError(`Top-level category "${c.parent}" is missing`, 'CATEGORY_MISSING');
    if (!write) continue;
    const [top] = await db
      .select({ sort: sql<number>`coalesce(max(${categories.sort}), 0)` })
      .from(categories)
      .where(
        c.parent === null
          ? isNull(categories.parentId)
          : eq(categories.parentId, categoryId.get(c.parent) ?? ''),
      );
    const [made] = await db
      .insert(categories)
      .values({
        slug: c.slug,
        name: c.name,
        nameHi: c.nameHi,
        parentId: c.parent === null ? null : (categoryId.get(c.parent) ?? null),
        sort: (top?.sort ?? 0) + 1,
      })
      .returning({ id: categories.id });
    if (made) {
      categoryId.set(c.slug, made.id);
      audits.push({
        actorUserId: staffUserId,
        actorRole: 'staff',
        action: 'category.created',
        entity: 'category',
        entityId: made.id,
        after: { slug: c.slug, source: SOURCE },
      });
    }
  }

  // Ranges (found by slug, or by name inside the brand; an existing one keeps the admin's switches and names).
  const rangeId = new Map<string, string>();
  const wantedRanges = new Map(plan.map((p) => [p.range.slug, p.range]));
  if (brandId !== null) {
    const have = await db
      .select({ id: productRanges.id, slug: productRanges.slug, name: productRanges.name })
      .from(productRanges)
      .where(eq(productRanges.brandId, brandId));
    for (const r of wantedRanges.values()) {
      const hit = have.find((h) => h.slug === r.slug) ?? have.find((h) => h.name === r.name);
      if (hit) rangeId.set(r.slug, hit.id);
    }
  }
  const missingRanges = [...wantedRanges.values()].filter((r) => !rangeId.has(r.slug));
  counts.rangesCreated = missingRanges.length;
  if (write && brandId !== null && missingRanges.length > 0) {
    const made = await db
      .insert(productRanges)
      .values(missingRanges.map((r) => ({ brandId, slug: r.slug, name: r.name, nameHi: r.nameHi })))
      .returning({ id: productRanges.id, slug: productRanges.slug });
    for (const m of made) rangeId.set(m.slug, m.id);
  }

  // What exists: every Exide product, the products holding a planned slug, the variants holding a planned SKU.
  const exideRows: ProductRow[] =
    brandId === null ? [] : await db.select().from(products).where(eq(products.brandId, brandId));
  const byId = new Map(exideRows.map((r) => [r.id, r]));
  const slugRows = await db
    .select()
    .from(products)
    .where(
      inArray(
        products.slug,
        plan.map((p) => p.slug),
      ),
    );
  for (const r of slugRows) byId.set(r.id, r);
  const skuRows = await db
    .select()
    .from(productVariants)
    .where(
      inArray(
        productVariants.sku,
        plan.map((p) => p.variant.sku),
      ),
    );
  const bySku = new Map(skuRows.map((v) => [v.sku, v]));
  const missingOwners = skuRows.filter((v) => !byId.has(v.productId)).map((v) => v.productId);
  if (missingOwners.length > 0)
    for (const r of await db.select().from(products).where(inArray(products.id, missingOwners)))
      byId.set(r.id, r);
  const bySlug = new Map([...byId.values()].map((r) => [r.slug, r]));
  const variantsOf = new Map<string, VariantRow[]>();
  const matchedIds = [...byId.keys()];
  if (matchedIds.length > 0)
    for (const v of await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, matchedIds)))
      variantsOf.set(v.productId, [...(variantsOf.get(v.productId) ?? []), v]);

  const matched = new Set<string>();
  const fresh: ExidePlannedProduct[] = [];
  const isExide = (r: ProductRow) => brandId !== null && r.brandId === brandId;

  /** Conditional update on `version` (and `status` when given); returns the new version. */
  const updateProduct = async (row: ProductRow, set: Partial<typeof products.$inferInsert>) => {
    const [r] = await db
      .update(products)
      .set(set)
      .where(and(eq(products.id, row.id), eq(products.version, row.version), eq(products.status, row.status)))
      .returning({ version: products.version, status: products.status });
    if (!r)
      throw new ConflictError(`Someone else changed ${row.slug}; run the import again`, 'STALE_PRODUCT');
    row.version = r.version;
    row.status = r.status;
  };

  for (const p of plan) {
    const owner = bySku.get(p.variant.sku);
    const row = (owner ? byId.get(owner.productId) : undefined) ?? bySlug.get(p.slug);
    if (!row) {
      fresh.push(p);
      results.set(p.slug, 'created');
      continue;
    }
    if (!isExide(row))
      throw new ValidationError(`${p.slug} (or its SKU) belongs to another brand's product`, 'SLUG_TAKEN');
    if (matched.has(row.id))
      throw new ConflictError(`Two source rows match the product ${row.slug}`, 'DUPLICATE_MATCH');
    matched.add(row.id);

    const own = (row.spec as { source?: unknown } | null)?.source === 'exidecare';
    const adminEdited = own && !row.hindiMachine;
    let touched = false;

    if (!adminEdited) {
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
        spec: p.spec,
        hsn: p.hsn,
        gstRateBp: p.gstRateBp,
        warranty: p.warranty,
        brandId: brandId ?? row.brandId,
        categoryId: categoryId.get(p.category.slug) ?? row.categoryId,
        rangeId: rangeId.get(p.range.slug) ?? row.rangeId,
        hindiMachine: true,
      };
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(want) as (keyof typeof want)[])
        if (!sameJson(want[key], row[key])) changed[key] = want[key];
      if (Object.keys(changed).length > 0) {
        if (write) {
          await updateProduct(row, changed);
          audit('product.updated', row.id, null, { slug: row.slug, fields: Object.keys(changed) });
        }
        counts.productsUpdated += 1;
        touched = true;
      }
    }

    // Status: an old row replaced by this import, or an archived one that is planned again, goes live.
    const wasArchived = row.status === 'archived';
    if (p.status === 'live' && row.status !== 'live' && (!own || wasArchived)) {
      if (write)
        for (const to of pathToLive(row.status)) {
          const from = row.status;
          await updateProduct(row, { status: to, rejectionReason: null });
          audit('product.status_changed', row.id, { status: from }, { status: to, slug: row.slug });
        }
      touched = true;
    }

    // The pack.
    const vs = variantsOf.get(row.id) ?? [];
    const mine = vs.find((v) => v.sku === p.variant.sku);
    const want = {
      options: p.variant.options,
      weightG: p.variant.weightG,
      netQty: p.variant.netQuantity.qty,
      netUnit: p.variant.netQuantity.unit,
    };
    let variantId = mine?.id;
    if (!mine) {
      if (write) {
        const [made] = await db
          .insert(productVariants)
          .values({ productId: row.id, sku: p.variant.sku, mrpPaise: p.variant.mrpPaise, ...want })
          .returning({ id: productVariants.id });
        variantId = made?.id;
      }
      counts.packsCreated += 1;
      if (p.variant.mrpPaise !== null) counts.mrpSet += 1;
      touched = true;
    } else {
      const patch: Partial<typeof productVariants.$inferInsert> = {};
      if (!adminEdited) {
        if (!sameJson(mine.options, want.options)) patch.options = want.options;
        if (mine.weightG !== want.weightG) patch.weightG = want.weightG;
        if (mine.netQty !== want.netQty) patch.netQty = want.netQty;
        if (mine.netUnit !== want.netUnit) patch.netUnit = want.netUnit;
      }
      // The old row's MRP is replaced; one this importer wrote (or staff edited) is only filled where empty.
      if (
        p.variant.mrpPaise !== null &&
        mine.mrpPaise !== p.variant.mrpPaise &&
        (!own || mine.mrpPaise === null)
      ) {
        patch.mrpPaise = p.variant.mrpPaise;
        counts.mrpSet += 1;
      }
      if (mine.status === 'archived' && (!own || wasArchived)) patch.status = 'active';
      if (Object.keys(patch).length > 0) {
        if (write) await db.update(productVariants).set(patch).where(eq(productVariants.id, mine.id));
        touched = true;
      }
    }
    // Other packs of the row are the old import's: archived.
    const stale = vs.filter((v) => v.sku !== p.variant.sku && v.status !== 'archived');
    if (stale.length > 0) {
      if (write)
        await db
          .update(productVariants)
          .set({ status: 'archived' })
          .where(
            inArray(
              productVariants.id,
              stale.map((v) => v.id),
            ),
          );
      counts.variantsArchived += stale.length;
      touched = true;
    }
    if (write && variantId)
      await db
        .insert(partNumbers)
        .values({
          variantId,
          kind: p.partNumber.kind,
          value: p.partNumber.value,
          normalised: p.partNumber.normalised,
        })
        .onConflictDoNothing();
    results.set(p.slug, touched ? 'updated' : 'unchanged');
    if (!touched) counts.productsUnchanged += 1;
  }

  // New products.
  if (fresh.length > 0) {
    counts.productsCreated = fresh.length;
    counts.packsCreated += fresh.length;
    counts.mrpSet += fresh.filter((p) => p.variant.mrpPaise !== null).length;
    if (write) {
      if (brandId === null) throw new ValidationError('The Exide brand is missing', 'GROUP_MISSING');
      const made = await db
        .insert(products)
        .values(
          fresh.map((p) => ({
            slug: p.slug,
            name: p.name,
            nameHi: p.nameHi,
            brandId,
            categoryId: categoryId.get(p.category.slug) ?? '',
            rangeId: rangeId.get(p.range.slug) ?? null,
            description: p.description,
            descriptionHi: p.descriptionHi,
            specSummary: p.specSummary,
            specSummaryHi: p.specSummaryHi,
            compatibility: p.compatibility,
            compatibilityHi: p.compatibilityHi,
            highlights: p.highlights,
            highlightsHi: p.highlightsHi,
            vehicleTypes: p.vehicleTypes,
            spec: p.spec,
            hsn: p.hsn,
            gstRateBp: p.gstRateBp,
            warranty: p.warranty,
            status: p.status,
            hindiMachine: true,
          })),
        )
        .returning({ id: products.id, slug: products.slug });
      const idBySlug = new Map(made.map((m) => [m.slug, m.id]));
      const variants = await db
        .insert(productVariants)
        .values(
          fresh.map((p) => ({
            productId: idBySlug.get(p.slug) ?? '',
            sku: p.variant.sku,
            options: p.variant.options,
            mrpPaise: p.variant.mrpPaise,
            weightG: p.variant.weightG,
            netQty: p.variant.netQuantity.qty,
            netUnit: p.variant.netQuantity.unit,
          })),
        )
        .returning({ id: productVariants.id, sku: productVariants.sku });
      const idBySku = new Map(variants.map((v) => [v.sku, v.id]));
      await db.insert(partNumbers).values(
        fresh.map((p) => ({
          variantId: idBySku.get(p.variant.sku) ?? '',
          kind: p.partNumber.kind,
          value: p.partNumber.value,
          normalised: p.partNumber.normalised,
        })),
      );
      for (const p of fresh)
        audit('product.created', idBySlug.get(p.slug) ?? '', null, {
          slug: p.slug,
          status: p.status,
          category: p.category.slug,
          range: p.range.slug,
          sourceRow: p.sourceRow,
        });
    }
  }

  // Archive every other Exide product.
  const archived: ExideRunResult['archived'] = [];
  for (const row of exideRows) {
    if (matched.has(row.id) || row.status === 'archived') continue;
    archived.push({ slug: row.slug, name: row.name, status: row.status });
    counts.productsArchived += 1;
    if (!write) continue;
    const from = row.status;
    await updateProduct(row, { status: 'archived' });
    const archivedVariants = await db
      .update(productVariants)
      .set({ status: 'archived' })
      .where(and(eq(productVariants.productId, row.id), eq(productVariants.status, 'active')))
      .returning({ id: productVariants.id });
    counts.variantsArchived += archivedVariants.length;
    audit('product.status_changed', row.id, { status: from }, { status: 'archived', slug: row.slug });
  }

  if (write) {
    for (let i = 0; i < audits.length; i += 500) await db.insert(auditLog).values(audits.slice(i, i + 500));
    await recordServerEvent(db, 'admin_exide_imported', {
      userId: staffUserId,
      props: {
        productsCreated: counts.productsCreated,
        productsUpdated: counts.productsUpdated,
        productsArchived: counts.productsArchived,
        packsCreated: counts.packsCreated,
      },
    });
  }
  return { counts, results, archived };
}

/** Read-only: what `applyExideImport` would do (the dry run). Never writes. */
export function diffExideImport(db: Tx, plan: readonly ExidePlannedProduct[]): Promise<ExideRunResult> {
  return execute(db, plan, { write: false, staffUserId: '' });
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyExideImport(
  db: Tx,
  plan: readonly ExidePlannedProduct[],
  opts: { staffUserId: string },
): Promise<ExideRunResult> {
  return db.transaction((tx) => execute(tx, plan, { write: true, staffUserId: opts.staffUserId }));
}

/** A planned product's live photos, for the photo step: where each came from and its content hash. */
export interface ExidePhotoState {
  productId: string;
  sources: Set<string>;
  hashes: Set<string>;
  photoIds: string[];
}

export async function exidePhotoStates(
  db: Tx,
  plan: readonly ExidePlannedProduct[],
): Promise<Map<string, ExidePhotoState>> {
  const out = new Map<string, ExidePhotoState>();
  const prods = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .where(
      inArray(
        products.slug,
        plan.map((p) => p.slug),
      ),
    );
  for (const p of prods)
    out.set(p.slug, { productId: p.id, sources: new Set(), hashes: new Set(), photoIds: [] });
  const byProduct = new Map(prods.map((p) => [p.id, p.slug]));
  if (prods.length === 0) return out;
  const photos = await db
    .select({
      id: productPhotos.id,
      productId: productPhotos.productId,
      source: productPhotos.photoSource,
      sha: mediaObjects.sha256,
    })
    .from(productPhotos)
    .innerJoin(mediaObjects, eq(mediaObjects.id, productPhotos.mediaId))
    .where(
      and(
        inArray(
          productPhotos.productId,
          prods.map((p) => p.id),
        ),
        isNull(productPhotos.deletedAt),
      ),
    )
    .orderBy(productPhotos.sort);
  for (const ph of photos) {
    const state = out.get(byProduct.get(ph.productId) ?? '');
    if (!state) continue;
    state.photoIds.push(ph.id);
    if (ph.source) state.sources.add(ph.source);
    if (ph.sha) state.hashes.add(ph.sha);
  }
  return out;
}
