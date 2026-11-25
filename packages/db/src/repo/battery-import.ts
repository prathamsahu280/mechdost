import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PlannedProduct } from '../battery-import/types';
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
 * Writing a battery brand's plan (Exide and Amaron importers, user 2026-11-23, runbook `catalogue-import.md`). One
 * transaction, one advisory lock:
 *  1. every existing product of the brand that is not in the plan is ARCHIVED (conditional update on `version`;
 *     its variants too). Never deleted: old orders and carts point at them;
 *  2. every planned product is created, or updated in place when its SKU or slug already exists;
 *  3. a re-run changes nothing. A product this importer made earlier (`spec.source` = the brand's source tag) that staff have
 *     since edited (`hindi_machine = false`) keeps its texts, and an MRP is only filled where the pack has none.
 * `diffBatteryImport` runs the same code without writing (the dry run).
 */
/** What differs between the brands: the brand row, the `spec.source` tag, the audit tag and the analytics event. */
export interface BatteryImportConfig {
  brand: { slug: string; name: string };
  /** `spec.source` of the products this importer writes ("exidecare", "amaron"). */
  specSource: string;
  /** `source` in the audit rows ("exide_import"). */
  auditSource: string;
  event:
    | 'admin_exide_imported'
    | 'admin_amaron_imported'
    | 'admin_tatagreen_imported'
    | 'admin_ceat_imported'
    | 'admin_mrf_imported'
    | 'admin_apollo_imported'
    | 'admin_hp_imported'
    | 'admin_bpcl_imported'
    | 'admin_servo_imported';
  /** Brands (slugs) whose old products this import archives too (Apollo: Vredestein). Never anything else. */
  alsoArchiveBrands?: readonly string[];
  /** Slugs of existing products that are never archived although they are not in the plan (HP Racer4: it has orders). */
  keepSlugs?: readonly string[];
}

export interface BatteryImportCounts {
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

export type BatteryRowResult = 'created' | 'updated' | 'unchanged';

export interface BatteryRunResult {
  counts: BatteryImportCounts;
  /** By planned slug. */
  results: Map<string, BatteryRowResult>;
  /** Old products of the brand archived (or to be archived in a dry run). */
  archived: { slug: string; name: string; status: string }[];
}

const LOCK = sql`select pg_advisory_xact_lock(hashtextextended('catalogue:create', 0))`;

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

function emptyCounts(): BatteryImportCounts {
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
  cfg: BatteryImportConfig,
  plan: readonly PlannedProduct[],
  opts: { write: boolean; staffUserId: string },
): Promise<BatteryRunResult> {
  const { write, staffUserId } = opts;
  const counts = emptyCounts();
  const results = new Map<string, BatteryRowResult>();
  const audits: (typeof auditLog.$inferInsert)[] = [];
  const audit = (action: string, entityId: string, before: unknown, after: Record<string, unknown>) =>
    audits.push({
      actorUserId: staffUserId,
      actorRole: 'staff',
      action,
      entity: 'product',
      entityId,
      before: before ?? null,
      after: { ...after, source: cfg.auditSource },
    });
  if (write) await db.execute(LOCK);

  // Brand.
  let [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.slug, cfg.brand.slug));
  if (!brand) {
    counts.brandsCreated = 1;
    if (write) {
      [brand] = await db
        .insert(brands)
        .values({ slug: cfg.brand.slug, name: cfg.brand.name })
        .returning({ id: brands.id });
    }
  }
  const brandId = brand?.id ?? null;
  const alsoIds =
    cfg.alsoArchiveBrands && cfg.alsoArchiveBrands.length > 0
      ? (
          await db
            .select({ id: brands.id })
            .from(brands)
            .where(inArray(brands.slug, [...cfg.alsoArchiveBrands]))
        ).map((b) => b.id)
      : [];

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
        description: c.description ?? null,
        descriptionHi: c.descriptionHi ?? null,
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
        after: { slug: c.slug, source: cfg.auditSource },
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
  const brandRows: ProductRow[] =
    brandId === null
      ? []
      : await db
          .select()
          .from(products)
          .where(inArray(products.brandId, [brandId, ...alsoIds]));
  const byId = new Map(brandRows.map((r) => [r.id, r]));
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
        plan.flatMap((p) => p.variants.map((v) => v.sku)),
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
  const fresh: PlannedProduct[] = [];
  const isOfBrand = (r: ProductRow) => brandId !== null && r.brandId === brandId;

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
    // The product holding any of the planned SKUs (all of them must sit on the one product), else the one with the slug.
    const owners = new Set(p.variants.flatMap((v) => bySku.get(v.sku)?.productId ?? []));
    if (owners.size > 1)
      throw new ConflictError(`The sizes of ${p.slug} sit on different products`, 'SKU_SPLIT');
    const [ownerId] = owners;
    const row = (ownerId === undefined ? undefined : byId.get(ownerId)) ?? bySlug.get(p.slug);
    if (!row) {
      fresh.push(p);
      results.set(p.slug, 'created');
      continue;
    }
    if (!isOfBrand(row))
      throw new ValidationError(`${p.slug} (or its SKU) belongs to another brand's product`, 'SLUG_TAKEN');
    if (matched.has(row.id))
      throw new ConflictError(`Two source rows match the product ${row.slug}`, 'DUPLICATE_MATCH');
    matched.add(row.id);

    const own = (row.spec as { source?: unknown } | null)?.source === cfg.specSource;
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

    // The packs: one per planned variant (a tyre pattern has one per size).
    const vs = variantsOf.get(row.id) ?? [];
    const planned = new Set(p.variants.map((v) => v.sku));
    for (const pv of p.variants) {
      const mine = vs.find((v) => v.sku === pv.sku);
      const want = {
        options: pv.options,
        weightG: pv.weightG,
        netQty: pv.netQuantity.qty,
        netUnit: pv.netQuantity.unit,
      };
      let variantId = mine?.id;
      if (!mine) {
        if (write) {
          const [made] = await db
            .insert(productVariants)
            .values({ productId: row.id, sku: pv.sku, mrpPaise: pv.mrpPaise, barcode: pv.barcode, ...want })
            .returning({ id: productVariants.id });
          variantId = made?.id;
        }
        counts.packsCreated += 1;
        if (pv.mrpPaise !== null) counts.mrpSet += 1;
        touched = true;
      } else {
        const patch: Partial<typeof productVariants.$inferInsert> = {};
        if (!adminEdited) {
          if (!sameJson(mine.options, want.options)) patch.options = want.options;
          if (mine.weightG !== want.weightG) patch.weightG = want.weightG;
          if (mine.netQty !== want.netQty) patch.netQty = want.netQty;
          if (mine.netUnit !== want.netUnit) patch.netUnit = want.netUnit;
        }
        // A barcode the source states is written; one staff typed is kept when the source has none.
        if (pv.barcode !== null && mine.barcode !== pv.barcode && !adminEdited) patch.barcode = pv.barcode;
        // The old row's MRP is replaced; one this importer wrote (or staff edited) is only filled where empty.
        if (pv.mrpPaise !== null && mine.mrpPaise !== pv.mrpPaise && (!own || mine.mrpPaise === null)) {
          patch.mrpPaise = pv.mrpPaise;
          counts.mrpSet += 1;
        }
        if (mine.status === 'archived' && (!own || wasArchived)) patch.status = 'active';
        if (Object.keys(patch).length > 0) {
          if (write) await db.update(productVariants).set(patch).where(eq(productVariants.id, mine.id));
          touched = true;
        }
      }
      if (write && variantId && pv.partNumbers.length > 0)
        await db
          .insert(partNumbers)
          .values(pv.partNumbers.map((n) => ({ variantId, ...n })))
          .onConflictDoNothing();
    }
    // Other packs of the row are the old import's (or a size the maker dropped): archived, the planned ones untouched.
    const stale = vs.filter((v) => !planned.has(v.sku) && v.status !== 'archived');
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
    results.set(p.slug, touched ? 'updated' : 'unchanged');
    if (!touched) counts.productsUnchanged += 1;
  }

  // New products.
  if (fresh.length > 0) {
    counts.productsCreated = fresh.length;
    for (const p of fresh) {
      counts.packsCreated += p.variants.length;
      counts.mrpSet += p.variants.filter((v) => v.mrpPaise !== null).length;
    }
    if (write) {
      if (brandId === null)
        throw new ValidationError(`The ${cfg.brand.name} brand is missing`, 'GROUP_MISSING');
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
      const idBySku = new Map<string, string>();
      const packRows = fresh.flatMap((p) =>
        p.variants.map((v) => ({
          productId: idBySlug.get(p.slug) ?? '',
          sku: v.sku,
          options: v.options,
          mrpPaise: v.mrpPaise,
          barcode: v.barcode,
          weightG: v.weightG,
          netQty: v.netQuantity.qty,
          netUnit: v.netQuantity.unit,
        })),
      );
      for (let k = 0; k < packRows.length; k += 500)
        for (const v of await db
          .insert(productVariants)
          .values(packRows.slice(k, k + 500))
          .returning({ id: productVariants.id, sku: productVariants.sku }))
          idBySku.set(v.sku, v.id);
      const partRows = fresh.flatMap((p) =>
        p.variants.flatMap((v) => v.partNumbers.map((n) => ({ variantId: idBySku.get(v.sku) ?? '', ...n }))),
      );
      for (let k = 0; k < partRows.length; k += 500)
        await db
          .insert(partNumbers)
          .values(partRows.slice(k, k + 500))
          .onConflictDoNothing();
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

  // Archive every other product of the brand (except the ones the config keeps).
  const keep = new Set(cfg.keepSlugs ?? []);
  const archived: BatteryRunResult['archived'] = [];
  for (const row of brandRows) {
    if (matched.has(row.id) || row.status === 'archived' || keep.has(row.slug)) continue;
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
    await recordServerEvent(db, cfg.event, {
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

/** Read-only: what `applyBatteryImport` would do (the dry run). Never writes. */
export function diffBatteryImport(
  db: Tx,
  cfg: BatteryImportConfig,
  plan: readonly PlannedProduct[],
): Promise<BatteryRunResult> {
  return execute(db, cfg, plan, { write: false, staffUserId: '' });
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyBatteryImport(
  db: Tx,
  cfg: BatteryImportConfig,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return db.transaction((tx) => execute(tx, cfg, plan, { write: true, staffUserId: opts.staffUserId }));
}

/** A planned product's live photos, for the photo step: where each came from and its content hash. */
export interface BatteryPhotoState {
  productId: string;
  sources: Set<string>;
  hashes: Set<string>;
  /** Live photo ids in gallery order. */
  photoIds: string[];
  /** The photo id holding a source URL / a content hash (to place a photo that is already there). */
  idBySource: Map<string, string>;
  idByHash: Map<string, string>;
}

export async function batteryPhotoStates(
  db: Tx,
  plan: readonly PlannedProduct[],
): Promise<Map<string, BatteryPhotoState>> {
  const out = new Map<string, BatteryPhotoState>();
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
    out.set(p.slug, {
      productId: p.id,
      sources: new Set(),
      hashes: new Set(),
      photoIds: [],
      idBySource: new Map(),
      idByHash: new Map(),
    });
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
    if (ph.source) {
      state.sources.add(ph.source);
      if (!state.idBySource.has(ph.source)) state.idBySource.set(ph.source, ph.id);
    }
    if (ph.sha) {
      state.hashes.add(ph.sha);
      if (!state.idByHash.has(ph.sha)) state.idByHash.set(ph.sha, ph.id);
    }
  }
  return out;
}
