import { and, eq, sql } from 'drizzle-orm';
import { isVehicleSegment, VEHICLE_SEGMENTS, type VehicleSegment } from '@mechdost/shared/vehicle-segments';
import { auditLog, productVehicleSegments, products, vehicleSegments } from '../schema';
import { productVisible } from './visibility';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Vehicle segments (design 2026-11-25, spec 02 "Vehicle segments", spec 08 Catalogue). Staff with `products:write`
 * rename, reorder and switch segments on or off, and set each product's segments (hard rule 8). Every change is a
 * conditional update on `version` with an audit row holding the fields that changed (hard rule 3). Switching a
 * segment off hides its chip and tag; the products keep their rows.
 */
export interface AdminSegmentRow {
  code: VehicleSegment;
  nameEn: string;
  nameHi: string;
  descriptionEn: string | null;
  descriptionHi: string | null;
  sort: number;
  active: boolean;
  version: number;
  /** Live products tagged with it. */
  products: number;
}

/** Every segment in staff order (active or not), with how many live products carry it. */
export async function listAdminSegments(db: Tx): Promise<AdminSegmentRow[]> {
  const rows = rowsOf<{
    code: string;
    name_en: string;
    name_hi: string;
    description_en: string | null;
    description_hi: string | null;
    sort: number;
    active: boolean;
    version: number;
    n: unknown;
  }>(
    await db.execute(sql`
      select vs.code, vs.name_en, vs.name_hi, vs.description_en, vs.description_hi, vs.sort, vs.active, vs.version,
        (select count(*) from product_vehicle_segments ps join products p on p.id = ps.product_id
          where ps.segment_code = vs.code and ${productVisible('p')}) as n
      from vehicle_segments vs order by vs.sort, vs.code`),
  );
  return rows.flatMap((r) =>
    isVehicleSegment(r.code)
      ? [
          {
            code: r.code,
            nameEn: r.name_en,
            nameHi: r.name_hi,
            descriptionEn: r.description_en,
            descriptionHi: r.description_hi,
            sort: r.sort,
            active: r.active,
            version: r.version,
            products: num(r.n),
          },
        ]
      : [],
  );
}

export interface SegmentPatch {
  nameEn?: string;
  nameHi?: string;
  descriptionEn?: string | null;
  descriptionHi?: string | null;
  sort?: number;
  active?: boolean;
}

/** Edit one segment's texts, order or switch. Optimistic `version`; audited with the old and new values. */
export async function updateVehicleSegment(
  db: Tx,
  input: { code: string; expectedVersion: number; patch: SegmentPatch; staffUserId: string },
): Promise<AdminSegmentRow> {
  if (!isVehicleSegment(input.code)) throw new NotFoundError('Segment not found');
  const code = input.code;
  const { patch } = input;
  if (Object.keys(patch).length === 0) throw new ValidationError('Nothing to change', 'SEGMENT_EMPTY');
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(vehicleSegments).where(eq(vehicleSegments.code, code));
    if (!before) throw new NotFoundError('Segment not found');
    const [row] = await tx
      .update(vehicleSegments)
      .set(patch)
      .where(and(eq(vehicleSegments.code, code), eq(vehicleSegments.version, input.expectedVersion)))
      .returning({ version: vehicleSegments.version });
    if (!row) throw new ConflictError('Someone else changed this segment; reload', 'STALE_SEGMENT');
    const changed = Object.keys(patch) as (keyof SegmentPatch)[];
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'vehicle_segment.updated',
      entity: 'vehicle_segment',
      entityId: code,
      before: { code, ...Object.fromEntries(changed.map((k) => [k, before[k]])) },
      after: { code, ...Object.fromEntries(changed.map((k) => [k, patch[k]])) },
    });
  });
  const updated = (await listAdminSegments(db)).find((s) => s.code === code);
  if (!updated) throw new NotFoundError('Segment not found');
  return updated;
}

/** The codes of a product's segments, in the shared order. */
export async function productSegmentCodes(db: Tx, productId: string): Promise<VehicleSegment[]> {
  const rows = await db
    .select({ code: productVehicleSegments.segmentCode })
    .from(productVehicleSegments)
    .where(eq(productVehicleSegments.productId, productId));
  const set = new Set(rows.map((r) => r.code));
  return VEHICLE_SEGMENTS.filter((c) => set.has(c));
}

/**
 * Replace a product's segments (admin control, rule 8). Codes come from the shared list only, duplicates collapse;
 * the product row's `version` is the compare-and-set token and moves on (the storefront cache follows). Audited.
 */
export async function setProductSegments(
  db: Tx,
  input: { slug: string; expectedVersion: number; segments: readonly string[]; staffUserId: string },
): Promise<{ version: number; segments: VehicleSegment[] }> {
  if (!input.segments.every(isVehicleSegment))
    throw new ValidationError('Unknown vehicle segment', 'PRODUCT_SEGMENTS');
  const next = VEHICLE_SEGMENTS.filter((c) => input.segments.includes(c));
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, input.slug));
    if (!current) throw new NotFoundError('Product not found');
    // A no-op update moves `version` and `updated_at` (triggers): the compare-and-set for the whole edit.
    const [row] = await tx
      .update(products)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(products.id, current.id), eq(products.version, input.expectedVersion)))
      .returning({ version: products.version });
    if (!row) throw new ConflictError('Someone else changed this product; reload', 'STALE_PRODUCT');
    const before = await productSegmentCodes(tx, current.id);
    await tx.delete(productVehicleSegments).where(eq(productVehicleSegments.productId, current.id));
    if (next.length > 0)
      await tx
        .insert(productVehicleSegments)
        .values(next.map((segmentCode) => ({ productId: current.id, segmentCode })));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'product.segments_updated',
      entity: 'product',
      entityId: current.id,
      before: { segments: before },
      after: { segments: next },
    });
    return { version: row.version, segments: next };
  });
}

export interface PublicSegment {
  code: VehicleSegment;
  name: string;
  description: string | null;
  /** Live products tagged with it. */
  count: number;
}

/** The active segments in staff order, named in the page language, with live product counts (home tiles). */
export async function listPublicSegments(db: Tx, locale: 'en' | 'hi'): Promise<PublicSegment[]> {
  const rows = rowsOf<{ code: string; name: string; description: string | null; n: unknown }>(
    await db.execute(sql`
      select vs.code, ${locale === 'hi' ? sql`vs.name_hi` : sql`vs.name_en`} as name,
        ${locale === 'hi' ? sql`coalesce(vs.description_hi, vs.description_en)` : sql`vs.description_en`} as description,
        (select count(*) from product_vehicle_segments ps join products p on p.id = ps.product_id
          where ps.segment_code = vs.code and ${productVisible('p')}) as n
      from vehicle_segments vs where vs.active order by vs.sort, vs.code`),
  );
  return rows.flatMap((r) =>
    isVehicleSegment(r.code)
      ? [{ code: r.code, name: r.name, description: r.description, count: num(r.n) }]
      : [],
  );
}
