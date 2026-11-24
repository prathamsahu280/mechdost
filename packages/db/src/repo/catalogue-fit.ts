import { sql } from 'drizzle-orm';
import { fitsFitment, type TyreFitLine } from '@mechdost/shared/variants';
import { NotFoundError } from './errors';
import { listVehicles } from './account';
import { rowsOf } from './sql-rows';
import type { Tx } from './orders';
import { productVisible } from './visibility';

export interface VariantFit {
  /** The first size whose fitment lists one of the customer's saved vehicles; null = none (or nothing saved). */
  fitsVariantSku: string | null;
  /** That vehicle's make and model, for "Fits your <vehicle>"; the fitment lists themselves never leave. */
  vehicle: { make: string; model: string } | null;
}

const NONE: VariantFit = { fitsVariantSku: null, vehicle: null };

const isFitLine = (v: unknown): v is TyreFitLine =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Record<string, unknown>).vehicleType === 'string' &&
  typeof (v as Record<string, unknown>).make === 'string' &&
  typeof (v as Record<string, unknown>).model === 'string';

/**
 * "Fits your vehicle" for a product sold in several sizes (user 2026-11-24): the signed-in customer's own saved
 * vehicles (actor-scoped, so another customer's are never read) against the private per-size fitment in
 * `spec.variantSpecs[sku].fitment`. Computed here so the fitment (hundreds of vehicles) stays out of every public
 * payload; the answer is one SKU and the vehicle's make and model. A product that is not live is a 404.
 */
export async function fitVariantForUser(db: Tx, userId: string, slug: string): Promise<VariantFit> {
  const [row] = rowsOf<{ specs: Record<string, unknown> | null; skus: string[] }>(
    await db.execute(sql`
      select p.spec -> 'variantSpecs' as specs,
        coalesce(array_agg(v.sku order by v.sku) filter (where v.id is not null), '{}') as skus
      from products p
      left join product_variants v on v.product_id = p.id and v.status = 'active'
      where p.slug = ${slug} and ${productVisible('p')}
      group by p.id`),
  );
  if (!row) throw new NotFoundError('Product not found');
  const specs = row.specs;
  if (!specs || typeof specs !== 'object') return NONE;
  const vehicles = await listVehicles(db, userId);
  if (vehicles.length === 0) return NONE;
  for (const sku of row.skus) {
    const spec: unknown = specs[sku];
    const list: unknown =
      typeof spec === 'object' && spec !== null ? (spec as Record<string, unknown>).fitment : null;
    if (!Array.isArray(list)) continue;
    const fitment = (list as unknown[]).filter(isFitLine);
    const vehicle = vehicles.find((v) => fitsFitment(fitment, v));
    if (vehicle) return { fitsVariantSku: sku, vehicle: { make: vehicle.make, model: vehicle.model } };
  }
  return NONE;
}
