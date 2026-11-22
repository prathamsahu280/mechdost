import { sql } from 'drizzle-orm';
import { BULK_MAX } from '@mechdost/shared/catalogue-groups';
import { productMachine } from '@mechdost/shared/state';
import { auditLog } from '../schema';
import { hasHindiGap, requireHindiToPublish } from './catalogue-admin';
import { ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Bulk actions on the admin product list (design 2026-11-22): publish or unpublish many products, set MRPs of many
 * packs. At most `BULK_MAX` per call, one transaction, one audit batch. Every change is ONE conditional UPDATE (the
 * status or the MRP rule is in its WHERE), so a product that moved meanwhile is reported as skipped, never forced.
 * Permissions (`products:publish`, `products:write`) are checked by the API.
 */
export type BulkStatusAction = 'publish' | 'unpublish';

export interface BulkStatusResult {
  changed: string[];
  skipped: { slug: string; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'NO_VARIANT' | 'HINDI_MISSING' }[];
}

const slugList = (slugs: readonly string[]) =>
  sql.join(
    slugs.map((s) => sql`${s}`),
    sql`, `,
  );

/**
 * `publish` = draft/submitted → live (through the same machine edges as one product: the "from" set is read from
 * `productMachine`); `unpublish` = live → archived (the machine's only way off the storefront).
 */
export async function bulkSetProductStatus(
  db: Tx,
  input: { slugs: readonly string[]; action: BulkStatusAction; staffUserId: string },
): Promise<BulkStatusResult> {
  const slugs = [...new Set(input.slugs)];
  if (slugs.length === 0 || slugs.length > BULK_MAX)
    throw new ValidationError(`Choose 1 to ${String(BULK_MAX)} products`, 'BULK_SIZE');
  const to = input.action === 'publish' ? 'live' : 'archived';
  const from = input.action === 'publish' ? (['draft', 'submitted'] as const) : (['live'] as const);
  for (const f of from) productMachine.assert(f, to, 'admin');
  return db.transaction(async (tx) => {
    const hindi = input.action === 'publish' && (await requireHindiToPublish(tx));
    const changedRows = rowsOf<{ slug: string; was: string }>(
      await tx.execute(sql`
        with before as (select p.id, p.slug, p.status as was from products p where p.slug in (${slugList(slugs)}) for update)
        update products set status = ${to}
        from before b
        where products.id = b.id and products.status in (${sql.join(
          from.map((f) => sql`${f}`),
          sql`, `,
        )})
          ${input.action === 'publish' ? sql`and exists (select 1 from product_variants v where v.product_id = products.id and v.status = 'active')` : sql``}
          ${hindi ? sql`and not ${hasHindiGap}` : sql``}
        returning products.slug, b.was`),
    );
    const changed = changedRows.map((r) => r.slug);
    const done = new Set(changed);
    const left = slugs.filter((s) => !done.has(s));
    const known = new Map(
      left.length === 0
        ? []
        : rowsOf<{ slug: string; status: string; variants: unknown; gap: boolean }>(
            await tx.execute(sql`
              select products.slug, products.status,
                (select count(*) from product_variants v where v.product_id = products.id and v.status = 'active') as variants,
                (${hasHindiGap}) as gap
              from products where products.slug in (${slugList(left)})`),
          ).map((r) => [r.slug, r] as const),
    );
    const skipped = left.map((slug) => {
      const r = known.get(slug);
      if (!r) return { slug, reason: 'NOT_FOUND' as const };
      if (!(from as readonly string[]).includes(r.status)) return { slug, reason: 'WRONG_STATE' as const };
      if (input.action === 'publish' && num(r.variants) === 0) return { slug, reason: 'NO_VARIANT' as const };
      return { slug, reason: hindi && r.gap ? ('HINDI_MISSING' as const) : ('WRONG_STATE' as const) };
    });
    if (changed.length > 0) {
      await tx.insert(auditLog).values(
        changedRows.map((r) => ({
          actorUserId: input.staffUserId,
          actorRole: 'staff',
          action: 'product.status_changed',
          entity: 'product',
          entityId: r.slug,
          before: { status: r.was },
          after: { status: to, bulk: true },
        })),
      );
      await recordServerEvent(tx, 'admin_products_bulk', {
        userId: input.staffUserId,
        props: { action: input.action, count: changed.length },
      });
    }
    return { changed, skipped };
  });
}

export interface MrpItem {
  sku: string;
  mrpPaise: number;
}

export interface BulkMrpResult {
  updated: string[];
  skipped: { sku: string; reason: 'NOT_FOUND' | 'BELOW_PRICE' }[];
}

/**
 * Set the MRP of many packs (incl. GST, integer paise). An MRP is never lowered under a price already set for the
 * pack (a shop's approved price or the admin's city/PIN price): MRP is the legal ceiling (Legal Metrology), so such a
 * pack is skipped as `BELOW_PRICE` and the admin fixes the price first.
 */
export async function bulkSetMrp(
  db: Tx,
  input: { items: readonly MrpItem[]; staffUserId: string },
): Promise<BulkMrpResult> {
  const items = [...new Map(input.items.map((i) => [i.sku, i])).values()];
  if (items.length === 0 || items.length > BULK_MAX)
    throw new ValidationError(`Choose 1 to ${String(BULK_MAX)} packs`, 'BULK_SIZE');
  for (const i of items)
    if (!Number.isSafeInteger(i.mrpPaise) || i.mrpPaise < 1 || i.mrpPaise > 100_000_000)
      throw new ValidationError('An MRP is ₹0.01 to ₹10,00,000', 'MRP_INVALID');
  return db.transaction(async (tx) => {
    const changed = rowsOf<{ sku: string; before: unknown }>(
      await tx.execute(sql`
        with want as (
          select * from jsonb_to_recordset(${JSON.stringify(items)}::jsonb) as w(sku text, "mrpPaise" bigint)
        ), cur as (
          select v.id, v.sku, v.mrp_paise as before, w."mrpPaise" as next from product_variants v join want w on w.sku = v.sku for update of v
        )
        update product_variants v set mrp_paise = c.next
        from cur c
        where v.id = c.id
          and not exists (select 1 from shop_inventory si where si.variant_id = v.id and si.selling_paise > c.next)
          and not exists (select 1 from admin_prices ap where ap.variant_id = v.id and ap.selling_paise > c.next)
        returning v.sku, c.before`),
    );
    const done = new Set(changed.map((c) => c.sku));
    const left = items.filter((i) => !done.has(i.sku)).map((i) => i.sku);
    const known = new Set(
      left.length === 0
        ? []
        : rowsOf<{ sku: string }>(
            await tx.execute(sql`select sku from product_variants where sku in (${slugList(left)})`),
          ).map((r) => r.sku),
    );
    const skipped = left.map((sku) => ({
      sku,
      reason: known.has(sku) ? ('BELOW_PRICE' as const) : ('NOT_FOUND' as const),
    }));
    if (changed.length > 0) {
      const next = new Map(items.map((i) => [i.sku, i.mrpPaise]));
      await tx.insert(auditLog).values(
        changed.map((c) => ({
          actorUserId: input.staffUserId,
          actorRole: 'staff',
          action: 'variant.mrp_updated',
          entity: 'product_variant',
          entityId: c.sku,
          before: { mrpPaise: c.before === null ? null : num(c.before) },
          after: { mrpPaise: next.get(c.sku) ?? null },
        })),
      );
      await recordServerEvent(tx, 'admin_products_bulk', {
        userId: input.staffUserId,
        props: { action: 'set_mrp', count: changed.length },
      });
    }
    return { updated: changed.map((c) => c.sku), skipped };
  });
}
